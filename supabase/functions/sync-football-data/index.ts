// sync-football-data
// Pulls fixtures + teams from football-data.org (v4) for one competition code.
// Free tier: 10 req/min, top European leagues + Champions League.
//
// Body:
//   { code: string (required) — e.g. "PL","PD","BL1","SA","FL1","CL","EL","EC","WC"
//     league_name?: string, country?: string — used to resolve/create the league row
//     season?: number — e.g. 2025 (defaults to current calendar year)
//     from_date?: string — YYYY-MM-DD (incremental window) }

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FD_KEY = Deno.env.get("FOOTBALL_DATA_KEY") ?? "";

const BASE = "https://api.football-data.org/v4";

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

async function fdGet(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "X-Auth-Token": FD_KEY } });
  const remaining = res.headers.get("X-Requests-Available-Minute");
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`football-data ${path} ${res.status} ${txt.slice(0, 200)}`);
  }
  const json = await res.json();
  return { json, remaining };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!FD_KEY) return j({ error: "FOOTBALL_DATA_KEY missing" }, 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: { code?: string; league_name?: string; country?: string; season?: number; from_date?: string } = {};
  try { body = await req.json(); } catch {}
  if (!body.code) return j({ error: "code required (e.g. PL, CL, WC)" }, 400);

  const season = body.season ?? new Date().getUTCFullYear();
  const country = body.country ?? "Europe";

  // Resolve / create league row. Match on (name, country, season) so that
  // fixtures land in the league row whose season matches `body.season`.
  // Falling back to "most recent name+country" caused 2026 fixtures to be
  // written into a stale 2022 FIFA World Cup row.
  const leagueName = body.league_name ?? body.code;
  let { data: league } = await supabase
    .from("leagues").select("*")
    .eq("name", leagueName).eq("country", country).eq("season", String(season))
    .maybeSingle();
  if (!league) {
    const { data: created } = await supabase.from("leagues")
      .insert({ name: leagueName, country, season: String(season), active: true })
      .select().single();
    league = created;
  }
  if (!league) return j({ error: "could not create league row" }, 500);

  const { data: source } = await supabase.from("data_sources")
    .upsert({ name: "football-data", active: true }, { onConflict: "name" }).select().single();
  const { data: job } = await supabase.from("sync_jobs").insert({
    job_name: `football-data:${leagueName}:${season}`,
    source: source!.id, status: "running", started_at: new Date().toISOString(),
  }).select().single();

  try {
    const params: Record<string, string> = {};
    if (body.from_date && /^\d{4}-\d{2}-\d{2}$/.test(body.from_date)) {
      params.dateFrom = body.from_date;
      const to = new Date(body.from_date); to.setUTCDate(to.getUTCDate() + 400);
      params.dateTo = to.toISOString().slice(0, 10);
    }
    const { json: data, remaining } = await fdGet(`/competitions/${body.code}/matches`, params);
    const matches: any[] = data.matches ?? [];

    // Build unique team set
    const teamMap = new Map<number, { id: number; name: string }>();
    for (const m of matches) {
      teamMap.set(m.homeTeam.id, { id: m.homeTeam.id, name: m.homeTeam.name ?? m.homeTeam.shortName });
      teamMap.set(m.awayTeam.id, { id: m.awayTeam.id, name: m.awayTeam.name ?? m.awayTeam.shortName });
    }

    // Resolve / upsert teams using normalized_name + team_aliases
    const { data: existing } = await supabase.from("teams").select("id, normalized_name");
    const byNorm = new Map<string, string>();
    (existing ?? []).forEach((t) => byNorm.set(t.normalized_name, t.id));
    const { data: aliases } = await supabase.from("team_aliases").select("team_id, normalized_alias");
    const byAlias = new Map<string, string>();
    (aliases ?? []).forEach((a) => byAlias.set(a.normalized_alias, a.team_id));

    const fdIdToTeamId = new Map<number, string>();
    for (const t of teamMap.values()) {
      if (!t.name) continue;
      const norm = normalize(t.name);
      let teamId = byNorm.get(norm) ?? byAlias.get(norm);
      if (!teamId) {
        const { data: ins } = await supabase.from("teams").insert({
          name: t.name, normalized_name: norm, country, league_id: league.id,
        }).select().single();
        teamId = ins?.id;
        if (teamId) byNorm.set(norm, teamId);
      } else if (!byAlias.has(norm)) {
        await supabase.from("team_aliases").insert({
          team_id: teamId, alias: t.name, normalized_alias: norm, source: "football-data",
        });
      }
      if (teamId) fdIdToTeamId.set(t.id, teamId);
    }

    // Build delta upsert rows
    const incoming: any[] = [];
    for (const m of matches) {
      const home = fdIdToTeamId.get(m.homeTeam.id);
      const away = fdIdToTeamId.get(m.awayTeam.id);
      if (!home || !away) continue;
      const finished = m.status === "FINISHED";
      incoming.push({
        league_id: league.id,
        season: String(season),
        round: m.matchday != null ? `MD ${m.matchday}` : null,
        status: finished ? "finished" : "scheduled",
        match_date: new Date(m.utcDate).toISOString(),
        home_team_id: home,
        away_team_id: away,
        home_goals: finished ? (m.score?.fullTime?.home ?? 0) : null,
        away_goals: finished ? (m.score?.fullTime?.away ?? 0) : null,
        source: "football-data",
      });
    }

    const dates = incoming.map((m) => m.match_date);
    const { data: current } = await supabase.from("matches")
      .select("id, match_date, home_team_id, away_team_id, status, home_goals, away_goals, round")
      .eq("league_id", league.id).eq("season", String(season))
      .in("match_date", dates.length ? dates : ["1970-01-01"]);
    const keyOf = (m: any) => `${m.home_team_id}|${m.away_team_id}|${m.match_date}`;
    const ex = new Map<string, any>();
    (current ?? []).forEach((m) => ex.set(keyOf({ ...m, match_date: new Date(m.match_date).toISOString() }), m));

    let inserted = 0, updated = 0, unchanged = 0;
    for (const row of incoming) {
      const e = ex.get(keyOf(row));
      if (!e) { await supabase.from("matches").insert(row); inserted++; continue; }
      const changed = e.status !== row.status || e.home_goals !== row.home_goals ||
        e.away_goals !== row.away_goals || (e.round ?? null) !== (row.round ?? null);
      if (changed) {
        await supabase.from("matches").update({
          status: row.status, home_goals: row.home_goals, away_goals: row.away_goals,
          round: row.round, source: "football-data",
        }).eq("id", e.id);
        updated++;
      } else unchanged++;
    }

    const futureScheduled = incoming.filter((m) =>
      m.status === "scheduled" && new Date(m.match_date).getTime() >= Date.now()
    ).length;

    await supabase.from("sync_jobs").update({
      status: "success", processed_records: incoming.length,
      error_message: `delta: ${inserted} new, ${updated} updated, ${unchanged} unchanged; future=${futureScheduled}; quota_remaining_minute=${remaining ?? "?"}`,
      finished_at: new Date().toISOString(),
    }).eq("id", job!.id);
    await supabase.from("data_sources").update({ last_sync: new Date().toISOString() }).eq("id", source!.id);

    return j({
      ok: true, code: body.code, league: leagueName, season,
      fixtures: incoming.length, inserted, updated, unchanged,
      future_scheduled: futureScheduled, quota_remaining_minute: remaining,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("sync_jobs").update({
      status: "failed", error_message: msg, finished_at: new Date().toISOString(),
    }).eq("id", job!.id);
    return j({ error: msg }, 500);
  }
});

function j(p: unknown, s = 200) {
  return new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
