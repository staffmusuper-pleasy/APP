// Ingestion pipeline for OpenFootball (https://github.com/openfootball)
// Pulls leagues, teams, fixtures and finished matches from two source formats:
//   - JSON (football.json repo)  → European leagues
//   - TXT  (south-america repo)  → Brazilian leagues (Série A)
//
// Cards & corners are NOT provided by OpenFootball and remain NULL.
// For European leagues they are later enriched by sync-worldfootballr (FBref).
// Brazilian leagues are intentionally left without cards/corners until a
// valid Brazilian data source is wired up — sync-worldfootballr filters
// leagues by fbref_id (which we leave NULL for Brazil) so they are skipped.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type SourceLeague = {
  key: string;
  name: string;
  country: string;
  format: "json" | "txt";
  url: string; // full raw URL
};

// European leagues (JSON). Season uses 2024-25 style.
const EUROPEAN_LEAGUES = (season: string): SourceLeague[] => {
  const base = `https://raw.githubusercontent.com/openfootball/football.json/master/${season}`;
  return [
    { key: "en.1", name: "English Premier League", country: "England", format: "json", url: `${base}/en.1.json` },
    { key: "es.1", name: "Primera División", country: "Spain", format: "json", url: `${base}/es.1.json` },
    { key: "de.1", name: "Bundesliga", country: "Germany", format: "json", url: `${base}/de.1.json` },
    { key: "it.1", name: "Serie A", country: "Italy", format: "json", url: `${base}/it.1.json` },
    { key: "fr.1", name: "Ligue 1", country: "France", format: "json", url: `${base}/fr.1.json` },
    { key: "nl.1", name: "Eredivisie", country: "Netherlands", format: "json", url: `${base}/nl.1.json` },
    { key: "pt.1", name: "Primeira Liga", country: "Portugal", format: "json", url: `${base}/pt.1.json` },
    { key: "tr.1", name: "Süper Lig", country: "Turkey", format: "json", url: `${base}/tr.1.json` },
    { key: "sco.1", name: "Scottish Premiership", country: "Scotland", format: "json", url: `${base}/sco.1.json` },
    { key: "gr.1", name: "Super League", country: "Greece", format: "json", url: `${base}/gr.1.json` },
  ];
};

// Brazilian leagues (TXT). Season is a calendar year, e.g. "2025".
const BRAZIL_LEAGUES = (season: string): SourceLeague[] => [
  { key: "br.1", name: "Campeonato Brasileiro Série A", country: "Brazil", format: "txt",
    url: `https://raw.githubusercontent.com/openfootball/south-america/master/brazil/${season}_br1.txt` },
];

type OFMatch = {
  round?: string;
  date: string;
  time?: string;
  team1: string;
  team2: string;
  score?: { ft?: [number, number]; ht?: [number, number] };
};

type OFFile = { name: string; matches: OFMatch[] };

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+(fc|cf|sc|ac|afc|cfc|fk|sk|bk|if|kf|club)\.?$/gi, "")
    .replace(/^(fc|cf|sc|ac|afc|cfc|fk|sk|bk|if|kf)\s+/gi, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseOpenFootballDateTime(date: string | undefined, time?: string): Date | null {
  if (!date) return null;
  const d = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!d) return null;
  const t = (time ?? "00:00").match(/^(\d{1,2}):(\d{2})$/);
  if (!t) return null;

  const year = Number(d[1]);
  const month = Number(d[2]);
  const day = Number(d[3]);
  const hour = Number(t[1]);
  const minute = Number(t[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute
  ) return null;
  return parsed;
}

// ------------- TXT parser (openfootball plain-text format) -------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseTxt(text: string, defaultYear: number): OFFile {
  const lines = text.split(/\r?\n/);
  const matches: OFMatch[] = [];
  let leagueName = "";
  let currentRound: string | undefined;
  let currentDate: string | undefined;   // YYYY-MM-DD
  let lastTime: string | undefined;

  const headerRe = /^=\s*(.+)$/;
  // Matchday marker can be » (older files) or ▪ (newer files).
  const roundRe  = /^[»▪]\s*(.+?)\s*$/;
  // Date line accepts both "Sat Mar/29 2025" and "Wed Jan 28 2026" forms.
  const dateRe = /^\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Za-z]{3})[\/\s]+(\d{1,2})(?:\s+(\d{4}))?\s*$/;
  // Match line:
  //   "    18.30  Team A   v Team B   2-1 (2-1)"
  //   "           Team A   v Team B   0-0"
  //   "           Team A   v Team B"   (scheduled, no score)
  const matchRe = /^\s*(?:(\d{1,2}[.:]\d{2})\s+)?(\S.*?\S)\s+v\s+(\S.*?\S?)(?:\s{2,}(\d{1,2})-(\d{1,2})(?:\s*\((\d{1,2})-(\d{1,2})\))?)?\s*$/;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const h = line.match(headerRe);
    if (h) { leagueName = h[1].trim(); continue; }

    const r = line.match(roundRe);
    if (r) { currentRound = r[1].trim(); continue; }

    const d = line.match(dateRe);
    if (d) {
      const month = MONTHS[d[1].toLowerCase()];
      const day = parseInt(d[2], 10);
      const year = d[3] ? parseInt(d[3], 10) : defaultYear;
      if (month) {
        currentDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
      lastTime = undefined;
      continue;
    }

    const m = line.match(matchRe);
    if (m && currentDate) {
      const time = m[1] ? m[1].replace(".", ":") : lastTime;
      if (m[1]) lastTime = time;
      const team1 = m[2].trim();
      const team2 = m[3].trim();
      // Ignore lines that look like prose, not real match rows.
      if (!team1 || !team2 || team1.length < 2 || team2.length < 2) continue;
      const hasScore = m[4] !== undefined && m[5] !== undefined;
      matches.push({
        round: currentRound,
        date: currentDate,
        time,
        team1,
        team2,
        score: hasScore
          ? {
              ft: [parseInt(m[4], 10), parseInt(m[5], 10)],
              ht: m[6] !== undefined && m[7] !== undefined
                ? [parseInt(m[6], 10), parseInt(m[7], 10)]
                : undefined,
            }
          : undefined,
      });
    }
  }

  return { name: leagueName, matches };
}

