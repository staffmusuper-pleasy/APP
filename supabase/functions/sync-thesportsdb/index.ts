// sync-thesportsdb
// Pulls upcoming + recent fixtures for a single TheSportsDB league.
// Free public key = "3"; users can set THESPORTSDB_KEY for higher limits.
//
// Body:
//   { idLeague: string (required), league_name?: string, country?: string,
//     season?: string }

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TSDB_KEY = Deno.env.get("THESPORTSDB_KEY") || "3";

const BASE = `https://www.thesportsdb.com/api/v1/json/${TSDB_KEY}`;

function normalize(name: string): string {
  return name.toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+(fc|cf|sc|ac|afc|cfc|fk|sk|bk|if|kf|club|football club|calcio|ssd|asd)\.?$/gi, "")
    .replace(/^(fc|cf|sc|ac|afc|cfc|fk|sk|bk|if|kf)\s+/gi, "")
    .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

async function tsdb(path: string) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`thesportsdb ${path} ${res.status}`);
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { idLeague?: string; league_name?: string; country?: string; season?: string } = {};
  try { body = await req.json(); } catch {}
  if (!body.idLeague) return j({ error: "idLeague required" }, 400);

  const country = body.country ?? "World";
  const leagueName = body.league_name ?? `TSDB ${body.idLeague}`;
  const season = body.season ?? String(new Date().getUTCFullYear());

  let { data: league } = await supabase.from("leagues").select("*")
    .eq("name", leagueName).eq("country", country)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!league) {
    const { data: created } = await supabase.from("leagues")
      .insert({ name: leagueName, country, season, active: true }).select().single();
    league = created;
  }
  if (!league) return j({ error: "could not create league" }, 500);

  const { data: source } = await supabase.from("data_sources")
    .upsert({ name: "thesportsdb", active: true }, { onConflict: "name" }).select().single();
  const { data: job } = await supabase.from("sync_jobs").insert({
    job_name: `thesportsdb:${leagueName}:${season}`,
    source: source!.id, status: "running", started_at: new Date().toISOString(),
  }).select().single();

  try {
    const [nextRes, pastRes] = await Promise.all([
      tsdb(`/eventsnextleague.php?id=${body.idLeague}`),
      tsdb(`/eventspastleague.php?id=${body.idLeague}`),
    ]);
    const events: any[] = [...(nextRes.events ?? []), ...(pastRes.events ?? [])];

    // Collect teams
    const teamNames = new Set<string>();
    for (const e of events) {
      if (e.strHomeTeam) teamNames.add(e.strHomeTeam);
      if (e.strAwayTeam) teamNames.add(e.strAwayTeam);
    }

    const { data: existing } = await supabase.from("teams").select("id, normalized_name");
    const byNorm = new Map<string, string>();
    (existing ?? []).forEach((t) => byNorm.set(t.normalized_name, t.id));
    const { data: aliases } = await supabase.from("team_aliases").select("team_id, normalized_alias");
    const byAlias = new Map<string, string>();
    (aliases ?? []).forEach((a) => byAlias.set(a.normalized_alias, a.team_id));

    const nameToTeamId = new Map<string, string>();
    for (const name of teamNames) {
      const norm = normalize(name);
      let teamId = byNorm.get(norm) ?? byAlias.get(norm);
      if (!teamId) {
        const { data: ins } = await supabase.from("teams").insert({
          name, normalized_name: norm, country, league_id: league.id,
        }).select().single();
        teamId = ins?.id;
        if (teamId) byNorm.set(norm, teamId);
      } else if (!byAlias.has(norm)) {
        await supabase.from("team_aliases").insert({
          team_id: teamId, alias: name, normalized_alias: norm, source: "thesportsdb",
        });
      }
      if (teamId) nameToTeamId.set(name, teamId);
    }

    const incoming: any[] = [];
    for (const e of events) {
      const home = nameToTeamId.get(e.strHomeTeam);
      const away = nameToTeamId.get(e.strAwayTeam);
      if (!home || !away) continue;
      const kickoff = e.strTimestamp
        ? new Date(e.strTimestamp).toISOString()
        : (e.dateEvent ? new Date(`${e.dateEvent}T${e.strTime || "00:00:00"}Z`).toISOString() : null);
      if (!kickoff) continue;
      const finished = e.strStatus === "Match Finished" || (e.intHomeScore != null && e.intAwayScore != null);
      incoming.push({
        league_id: league.id,
        season: e.strSeason ?? season,
        round: e.intRound ? `Round ${e.intRound}` : null,
        status: finished ? "finished" : "scheduled",
        match_date: kickoff,
        home_team_id: home,
        away_team_id: away,
        home_goals: finished ? Number(e.intHomeScore ?? 0) : null,
        away_goals: finished ? Number(e.intAwayScore ?? 0) : null,
        source: "thesportsdb",
      });
    }

    const dates = incoming.map((m) => m.match_date);
    const { data: current } = await supabase.from("matches")
      .select("id, match_date, home_team_id, away_team_id, status, home_goals, away_goals")
      .eq("league_id", league.id)
      .in("match_date", dates.length ? dates : ["1970-01-01"]);
    const keyOf = (m: any) => `${m.home_team_id}|${m.away_team_id}|${new Date(m.match_date).toISOString()}`;
    const ex = new Map<string, any>();
    (current ?? []).forEach((m) => ex.set(keyOf(m), m));

    let inserted = 0, updated = 0, unchanged = 0;
    for (const row of incoming) {
      const e = ex.get(keyOf(row));
      if (!e) { await supabase.from("matches").insert(row); inserted++; continue; }
      const changed = e.status !== row.status || e.home_goals !== row.home_goals || e.away_goals !== row.away_goals;
      if (changed) {
        await supabase.from("matches").update({
          status: row.status, home_goals: row.home_goals, away_goals: row.away_goals, source: "thesportsdb",
        }).eq("id", e.id);
        updated++;
      } else unchanged++;
    }

    const futureScheduled = incoming.filter((m) =>
      m.status === "scheduled" && new Date(m.match_date).getTime() >= Date.now()
    ).length;

    await supabase.from("sync_jobs").update({
      status: "success", processed_records: incoming.length,
      error_message: `delta: ${inserted} new, ${updated} updated, ${unchanged} unchanged; future=${futureScheduled}`,
      finished_at: new Date().toISOString(),
    }).eq("id", job!.id);
    await supabase.from("data_sources").update({ last_sync: new Date().toISOString() }).eq("id", source!.id);

    return j({
      ok: true, idLeague: body.idLeague, league: leagueName,
      fixtures: incoming.length, inserted, updated, unchanged, future_scheduled: futureScheduled,
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
