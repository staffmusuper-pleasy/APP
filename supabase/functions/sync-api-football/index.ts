// sync-api-football
// Fetches fixtures (teams, scheduled + finished matches, cards, corners) for a
// given league/season from api-football.com (v3). Free tier = 100 req/day.
//
// Body:
//   { league_id: uuid (required) — public.leagues row to populate
//     af_league_id: number (required) — API-Football league id
//     af_season: number (required) — e.g. 2025
//     fixture_limit?: number — cap fixture-statistics requests (default 50) }
//
// Notes:
//   - One /fixtures call returns the WHOLE season → cheap.
//   - Cards/corners require one /fixtures/statistics per finished fixture →
//     can blow through the daily quota. Capped by fixture_limit.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AF_KEY = Deno.env.get("API_FOOTBALL_KEY") ?? "";

const BASE = "https://v3.football.api-sports.io";

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+(fc|cf|sc|ac|afc|cfc|fk|sk|bk|if|kf|club|football club|calcio|ssd|asd)\.?$/gi, "")
    .replace(/^(fc|cf|sc|ac|afc|cfc|fk|sk|bk|if|kf)\s+/gi, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function afGet(path: string, params: Record<string, string | number>) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: { "x-apisports-key": AF_KEY },
  });
  if (!res.ok) throw new Error(`api-football ${path} ${res.status}`);
  const json = await res.json();
  if (json.errors && (Array.isArray(json.errors) ? json.errors.length : Object.keys(json.errors).length)) {
    console.log(`[api-football] ${path}`, JSON.stringify(params), "errors:", JSON.stringify(json.errors));
  }
  console.log(`[api-football] ${path}`, JSON.stringify(params), "results:", json.results);
  return json;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!AF_KEY) return json({ error: "API_FOOTBALL_KEY missing" }, 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: {
    league_id?: string;
    af_league_id?: number;
    af_season?: number;
    fixture_limit?: number;
    from_date?: string; // YYYY-MM-DD; only fetch fixtures on/after this date
    stats_only?: boolean; // skip ingest; only enrich finished matches missing cards/corners
  } = {};
  try { body = await req.json(); } catch {}
  if (!body.league_id || !body.af_league_id || !body.af_season) {
    return json({ error: "league_id, af_league_id, af_season required" }, 400);
  }

  const fixtureLimit = Math.max(0, Math.min(body.fixture_limit ?? 50, 300));
  const statsOnly = body.stats_only === true;

  // Resolve league row
  const { data: league } = await supabase.from("leagues").select("*").eq("id", body.league_id).single();
  if (!league) return json({ error: "league not found" }, 404);

  // Persist api_football_id mapping if missing
  if (!league.api_football_id) {
    await supabase.from("leagues").update({ api_football_id: body.af_league_id }).eq("id", league.id);
  }

  const { data: source } = await supabase
    .from("data_sources")
    .upsert({ name: "api-football", active: true }, { onConflict: "name" })
    .select().single();

  const { data: job } = await supabase
    .from("sync_jobs")
    .insert({
      job_name: `api-football${statsOnly ? "(stats)" : ""}:${league.name}:${body.af_season}`,
      source: source!.id,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select().single();

  // Helper: write a row to pipeline_logs for each finished fixture processed.
  const logFixture = async (row: {
    match_id?: string | null;
    af_fixture_id: number;
    match_date: string;
    cards_found: boolean;
    corners_found: boolean;
    cards_written: boolean;
    corners_written: boolean;
    status: "success" | "partial" | "skipped" | "failed";
    error_message?: string | null;
  }) => {
    try {
      await supabase.from("pipeline_logs").insert({
        provider: "api-football",
        job_run_id: job?.id ?? null,
        league_id: league.id,
        match_id: row.match_id ?? null,
        provider_fixture_id: String(row.af_fixture_id),
        match_date: row.match_date,
        cards_found: row.cards_found,
        corners_found: row.corners_found,
        cards_written: row.cards_written,
        corners_written: row.corners_written,
        status: row.status,
        error_message: row.error_message ?? null,
      });
    } catch { /* log best-effort */ }
  };

  try {
    // 1) Fetch fixtures. Incremental: when from_date is provided, only ask
    // the upstream for fixtures on/after that date — historical matches that
    // are already stored locally are never re-fetched.
    const fxParams: Record<string, string | number> = {
      league: body.af_league_id,
      season: body.af_season,
    };
    if (body.from_date && /^\d{4}-\d{2}-\d{2}$/.test(body.from_date)) {
      fxParams.from = body.from_date;
      // 'to' must accompany 'from'. Cap at +400 days to cover the rest of the season.
      const to = new Date(body.from_date);
      to.setUTCDate(to.getUTCDate() + 400);
      fxParams.to = to.toISOString().slice(0, 10);
    }
    const fixturesRes = await afGet("/fixtures", fxParams);
    const fixtures: any[] = fixturesRes.response ?? [];

    // 2) Build set of unique teams from fixtures
    const teamMap = new Map<number, { id: number; name: string }>();
    for (const f of fixtures) {
      teamMap.set(f.teams.home.id, { id: f.teams.home.id, name: f.teams.home.name });
      teamMap.set(f.teams.away.id, { id: f.teams.away.id, name: f.teams.away.name });
    }

    // 3) Resolve / upsert teams.
    const { data: existing } = await supabase
      .from("teams")
      .select("id, name, normalized_name, api_football_id, country")
      .eq("country", league.country);
    const byAf = new Map<number, string>();
    const byNorm = new Map<string, string>();
    (existing ?? []).forEach((t) => {
      if (t.api_football_id) byAf.set(t.api_football_id, t.id);
      byNorm.set(t.normalized_name, t.id);
    });
    const { data: aliasRows } = await supabase
      .from("team_aliases")
      .select("team_id, normalized_alias, source");
    const byAlias = new Map<string, string>();
    (aliasRows ?? []).forEach((a) => byAlias.set(a.normalized_alias, a.team_id));

    const afIdToTeamId = new Map<number, string>();
    for (const t of teamMap.values()) {
      const norm = normalize(t.name);
      let teamId = byAf.get(t.id) ?? byNorm.get(norm) ?? byAlias.get(norm);
      if (!teamId) {
        const { data: ins } = await supabase
          .from("teams")
          .insert({
            name: t.name,
            normalized_name: norm,
            country: league.country,
            league_id: league.id,
            api_football_id: t.id,
          })
          .select().single();
        teamId = ins?.id;
      } else {
        await supabase.from("teams").update({ api_football_id: t.id }).eq("id", teamId).is("api_football_id", null);
        if (!byNorm.has(norm) && !byAlias.has(norm)) {
          await supabase.from("team_aliases").insert({
            team_id: teamId, alias: t.name, normalized_alias: norm, source: "api-football",
          }).select();
        }
      }
      if (teamId) afIdToTeamId.set(t.id, teamId);
    }

    // 4) Build incoming match rows from the (possibly date-filtered) response.
    const season = String(body.af_season);
    const incoming: any[] = [];
    let withStats = 0;
    for (const f of fixtures) {
      const home = afIdToTeamId.get(f.teams.home.id);
      const away = afIdToTeamId.get(f.teams.away.id);
      if (!home || !away) continue;
      const status = f.fixture.status.short;
      const finished = ["FT", "AET", "PEN"].includes(status);
      incoming.push({
        league_id: league.id,
        season,
        round: f.league.round ?? null,
        status: finished ? "finished" : "scheduled",
        match_date: new Date(f.fixture.date).toISOString(),
        home_team_id: home,
        away_team_id: away,
        home_goals: finished ? (f.goals.home ?? 0) : null,
        away_goals: finished ? (f.goals.away ?? 0) : null,
      });
    }

    const futureScheduled = incoming.filter((m) =>
      m.status === "scheduled" && new Date(m.match_date).getTime() >= Date.now()
    ).length;

    let inserted = 0, updated = 0, unchanged = 0;

    // 4b) DELTA UPSERT — skipped entirely in stats_only mode.
    // Note: removed the previous early-return on futureScheduled===0 because
    // it skipped finished-match enrichment for ended seasons. We always fall
    // through to the stats loop below.
    if (!statsOnly && incoming.length > 0) {
      const dateList = incoming.map((m) => m.match_date);
      const { data: current } = await supabase
        .from("matches")
        .select("id, match_date, home_team_id, away_team_id, status, home_goals, away_goals, home_cards, away_cards, home_corners, away_corners, round")
        .eq("league_id", league.id)
        .eq("season", season)
        .in("match_date", dateList.length ? dateList : ["1970-01-01"]);
      const keyOf = (m: any) => `${m.home_team_id}|${m.away_team_id}|${m.match_date}`;
      const existingByKey = new Map<string, any>();
      (current ?? []).forEach((m) => existingByKey.set(keyOf(m), m));

      for (const row of incoming) {
        const ex = existingByKey.get(keyOf(row));
        if (!ex) {
          await supabase.from("matches").insert(row);
          inserted++;
          continue;
        }
        const changed =
          ex.status !== row.status ||
          ex.home_goals !== row.home_goals ||
          ex.away_goals !== row.away_goals ||
          new Date(ex.match_date).toISOString() !== row.match_date ||
          (ex.round ?? null) !== (row.round ?? null);
        if (changed) {
          await supabase.from("matches").update({
            status: row.status,
            home_goals: row.home_goals,
            away_goals: row.away_goals,
            match_date: row.match_date,
            round: row.round,
          }).eq("id", ex.id);
          updated++;
        } else {
          unchanged++;
        }
      }
    }

    // 4c) Register provider→match mapping for every fixture we know about.
    // This populates match_provider_ids so downstream enrichment can resolve
    // by stable provider ID instead of team-name+date matching.
    try {
      const allDates = Array.from(new Set(incoming.map((m) => m.match_date)));
      if (allDates.length) {
        const { data: knownMatches } = await supabase
          .from("matches")
          .select("id, home_team_id, away_team_id, match_date")
          .eq("league_id", league.id)
          .eq("season", season)
          .in("match_date", allDates);
        const idByKey = new Map<string, string>();
        (knownMatches ?? []).forEach((m: any) => {
          idByKey.set(`${m.home_team_id}|${m.away_team_id}|${new Date(m.match_date).toISOString()}`, m.id);
        });
        const mappings: Array<{ match_id: string; provider: string; provider_match_id: string }> = [];
        for (const f of fixtures) {
          const home = afIdToTeamId.get(f.teams.home.id);
          const away = afIdToTeamId.get(f.teams.away.id);
          if (!home || !away) continue;
          const k = `${home}|${away}|${new Date(f.fixture.date).toISOString()}`;
          const mid = idByKey.get(k);
          if (mid) {
            mappings.push({
              match_id: mid,
              provider: "api-football",
              provider_match_id: String(f.fixture.id),
            });
          }
        }
        if (mappings.length) {
          await supabase
            .from("match_provider_ids")
            .upsert(mappings, { onConflict: "match_id,provider", ignoreDuplicates: true });
        }
      }
    } catch { /* mapping is best-effort */ }


    // 5) Fetch fixture statistics (cards + corners) for finished matches whose
    //    DB row is still missing data. Cap by fixture_limit to control quota.
    const finishedFromApi = fixtures.filter((f) =>
      ["FT", "AET", "PEN"].includes(f.fixture.status.short)
    );

    // Pull existing DB rows for these finished fixtures to know which still
    // need enrichment AND to capture each match_id for pipeline_logs.
    const finishedDates = Array.from(new Set(finishedFromApi.map((f) => new Date(f.fixture.date).toISOString())));
    const { data: dbFinished } = finishedDates.length
      ? await supabase
          .from("matches")
          .select("id, match_date, home_team_id, away_team_id, home_cards, away_cards, home_corners, away_corners")
          .eq("league_id", league.id)
          .eq("season", season)
          .in("match_date", finishedDates)
      : { data: [] as any[] };
    const dbByKey = new Map<string, any>();
    (dbFinished ?? []).forEach((m: any) => {
      const k = `${m.home_team_id}|${m.away_team_id}|${new Date(m.match_date).toISOString()}`;
      dbByKey.set(k, m);
    });

    const candidates = finishedFromApi
      .map((f) => {
        const home = afIdToTeamId.get(f.teams.home.id);
        const away = afIdToTeamId.get(f.teams.away.id);
        if (!home || !away) return null;
        const k = `${home}|${away}|${new Date(f.fixture.date).toISOString()}`;
        const db = dbByKey.get(k);
        return { f, home, away, db };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .filter((x) =>
        // Only enrich if any value is still missing
        x.db == null ||
        x.db.home_cards == null || x.db.away_cards == null ||
        x.db.home_corners == null || x.db.away_corners == null
      )
      .slice(0, fixtureLimit);

    let logged = 0, withCards = 0, withCorners = 0, statErrors = 0;

    for (const { f, home, away, db } of candidates) {
      try {
        const sRes = await afGet("/fixtures/statistics", { fixture: f.fixture.id });
        const teams = sRes.response ?? [];
        const update: Record<string, number> = {};
        let cardsFound = false, cornersFound = false;
        for (const block of teams) {
          const isHome = block.team.id === f.teams.home.id;
          const stats = block.statistics ?? [];
          const yRaw = stats.find((s: any) => s.type === "Yellow Cards")?.value;
          const rRaw = stats.find((s: any) => s.type === "Red Cards")?.value;
          const cRaw = stats.find((s: any) => s.type === "Corner Kicks")?.value;
          const hasCards = yRaw != null || rRaw != null;
          const hasCorners = cRaw != null;
          if (hasCards) cardsFound = true;
          if (hasCorners) cornersFound = true;
          const yellow = Number(yRaw ?? 0) || 0;
          const red = Number(rRaw ?? 0) || 0;
          const corners = Number(cRaw ?? 0) || 0;
          if (isHome) {
            if (hasCards) update.home_cards = yellow + red;
            if (hasCorners) update.home_corners = corners;
          } else {
            if (hasCards) update.away_cards = yellow + red;
            if (hasCorners) update.away_corners = corners;
          }
        }

        let cardsWritten = false, cornersWritten = false;
        if (Object.keys(update).length) {
          const { error: upErr } = await supabase.from("matches")
            .update(update)
            .eq("league_id", league.id)
            .eq("season", season)
            .eq("home_team_id", home)
            .eq("away_team_id", away)
            .eq("match_date", new Date(f.fixture.date).toISOString());
          if (!upErr) {
            withStats++;
            cardsWritten = "home_cards" in update || "away_cards" in update;
            cornersWritten = "home_corners" in update || "away_corners" in update;
            if (cardsWritten) withCards++;
            if (cornersWritten) withCorners++;
          }
        }

        await logFixture({
          match_id: db?.id ?? null,
          af_fixture_id: f.fixture.id,
          match_date: new Date(f.fixture.date).toISOString(),
          cards_found: cardsFound,
          corners_found: cornersFound,
          cards_written: cardsWritten,
          corners_written: cornersWritten,
          status: (cardsFound || cornersFound)
            ? ((cardsWritten || cornersWritten) ? (cardsFound === cardsWritten && cornersFound === cornersWritten ? "success" : "partial") : "skipped")
            : "skipped",
        });
        logged++;
      } catch (err) {
        statErrors++;
        await logFixture({
          match_id: db?.id ?? null,
          af_fixture_id: f.fixture.id,
          match_date: new Date(f.fixture.date).toISOString(),
          cards_found: false,
          corners_found: false,
          cards_written: false,
          corners_written: false,
          status: "failed",
          error_message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await supabase.from("sync_jobs").update({
      status: "success",
      processed_records: statsOnly ? withStats : incoming.length,
      error_message: statsOnly
        ? `stats_only: ${withStats} enriched / ${candidates.length} candidates (cards:${withCards}, corners:${withCorners}, errors:${statErrors})`
        : `delta: ${inserted} new, ${updated} updated, ${unchanged} unchanged; stats: ${withStats}/${candidates.length}${body.from_date ? ` (incremental from ${body.from_date})` : ""}`,
      finished_at: new Date().toISOString(),
    }).eq("id", job!.id);
    await supabase.from("data_sources").update({ last_sync: new Date().toISOString() }).eq("id", source!.id);

    return json({
      ok: true,
      league: league.name,
      season,
      mode: statsOnly ? "stats_only" : "ingest+stats",
      fixtures: incoming.length,
      inserted,
      updated,
      unchanged,
      future_scheduled: futureScheduled,
      incremental: Boolean(body.from_date),
      from_date: body.from_date ?? null,
      teams: afIdToTeamId.size,
      stats_candidates: candidates.length,
      stats_logged: logged,
      stats_errors: statErrors,
      with_stats: withStats,
      with_cards: withCards,
      with_corners: withCorners,
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("sync_jobs").update({
      status: "failed", error_message: msg, finished_at: new Date().toISOString(),
    }).eq("id", job!.id);
    return json({ error: msg }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
