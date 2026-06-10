// sync-worldfootballr
// Pulls cards & corners from FBref (the primary data source used by the R
// package `worldfootballR`) and updates matches.home_cards/away_cards/
// home_corners/away_corners.
//
// Strategy:
//   1. For each active league with a fbref_id, fetch the season schedule page.
//   2. Each row contains: date, home, away and a match-report link.
//   3. For each finished match we don't yet have cards/corners for, fetch the
//      match report HTML and extract:
//        - cards_yellow + cards_red per side (from #stats_{team}_summary)
//        - corner_kicks per side (from #stats_{team}_passing_types)
//   4. Update the existing matches row matched by (league_id, match_date::date,
//      home_team_id, away_team_id) using normalized team names for fuzzy join.
//
// FBref is rate-limited (~10 req/min). Pass `{ "limit": 25 }` to chunk runs.
// Pass `{ "league_id": "<uuid>", "season": "2024-25" }` to scope a run.
// Pass `{ "trigger_stats": true }` to chain calculate-statistics afterwards.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Conservative pacing — FBref throttles aggressively.
const REQUEST_DELAY_MS = 3500;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

// "2024-25" -> "2024-2025"  (FBref uses the full year form in URLs)
function toFbrefSeason(season: string): string {
  const m = season.match(/^(\d{4})-(\d{2})$/);
  if (!m) return season;
  const startYear = parseInt(m[1], 10);
  return `${startYear}-${startYear + 1}`;
}

// FBref wraps several tables in HTML comments to avoid layout reflow. Unwrap.
function stripFbrefComments(html: string): string {
  return html.replace(/<!--/g, "").replace(/-->/g, "");
}

// Pull all <td>/<th> cells with data-stat="X" from a chunk and return the
// first numeric value. Used for per-team stat blocks on a match report.
function extractStat(html: string, stat: string): number | null {
  const re = new RegExp(
    `data-stat=["']${stat}["'][^>]*>([\\s\\S]*?)<\\/(?:td|th)>`,
    "i",
  );
  const m = html.match(re);
  if (!m) return null;
  const inner = m[1].replace(/<[^>]+>/g, "").trim();
  const n = parseInt(inner, 10);
  return Number.isFinite(n) ? n : null;
}

type ScheduleRow = {
  date: string;          // YYYY-MM-DD
  homeName: string;
  awayName: string;
  reportPath: string;    // /en/matches/<id>/...
};

