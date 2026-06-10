// sync-sofascore
// Third-tier enrichment provider for cards & corners (after API-Football and FBref).
//
// SofaScore exposes an internal JSON API at https://api.sofascore.com/api/v1/.
// We route through ScraperAPI to bypass aggressive rate-limiting / 403 from
// their edge. Match identity goes through match_provider_ids (provider='sofascore').
//
// Request body:
//   {
//     league_id?: string         // single league filter
//     af_league_id?: number      // not used here, kept for symmetry
//     season?: string            // "2024-25"
//     limit?: number             // default 25
//     mode?: "audit" | "enrich"  // audit = discovery only, no writes (default "enrich")
//   }
//
// Audit mode: discovers SofaScore events for the league/season, returns counts,
// upserts match_provider_ids mappings where possible, but does NOT touch
// matches.* columns or pipeline_logs cards/corners writes.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SCRAPER_KEY = Deno.env.get("SCRAPERAPI_KEY") ?? "";

const PROVIDER = "sofascore";
const SOFA_BASE = "https://api.sofascore.com/api/v1";

function normalize(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+(fc|cf|sc|ac|afc|cfc|fk|sk|bk|if|kf|club)\.?$/gi, "")
    .replace(/^(fc|cf|sc|ac|afc|cfc|fk|sk|bk|if|kf)\s+/gi, "")
    .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

async function sofaFetch(path: string): Promise<{ ok: boolean; status: number; body: any; ms: number }> {
  const t0 = Date.now();
  const direct = `${SOFA_BASE}${path}`;
  const url = SCRAPER_KEY
    ? `http://api.scraperapi.com/?api_key=${SCRAPER_KEY}&url=${encodeURIComponent(direct)}&premium=true&country_code=us`
    : direct;
  try {
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    const ms = Date.now() - t0;
    const text = await r.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { body = { _raw: text.slice(0, 200) }; }
    return { ok: r.ok, status: r.status, body, ms };
  } catch (e) {
    return { ok: false, status: 0, body: { error: String(e) }, ms: Date.now() - t0 };
  }
}

type SofaEvent = {
  id: number;
  startTimestamp: number;
  homeTeam: { id: number; name: string };
  awayTeam: { id: number; name: string };
  status?: { type?: string };
};

