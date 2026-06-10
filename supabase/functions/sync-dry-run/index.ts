// sync-dry-run
// Estimates what a full sync would import without writing match data.
// Returns: competitions_detected, seasons_detected, matches_expected,
// teams_expected, potential_duplicates.
//
// Strategy (read-only):
// - Counts enabled league_sources (competitions detected, seasons from leagues).
// - For each competition, peeks at the configured primary source's upcoming
//   fixture window via a lightweight HEAD/GET when possible. To keep credits
//   safe, we only sample sources we already know are cheap: football-data
//   and thesportsdb (no scraper, generous free tier). For api-football and
//   openfootball we approximate using historical patterns already in DB.
//
// Writes ONE row to import_logs with source='dry-run' summarizing the run.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FD_KEY = Deno.env.get("FOOTBALL_DATA_KEY") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = new Date();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: srcs } = await supabase
    .from("league_sources")
    .select("league_key, league_name, country, source, source_ref, enabled")
    .eq("enabled", true);

  const competitions = new Set<string>();
  const seasons = new Set<string>();
  const sampled: any[] = [];
  let matchesExpected = 0;
  let teamsExpected = 0;
  let potentialDuplicates = 0;
  let errors = 0;

  const { data: existingLeagues } = await supabase.from("leagues").select("id, name, country, season");
  for (const l of existingLeagues ?? []) seasons.add(l.season);

  for (const s of srcs ?? []) {
    competitions.add(`${s.league_name}|${s.country}`);
    try {
      let count = 0;
      let teams = 0;
      if (s.source === "football-data" && FD_KEY && s.source_ref?.code) {
        const today = new Date().toISOString().slice(0, 10);
        const end = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
        const r = await fetch(
          `https://api.football-data.org/v4/competitions/${s.source_ref.code}/matches?dateFrom=${today}&dateTo=${end}`,
          { headers: { "X-Auth-Token": FD_KEY } },
        );
        if (r.ok) {
          const j = await r.json();
          const ms = j?.matches ?? [];
          count = ms.length;
          const set = new Set<string>();
          for (const m of ms) { set.add(m?.homeTeam?.name); set.add(m?.awayTeam?.name); }
          teams = set.size;
        } else if (r.status !== 403 && r.status !== 429) errors++;
      } else if (s.source === "thesportsdb" && s.source_ref?.idLeague) {
        const r = await fetch(`https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=${s.source_ref.idLeague}`);
        if (r.ok) {
          const j = await r.json();
          const ms = j?.events ?? [];
          count = ms.length;
          const set = new Set<string>();
          for (const m of ms) { set.add(m?.strHomeTeam); set.add(m?.strAwayTeam); }
          teams = set.size;
        } else errors++;
      } else {
        // Approximate by extrapolating from history for sources we don't probe live
        const { count: hist } = await supabase
          .from("matches")
          .select("id", { count: "exact", head: true })
          .eq("source", s.source);
        count = Math.round((hist ?? 0) / 20); // rough next-window estimate
      }
      matchesExpected += count;
      teamsExpected += teams;
      sampled.push({ league: s.league_name, country: s.country, source: s.source, matches: count, teams });
    } catch (e) {
      errors++;
      sampled.push({ league: s.league_name, country: s.country, source: s.source, error: String(e).slice(0, 200) });
    }
  }

  // Duplicate detection from existing data
  const { data: dups } = await supabase.rpc("data_quality_summary" as any).select?.() ?? { data: null };
  // Fallback: query the view directly
  const { data: dqRow } = await supabase.from("data_quality_summary").select("*").maybeSingle();
  potentialDuplicates = dqRow?.duplicates_detected ?? 0;

  const status = errors === 0 ? "success" : "warning";
  const report = {
    competitions_detected: competitions.size,
    seasons_detected: seasons.size,
    matches_expected: matchesExpected,
    teams_expected: teamsExpected,
    potential_duplicates: potentialDuplicates,
    errors,
    sampled,
  };

  await supabase.from("import_logs").insert({
    source: "dry-run",
    competition: null,
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    matches_imported: 0,
    matches_updated: 0,
    errors_count: errors,
    status,
    error_sample: JSON.stringify(report).slice(0, 500),
  });

  return new Response(JSON.stringify({ ok: true, status, ...report }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