function parseSchedule(html: string): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  // Each schedule row is a <tr> with several data-stat cells.
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html)) !== null) {
    const tr = m[1];
    if (!/data-stat=["']match_report["']/.test(tr)) continue;

    const date =
      tr.match(/data-stat=["']date["'][^>]*>(?:<a[^>]*>)?(\d{4}-\d{2}-\d{2})/)?.[1];
    const home = tr
      .match(/data-stat=["']home_team["'][^>]*>([\s\S]*?)<\/td>/)?.[1]
      ?.replace(/<[^>]+>/g, "")
      .trim();
    const away = tr
      .match(/data-stat=["']away_team["'][^>]*>([\s\S]*?)<\/td>/)?.[1]
      ?.replace(/<[^>]+>/g, "")
      .trim();
    const report = tr.match(
      /data-stat=["']match_report["'][^>]*>\s*<a href=["']([^"']+)["']/,
    )?.[1];

    if (date && home && away && report && /\/en\/matches\//.test(report)) {
      rows.push({ date, homeName: home, awayName: away, reportPath: report });
    }
  }
  return rows;
}

type MatchStats = {
  home_cards: number | null;
  away_cards: number | null;
  home_corners: number | null;
  away_corners: number | null;
};

// Extracts a single team's stats block from a match report.
function extractTeamBlock(html: string, blockId: string): string | null {
  const re = new RegExp(
    `<table[^>]*id=["']${blockId}["'][^>]*>([\\s\\S]*?)<\\/table>`,
    "i",
  );
  return html.match(re)?.[1] ?? null;
}

function parseMatchReport(html: string): MatchStats {
  const unwrapped = stripFbrefComments(html);

  // Team ids in the URL are hex; FBref builds tables like stats_<teamid>_summary
  // and stats_<teamid>_passing_types. Find both team ids in order (home first,
  // away second) by scanning for stats_*_summary table headers.
  const ids: string[] = [];
  const idRe = /id=["']stats_([0-9a-f]+)_summary["']/g;
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(unwrapped)) !== null) ids.push(m[1]);

  const result: MatchStats = {
    home_cards: null,
    away_cards: null,
    home_corners: null,
    away_corners: null,
  };
  if (ids.length < 2) return result;

  const [homeId, awayId] = ids;

  // Sum yellow + red cards from the team summary footer (tfoot has totals).
  for (const [side, id] of [["home", homeId], ["away", awayId]] as const) {
    const summary = extractTeamBlock(unwrapped, `stats_${id}_summary`);
    if (summary) {
      // Use tfoot if present, else fall back to full table.
      const tfoot = summary.match(/<tfoot>([\s\S]*?)<\/tfoot>/)?.[1] ?? summary;
      const y = extractStat(tfoot, "cards_yellow") ?? 0;
      const r = extractStat(tfoot, "cards_red") ?? 0;
      result[`${side}_cards`] = y + r;
    }

    const passing = extractTeamBlock(unwrapped, `stats_${id}_passing_types`);
    if (passing) {
      const tfoot = passing.match(/<tfoot>([\s\S]*?)<\/tfoot>/)?.[1] ?? passing;
      result[`${side}_corners`] = extractStat(tfoot, "corner_kicks");
    }
  }
  return result;
}

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const SCRAPERAPI_KEY = Deno.env.get("SCRAPERAPI_KEY") ?? "";

let lastFetchStatus = 0;
async function fbrefFetch(url: string): Promise<string | null> {
  // Route through ScraperAPI to bypass Cloudflare on fbref.com.
  // For FBref we need premium routing + a US residential exit; the basic
  // datacenter proxy gets a hard 403 on every schedule page. `render=false`
  // because FBref pages are server-rendered HTML — saves credits vs render=true.
  const fetchUrl = SCRAPERAPI_KEY
    ? `https://api.scraperapi.com/?api_key=${SCRAPERAPI_KEY}` +
      `&url=${encodeURIComponent(url)}` +
      `&country_code=us&premium=true&keep_headers=true`
    : url;
  let res: Response;
  try {
    res = await fetch(fetchUrl, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://fbref.com/",
      },
    });
  } catch (e) {
    console.log(`[worldfootballr] fetch threw: ${e instanceof Error ? e.message : e}`);
    lastFetchStatus = 0;
    return null;
  }
  lastFetchStatus = res.status;
  if (!res.ok) {
    // Log a slice of the body so we can tell apart ScraperAPI errors (JSON
    // saying "premium=true required" or quota exhausted) from real Cloudflare
    // 403s on FBref itself.
    let snippet = "";
    try { snippet = (await res.text()).slice(0, 200).replace(/\s+/g, " "); } catch {}
    console.log(`[worldfootballr] fetch ${url} -> http ${res.status} via=${SCRAPERAPI_KEY ? "scraperapi" : "direct"} body="${snippet}"`);
    return null;
  }
  return await res.text();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: {
    season?: string;
    league_id?: string;
    limit?: number;
    trigger_stats?: boolean;
  } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const season = body.season ?? "2024-25";
  const fbrefSeason = toFbrefSeason(season);
  const limit = Math.max(1, Math.min(body.limit ?? 30, 200));

  // Lookup or create source row
  const { data: source } = await supabase
    .from("data_sources")
    .upsert({ name: "worldfootballr_fbref", active: true }, { onConflict: "name" })
    .select()
    .single();
  if (!source) return json({ error: "data_source upsert failed" }, 500);

  const { data: job } = await supabase
    .from("sync_jobs")
    .insert({
      job_name: `worldfootballr:${season}`,
      source: source.id,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (!job) return json({ error: "sync_jobs insert failed" }, 500);

  // Target leagues
  let lq = supabase
    .from("leagues")
    .select("id, name, country, fbref_id, fbref_slug")
    .eq("season", season)
    .not("fbref_id", "is", null);
  if (body.league_id) lq = lq.eq("id", body.league_id);
  const { data: leagues } = await lq;
  if (!leagues || leagues.length === 0) {
    await supabase.from("sync_jobs").update({
      status: "success", processed_records: 0,
      finished_at: new Date().toISOString(),
    }).eq("id", job.id);
    return json({ ok: true, processed: 0, message: "no leagues to sync" });
  }

  let processed = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    outer:
    for (const lg of leagues) {
      // Load all matches for this league/season missing stats — we only enrich
      // matches we already have (sync-openfootball seeded them).
      const { data: pendingMatches } = await supabase
        .from("matches")
        .select("id, match_date, status, home_team_id, away_team_id, home_cards, away_cards, home_corners, away_corners")
        .eq("league_id", lg.id)
        .eq("season", season)
        .eq("status", "finished")
        .or("home_cards.is.null,home_corners.is.null")
        .order("match_date", { ascending: false });

      if (!pendingMatches || pendingMatches.length === 0) continue;

      // Fetch team name → id map for this league
      const { data: teamRows } = await supabase
        .from("teams")
        .select("id, name, normalized_name")
        .eq("league_id", lg.id);
      const teamByNorm = new Map<string, string>();
      (teamRows ?? []).forEach((t) => teamByNorm.set(t.normalized_name, t.id));

      const scheduleUrl =
        `https://fbref.com/en/comps/${lg.fbref_id}/${fbrefSeason}/schedule/` +
        `${fbrefSeason}-${lg.fbref_slug}-Scores-and-Fixtures`;
      const scheduleHtml = await fbrefFetch(scheduleUrl);
      await delay(REQUEST_DELAY_MS);
      if (!scheduleHtml) {
        // FBref/Cloudflare frequently 403s on schedule pages. worldfootballr is
        // enrichment-only (cards/corners); never let it pollute the error log
        // or block downstream visibility. Log to console only.
        const reason = lastFetchStatus === 403
          ? "blocked (http 403)"
          : `unavailable (http ${lastFetchStatus})`;
        console.log(`[worldfootballr] skip ${lg.name}: ${reason}`);
        continue;
      }

      const schedule = parseSchedule(stripFbrefComments(scheduleHtml));

      // Index schedule by (date, home, away) -> reportPath
      const schedIndex = new Map<string, string>();
      for (const s of schedule) {
        const k = `${s.date}|${normalize(s.homeName)}|${normalize(s.awayName)}`;
        schedIndex.set(k, s.reportPath);
      }

      for (const m of pendingMatches) {
        if (processed >= limit) break outer;

        const matchDateIso = new Date(m.match_date as string).toISOString().slice(0, 10);

        // Find team names by id to build the lookup key
        const homeName = (teamRows ?? []).find((t) => t.id === m.home_team_id)?.normalized_name;
        const awayName = (teamRows ?? []).find((t) => t.id === m.away_team_id)?.normalized_name;
        if (!homeName || !awayName) {
          skipped++;
          await supabase.from("pipeline_logs").insert({
            provider: "worldfootballr",
            job_run_id: job.id,
            league_id: lg.id,
            match_id: m.id,
            match_date: m.match_date,
            cards_found: false, corners_found: false,
            cards_written: false, corners_written: false,
            status: "skipped",
            error_message: "team name lookup failed",
          }).then(() => {}, () => {});
          continue;
        }

        // Try exact date match first, then ±1 day (timezones).
        const candidateDates = [matchDateIso];
        const d = new Date(matchDateIso);
        candidateDates.push(new Date(d.getTime() - 86400000).toISOString().slice(0, 10));
        candidateDates.push(new Date(d.getTime() + 86400000).toISOString().slice(0, 10));

        let reportPath: string | undefined;
        for (const cd of candidateDates) {
          reportPath = schedIndex.get(`${cd}|${homeName}|${awayName}`);
          if (reportPath) break;
        }
        if (!reportPath) {
          skipped++;
          await supabase.from("pipeline_logs").insert({
            provider: "worldfootballr",
            job_run_id: job.id,
            league_id: lg.id,
            match_id: m.id,
            match_date: m.match_date,
            cards_found: false, corners_found: false,
            cards_written: false, corners_written: false,
            status: "skipped",
            error_message: "no FBref schedule row matched",
          }).then(() => {}, () => {});
          continue;
        }

        const reportHtml = await fbrefFetch(`https://fbref.com${reportPath}`);
        await delay(REQUEST_DELAY_MS);
        if (!reportHtml) {
          skipped++;
          await supabase.from("pipeline_logs").insert({
            provider: "worldfootballr",
            job_run_id: job.id,
            league_id: lg.id,
            match_id: m.id,
            provider_fixture_id: reportPath,
            match_date: m.match_date,
            cards_found: false, corners_found: false,
            cards_written: false, corners_written: false,
            status: "failed",
            error_message: `match report fetch failed (http ${lastFetchStatus})`,
          }).then(() => {}, () => {});
          continue;
        }

        const stats = parseMatchReport(reportHtml);
        const cardsFound = stats.home_cards != null || stats.away_cards != null;
        const cornersFound = stats.home_corners != null || stats.away_corners != null;
        const update: Record<string, number | null> = {};
        if (m.home_cards == null && stats.home_cards != null) update.home_cards = stats.home_cards;
        if (m.away_cards == null && stats.away_cards != null) update.away_cards = stats.away_cards;
        if (m.home_corners == null && stats.home_corners != null) update.home_corners = stats.home_corners;
        if (m.away_corners == null && stats.away_corners != null) update.away_corners = stats.away_corners;

        let cardsWritten = false, cornersWritten = false, errMsg: string | null = null;
        if (Object.keys(update).length > 0) {
          const { error: upErr } = await supabase
            .from("matches")
            .update(update)
            .eq("id", m.id);
          if (!upErr) {
            processed++;
            cardsWritten = "home_cards" in update || "away_cards" in update;
            cornersWritten = "home_corners" in update || "away_corners" in update;
          } else {
            errors.push(`match ${m.id}: ${upErr.message}`);
            errMsg = upErr.message;
          }
        } else {
          skipped++;
        }

        await supabase.from("pipeline_logs").insert({
          provider: "worldfootballr",
          job_run_id: job.id,
          league_id: lg.id,
          match_id: m.id,
          provider_fixture_id: reportPath,
          match_date: m.match_date,
          cards_found: cardsFound,
          corners_found: cornersFound,
          cards_written: cardsWritten,
          corners_written: cornersWritten,
          status: errMsg
            ? "failed"
            : ((cardsWritten || cornersWritten) ? "success" : "skipped"),
          error_message: errMsg,
        }).then(() => {}, () => {});
      }
    }

    await supabase.from("sync_jobs").update({
      status: errors.length ? "success" : "success",
      processed_records: processed,
      error_message: errors.length ? errors.slice(0, 5).join(" | ") : null,
      finished_at: new Date().toISOString(),
    }).eq("id", job.id);
    await supabase.from("data_sources").update({ last_sync: new Date().toISOString() }).eq("id", source.id);

    // Optionally chain into the statistics pipeline
    if (body.trigger_stats && processed > 0) {
      await fetch(`${SUPABASE_URL}/functions/v1/calculate-statistics`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({ sample_sizes: [10, 20], categories: ["cards", "corners"] }),
      }).catch(() => { /* best-effort */ });
    }

    return json({
      ok: true,
      processed,
      skipped,
      limit,
      season,
      leagues: leagues.length,
      errors: errors.slice(0, 5),
      hint: processed === limit ? "limit reached — call again to continue" : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("sync_jobs").update({
      status: "failed",
      processed_records: processed,
      error_message: msg,
      finished_at: new Date().toISOString(),
    }).eq("id", job.id);
    return json({ error: msg, processed }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