// -----------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { season?: string; region?: "europe" | "brazil"; leagues?: SourceLeague[] } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const region = body.region ?? "europe";
  const season =
    body.season ?? (region === "brazil" ? String(new Date().getFullYear()) : "2024-25");

  const leagues =
    body.leagues ??
    (region === "brazil" ? BRAZIL_LEAGUES(season) : EUROPEAN_LEAGUES(season));

  const { data: source, error: srcErr } = await supabase
    .from("data_sources")
    .upsert({ name: "openfootball", active: true }, { onConflict: "name" })
    .select()
    .single();
  if (srcErr || !source) return json({ error: srcErr?.message ?? "source missing" }, 500);

  const { data: job, error: jobErr } = await supabase
    .from("sync_jobs")
    .insert({
      job_name: `openfootball:${region}:${season}`,
      source: source.id,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (jobErr || !job) return json({ error: jobErr?.message }, 500);

  let processed = 0;
  const perLeague: Array<{ key: string; matches: number; ok: boolean; error?: string }> = [];

  try {
    for (const lg of leagues) {
      const res = await fetch(lg.url);
      if (!res.ok) {
        perLeague.push({ key: lg.key, matches: 0, ok: false, error: `fetch ${res.status}` });
        continue;
      }

      let parsed: OFFile;
      if (lg.format === "json") {
        parsed = (await res.json()) as OFFile;
      } else {
        const text = await res.text();
        const defaultYear = parseInt(season.match(/^\d{4}/)?.[0] ?? "2025", 10);
        parsed = parseTxt(text, defaultYear);
      }

      // Upsert league. Brazilian leagues intentionally leave fbref_id NULL so
      // sync-worldfootballr skips them (cards/corners stay disabled).
      const { data: league } = await supabase
        .from("leagues")
        .upsert(
          { name: lg.name, country: lg.country, season, active: true },
          { onConflict: "name,country,season" }
        )
        .select()
        .single();
      if (!league) {
        perLeague.push({ key: lg.key, matches: 0, ok: false, error: "league upsert failed" });
        continue;
      }

      const teamNames = new Set<string>();
      for (const m of parsed.matches) { teamNames.add(m.team1); teamNames.add(m.team2); }

      const teamRows = [...teamNames].map((n) => ({
        name: n,
        normalized_name: normalize(n),
        country: lg.country,
        league_id: league.id,
      }));

      const { data: teams } = await supabase
        .from("teams")
        .upsert(teamRows, { onConflict: "normalized_name,country" })
        .select();

      const teamMap = new Map<string, string>();
      (teams ?? []).forEach((t: any) => teamMap.set(t.normalized_name, t.id));

      let skippedInvalidDate = 0;
      const matchRows = parsed.matches.map((m) => {
        const home = teamMap.get(normalize(m.team1));
        const away = teamMap.get(normalize(m.team2));
        if (!home || !away) return null;
        const iso = parseOpenFootballDateTime(m.date, m.time);
        if (!iso) { skippedInvalidDate++; return null; }
        const ft = m.score?.ft;
        const finished = Array.isArray(ft);
        return {
          league_id: league.id,
          season,
          round: m.round ?? null,
          status: finished ? "finished" : "scheduled",
          match_date: iso.toISOString(),
          home_team_id: home,
          away_team_id: away,
          home_goals: finished ? ft![0] : null,
          away_goals: finished ? ft![1] : null,
          // home_cards/away_cards/home_corners/away_corners intentionally NULL
          // — OpenFootball doesn't provide them and Brazil has no alt source.
        };
      }).filter(Boolean) as any[];

      let inserted = 0;
      if (matchRows.length) {
        // Avoid duplicating: delete existing matches for this league+season first.
        await supabase.from("matches")
          .delete()
          .eq("league_id", league.id)
          .eq("season", season);

        const { error: insErr } = await supabase.from("matches").insert(matchRows);
        if (!insErr) {
          inserted = matchRows.length;
          processed += inserted;
        } else {
          perLeague.push({ key: lg.key, matches: 0, ok: false, error: insErr.message });
          continue;
        }
      }
      perLeague.push({ key: lg.key, matches: inserted, ok: true, skipped_invalid_date: skippedInvalidDate });
    }

    await supabase.from("sync_jobs").update({
      status: "success",
      processed_records: processed,
      finished_at: new Date().toISOString(),
    }).eq("id", job.id);

    await supabase.from("data_sources").update({ last_sync: new Date().toISOString() }).eq("id", source.id);

    return json({ ok: true, processed, region, season, leagues: perLeague, job_id: job.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("sync_jobs").update({
      status: "failed",
      processed_records: processed,
      error_message: msg,
      finished_at: new Date().toISOString(),
    }).eq("id", job.id);
    return json({ error: msg, leagues: perLeague }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
