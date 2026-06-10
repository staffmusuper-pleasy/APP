// sync-orchestrator
// Reads public.league_sources and runs sync functions in priority order per
// league_key. Stops at the first successful primary fixture import; then runs
// any lower-priority enrichment sources (e.g. worldfootballR for cards/corners).
//
// Body:
//   { season?: string,           // for openfootball ("2025-26", "2025")
//     af_season?: number,        // for api-football (e.g. 2025)
//     league_keys?: string[],    // limit to specific league_keys
//     enrich_only?: boolean      // skip primary, only run enrichment sources
//   }

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function invoke(fn: string, body: unknown) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any; try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  return { ok: res.ok, status: res.status, body: parsed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { season?: string; af_season?: number; league_keys?: string[]; enrich_only?: boolean; max_seconds?: number } = {};
  try { body = await req.json(); } catch {}
  const ofSeason = body.season ?? "2025-26";
  const ofSeasonBrazil = String(body.af_season ?? new Date().getFullYear());
  const afSeason = body.af_season ?? new Date().getFullYear();
  const MAX_RUNTIME_MS = (body.max_seconds ?? 110) * 1000;
  const startedAt = Date.now();

  // Order: never-attempted rows first (so newly added league_sources are always
  // picked up on the next run), then oldest attempt first → fair rotation.
  let q = supabase.from("league_sources").select("*").eq("enabled", true)
    .order("last_attempt_at", { ascending: true, nullsFirst: true })
    .order("league_key").order("priority");
  if (body.league_keys?.length) q = q.in("league_key", body.league_keys);
  const { data: rows } = await q;
  if (!rows?.length) return json({ ok: true, ran: [] });

  // Global source priority (configurable in source_priorities table)
  const { data: spRows } = await supabase.from("source_priorities").select("source, priority, enabled");
  const globalPriority = new Map<string, { priority: number; enabled: boolean }>();
  for (const sp of spRows ?? []) globalPriority.set(sp.source, { priority: sp.priority, enabled: sp.enabled });

  // Group by league_key, sorted by global priority then per-league priority
  const byKey = new Map<string, any[]>();
  for (const r of rows) {
    const gp = globalPriority.get(r.source);
    if (gp && gp.enabled === false) continue;
    if (!byKey.has(r.league_key)) byKey.set(r.league_key, []);
    byKey.get(r.league_key)!.push(r);
  }
  for (const arr of byKey.values()) {
    arr.sort((a, b) => {
      const ap = globalPriority.get(a.source)?.priority ?? 999;
      const bp = globalPriority.get(b.source)?.priority ?? 999;
      if (ap !== bp) return ap - bp;
      return (a.priority ?? 999) - (b.priority ?? 999);
    });
  }

  const ran: any[] = [];
  const COOLDOWN_MS = 24 * 60 * 60 * 1000;
  const nowMs = Date.now();

  const markCooldown = async (id: string, status: string, message: string, failures: number) => {
    const next = new Date(nowMs + COOLDOWN_MS).toISOString();
    await supabase.from("league_sources").update({
      last_attempt_at: new Date(nowMs).toISOString(),
      last_status: status,
      last_result: (message || "").slice(0, 500),
      next_retry_at: next,
      consecutive_failures: (failures ?? 0) + 1,
    }).eq("id", id);
  };
  const markSuccess = async (id: string, message: string) => {
    await supabase.from("league_sources").update({
      last_attempt_at: new Date(nowMs).toISOString(),
      last_status: "success",
      last_result: (message || "").slice(0, 500),
      next_retry_at: null,
      consecutive_failures: 0,
    }).eq("id", id);
  };

  let stoppedEarly = false;
  outer: for (const [key, sources] of byKey) {
    let primaryOk = false;
    for (const s of sources) {
      // Soft time budget — bail cleanly so the next scheduled run picks up the rest.
      if (Date.now() - startedAt > MAX_RUNTIME_MS) { stoppedEarly = true; break outer; }
      // Skip primary if enrich_only
      if (body.enrich_only && s.source !== "worldfootballr") continue;

      // Skip lower-priority primaries if a higher one already worked.
      // Convention: openfootball + api-football are "primary" (fixtures);
      // worldfootballr is "enrich" (cards/corners only).
      if (s.source !== "worldfootballr" && primaryOk) continue;

      // Smart retry: skip sources currently in cooldown
      if (s.next_retry_at && new Date(s.next_retry_at).getTime() > nowMs) {
        ran.push({
          key, source: s.source, priority: s.priority, ok: false,
          skipped: "cooldown",
          next_retry_at: s.next_retry_at,
          last_status: s.last_status,
          last_result: s.last_result,
          consecutive_failures: s.consecutive_failures,
        });
        continue;
      }

      // Historical lock: skip seasons explicitly marked completed
      if (s.season_completed) {
        ran.push({
          key, source: s.source, priority: s.priority, ok: true,
          skipped: "season_completed",
          last_match_imported: s.last_match_imported,
          total_matches_stored: s.total_matches_stored,
        });
        // Count this as saved (would-have-been an API call)
        await supabase.from("league_sources")
          .update({ api_calls_saved: (s.api_calls_saved ?? 0) + 1 })
          .eq("id", s.id);
        continue;
      }

      // Incremental window: only ask api-football for fixtures newer than
      // the latest match we already have stored.
      let fromDate: string | undefined;
      if (s.source === "api-football" && s.last_match_imported) {
        const d = new Date(s.last_match_imported);
        d.setUTCDate(d.getUTCDate() - 1); // tiny overlap to catch reschedules
        fromDate = d.toISOString().slice(0, 10);
      }



      let result;
      if (s.source === "openfootball") {
        // Custom URL form (international cups, etc.)
        if (s.source_ref?.url) {
          const season = s.source_ref.season ?? ofSeason;
          result = await invoke("sync-openfootball", {
            season,
            leagues: [{
              key: s.source_ref.of_key ?? key,
              name: s.league_name,
              country: s.country,
              format: s.source_ref.format ?? "txt",
              url: s.source_ref.url,
            }],
          });
        } else {
          const isBrazil = s.country === "Brazil" || key.startsWith("br.");
          const region = isBrazil ? "brazil" : "europe";
          const season = isBrazil ? ofSeasonBrazil : ofSeason;
          const ofKey = s.source_ref?.of_key ?? key;
          const baseEuro = `https://raw.githubusercontent.com/openfootball/football.json/master/${season}`;
          const baseBr = `https://raw.githubusercontent.com/openfootball/south-america/master/brazil/${season}_br1.txt`;
          const url = isBrazil ? baseBr : `${baseEuro}/${ofKey}.json`;
          result = await invoke("sync-openfootball", {
            season,
            leagues: [{
              key: ofKey,
              name: s.league_name,
              country: s.country,
              format: isBrazil ? "txt" : "json",
              url,
            }],
          });
        }
        // Only mark primary as OK if openfootball actually produced UPCOMING
        // fixtures for this league. Historical-only data must not block the
        // api-football fallback that has current-season fixtures.
        if (result.ok && result.body?.processed > 0) {
          const { count: upcomingCount } = await supabase
            .from("matches")
            .select("id, leagues!inner(name,country)", { count: "exact", head: true })
            .eq("status", "scheduled")
            .gte("match_date", new Date().toISOString())
            .eq("leagues.name", s.league_name)
            .eq("leagues.country", s.country);
          if ((upcomingCount ?? 0) > 0) primaryOk = true;
        }

      } else if (s.source === "api-football") {
        // Find the league row to pass league_id
        const { data: league } = await supabase
          .from("leagues")
          .select("id")
          .eq("name", s.league_name)
          .eq("country", s.country)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        let leagueId = league?.id;
        const justCreated = !leagueId;
        if (!leagueId) {
          // Create the league row so api-football can target it
          const { data: created } = await supabase
            .from("leagues")
            .insert({ name: s.league_name, country: s.country, season: String(afSeason), active: true })
            .select().single();
          leagueId = created?.id;
        }
        if (!leagueId) { ran.push({ key, source: s.source, error: "league row missing" }); continue; }
        result = await invoke("sync-api-football", {
          league_id: leagueId,
          af_league_id: s.source_ref.af_league_id,
          af_season: afSeason,
          fixture_limit: 0,
          from_date: fromDate,
        });
        if (result.ok && (result.body?.fixtures > 0 || result.body?.future_scheduled > 0)) primaryOk = true;

        // Avoid leaving ghost league rows when the upstream returned nothing
        if (justCreated && (!result.ok || !result.body?.fixtures)) {
          const { count } = await supabase
            .from("matches").select("id", { count: "exact", head: true }).eq("league_id", leagueId);
          if ((count ?? 0) === 0) {
            await supabase.from("leagues").delete().eq("id", leagueId);
            (result.body ||= {}).note = "Source returned no future fixtures — league row removed (no ghost record)";
          }
        }
      } else if (s.source === "football-data") {
        result = await invoke("sync-football-data", {
          code: s.source_ref?.code,
          league_name: s.league_name,
          country: s.country,
          season: afSeason,
          from_date: fromDate,
        });
        if (result.ok && (result.body?.future_scheduled > 0 || result.body?.fixtures > 0)) primaryOk = true;
      } else if (s.source === "thesportsdb") {
        result = await invoke("sync-thesportsdb", {
          idLeague: s.source_ref?.idLeague,
          league_name: s.league_name,
          country: s.country,
          season: String(afSeason),
        });
        if (result.ok && (result.body?.future_scheduled > 0 || result.body?.fixtures > 0)) primaryOk = true;
      } else if (s.source === "worldfootballr") {
        result = await invoke("sync-worldfootballr", {
          season: ofSeason,
          limit: 20,
        });
      } else {
        result = { ok: false, status: 0, body: { error: "unknown source" } };
      }

      // Update cooldown tracking based on result
      try {
        const ok = result?.ok === true;
        const summary = result?.body ?? {};
        const fixtures = summary?.fixtures ?? summary?.processed ?? 0;
        const futureScheduled = summary?.future_scheduled;
        const httpStatus = result?.status ?? 0;
        let failureReason: string | null = null;
        if (!ok) {
          failureReason = httpStatus === 403
            ? "HTTP 403 (forbidden)"
            : (summary?.error ? String(summary.error) : `HTTP ${httpStatus} failure`);
        } else if (s.source !== "worldfootballr" && (futureScheduled === 0 || (fixtures === 0 && summary?.message))) {
          failureReason = summary?.message || "no future fixtures returned";
        }
        if (failureReason) {
          await markCooldown(s.id, httpStatus === 403 ? "http_403" : (ok ? "no_future_fixtures" : "error"),
            failureReason, s.consecutive_failures ?? 0);
        } else if (ok) {
          await markSuccess(s.id, `fixtures=${fixtures}`);

          // Refresh incremental-sync stats from current DB state
          const { data: leagueRow } = await supabase
            .from("leagues").select("id")
            .eq("name", s.league_name).eq("country", s.country)
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          if (leagueRow?.id) {
            const { data: latest } = await supabase
              .from("matches").select("match_date")
              .eq("league_id", leagueRow.id)
              .order("match_date", { ascending: false }).limit(1).maybeSingle();
            const { count: total } = await supabase
              .from("matches").select("id", { count: "exact", head: true })
              .eq("league_id", leagueRow.id);
            const update: Record<string, unknown> = {
              last_successful_sync: new Date(nowMs).toISOString(),
              last_match_imported: latest?.match_date ?? null,
              total_matches_stored: total ?? 0,
            };
            if (latest?.match_date && new Date(latest.match_date).getTime() < nowMs - 14 * 24 * 60 * 60 * 1000) {
              const { count: upcoming } = await supabase
                .from("matches").select("id", { count: "exact", head: true })
                .eq("league_id", leagueRow.id)
                .eq("status", "scheduled")
                .gte("match_date", new Date(nowMs).toISOString());
              if ((upcoming ?? 0) === 0) update.season_completed = true;
            }
            await supabase.from("league_sources").update(update).eq("id", s.id);
          }
        }
      } catch { /* tracking failure is non-fatal */ }

      // Audit trail
      try {
        const ok = result?.ok === true;
        const summary = result?.body ?? {};
        await supabase.from("import_logs").insert({
          source: s.source,
          competition: `${s.league_name} (${s.country})`,
          started_at: new Date(nowMs).toISOString(),
          completed_at: new Date().toISOString(),
          matches_imported: summary?.fixtures ?? summary?.processed ?? 0,
          matches_updated: summary?.updated ?? 0,
          errors_count: ok ? 0 : 1,
          status: ok ? "success" : "error",
          error_sample: ok ? null : String(summary?.error ?? `HTTP ${result?.status}`).slice(0, 500),
        });
      } catch { /* logging failure non-fatal */ }

      ran.push({ key, source: s.source, priority: s.priority, ok: result.ok, summary: result.body });
    }
  }


  return json({ ok: true, ran, stoppedEarly, processed: ran.length, elapsed_ms: Date.now() - startedAt });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
