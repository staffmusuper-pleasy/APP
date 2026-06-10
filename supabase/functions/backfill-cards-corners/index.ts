// backfill-cards-corners
// Orchestrates cards/corners enrichment across leagues with multiple modes.
//
// Body:
//   { mode?: "current" | "historical_2022_2024" | "local_db" (default "current")
//     provider?: "api-football" | "worldfootballr" (default "api-football")
//     per_league_limit?: number (default 50, max 300)
//     league_ids?: string[] (optional filter)
//     trigger_stats?: boolean — chain calculate-statistics when done }
//
// Modes:
//   - "current": enrich CURRENT_SEASONS leagues. api-football free plan likely
//     returns 0 here; prefer worldfootballr when current.
//   - "historical_2022_2024": loop seasons 2022..2024 for every league with
//     api_football_id. Works on the api-football free plan.
//   - "local_db": find leagues that have local finished matches missing
//     cards/corners, group by (league, season-year), and enrich each.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CURRENT_SEASONS = ["2025-26", "2026"];
const HISTORICAL_YEARS = [2022, 2023, 2024];

type Mode = "current" | "historical_2022_2024" | "local_db";

type LeagueRow = {
  id: string;
  name: string;
  country: string;
  season: string;
  api_football_id: number | null;
  fbref_id: string | null;
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function seasonStartYear(season: string): number | null {
  const m = season.match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

async function callApiFootball(leagueId: string, afLeagueId: number, season: number, limit: number) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/sync-api-football`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({
      league_id: leagueId,
      af_league_id: afLeagueId,
      af_season: season,
      fixture_limit: limit,
      stats_only: true,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, data };
}

async function callWorldFootballR(leagueId: string, season: string, limit: number) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/sync-worldfootballr`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ league_id: leagueId, season, limit }),
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, data };
}