// Extract cards/corners from SofaScore statistics payload.
// Statistics live in event/{id}/statistics, grouped by period ("ALL", "1ST", "2ND")
// with groups[].statisticsItems[{name, home, away}].
function extractStats(stats: any): { home_cards: number | null; away_cards: number | null; home_corners: number | null; away_corners: number | null } {
  const out = { home_cards: null as number | null, away_cards: null as number | null, home_corners: null as number | null, away_corners: null as number | null };
  const periods = stats?.statistics ?? [];
  const all = periods.find((p: any) => p?.period === "ALL") ?? periods[0];
  if (!all) return out;
  let yh = 0, ya = 0, rh = 0, ra = 0, ch = 0, ca = 0;
  let sawCards = false, sawCorners = false;
  for (const g of all.groups ?? []) {
    for (const it of g.statisticsItems ?? []) {
      const n = String(it.name ?? "").toLowerCase();
      const h = Number(it.home); const a = Number(it.away);
      if (n.includes("yellow")) { if (!Number.isNaN(h)) yh += h; if (!Number.isNaN(a)) ya += a; sawCards = true; }
      else if (n.includes("red")) { if (!Number.isNaN(h)) rh += h; if (!Number.isNaN(a)) ra += a; sawCards = true; }
      else if (n.includes("corner")) { if (!Number.isNaN(h)) ch = h; if (!Number.isNaN(a)) ca = a; sawCorners = true; }
    }
  }
  if (sawCards) { out.home_cards = yh + rh; out.away_cards = ya + ra; }
  if (sawCorners) { out.home_corners = ch; out.away_corners = ca; }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const mode: "audit" | "enrich" = body.mode ?? "enrich";
  const limit = Math.min(Math.max(Number(body.limit ?? 25), 1), 200);

  if (!SCRAPER_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "SCRAPERAPI_KEY not configured", provider: PROVIDER }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Resolve target league(s)
  let leaguesQ = supabase.from("leagues")
    .select("id, name, country, season, sofascore_id");
  if (body.league_id) leaguesQ = leaguesQ.eq("id", body.league_id);
  const { data: leagues, error: lerr } = await leaguesQ;
  if (lerr) return new Response(JSON.stringify({ error: lerr.message }), { status: 500, headers: corsHeaders });

  const report = {
    ok: true,
    provider: PROVIDER,
    mode,
    leagues_processed: 0,
    leagues_with_sofascore_id: 0,
    events_discovered: 0,
    mappings_created: 0,
    matches_updated: 0,
    cards_written: 0,
    corners_written: 0,
    skipped_no_mapping: 0,
    errors: 0,
    details: [] as any[],
  };

  for (const l of (leagues ?? []) as any[]) {
    report.leagues_processed++;
    if (!l.sofascore_id) {
      report.details.push({ league: l.name, season: l.season, skipped: "no sofascore_id" });
      continue;
    }
    report.leagues_with_sofascore_id++;
    // SofaScore: /unique-tournament/{utId}/season/{seasonId}/events/last/{page}
    // For audit-only first iteration we just hit page 0 of "last" (recent finished).
    const path = `/unique-tournament/${l.sofascore_id}/season/${body.season_id ?? 0}/events/last/0`;
    const ev = await sofaFetch(path);
    if (!ev.ok) {
      report.errors++;
      report.details.push({ league: l.name, status: ev.status, error: ev.body?._raw ?? ev.body?.error ?? "fetch failed", ms: ev.ms });
      continue;
    }
    const events: SofaEvent[] = ev.body?.events ?? [];
    report.events_discovered += events.length;

    // Pre-load local finished matches for this league for mapping
    const { data: localMatches } = await supabase
      .from("matches")
      .select("id, match_date, home_team_id, away_team_id, home_cards, home_corners")
      .eq("league_id", l.id)
      .eq("status", "finished" as any);
    const { data: teams } = await supabase
      .from("teams")
      .select("id, name")
      .eq("league_id", l.id);
    const teamByNorm = new Map<string, string>();
    for (const t of teams ?? []) teamByNorm.set(normalize(t.name as string), t.id as string);

    let processed = 0;
    for (const e of events.slice(0, limit)) {
      const homeId = teamByNorm.get(normalize(e.homeTeam?.name ?? ""));
      const awayId = teamByNorm.get(normalize(e.awayTeam?.name ?? ""));
      if (!homeId || !awayId) { report.skipped_no_mapping++; continue; }
      const evDate = new Date(e.startTimestamp * 1000).toISOString().slice(0, 10);
      const match = (localMatches ?? []).find((m: any) =>
        m.home_team_id === homeId && m.away_team_id === awayId &&
        String(m.match_date).slice(0, 10) === evDate
      );
      if (!match) { report.skipped_no_mapping++; continue; }

      // Upsert provider id
      const { error: upErr } = await supabase.from("match_provider_ids").upsert({
        match_id: match.id, provider: PROVIDER, provider_match_id: String(e.id),
      } as any, { onConflict: "match_id,provider" });
      if (!upErr) report.mappings_created++;

      if (mode === "audit") {
        processed++;
        continue;
      }

      // Skip if already has data
      if (match.home_cards != null && match.home_corners != null) continue;

      const stats = await sofaFetch(`/event/${e.id}/statistics`);
      const ex = extractStats(stats.body);
      const patch: any = {};
      if (ex.home_cards != null) patch.home_cards = ex.home_cards;
      if (ex.away_cards != null) patch.away_cards = ex.away_cards;
      if (ex.home_corners != null) patch.home_corners = ex.home_corners;
      if (ex.away_corners != null) patch.away_corners = ex.away_corners;

      const cardsFound = ex.home_cards != null || ex.away_cards != null;
      const cornersFound = ex.home_corners != null || ex.away_corners != null;
      let cardsWritten = false, cornersWritten = false;
      if (Object.keys(patch).length > 0) {
        const { error: mErr } = await supabase.from("matches").update(patch).eq("id", match.id);
        if (!mErr) {
          report.matches_updated++;
          if (patch.home_cards != null) { report.cards_written++; cardsWritten = true; }
          if (patch.home_corners != null) { report.corners_written++; cornersWritten = true; }
        }
      }

      await supabase.from("pipeline_logs" as any).insert({
        provider: PROVIDER,
        league_id: l.id, match_id: match.id,
        provider_fixture_id: String(e.id),
        match_date: new Date(e.startTimestamp * 1000).toISOString(),
        cards_found: cardsFound, corners_found: cornersFound,
        cards_written: cardsWritten, corners_written: cornersWritten,
        cards_count: (ex.home_cards ?? 0) + (ex.away_cards ?? 0),
        corners_count: (ex.home_corners ?? 0) + (ex.away_corners ?? 0),
        provider_attempt_order: body.attempt_order ?? 3,
        provider_response_time_ms: stats.ms,
        provider_success: stats.ok && (cardsFound || cornersFound),
        status: stats.ok && (cardsFound || cornersFound) ? "success" : (stats.ok ? "skipped" : "failed"),
        error_message: stats.ok ? null : (stats.body?._raw ?? stats.body?.error ?? `HTTP ${stats.status}`),
      });
      processed++;
    }
    report.details.push({ league: l.name, season: l.season, events_seen: events.length, processed });
  }

  return new Response(JSON.stringify(report), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
