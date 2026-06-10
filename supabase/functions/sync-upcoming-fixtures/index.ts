// sync-upcoming-fixtures
// Recovers CURRENT + UPCOMING fixtures via Sofascore's public JSON API
// (proxied through ScraperAPI). Only imports: match_date, league, home/away
// team, status. Does NOT touch historical stats or statistics_cache.
//
// Priority elsewhere (orchestrator): OpenFootball → FBref → here → API-Football.
// This function is the "free upcoming fixtures fallback" for leagues where
// OpenFootball has no current season published.
//
// Body: { league_keys?: string[], dry_run?: boolean }

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SCRAPERAPI_KEY = Deno.env.get("SCRAPERAPI_KEY") ?? "";

// Target competitions → Sofascore unique-tournament IDs.
// Each entry also carries the league row identity we want to upsert into.
type Target = {
  key: string;
  name: string;
  country: string;
  season: string;        // our internal season label
  sofa_tid?: number;
  search?: string[];
};

const TARGETS: Target[] = [
  { key: "eng.1",  name: "English Premier League", country: "England",       season: "2025-26", sofa_tid: 17  },
  { key: "es.1",   name: "La Liga",                 country: "Spain",         season: "2025-26", sofa_tid: 8   },
  { key: "de.1",   name: "Bundesliga",              country: "Germany",       season: "2025-26", sofa_tid: 35  },
  { key: "it.1",   name: "Serie A",                 country: "Italy",         season: "2025-26", sofa_tid: 23  },
  { key: "fr.1",   name: "Ligue 1",                 country: "France",        season: "2025-26", sofa_tid: 34  },
  { key: "pt.1",   name: "Primeira Liga",           country: "Portugal",      season: "2025-26", sofa_tid: 238 },
  { key: "intl.cl",name: "UEFA Champions League",   country: "International", season: "2026",    sofa_tid: 7   },
  { key: "us.1",   name: "Major League Soccer",     country: "USA",           season: "2026",    sofa_tid: 242 },
  { key: "br.1",   name: "Campeonato Brasileiro Série A", country: "Brazil", season: "2026",    sofa_tid: 325 },
  { key: "intl.cwc", name: "FIFA Club World Cup", country: "International", season: "2026", search: ["FIFA Club World Cup", "Club World Cup"] },
  { key: "intl.wc.2026", name: "FIFA World Cup", country: "International", season: "2026", search: ["FIFA World Cup", "World Championship"] },
  { key: "intl.friendlies", name: "International Friendlies", country: "International", season: "2026", search: ["International Friendlies", "Int. Friendly Games", "Friendly International"] },
  { key: "intl.nations", name: "UEFA Nations League", country: "International", season: "2026", search: ["UEFA Nations League", "Nations League"] },
  { key: "intl.wcq.uefa", name: "World Cup Qualifiers - UEFA", country: "International", season: "2026", search: ["World Cup Qualification UEFA", "World Championship Qual. UEFA"] },
  { key: "intl.wcq.conmebol", name: "World Cup Qualifiers - CONMEBOL", country: "International", season: "2026", search: ["World Cup Qualification CONMEBOL", "World Championship Qual. CONMEBOL"] },
  { key: "intl.wcq.concacaf", name: "World Cup Qualifiers - CONCACAF", country: "International", season: "2026", search: ["World Cup Qualification CONCACAF", "World Championship Qual. CONCACAF"] },
  { key: "intl.wcq.afc", name: "World Cup Qualifiers - AFC", country: "International", season: "2026", search: ["World Cup Qualification AFC", "World Championship Qual. AFC"] },
];

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function sofa(path: string): Promise<any | null> {
  const url = `https://api.sofascore.com/api/v1${path}`;
  const fetchUrl = SCRAPERAPI_KEY
    ? `https://api.scraperapi.com/?api_key=${SCRAPERAPI_KEY}&url=${encodeURIComponent(url)}`
    : url;
  try {
    const res = await fetch(fetchUrl, { headers: { "User-Agent": UA, "Accept": "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function resolveTournamentId(target: Target): Promise<number | null> {
  if (target.sofa_tid) return target.sofa_tid;
  for (const q of target.search ?? [target.name]) {
    const data = await sofa(`/search/all?q=${encodeURIComponent(q)}`);
    const rows = data?.results ?? [];
    for (const row of rows) {
      const entity = row?.entity ?? {};
      const type = String(row?.type ?? entity?.type ?? "").toLowerCase();
      const name = String(entity?.name ?? "").toLowerCase();
      if (!entity?.id) continue;
      if (!type.includes("tournament") && !entity?.uniqueTournament) continue;
      const wanted = target.name.toLowerCase().replace(/^fifa\s+/, "").replace(/^uefa\s+/, "");
      if (name.includes(wanted) || wanted.includes(name) || name.includes(q.toLowerCase().replace(/^fifa\s+/, "").replace(/^uefa\s+/, ""))) {
        return Number(entity.uniqueTournament?.id ?? entity.id);
      }
    }
  }
  return null;
}

function normalize(name: string): string {
  return name.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+(fc|cf|sc|ac|afc|cfc|fk|sk|bk|if|kf|club)\.?$/gi, "")
    .replace(/^(fc|cf|sc|ac|afc|cfc|fk|sk|bk|if|kf)\s+/gi, "")
    .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function statusOf(t: any): "scheduled" | "live" | "finished" {
  const code = t?.status?.type;
  if (code === "finished") return "finished";
  if (code === "inprogress") return "live";
  return "scheduled";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { league_keys?: string[]; dry_run?: boolean } = {};
  try { body = await req.json(); } catch {}

  const targets = body.league_keys?.length
    ? TARGETS.filter(t => body.league_keys!.includes(t.key))
    : TARGETS;

  // Track in sync_jobs so the diagnostics dashboard can surface this run.
  const { data: source } = await supabase
    .from("data_sources")
    .upsert({ name: "sofascore_scraper", active: true }, { onConflict: "name" })
    .select().single();

  const summary: any[] = [];
  let inserted = 0;
  let teamsCreated = 0;

  for (const t of targets) {
    const { data: job } = await supabase.from("sync_jobs").insert({
      job_name: `sofascore:${t.name}`,
      source: source?.id,
      status: "running",
      started_at: new Date().toISOString(),
    }).select().single();

    let leagueErr: string | null = null;
    let localIns = 0;
    let eventsCount = 0;
    let tournamentId: number | null = null;
    let sid: number | null = null;
    let skipNoData = 0, skipNoTeam = 0, skipDupe = 0;

    // 1) ensure league row exists
    let { data: league } = await supabase.from("leagues")
      .select("id")
      .eq("name", t.name).eq("country", t.country).eq("season", t.season)
      .maybeSingle();
    if (!league) {
      const { data: created } = await supabase.from("leagues")
        .insert({ name: t.name, country: t.country, season: t.season, active: true })
        .select("id").single();
      league = created;
    }
    if (!league) {
      leagueErr = "league insert failed";
      summary.push({ key: t.key, error: leagueErr });
      await supabase.from("sync_jobs").update({
        status: "failed", error_message: leagueErr, finished_at: new Date().toISOString(),
      }).eq("id", job!.id);
      continue;
    }

    // 2) current season id on Sofascore
    tournamentId = await resolveTournamentId(t);
    if (!tournamentId) {
      leagueErr = "no sofascore tournament";
      summary.push({ key: t.key, error: leagueErr });
      await supabase.from("sync_jobs").update({
        status: "failed", error_message: leagueErr, finished_at: new Date().toISOString(),
      }).eq("id", job!.id);
      continue;
    }
    const seasons = await sofa(`/unique-tournament/${tournamentId}/seasons`);
    sid = seasons?.seasons?.[0]?.id ?? null;
    if (!sid) {
      leagueErr = "no sofascore season";
      summary.push({ key: t.key, error: leagueErr });
      await supabase.from("sync_jobs").update({
        status: "failed", error_message: leagueErr, finished_at: new Date().toISOString(),
      }).eq("id", job!.id);
      continue;
    }

    // 3) upcoming events (bounded pagination)
    const events: any[] = [];
    for (let page = 0; page < 4; page++) {
      const data = await sofa(`/unique-tournament/${tournamentId}/season/${sid}/events/next/${page}`);
      const list = data?.events ?? [];
      if (!list.length) break;
      events.push(...list);
      if (!data?.hasNextPage) break;
    }
    eventsCount = events.length;

    // 4) team cache for this league
    const { data: teamRows } = await supabase.from("teams")
      .select("id, name, normalized_name").eq("league_id", league.id);
    const teamByNorm = new Map<string, string>();
    (teamRows ?? []).forEach(r => teamByNorm.set(r.normalized_name, r.id));

    const ensureTeam = async (name: string): Promise<string | null> => {
      const norm = normalize(name);
      if (teamByNorm.has(norm)) return teamByNorm.get(norm)!;
      const { data: existing } = await supabase.from("teams")
        .select("id").eq("normalized_name", norm).limit(1).maybeSingle();
      if (existing?.id) { teamByNorm.set(norm, existing.id); return existing.id; }
      const { data: ins, error: tErr } = await supabase.from("teams")
        .insert({ name, country: t.country, league_id: league!.id, normalized_name: norm })
        .select("id").single();
      if (tErr) console.log("team insert err", name, tErr.message);
      if (ins?.id) { teamByNorm.set(norm, ins.id); teamsCreated++; return ins.id; }
      return null;
    };

    const errs: string[] = [];
    for (const e of events) {
      const home = e?.homeTeam?.name; const away = e?.awayTeam?.name;
      const ts = e?.startTimestamp;
      if (!home || !away || !ts) { skipNoData++; continue; }
      const matchDate = new Date(ts * 1000).toISOString();

      if (body.dry_run) { localIns++; continue; }

      const homeId = await ensureTeam(home);
      const awayId = await ensureTeam(away);
      if (!homeId || !awayId) { skipNoTeam++; continue; }

      const dayStart = new Date(ts * 1000 - 86400000).toISOString();
      const dayEnd   = new Date(ts * 1000 + 86400000).toISOString();
      const { data: dupe } = await supabase.from("matches")
        .select("id").eq("league_id", league.id)
        .eq("home_team_id", homeId).eq("away_team_id", awayId)
        .gte("match_date", dayStart).lte("match_date", dayEnd)
        .limit(1).maybeSingle();
      if (dupe?.id) { skipDupe++; continue; }

      const { error: insErr } = await supabase.from("matches").insert({
        league_id: league.id, season: t.season, match_date: matchDate,
        home_team_id: homeId, away_team_id: awayId, status: statusOf(e),
        round: e?.roundInfo?.name ?? null,
      });
      if (!insErr) { localIns++; inserted++; }
      else if (errs.length < 3) errs.push(insErr.message);
    }

    if (eventsCount === 0) leagueErr = "no upcoming fixtures returned by sofascore";
    else if (localIns === 0 && skipDupe === eventsCount) leagueErr = null;
    else if (localIns === 0 && skipNoTeam > 0) leagueErr = "team normalization failed for all events";

    await supabase.from("sync_jobs").update({
      status: errs.length || leagueErr ? "success" : "success",
      processed_records: localIns,
      error_message: leagueErr ?? (errs.length ? errs.slice(0, 3).join(" | ") : null),
      finished_at: new Date().toISOString(),
    }).eq("id", job!.id);

    summary.push({ key: t.key, league_id: league.id, sofa_tournament: tournamentId, sofa_season: sid, events: eventsCount, inserted: localIns, skipNoData, skipNoTeam, skipDupe, errors: errs, reason: leagueErr });
  }

  if (source) {
    await supabase.from("data_sources").update({ last_sync: new Date().toISOString() }).eq("id", source.id);
  }


  return new Response(JSON.stringify({ ok: true, inserted, teams_created: teamsCreated, summary }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
  });
});