async function callSofaScore(leagueId: string, season: string, limit: number, attemptOrder = 3, mode: "audit" | "enrich" = "enrich") {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/sync-sofascore`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ league_id: leagueId, season, limit, mode, attempt_order: attemptOrder }),
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: {
    mode?: Mode;
    provider?: "api-football" | "worldfootballr" | "sofascore";
    per_league_limit?: number;
    league_ids?: string[];
    trigger_stats?: boolean;
    sofascore_mode?: "audit" | "enrich";
  } = {};
  try { body = await req.json(); } catch {}

  const mode: Mode = body.mode ?? "current";
  const provider = body.provider ?? "api-football";
  const perLeagueLimit = Math.max(1, Math.min(body.per_league_limit ?? 50, 300));

  const results: any[] = [];
  let totalWritten = 0;
  let totalCandidates = 0;
  let totalApiFixtures = 0;
  let totalLocalCandidates = 0;
  let totalErrors = 0;
  let totalSkipped = 0;
  const skipReasons: Record<string, number> = {};

  // ----- Build the (league, season-int) work list per mode -----
  type Task =
    | { kind: "api"; league: LeagueRow; afSeason: number; localCandidates?: number; source: "current" | "historical" | "local_db" }
    | { kind: "wfr"; league: LeagueRow; season: string }
    | { kind: "sof"; league: LeagueRow; season: string; localCandidates?: number };

  const tasks: Task[] = [];

  if (mode === "current") {
    let lq = supabase
      .from("leagues")
      .select("id, name, country, season, api_football_id, fbref_id")
      .in("season", CURRENT_SEASONS);
    if (body.league_ids?.length) lq = lq.in("id", body.league_ids);
    const { data: leagues, error } = await lq;
    if (error) return json({ error: error.message }, 500);
    for (const l of (leagues ?? []) as LeagueRow[]) {
      if (provider === "worldfootballr") {
        if (l.fbref_id) tasks.push({ kind: "wfr", league: l, season: l.season });
        else { totalSkipped++; skipReasons["no fbref_id"] = (skipReasons["no fbref_id"] ?? 0) + 1; }
      } else {
        const sy = seasonStartYear(l.season);
        if (l.api_football_id && sy) tasks.push({ kind: "api", league: l, afSeason: sy, source: "current" });
        else { totalSkipped++; skipReasons["no api_football_id"] = (skipReasons["no api_football_id"] ?? 0) + 1; }
      }
    }
  } else if (mode === "historical_2022_2024") {
    let lq = supabase
      .from("leagues")
      .select("id, name, country, season, api_football_id, fbref_id")
      .not("api_football_id", "is", null);
    if (body.league_ids?.length) lq = lq.in("id", body.league_ids);
    const { data: leagues, error } = await lq;
    if (error) return json({ error: error.message }, 500);
    // Deduplicate by (name,country,api_football_id) — use the row whose season
    // year matches; fall back to any row when no per-year row exists.
    const byKey = new Map<string, LeagueRow[]>();
    for (const l of (leagues ?? []) as LeagueRow[]) {
      const k = `${l.name}|${l.country}|${l.api_football_id}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(l);
    }
    for (const [, rows] of byKey) {
      for (const y of HISTORICAL_YEARS) {
        const match = rows.find((r) => seasonStartYear(r.season) === y) ?? rows[0];
        if (!match || !match.api_football_id) continue;
        tasks.push({ kind: "api", league: match, afSeason: y, source: "historical" });
      }
    }
  } else if (mode === "local_db") {
    // Find finished matches missing any cards/corners, grouped by (league_id, year).
    // Push the league filter into the query when provided, and page through the
    // result so PostgREST's default row cap doesn't silently truncate us.
    const grp = new Map<string, { league_id: string; year: number; count: number }>();
    const pageSize = 1000;
    let from = 0;
    // Safety cap so an unbounded backlog never spins forever.
    const maxRows = 50000;
    while (from < maxRows) {
      let q = supabase
        .from("matches")
        .select("league_id, season, match_date, home_cards, away_cards, home_corners, away_corners")
        .eq("status", "finished" as any)
        .or("home_cards.is.null,away_cards.is.null,home_corners.is.null,away_corners.is.null")
        .order("match_date", { ascending: false })
        .range(from, from + pageSize - 1);
      if (body.league_ids?.length) q = q.in("league_id", body.league_ids);
      const { data: rows, error } = await q;
      if (error) return json({ error: error.message }, 500);
      if (!rows || rows.length === 0) break;
      for (const r of rows) {
        const y = new Date(r.match_date as string).getUTCFullYear();
        const k = `${r.league_id}|${y}`;
        const existing = grp.get(k);
        if (existing) existing.count++;
        else grp.set(k, { league_id: r.league_id as string, year: y, count: 1 });
      }
      if (rows.length < pageSize) break;
      from += pageSize;
    }


    const leagueIds = Array.from(new Set(Array.from(grp.values()).map((g) => g.league_id)));
    const filteredIds = body.league_ids?.length
      ? leagueIds.filter((id) => body.league_ids!.includes(id))
      : leagueIds;
    if (filteredIds.length === 0) {
      return json({ ok: true, mode, message: "no local candidates", total_local_candidates: 0 });
    }
    const { data: leagues } = await supabase
      .from("leagues")
      .select("id, name, country, season, api_football_id, fbref_id")
      .in("id", filteredIds);
    const leagueById = new Map((leagues ?? []).map((l) => [l.id as string, l as unknown as LeagueRow]));

    for (const g of grp.values()) {
      const l = leagueById.get(g.league_id);
      if (!l) continue;
      totalLocalCandidates += g.count;
      // Respect the caller's provider preference; fall back to others when
      // the preferred provider has no id wired up for this league.
      const wantSof = provider === "sofascore";
      const wantWfr = provider === "worldfootballr";
      const preferAf = provider === "api-football";
      if (wantSof) {
        tasks.push({ kind: "sof", league: l, season: l.season, localCandidates: g.count });
      } else if (wantWfr && l.fbref_id) {
        tasks.push({ kind: "wfr", league: l, season: l.season });
      } else if (preferAf && l.api_football_id) {
        tasks.push({ kind: "api", league: l, afSeason: g.year, localCandidates: g.count, source: "local_db" });
      } else if (l.api_football_id) {
        tasks.push({ kind: "api", league: l, afSeason: g.year, localCandidates: g.count, source: "local_db" });
      } else if (l.fbref_id) {
        tasks.push({ kind: "wfr", league: l, season: l.season });
      } else {
        tasks.push({ kind: "sof", league: l, season: l.season, localCandidates: g.count });
      }
    }
  }


  // ----- Execute tasks -----
  for (const t of tasks) {
    try {
      if (t.kind === "api") {
        const { ok, data } = await callApiFootball(t.league.id, t.league.api_football_id!, t.afSeason, perLeagueLimit);
        const written = Number(data.with_stats ?? 0) || 0;
        const candidates = Number(data.stats_candidates ?? 0) || 0;
        const apiFixtures = Number(data.fixtures ?? 0) || 0;
        totalWritten += written;
        totalCandidates += candidates;
        totalApiFixtures += apiFixtures;
        if (candidates === 0) {
          totalSkipped++;
          const reason = (data.error || (apiFixtures === 0 ? "api returned 0 fixtures (plan limit?)" : "no missing data"));
          skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
        }
        results.push({
          league: t.league.name, country: t.league.country, season_year: t.afSeason,
          provider: "api-football", source: t.source,
          ok, written, candidates, api_fixtures: apiFixtures,
          local_candidates: t.localCandidates ?? null,
          with_cards: data.with_cards ?? null, with_corners: data.with_corners ?? null,
          message: data.error ?? null,
        });
      } else if (t.kind === "wfr") {
        const { ok, data } = await callWorldFootballR(t.league.id, t.season, perLeagueLimit);
        const written = Number(data.processed ?? 0) || 0;
        totalWritten += written;
        results.push({
          league: t.league.name, country: t.league.country, season: t.season,
          provider: "worldfootballr", source: "current",
          ok, written,
          skipped: data.skipped ?? null,
          message: data.error ?? data.hint ?? null,
        });
      } else {
        const { ok, data } = await callSofaScore(t.league.id, t.season, perLeagueLimit, 3, body.sofascore_mode ?? "enrich");
        const written = Number(data.matches_updated ?? 0) || 0;
        totalWritten += written;
        results.push({
          league: t.league.name, country: t.league.country, season: t.season,
          provider: "sofascore", source: "local_db",
          ok, written,
          events_discovered: data.events_discovered ?? null,
          mappings_created: data.mappings_created ?? null,
          cards_written: data.cards_written ?? null,
          corners_written: data.corners_written ?? null,
          message: data.error ?? null,
        });
      }
    } catch (err) {
      totalErrors++;
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ league: t.league.name, ok: false, error: msg });
    }
  }

  if (body.trigger_stats && totalWritten > 0) {
    fetch(`${SUPABASE_URL}/functions/v1/calculate-statistics`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ sample_sizes: [10, 20], categories: ["cards", "corners"] }),
    }).catch(() => {});
  }

  return json({
    ok: true,
    mode,
    provider,
    tasks: tasks.length,
    total_written: totalWritten,
    total_candidates: totalCandidates,
    total_api_fixtures: totalApiFixtures,
    total_local_candidates: totalLocalCandidates,
    total_skipped: totalSkipped,
    total_errors: totalErrors,
    skip_reasons: skipReasons,
    triggered_stats_rebuild: Boolean(body.trigger_stats && totalWritten > 0),
    results,
  });
});
