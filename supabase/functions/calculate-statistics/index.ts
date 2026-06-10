// Calculates team statistics per venue (overall / home / away) from finished
// matches and stores percentages into statistics_cache.
//
// Body (all optional):
//   { team_id?: string, league_id?: string, sample_sizes?: number[],
//     categories?: ("goals"|"cards"|"corners"|"result"|"btts")[] }
//
// Defaults: all teams, all leagues, sizes [10,20], all categories.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Category = "goals" | "cards" | "corners" | "result" | "btts";
type Venue = "overall" | "home" | "away";

const LINES: Record<Exclude<Category, "result" | "btts">, number[]> = {
  goals: [0.5, 1.5, 2.5, 3.5, 4.5],
  cards: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5],
  corners: [5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5],
};

const keyFor = (line: number) => line.toString().replace(".", "_");
const pct = (n: number, total: number) =>
  !total ? 0 : Math.round((n / total) * 10000) / 100;

function totalFor(cat: Exclude<Category, "result" | "btts">, m: any): number | null {
  if (cat === "goals") {
    if (m.home_goals == null || m.away_goals == null) return null;
    return m.home_goals + m.away_goals;
  }
  if (cat === "cards") {
    const h = m.home_cards, a = m.away_cards;
    if (h == null && a == null) return null;
    return (h ?? 0) + (a ?? 0);
  }
  const h = m.home_corners, a = m.away_corners;
  if (h == null && a == null) return null;
  return (h ?? 0) + (a ?? 0);
}

function outcomeFor(m: any, teamId: string): "win" | "draw" | "loss" | null {
  if (m.home_goals == null || m.away_goals == null) return null;
  const isHome = m.home_team_id === teamId;
  const tg = isHome ? m.home_goals : m.away_goals;
  const og = isHome ? m.away_goals : m.home_goals;
  if (tg > og) return "win";
  if (tg < og) return "loss";
  return "draw";
}

function buildOverUnder(cat: Exclude<Category, "result" | "btts">, totals: number[]) {
  const out: Record<string, number> = { matches_used: totals.length };
  for (const line of LINES[cat]) {
    const over = totals.filter((t) => t > line).length;
    out[`over_${keyFor(line)}`] = pct(over, totals.length);
    out[`under_${keyFor(line)}`] = pct(totals.length - over, totals.length);
  }
  return out;
}

function buildResult(outcomes: ("win" | "draw" | "loss")[]) {
  const n = outcomes.length;
  return {
    matches_used: n,
    win: pct(outcomes.filter((o) => o === "win").length, n),
    draw: pct(outcomes.filter((o) => o === "draw").length, n),
    loss: pct(outcomes.filter((o) => o === "loss").length, n),
  };
}

function buildBtts(matches: any[]) {
  const valid = matches.filter((m) => m.home_goals != null && m.away_goals != null);
  const n = valid.length;
  const yes = valid.filter((m) => m.home_goals > 0 && m.away_goals > 0).length;
  return { matches_used: n, yes: pct(yes, n), no: pct(n - yes, n) };
}

function statsForSlice(cat: Category, slice: any[], teamId: string) {
  if (cat === "result") {
    const outs = slice
      .map((m) => outcomeFor(m, teamId))
      .filter((v): v is "win" | "draw" | "loss" => v !== null);
    return outs.length ? buildResult(outs) : null;
  }
  if (cat === "btts") {
    const s = buildBtts(slice);
    return s.matches_used ? s : null;
  }
  const totals = slice
    .map((m) => totalFor(cat, m))
    .filter((v): v is number => v !== null);
  return totals.length ? buildOverUnder(cat, totals) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: {
    team_id?: string;
    league_id?: string;
    sample_sizes?: number[];
    categories?: Category[];
  } = {};
  try { body = await req.json(); } catch { /* ok */ }

  const sizes = (body.sample_sizes ?? [10, 20]).filter((n) => n === 10 || n === 20);
  const categories: Category[] = body.categories ?? ["goals", "cards", "corners", "result", "btts"];
  const retentionCutoff = new Date(Date.UTC(new Date().getUTCFullYear() - 2, 0, 1)).toISOString();

  let teamsQ = supabase.from("teams").select("id, league_id");
  if (body.team_id) teamsQ = teamsQ.eq("id", body.team_id);
  if (body.league_id) teamsQ = teamsQ.eq("league_id", body.league_id);
  const { data: teams, error: teamsErr } = await teamsQ;
  if (teamsErr) return json({ error: teamsErr.message }, 500);

  const upserts: any[] = [];
  let teamsProcessed = 0;
  const maxSize = Math.max(...sizes);

  for (const team of teams ?? []) {
    const { data: matches, error: mErr } = await supabase
      .from("matches")
      .select("home_team_id, away_team_id, league_id, home_goals, away_goals, home_cards, away_cards, home_corners, away_corners, match_date, status")
      .eq("status", "finished")
      .gte("match_date", retentionCutoff)
      .or(`home_team_id.eq.${team.id},away_team_id.eq.${team.id}`)
      .order("match_date", { ascending: false })
      .limit(maxSize * 2); // pull extra so home/away slices each reach `size`

    if (mErr || !matches || matches.length === 0) continue;

    const homeMatches = matches.filter((m: any) => m.home_team_id === team.id);
    const awayMatches = matches.filter((m: any) => m.away_team_id === team.id);

    for (const size of sizes) {
      const slices: Record<Venue, any[]> = {
        overall: matches.slice(0, size),
        home: homeMatches.slice(0, size),
        away: awayMatches.slice(0, size),
      };

      for (const venue of ["overall", "home", "away"] as const) {
        const slice = slices[venue];
        if (slice.length === 0) continue;

        // Resolve league for cache row
        let leagueId = team.league_id as string | null;
        if (!leagueId) {
          const counts = new Map<string, number>();
          slice.forEach((m: any) => counts.set(m.league_id, (counts.get(m.league_id) ?? 0) + 1));
          leagueId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
        }
        if (!leagueId) continue;

        for (const cat of categories) {
          const stats = statsForSlice(cat, slice, team.id);
          if (!stats) continue;
          upserts.push({
            team_id: team.id,
            league_id: leagueId,
            category: cat,
            sample_size: size,
            venue,
            statistics: stats,
            updated_at: new Date().toISOString(),
          });
        }
      }
    }
    teamsProcessed++;
  }

  if (upserts.length) {
    const chunkSize = 500;
    for (let i = 0; i < upserts.length; i += chunkSize) {
      const chunk = upserts.slice(i, i + chunkSize);
      const { error } = await supabase
        .from("statistics_cache")
        .upsert(chunk, { onConflict: "team_id,league_id,category,sample_size,venue" });
      if (error) return json({ error: error.message, teamsProcessed, written: i }, 500);
    }
  }

  return json({ ok: true, teams_processed: teamsProcessed, rows_written: upserts.length });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
