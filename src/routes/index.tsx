import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Trophy, CalendarClock, TrendingUp, Activity, Flame, Star, StarOff, Skull, Database, AlertTriangle, RefreshCw, Lock, ShieldCheck, Compass,
} from "lucide-react";
import { DataAudit } from "./data-audit";

export const Route = createFileRoute("/")({
  component: Index,
  ssr: false,
});

const FAV_KEY = "fav_leagues_v1";

function useFavorites() {
  const [favs, setFavs] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      if (raw) setFavs(JSON.parse(raw));
    } catch { /* noop */ }
  }, []);
  const save = (next: string[]) => {
    setFavs(next);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch { /* noop */ }
  };
  return {
    favs,
    toggle: (id: string) =>
      save(favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id]),
    isFav: (id: string) => favs.includes(id),
    clear: () => save([]),
  };
}

function fmtDate(d: string) {
  return new Date(d).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function pctColor(p: number | null | undefined) {
  if (p == null || p < 0) return "text-zinc-500";
  if (p >= 70) return "text-emerald-400";
  if (p >= 55) return "text-lime-400";
  if (p >= 40) return "text-amber-400";
  return "text-rose-400";
}

function pctLabel(value: number | null | undefined, fallback = "no stats yet") {
  return value == null || value < 0 || Number.isNaN(Number(value)) ? fallback : `${value}%`;
}

function formatMarketLabel(category: string, market: string) {
  if (!category || !market) return "Statistics pending";
  if (category === "result") {
    const map: Record<string, string> = { win: "Win", draw: "Draw", loss: "Loss" };
    return map[market] ?? market;
  }
  if (category === "btts") {
    return `BTTS ${market === "yes" ? "Yes" : "No"}`;
  }
  const [side, ...rest] = market.split("_");
  const line = rest.join(".");
  const cat = category[0].toUpperCase() + category.slice(1);
  const sideLabel = side[0].toUpperCase() + side.slice(1);
  return `${sideLabel} ${line} ${cat}`;
}

function Index() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-black text-zinc-100">
      <header className="border-b border-white/5 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-6 py-5 flex items-center gap-3">
          <div className="size-9 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 grid place-items-center shadow-lg shadow-emerald-900/30">
            <Trophy className="size-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Football Statistics</h1>
            <p className="text-xs text-zinc-500">Upcoming matches across every competition for your favorite leagues</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <Tabs defaultValue="top" className="space-y-6">
          <TabsList className="bg-zinc-900/60 border border-white/5 flex-wrap h-auto">
            <TabsTrigger value="top"><Flame className="size-3.5 mr-1.5" /> Top %</TabsTrigger>
            <TabsTrigger value="defeats"><Skull className="size-3.5 mr-1.5" /> Top Defeat %</TabsTrigger>
            <TabsTrigger value="browse"><Compass className="size-3.5 mr-1.5" /> Browser</TabsTrigger>
            <TabsTrigger value="admin" className="ml-auto"><Lock className="size-3.5 mr-1.5" /> Admin</TabsTrigger>
          </TabsList>

          <TabsContent value="top" className="space-y-6"><TopPicksTab /></TabsContent>
          <TabsContent value="defeats" className="space-y-6"><TopDefeatsTab /></TabsContent>
          <TabsContent value="browse" className="space-y-6"><BrowseTab /></TabsContent>
          <TabsContent value="admin" className="space-y-6"><AdminTab /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

/* ---------------- Leagues + favorites shared state ---------------- */

function useLeagues() {
  return useQuery({
    queryKey: ["leagues"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leagues")
        .select("id, name, country, season")
        .eq("active", true)
        .order("country", { ascending: true })
        .order("name", { ascending: true })
        .order("season", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function LeagueScopeBar({
  scope, setScope, favs, hasFavs,
}: {
  scope: "favs" | "all"; setScope: (s: "favs" | "all") => void;
  favs: string[]; hasFavs: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-zinc-500">Scope:</span>
      <Button
        size="sm"
        variant={scope === "favs" ? "default" : "secondary"}
        onClick={() => setScope("favs")}
        disabled={!hasFavs}
        className="h-8"
      >
        <Star className="size-3.5 mr-1.5" /> Favorites ({favs.length})
      </Button>
      <Button
        size="sm"
        variant={scope === "all" ? "default" : "secondary"}
        onClick={() => setScope("all")}
        className="h-8"
      >
        All leagues
      </Button>
    </div>
  );
}

/* ---------------- Top picks ---------------- */

type Threshold = "100" | "95" | "90" | "85" | "all";
const THRESHOLDS: { value: Threshold; label: string; min: number }[] = [
  { value: "100", label: "100%", min: 100 },
  { value: "95",  label: "95%+", min: 95 },
  { value: "90",  label: "90%+", min: 90 },
  { value: "85",  label: "85%+", min: 85 },
  { value: "all", label: "All",  min: 0 },
];

function startOfLocalDay(offsetDays = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

function TopPicksTab() {
  const { favs } = useFavorites();
  const [scope, setScope] = useState<"favs" | "all">(favs.length ? "favs" : "all");
  useEffect(() => { if (!favs.length && scope === "favs") setScope("all"); }, [favs.length, scope]);
  const [sampleSize, setSampleSize] = useState<10 | 20>(10);
  const [threshold, setThreshold] = useState<Threshold>("95");
  const [dayMode, setDayMode] = useState<"0" | "1" | "2" | "next">("0");

  const leagueIds = scope === "favs" ? favs : null;

  const picksQ = useQuery({
    queryKey: ["top-picks", sampleSize, leagueIds?.join(",") ?? "all"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_top_picks_for_leagues", {
        _sample_size: sampleSize,
        _hours: null,
        _limit: null,
        _min_matches_used: 8,
        ...(leagueIds ? { _league_ids: leagueIds } : {}),
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Count of fixtures hidden by the sample gate (for the visible reason banner).
  const ungatedQ = useQuery({
    queryKey: ["top-picks-ungated", sampleSize, leagueIds?.join(",") ?? "all"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_top_picks_for_leagues", {
        _sample_size: sampleSize,
        _hours: null,
        _limit: null,
        _min_matches_used: 0,
        ...(leagueIds ? { _league_ids: leagueIds } : {}),
      });
      if (error) throw error;
      return (data ?? []).length as number;
    },
  });
  const hiddenBySample = Math.max(0, (ungatedQ.data ?? 0) - (picksQ.data?.length ?? 0));

  const allPicks = (picksQ.data ?? []) as any[];
  const tCfg = THRESHOLDS.find((t) => t.value === threshold)!;
  const isNext = dayMode === "next";
  const dayOffset = isNext ? 0 : (Number(dayMode) as 0 | 1 | 2);

  const dayStart = startOfLocalDay(dayOffset);
  const dayEnd = startOfLocalDay(dayOffset + 1);
  const modeLabel = isNext
    ? "Next available"
    : dayOffset === 0
      ? "Today"
      : dayOffset === 1
        ? "Tomorrow"
        : dayStart.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  const scoped = useMemo(() => {
    if (isNext) {
      const now = Date.now();
      return allPicks.filter((p) => new Date(p.match_date).getTime() >= now);
    }
    return allPicks.filter((p) => {
      const d = new Date(p.match_date);
      return d >= dayStart && d < dayEnd;
    });
  }, [allPicks, isNext, dayStart.getTime(), dayEnd.getTime()]);

  const filtered = useMemo(() => {
    // Include matches even when statistics are missing. Fixture visibility must
    // not depend on statistics_cache; pending matches are sorted last.
    const f = scoped.filter((p: any) =>
      p.combined_avg == null || tCfg.min <= 0 ? true : p.combined_avg >= tCfg.min,
    );
    return f.sort((a: any, b: any) => {
      const av = a.combined_avg ?? -1;
      const bv = b.combined_avg ?? -1;
      const at = new Date(a.match_date).getTime();
      const bt = new Date(b.match_date).getTime();
      if (isNext) {
        if (at !== bt) return at - bt;
        return bv - av;
      }
      if (bv !== av) return bv - av;
      return at - bt;
    });
  }, [scoped, tCfg.min, isNext]);

  const dayModes: { value: "0" | "1" | "2" | "next"; label: string }[] = [
    { value: "0", label: "Today" },
    { value: "1", label: "+1" },
    { value: "2", label: "+2" },
    { value: "next", label: "Next" },
  ];

  return (
    <>
      <section className="flex flex-wrap items-end gap-3">
        <LeagueScopeBar scope={scope} setScope={setScope} favs={favs} hasFavs={!!favs.length} />
        <FilterBlock label="Day">
          <div className="flex gap-1 flex-wrap">
            {dayModes.map((m) => (
              <Button
                key={m.value}
                size="sm"
                variant={dayMode === m.value ? "default" : "secondary"}
                onClick={() => setDayMode(m.value)}
                className="h-9"
              >
                {m.label}
              </Button>
            ))}
          </div>
        </FilterBlock>
        <FilterBlock label="Min probability">
          <Select value={threshold} onValueChange={(v) => setThreshold(v as Threshold)}>
            <SelectTrigger className="bg-zinc-900/60 border-white/10 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {THRESHOLDS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </FilterBlock>
        <FilterBlock label="Sample">
          <Select value={String(sampleSize)} onValueChange={(v) => setSampleSize(Number(v) as 10 | 20)}>
            <SelectTrigger className="bg-zinc-900/60 border-white/10 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="10">Last 10</SelectItem>
              <SelectItem value="20">Last 20</SelectItem>
            </SelectContent>
          </Select>
        </FilterBlock>
      </section>

      <div className="flex items-center gap-2 text-sm text-zinc-400 flex-wrap">
        <Flame className="size-4 text-orange-400" />
        <span className="text-zinc-100 font-medium">{modeLabel}</span>
        • <span className="text-zinc-100 font-medium">{filtered.length}</span> match{filtered.length === 1 ? "" : "es"} at{" "}
        <span className="text-orange-300 font-medium">{tCfg.label}</span>
        <span className="text-zinc-600">• {scoped.length} total {isNext ? "upcoming" : "on this day"}</span>
        {hiddenBySample > 0 && (
          <span className="text-amber-400/80 ml-1">
            • {hiddenBySample} hidden (insufficient sample &lt; 8 matches)
          </span>
        )}
      </div>

      {picksQ.isLoading ? <SkeletonGrid /> : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-zinc-900/30 p-12 text-center">
          <Flame className="size-8 mx-auto text-zinc-600 mb-3" />
          <p className="text-zinc-300 font-medium">No opportunities found for this probability range.</p>
          <p className="text-zinc-500 text-sm mt-1">
            {scoped.length} match{scoped.length === 1 ? "" : "es"} {isNext ? "upcoming" : `on ${modeLabel}`}, none meeting {tCfg.label}.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p: any) => <TopPickCard key={p.match_id} pick={p} />)}
        </div>
      )}
    </>
  );
}

function TopPickCard({ pick }: { pick: any }) {
  const label = formatMarketLabel(pick.category, pick.market);
  const pending = pick.combined_avg == null;
  return (
    <Card className="bg-zinc-900/50 border-white/5 hover:border-orange-500/30 transition-colors overflow-hidden">
      <CardHeader className="pb-3 space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
          <Badge variant="secondary" className="bg-orange-500/10 text-orange-200 border border-orange-500/20 font-normal">
            {pick.competition_name}
          </Badge>
          <span className="flex items-center gap-1 shrink-0">
            <CalendarClock className="size-3" />{fmtDate(pick.match_date)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-semibold text-zinc-100 truncate">{pick.home_team_name}</span>
          <span className="text-xs text-zinc-600 px-2">vs</span>
          <span className="font-semibold text-zinc-100 truncate text-right">{pick.away_team_name}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border border-orange-500/30 bg-gradient-to-br from-orange-500/10 to-amber-500/5 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] uppercase tracking-wider text-orange-300/80">Best market</span>
            <TrendingUp className="size-3.5 text-orange-300" />
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <div className={`text-3xl font-bold tabular-nums ${pctColor(pick.combined_avg)}`}>
              {pending ? "Pending" : pctLabel(pick.combined_avg)}
            </div>
            <div className="text-sm font-medium text-zinc-200 text-right">{pending ? "Statistics pending" : label}</div>
          </div>
        </div>
        <ThreeTiles home={pick.home_pct} avg={pick.combined_avg} away={pick.away_pct} />
      </CardContent>
    </Card>
  );
}

/* ---------------- Top defeats ---------------- */

function TopDefeatsTab() {
  const { favs } = useFavorites();
  const [scope, setScope] = useState<"favs" | "all">(favs.length ? "favs" : "all");
  useEffect(() => { if (!favs.length && scope === "favs") setScope("all"); }, [favs.length, scope]);
  const [sampleSize, setSampleSize] = useState<10 | 20>(10);

  const leagueIds = scope === "favs" ? favs : null;
  const q = useQuery({
    queryKey: ["top-defeats", sampleSize, leagueIds?.join(",") ?? "all"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_top_defeats", {
        _sample_size: sampleSize,
        _hours: null,
        _limit: null,
        ...(leagueIds ? { _league_ids: leagueIds } : {}),
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const raw = (q.data ?? []) as any[];

  // Flatten to one entry per predicted-loser team, dedupe by team id keeping the highest loss%.
  const teamRows = useMemo(() => {
    const map = new Map<string, { team_id: string; team_name: string; loss_pct: number }>();
    for (const r of raw) {
      const loserHome = r.predicted_loser === "home";
      const team_id = loserHome ? r.home_team_id : r.away_team_id;
      const team_name = r.predicted_loser_team_name ?? (loserHome ? r.home_team_name : r.away_team_name);
      const loss_pct = Number(r.loss_pct ?? 0);
      if (!team_id || Number.isNaN(loss_pct)) continue;
      const cur = map.get(team_id);
      if (!cur || loss_pct > cur.loss_pct) map.set(team_id, { team_id, team_name, loss_pct });
    }
    return [...map.values()].sort((a, b) => b.loss_pct - a.loss_pct);
  }, [raw]);

  const teamIds = teamRows.map((t) => t.team_id);

  // Pull matches_used from statistics_cache (result category, overall venue) for the displayed teams.
  const samplesQ = useQuery({
    queryKey: ["defeat-samples", sampleSize, teamIds.join(",")],
    enabled: teamIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("statistics_cache")
        .select("team_id, statistics, venue")
        .eq("category", "result")
        .eq("sample_size", sampleSize)
        .in("team_id", teamIds);
      if (error) throw error;
      const used = new Map<string, number>();
      for (const row of (data ?? []) as any[]) {
        const n = Number(row?.statistics?.matches_used ?? 0);
        // Prefer overall, fall back to any venue value.
        const cur = used.get(row.team_id);
        if (row.venue === "overall" || cur == null) used.set(row.team_id, n);
      }
      return used;
    },
  });
  const usedMap = samplesQ.data ?? new Map<string, number>();

  return (
    <>
      <section className="flex flex-wrap items-end gap-3">
        <LeagueScopeBar scope={scope} setScope={setScope} favs={favs} hasFavs={!!favs.length} />
        <div className="flex gap-2">
          <FilterBlock label="Sample">
            <Select value={String(sampleSize)} onValueChange={(v) => setSampleSize(Number(v) as 10 | 20)}>
              <SelectTrigger className="bg-zinc-900/60 border-white/10 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="10">Last 10</SelectItem>
                <SelectItem value="20">Last 20</SelectItem>
              </SelectContent>
            </Select>
          </FilterBlock>
        </div>
      </section>

      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <Skull className="size-4 text-rose-400" />
        Teams ranked by historical loss rate over the last {sampleSize} matches • {teamRows.length} team{teamRows.length === 1 ? "" : "s"}
      </div>

      {q.isLoading ? <SkeletonGrid /> : teamRows.length === 0 ? <EmptyState /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teamRows.map((t) => (
            <TopDefeatCard
              key={t.team_id}
              teamName={t.team_name}
              lossPct={t.loss_pct}
              matchesUsed={usedMap.get(t.team_id) ?? null}
            />
          ))}
        </div>
      )}
    </>
  );
}

function TopDefeatCard({ teamName, lossPct, matchesUsed }: { teamName: string; lossPct: number; matchesUsed: number | null }) {
  return (
    <Card className="bg-zinc-900/50 border-white/5 hover:border-rose-500/30 transition-colors overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-zinc-100 text-lg truncate">{teamName}</span>
          <Skull className="size-4 text-rose-300 shrink-0" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border border-rose-500/30 bg-gradient-to-br from-rose-500/10 to-pink-500/5 px-4 py-3">
          <div className="text-[11px] uppercase tracking-wider text-rose-300/80 mb-1">Defeat rate</div>
          <div className={`text-4xl font-bold tabular-nums ${pctColor(lossPct)}`}>{pctLabel(lossPct)}</div>
        </div>
        <div className="text-xs text-zinc-500">
          Matches used: <span className="text-zinc-300 tabular-nums">{matchesUsed ?? "—"}</span>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Admin (password-gated) ---------------- */

const ADMIN_PASSWORD = "pleasy";
const ADMIN_KEY = "admin_unlocked";

function AdminTab() {
  const [unlocked, setUnlocked] = useState<boolean>(false);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    try { if (sessionStorage.getItem(ADMIN_KEY) === "1") setUnlocked(true); } catch { /* noop */ }
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw === ADMIN_PASSWORD) {
      try { sessionStorage.setItem(ADMIN_KEY, "1"); } catch { /* noop */ }
      setUnlocked(true);
      setErr(null);
      setPw("");
    } else {
      setErr("Incorrect password");
    }
  }

  function lock() {
    try { sessionStorage.removeItem(ADMIN_KEY); } catch { /* noop */ }
    setUnlocked(false);
  }

  if (!unlocked) {
    return (
      <div className="grid place-items-center py-16">
        <Card className="w-full max-w-sm bg-zinc-900/60 border-white/5">
          <CardHeader>
            <div className="flex items-center gap-2 text-zinc-100">
              <Lock className="size-4" /> <span className="font-semibold">Admin access</span>
            </div>
            <p className="text-xs text-zinc-500 mt-1">Enter the admin password to continue.</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-3">
              <Input
                type="password"
                autoFocus
                value={pw}
                onChange={(e) => { setPw(e.target.value); setErr(null); }}
                placeholder="Password"
                className="bg-zinc-950/60 border-white/10"
              />
              {err && <p className="text-xs text-rose-400">{err}</p>}
              <Button type="submit" className="w-full">Unlock</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-emerald-300">
          <ShieldCheck className="size-4" /> Admin unlocked for this session
        </div>
        <Button variant="outline" size="sm" onClick={lock}>
          <Lock className="size-3.5 mr-1.5" /> Lock
        </Button>
      </div>
      <Tabs defaultValue="debug" className="space-y-4">
        <TabsList className="bg-zinc-900/60 border border-white/5">
          <TabsTrigger value="debug"><Activity className="size-3.5 mr-1.5" /> Debug</TabsTrigger>
          <TabsTrigger value="pipeline"><Database className="size-3.5 mr-1.5" /> Pipeline</TabsTrigger>
          <TabsTrigger value="cards"><Activity className="size-3.5 mr-1.5" /> Cards/Corners</TabsTrigger>
          <TabsTrigger value="audit"><AlertTriangle className="size-3.5 mr-1.5" /> Data Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="debug" className="space-y-6"><DebugTab /></TabsContent>
        <TabsContent value="pipeline" className="space-y-6"><PipelineTab /></TabsContent>
        <TabsContent value="cards" className="space-y-6"><CardsCornersTab /></TabsContent>
        <TabsContent value="audit" className="space-y-6"><DataAudit /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- Cards & Corners pipeline ---------------- */

function CardsCornersTab() {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [mode, setMode] = useState<"current" | "historical_2022_2024" | "local_db">("local_db");

  const coverageQ = useQuery({
    queryKey: ["cards-corners-coverage"],
    queryFn: async () => {
      const [m1, m2, m3, m4] = await Promise.all([
        supabase.from("matches").select("id", { count: "exact", head: true }).eq("status", "finished" as any),
        supabase.from("matches").select("id", { count: "exact", head: true }).eq("status", "finished" as any).not("home_cards", "is", null),
        supabase.from("matches").select("id", { count: "exact", head: true }).eq("status", "finished" as any).not("home_corners", "is", null),
        supabase.from("statistics_cache").select("id", { count: "exact", head: true }).in("category", ["cards", "corners"] as any),
      ]);
      return {
        finished: m1.count ?? 0,
        with_cards: m2.count ?? 0,
        with_corners: m3.count ?? 0,
        cache_rows: m4.count ?? 0,
      };
    },
    refetchInterval: 5000,
  });

  const logsQ = useQuery({
    queryKey: ["pipeline-logs-recent"],
    queryFn: async () => {
      const { data } = await supabase
        .from("pipeline_logs" as any)
        .select("created_at, provider, status, cards_found, corners_found, cards_written, corners_written, error_message")
        .order("created_at", { ascending: false })
        .limit(15);
      return (data ?? []) as any[];
    },
    refetchInterval: 5000,
  });

  async function runBackfill(provider: "api-football" | "worldfootballr" | "sofascore") {
    setBusy(`backfill:${provider}`);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("backfill-cards-corners", {
        body: { mode, provider, per_league_limit: 50, trigger_stats: true, sofascore_mode: provider === "sofascore" ? "audit" : undefined },
      });
      setResult(error ? { error: error.message } : data);
    } catch (e: any) {
      setResult({ error: e?.message ?? String(e) });
    } finally {
      setBusy(null);
    }
  }

  // Provider coverage dashboard — aggregates pipeline_logs by provider.
  const providerCoverageQ = useQuery({
    queryKey: ["provider-coverage"],
    queryFn: async () => {
      const providers = ["api-football", "worldfootballr", "sofascore"];
      const rows = await Promise.all(providers.map(async (p) => {
        const { data } = await supabase
          .from("pipeline_logs" as any)
          .select("status, cards_written, corners_written, provider_success")
          .eq("provider", p)
          .limit(5000);
        const attempts = data?.length ?? 0;
        const success = data?.filter((r: any) => r.status === "success").length ?? 0;
        const failed = data?.filter((r: any) => r.status === "failed").length ?? 0;
        const cards = data?.filter((r: any) => r.cards_written).length ?? 0;
        const corners = data?.filter((r: any) => r.corners_written).length ?? 0;
        const { count: candidates } = await supabase
          .from("match_provider_ids" as any)
          .select("id", { count: "exact", head: true })
          .eq("provider", p);
        return { provider: p, candidates: candidates ?? 0, attempts, success, failed, cards_written: cards, corners_written: corners };
      }));
      return rows;
    },
    refetchInterval: 10000,
  });

  async function rebuildCache() {
    setBusy("rebuild");
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("calculate-statistics", {
        body: { sample_sizes: [10, 20], categories: ["cards", "corners"] },
      });
      setResult(error ? { error: error.message } : data);
    } catch (e: any) {
      setResult({ error: e?.message ?? String(e) });
    } finally {
      setBusy(null);
    }
  }

  const c = coverageQ.data as any;
  const modeOptions: { value: typeof mode; label: string; hint: string }[] = [
    { value: "local_db", label: "Local DB missing stats", hint: "Pick finished matches in DB missing cards/corners and enrich them." },
    { value: "historical_2022_2024", label: "Historical 2022–2024", hint: "Works on api-football free plan." },
    { value: "current", label: "Current season only", hint: "Prefer FBref provider; api-football free plan blocks current season." },
  ];

  return (
    <div className="space-y-4">
      <Card className="bg-zinc-900/60 border-white/5">
        <CardHeader>
          <div className="flex items-center gap-2 text-zinc-100">
            <Activity className="size-4" /> <span className="font-semibold">Cards & Corners pipeline</span>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Backfills missing cards/corners. Choose a mode below — local DB mode does not depend on api-football /fixtures returning rows.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <CountTile label="Finished matches" value={c?.finished ?? 0} />
            <CountTile label="With cards data" value={c?.with_cards ?? 0} />
            <CountTile label="With corners data" value={c?.with_corners ?? 0} />
            <CountTile label="Cache rows (cards+corners)" value={c?.cache_rows ?? 0} />
          </div>

          <div className="space-y-1.5">
            <div className="text-xs text-zinc-400 font-medium">Backfill mode</div>
            <div className="flex flex-wrap gap-2">
              {modeOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMode(opt.value)}
                  className={`text-xs rounded px-2.5 py-1.5 border ${
                    mode === opt.value
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                      : "bg-zinc-900/60 border-white/10 text-zinc-300 hover:border-white/20"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-zinc-500">
              {modeOptions.find((o) => o.value === mode)?.hint}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => runBackfill("api-football")} disabled={!!busy}>
              <RefreshCw className={`size-3.5 mr-1.5 ${busy === "backfill:api-football" ? "animate-spin" : ""}`} />
              Backfill via api-football
            </Button>
            <Button onClick={() => runBackfill("worldfootballr")} variant="outline" disabled={!!busy}>
              <RefreshCw className={`size-3.5 mr-1.5 ${busy === "backfill:worldfootballr" ? "animate-spin" : ""}`} />
              Backfill via FBref
            </Button>
            <Button onClick={() => runBackfill("sofascore")} variant="outline" disabled={!!busy}>
              <RefreshCw className={`size-3.5 mr-1.5 ${busy === "backfill:sofascore" ? "animate-spin" : ""}`} />
              SofaScore (audit)
            </Button>
            <Button onClick={rebuildCache} variant="secondary" disabled={!!busy}>
              <RefreshCw className={`size-3.5 mr-1.5 ${busy === "rebuild" ? "animate-spin" : ""}`} />
              Rebuild cards/corners cache
            </Button>
          </div>
          {result && (
            <pre className="text-xs bg-zinc-950/60 border border-white/5 rounded p-3 overflow-auto max-h-80 text-zinc-300">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card className="bg-zinc-900/60 border-white/5">
        <CardHeader>
          <div className="flex items-center gap-2 text-zinc-100">
            <Activity className="size-4" /> <span className="font-semibold">Provider coverage</span>
          </div>
          <p className="text-xs text-zinc-500 mt-1">Per-provider attempts, success rate, and writes (from pipeline_logs + match_provider_ids).</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-zinc-400">
                <tr className="text-left border-b border-white/5">
                  <th className="py-1.5 pr-3">Provider</th>
                  <th className="py-1.5 pr-3 text-right">Candidates</th>
                  <th className="py-1.5 pr-3 text-right">Attempts</th>
                  <th className="py-1.5 pr-3 text-right">Success</th>
                  <th className="py-1.5 pr-3 text-right">Failed</th>
                  <th className="py-1.5 pr-3 text-right">Cards written</th>
                  <th className="py-1.5 pr-3 text-right">Corners written</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {(providerCoverageQ.data ?? []).map((r) => (
                  <tr key={r.provider} className="border-b border-white/5">
                    <td className="py-1.5 pr-3"><Badge variant="outline" className="text-[10px]">{r.provider}</Badge></td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{r.candidates}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{r.attempts}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-emerald-300">{r.success}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-rose-300">{r.failed}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{r.cards_written}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{r.corners_written}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>


      <Card className="bg-zinc-900/60 border-white/5">
        <CardHeader>
          <div className="flex items-center gap-2 text-zinc-100">
            <Database className="size-4" /> <span className="font-semibold">Recent pipeline events</span>
          </div>
        </CardHeader>
        <CardContent>
          {logsQ.data && logsQ.data.length > 0 ? (
            <div className="space-y-1.5 text-xs">
              {logsQ.data.map((l, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 border-b border-white/5 pb-1.5">
                  <span className="text-zinc-500 tabular-nums">{new Date(l.created_at).toLocaleTimeString()}</span>
                  <Badge variant="outline" className="text-[10px]">{l.provider}</Badge>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      l.status === "success" ? "border-emerald-500/40 text-emerald-300" :
                      l.status === "partial" ? "border-amber-500/40 text-amber-300" :
                      l.status === "failed"  ? "border-rose-500/40 text-rose-300" :
                                                "border-zinc-500/40 text-zinc-400"
                    }`}
                  >
                    {l.status}
                  </Badge>
                  <span className="text-zinc-400">
                    cards: {l.cards_found ? (l.cards_written ? "✓" : "found") : "—"} ·
                    corners: {l.corners_found ? (l.corners_written ? "✓" : "found") : "—"}
                  </span>
                  {l.error_message && <span className="text-rose-400 truncate">{l.error_message}</span>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">No pipeline events yet. Run a backfill above to populate.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------- Browse ---------------- */

type Category = "goals" | "cards" | "corners";
type Market = "over" | "under";
const LINES: Record<Category, number[]> = {
  goals: [0.5, 1.5, 2.5, 3.5, 4.5],
  cards: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5],
  corners: [5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5],
};
const marketKey = (m: Market, line: number) => `${m}_${line.toString().replace(".", "_")}`;

function BrowseTab() {
  const fav = useFavorites();
  const leaguesQ = useLeagues();
  const [scope, setScope] = useState<"favs" | "all">("favs");
  useEffect(() => { if (!fav.favs.length && scope === "favs") setScope("all"); }, [fav.favs.length, scope]);

  const [sampleSize, setSampleSize] = useState<10 | 20>(10);
  const [category, setCategory] = useState<Category>("goals");
  const [market, setMarket] = useState<Market>("over");
  const [line, setLine] = useState<number>(2.5);

  useEffect(() => {
    if (!LINES[category].includes(line)) {
      setLine(LINES[category][Math.floor(LINES[category].length / 2)]);
    }
  }, [category, line]);

  const leagueIds = scope === "favs" ? fav.favs : null;

  const matchesQ = useQuery({
    queryKey: ["upcoming-team-scope", leagueIds?.join(",") ?? "all"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_upcoming_for_leagues", {
        _limit: null,
        ...(leagueIds ? { _league_ids: leagueIds } : {}),
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const matches = (matchesQ.data ?? []) as any[];
  const marketName = marketKey(market, line);

  const matchupQueries = useQueries({
    queries: matches.map((m: any) => ({
      queryKey: ["matchup", m.id, category, marketName, sampleSize],
      enabled: !!m.home_team_id && !!m.away_team_id,
      queryFn: async () => {
        // use competition_id as the league context for the matchup lookup
        const { data, error } = await supabase.rpc("get_matchup_stats", {
          _league_id: m.competition_id,
          _home_team_id: m.home_team_id,
          _away_team_id: m.away_team_id,
          _category: category,
          _market: marketName,
          _sample_size: sampleSize,
        });
        if (error) throw error;
        return data?.[0] ?? null;
      },
    })),
  });

  // Sort by combined_avg desc (null last), then by date
  const ordered = useMemo(() => {
    return matches
      .map((m: any, i: number) => ({ m, stat: matchupQueries[i]?.data as any, loading: matchupQueries[i]?.isLoading }))
      .sort((a: any, b: any) => {
        const av = a.stat?.combined_avg ?? -1;
        const bv = b.stat?.combined_avg ?? -1;
        if (bv !== av) return bv - av;
        return new Date(a.m.match_date).getTime() - new Date(b.m.match_date).getTime();
      });
  }, [matches, matchupQueries.map((q) => q.data).join("|")]);

  return (
    <>
      <section className="flex flex-wrap items-end gap-3">
        <LeagueScopeBar scope={scope} setScope={setScope} favs={fav.favs} hasFavs={!!fav.favs.length} />
        <FilterBlock label="Sample">
          <Select value={String(sampleSize)} onValueChange={(v) => setSampleSize(Number(v) as 10 | 20)}>
            <SelectTrigger className="bg-zinc-900/60 border-white/10 w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="10">Last 10</SelectItem>
              <SelectItem value="20">Last 20</SelectItem>
            </SelectContent>
          </Select>
        </FilterBlock>
        <FilterBlock label="Category">
          <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
            <SelectTrigger className="bg-zinc-900/60 border-white/10 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="goals">Goals</SelectItem>
              <SelectItem value="cards">Cards</SelectItem>
              <SelectItem value="corners">Corners</SelectItem>
            </SelectContent>
          </Select>
        </FilterBlock>
        <FilterBlock label="Market">
          <Select value={market} onValueChange={(v) => setMarket(v as Market)}>
            <SelectTrigger className="bg-zinc-900/60 border-white/10 w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="over">Over</SelectItem>
              <SelectItem value="under">Under</SelectItem>
            </SelectContent>
          </Select>
        </FilterBlock>
        <FilterBlock label="Line">
          <Select value={String(line)} onValueChange={(v) => setLine(Number(v))}>
            <SelectTrigger className="bg-zinc-900/60 border-white/10 w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LINES[category].map((l) => <SelectItem key={l} value={String(l)}>{l.toFixed(1)}</SelectItem>)}
            </SelectContent>
          </Select>
        </FilterBlock>
      </section>

      <FavoritesPicker leagues={leaguesQ.data ?? []} fav={fav} />

      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <Activity className="size-4 text-emerald-400" />
        <span className="text-zinc-100 font-medium">{matches.length}</span> upcoming match{matches.length === 1 ? "" : "es"} •{" "}
        <span className="text-emerald-400 font-medium uppercase">{market} {line.toFixed(1)} {category}</span> • last {sampleSize} • all future scheduled dates
      </div>

      {matchesQ.isLoading ? <SkeletonGrid /> : ordered.length === 0 ? <EmptyState /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ordered.map(({ m, stat, loading }: any) => (
            <MatchCard key={m.id} match={m} stat={stat} loading={!!loading}
              category={category} market={market} line={line} />
          ))}
        </div>
      )}
    </>
  );
}

function FavoritesPicker({ leagues, fav }: { leagues: any[]; fav: ReturnType<typeof useFavorites> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-white/5 bg-zinc-900/40">
      <button
        type="button"
        className="w-full px-4 py-2.5 flex items-center justify-between text-sm"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2 text-zinc-300">
          <Star className="size-4 text-amber-400" /> Manage favorite leagues
          <span className="text-zinc-500">({fav.favs.length} selected)</span>
        </span>
        <span className="text-zinc-500 text-xs">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="max-h-72 overflow-auto border-t border-white/5 p-2 grid grid-cols-1 md:grid-cols-2 gap-1">
          {leagues.map((l) => {
            const active = fav.isFav(l.id);
            return (
              <button
                key={l.id}
                onClick={() => fav.toggle(l.id)}
                className={`flex items-center justify-between gap-2 px-3 py-1.5 rounded-md text-left text-sm transition-colors ${
                  active ? "bg-amber-500/10 text-amber-100" : "hover:bg-white/5 text-zinc-300"
                }`}
              >
                <span className="truncate">{l.country} — {l.name} <span className="text-zinc-500">({l.season})</span></span>
                {active ? <Star className="size-4 text-amber-400 shrink-0" /> : <StarOff className="size-4 text-zinc-600 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MatchCard({ match, stat, loading, category, market, line }: {
  match: any; stat: any | null; loading: boolean;
  category: Category; market: Market; line: number;
}) {
  return (
    <Card className="bg-zinc-900/50 border-white/5 hover:border-emerald-500/30 transition-colors overflow-hidden">
      <CardHeader className="pb-3 space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
          <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-200 border border-emerald-500/20 font-normal">
            {match.competition_name}
          </Badge>
          <span className="flex items-center gap-1 shrink-0">
            <CalendarClock className="size-3" />{fmtDate(match.match_date)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-semibold text-zinc-100 truncate">{match.home_team_name}</span>
          <span className="text-xs text-zinc-600 px-2">vs</span>
          <span className="font-semibold text-zinc-100 truncate text-right">{match.away_team_name}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-zinc-500">
          <span>{market} {line.toFixed(1)} {category}</span>
          <TrendingUp className="size-3" />
        </div>
        <ThreeTiles home={stat?.home_pct} avg={stat?.combined_avg} away={stat?.away_pct} loading={loading} />
      </CardContent>
    </Card>
  );
}

/* ---------------- Shared bits ---------------- */

function ThreeTiles({
  home, avg, away, loading, homeLabel = "Home", awayLabel = "Away", avgLabel = "Avg",
}: {
  home?: number | null; avg?: number | null; away?: number | null; loading?: boolean;
  homeLabel?: string; awayLabel?: string; avgLabel?: string;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <StatTile label={homeLabel} value={home} loading={loading} />
      <StatTile label={avgLabel} value={avg ?? null} loading={loading} highlight />
      <StatTile label={awayLabel} value={away} loading={loading} />
    </div>
  );
}

function StatTile({ label, value, loading, highlight }: {
  label: string; value: number | null | undefined; loading?: boolean; highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 text-center ${highlight ? "border-emerald-500/30 bg-emerald-500/5" : "border-white/5 bg-zinc-950/40"}`}>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{label}</div>
      {loading ? (
        <div className="h-5 w-10 mx-auto rounded bg-zinc-800 animate-pulse" />
      ) : (
        <div className={`text-lg font-bold tabular-nums ${pctColor(value)}`}>
          {pctLabel(value)}
        </div>
      )}
    </div>
  );
}

function FilterBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">{label}</label>
      {children}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-44 rounded-xl bg-zinc-900/40 border border-white/5 animate-pulse" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-zinc-900/30 p-12 text-center">
      <CalendarClock className="size-8 mx-auto text-zinc-600 mb-3" />
      <p className="text-zinc-300 font-medium">No upcoming matches</p>
      <p className="text-zinc-500 text-sm mt-1">Try picking more favorites or switching to All leagues.</p>
    </div>
  );
}

/* ---------------- Debug tab ---------------- */

function DebugTab() {
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const countsQ = useQuery({
    queryKey: ["debug-counts"],
    queryFn: async () => {
      const [leagues, teams, matches, upcoming, perCountry, sources, diagnostics] = await Promise.all([
        supabase.from("leagues").select("id", { count: "exact", head: true }),
        supabase.from("teams").select("id", { count: "exact", head: true }),
        supabase.from("matches").select("id", { count: "exact", head: true }),
        supabase.from("matches").select("id", { count: "exact", head: true }).eq("status", "scheduled").gte("match_date", new Date().toISOString()),
        supabase.from("leagues").select("country"),
        supabase.from("league_sources").select("league_key, league_name, country, source, priority, enabled").order("country").order("league_key").order("priority"),
        (supabase.rpc as any)("get_upcoming_diagnostics"),
      ]);
      const byCountry: Record<string, number> = {};
      (perCountry.data ?? []).forEach((r: any) => { byCountry[r.country] = (byCountry[r.country] ?? 0) + 1; });
      return {
        leagues: leagues.count ?? 0,
        teams: teams.count ?? 0,
        matches: matches.count ?? 0,
        upcoming: upcoming.count ?? 0,
        byCountry,
        perLeague: diagnostics.data ?? [],
        sources: sources.data ?? [],
      };
    },
  });

  async function runSync() {
    setSyncing(true); setSyncMsg("Running full pipeline…");
    try {
      const res = await fetch("/api/public/hooks/refresh-data", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data).slice(0, 200));
      setSyncMsg(`Sync OK: ${JSON.stringify(data).slice(0, 300)}`);
      countsQ.refetch();
    } catch (e: any) {
      setSyncMsg(`Sync failed: ${e.message ?? String(e)}`);
    } finally {
      setSyncing(false);
    }
  }

  const d = countsQ.data;
  const sourcesByLeague = new Map<string, string[]>();
  (d?.sources ?? []).forEach((s: any) => {
    const k = `${s.country} — ${s.league_name}`;
    if (!sourcesByLeague.has(k)) sourcesByLeague.set(k, []);
    sourcesByLeague.get(k)!.push(`${s.source}${s.enabled ? "" : " (off)"}`);
  });

  return (
    <div className="space-y-6">
      <Card className="bg-amber-500/5 border-amber-500/20">
        <CardContent className="pt-6 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm text-amber-200 font-medium">Sincronização manual</p>
            <p className="text-xs text-zinc-400">A sincronização automática foi desativada para preservar seus créditos de API. Rode apenas quando quiser dados novos.</p>
          </div>
          <Button onClick={runSync} disabled={syncing} className="bg-amber-500 hover:bg-amber-600 text-zinc-950">
            {syncing ? "Sincronizando…" : "Sincronizar agora"}
          </Button>
        </CardContent>
      </Card>
      {syncMsg && <p className="text-xs text-zinc-400 break-all">{syncMsg}</p>}

      {!d ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <CountTile label="Leagues" value={d.leagues} />
            <CountTile label="Teams" value={d.teams} />
            <CountTile label="Matches (total)" value={d.matches} />
            <CountTile label="Upcoming (scheduled, future)" value={d.upcoming} />
          </div>

          <Card className="bg-zinc-900/40 border-white/5">
            <CardHeader className="text-sm font-medium">Leagues per country</CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                {Object.entries(d.byCountry).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
                  <div key={c} className="flex justify-between border border-white/5 rounded px-2 py-1">
                    <span className="text-zinc-300">{c}</span>
                    <span className="text-zinc-500">{n}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/40 border-white/5">
            <CardHeader className="text-sm font-medium">Matches per league (with source priority)</CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-zinc-500">
                    <tr><th className="text-left p-2">Country</th><th className="text-left p-2">League</th><th className="text-left p-2">Season</th><th className="text-right p-2">Upcoming</th><th className="text-left p-2">Latest future</th><th className="text-right p-2">Stats coverage</th><th className="text-left p-2">Eligibility</th><th className="text-left p-2">Sources</th></tr>
                  </thead>
                  <tbody>
                    {d.perLeague.map((l: any, i: number) => (
                      <tr key={i} className="border-t border-white/5">
                        <td className="p-2 text-zinc-400">{l.country}</td>
                        <td className="p-2 text-zinc-200">{l.league}</td>
                        <td className="p-2 text-zinc-500">{l.season}</td>
                        <td className="p-2 text-right text-emerald-400">{Number(l.upcoming_count ?? 0).toLocaleString()}</td>
                        <td className="p-2 text-zinc-500">{l.latest_future_match ? fmtDate(l.latest_future_match) : "—"}</td>
                        <td className="p-2 text-right text-zinc-300">{l.statistics_coverage_pct ?? 0}%</td>
                        <td className="p-2 text-zinc-500">{l.display_eligibility_reason}</td>
                        <td className="p-2 text-zinc-500">{(sourcesByLeague.get(`${l.country} — ${l.league}`) ?? []).join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-zinc-500">
            Note: "Upcoming" only counts matches with status=scheduled and match_date in the future.
            Today is {new Date().toLocaleDateString()} — most European league seasons (2025-26) end in May,
            so between seasons only competitions actively scheduled (Brazil Série A, Club World Cup, friendlies, etc.) will appear.
            If a league shows zero upcoming, run a sync to pull the latest fixtures.
          </p>
        </>
      )}
    </div>
  );
}

function CountTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-4">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-2xl font-semibold text-zinc-100 mt-1">{value.toLocaleString()}</div>
    </div>
  );
}

/* ---------------- Data Pipeline tab ---------------- */

function PipelineTab() {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const sourcesQ = useQuery({
    queryKey: ["pipeline-sources"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_source_status");
      if (error) throw error;
      return data ?? [];
    },
  });

  const diagQ = useQuery({
    queryKey: ["pipeline-diagnostics"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_pipeline_diagnostics");
      if (error) throw error;
      return data ?? [];
    },
  });

  const recentJobsQ = useQuery({
    queryKey: ["pipeline-jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sync_jobs")
        .select("id, job_name, status, processed_records, error_message, started_at, finished_at, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  async function run(action: string, body: any = {}) {
    setBusy(action); setMsg(null);
    try {
      let url = "/api/public/hooks/refresh-data";
      let payload: any = body;
      if (action === "stats") {
        // call calculate-statistics directly via supabase
        const { data, error } = await (supabase.functions as any).invoke("calculate-statistics", { body });
        if (error) throw error;
        setMsg(`Statistics rebuilt: ${JSON.stringify(data).slice(0, 300)}`);
      } else if (action === "sync-comp") {
        const { data, error } = await (supabase.functions as any).invoke("sync-orchestrator", { body });
        if (error) throw error;
        setMsg(`Sync complete: ${JSON.stringify(data).slice(0, 300)}`);
      } else {
        const res = await fetch(url, { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(data).slice(0, 200));
        setMsg(`Sync OK: ${JSON.stringify(data).slice(0, 300)}`);
      }
      sourcesQ.refetch(); diagQ.refetch(); recentJobsQ.refetch();
    } catch (e: any) {
      setMsg(`Failed: ${e.message ?? String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const jobs = recentJobsQ.data ?? [];
  const errorJobs = jobs.filter((j: any) => j.error_message);
  const diag = (diagQ.data ?? []) as any[];
  const filtered = diag.filter((r) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return r.league?.toLowerCase().includes(q) || r.country?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      {/* Manual actions */}
      <Card className="bg-zinc-900/40 border-white/5">
        <CardHeader className="text-sm font-medium flex items-center gap-2"><RefreshCw className="size-4" /> Manual actions</CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!!busy} onClick={() => run("sync-all")} className="bg-emerald-600 hover:bg-emerald-500">
            {busy === "sync-all" ? "Running…" : "Sync All"}
          </Button>
          <Button size="sm" disabled={!!busy} variant="secondary" onClick={() => run("stats")}>
            {busy === "stats" ? "Running…" : "Rebuild Statistics"}
          </Button>
          <Button size="sm" disabled={!!busy} variant="secondary" onClick={() => { sourcesQ.refetch(); diagQ.refetch(); recentJobsQ.refetch(); }}>
            Refresh Cache
          </Button>
        </CardContent>
        {msg && <CardContent className="pt-0"><p className="text-xs text-zinc-400 break-all">{msg}</p></CardContent>}
      </Card>

      {/* Sources */}
      <Card className="bg-zinc-900/40 border-white/5">
        <CardHeader className="text-sm font-medium">Sources</CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="text-left p-2">Source</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Last sync</th>
                  <th className="text-right p-2">Records imported</th>
                  <th className="text-right p-2">Failed runs</th>
                  <th className="text-left p-2">Last error</th>
                </tr>
              </thead>
              <tbody>
                {(sourcesQ.data ?? []).map((s: any) => (
                  <tr key={s.source} className="border-t border-white/5">
                    <td className="p-2 text-zinc-200">{s.source}</td>
                    <td className="p-2">
                      <Badge variant="outline" className={s.last_status === "success" ? "border-emerald-500/40 text-emerald-300" : "border-rose-500/40 text-rose-300"}>
                        {s.last_status ?? "—"}
                      </Badge>
                    </td>
                    <td className="p-2 text-zinc-400">{s.last_run ? fmtDate(s.last_run) : "—"}</td>
                    <td className="p-2 text-right text-emerald-400">{Number(s.records_imported ?? 0).toLocaleString()}</td>
                    <td className="p-2 text-right text-rose-400">{s.failed_runs ?? 0}</td>
                    <td className="p-2 text-zinc-500 max-w-[360px] truncate" title={s.last_error ?? ""}>{s.last_error ?? "—"}</td>
                  </tr>
                ))}
                {(!sourcesQ.data || sourcesQ.data.length === 0) && (
                  <tr><td colSpan={6} className="p-3 text-zinc-500">No sync jobs recorded yet. Run "Sync All".</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Competitions diagnostics */}
      <Card className="bg-zinc-900/40 border-white/5">
        <CardHeader className="text-sm font-medium flex items-center justify-between gap-2 flex-wrap">
          <span>Competitions — display diagnostics</span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by competition or country…"
            className="bg-zinc-950 border border-white/10 rounded px-2 py-1 text-xs w-64"
          />
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="text-left p-2">Competition</th>
                  <th className="text-left p-2">Country</th>
                  <th className="text-left p-2">Sources</th>
                  <th className="text-left p-2">Source used</th>
                  <th className="text-right p-2">Imported</th>
                  <th className="text-right p-2">Total</th>
                  <th className="text-right p-2">Finished</th>
                  <th className="text-right p-2">Upcoming</th>
                  <th className="text-right p-2">Displayed</th>
                  <th className="text-right p-2">Hidden (no stats)</th>
                  <th className="text-right p-2">Hidden (no teams)</th>
                  <th className="text-right p-2">Stats %</th>
                  <th className="text-left p-2">Hidden reason</th>
                  <th className="text-left p-2">Last sync</th>
                  <th className="text-left p-2">Last error</th>
                  <th className="text-left p-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.league_id} className="border-t border-white/5">
                    <td className="p-2 text-zinc-200">{r.league}</td>
                    <td className="p-2 text-zinc-400">{r.country}</td>
                    <td className="p-2 text-zinc-500 max-w-[180px] truncate" title={r.sources}>{r.sources}</td>
                    <td className="p-2 text-zinc-300">{r.source_used ?? "—"}</td>
                    <td className="p-2 text-right text-zinc-300">{Number(r.fixtures_imported ?? 0).toLocaleString()}</td>
                    <td className="p-2 text-right text-zinc-300">{Number(r.total_matches ?? 0).toLocaleString()}</td>
                    <td className="p-2 text-right text-zinc-400">{Number(r.finished_matches ?? 0).toLocaleString()}</td>
                    <td className="p-2 text-right text-emerald-400">{Number(r.upcoming_matches ?? 0).toLocaleString()}</td>
                    <td className="p-2 text-right text-emerald-300">{Number(r.displayed_matches ?? 0).toLocaleString()}</td>
                    <td className="p-2 text-right text-amber-400">{Number(r.hidden_missing_stats ?? 0).toLocaleString()}</td>
                    <td className="p-2 text-right text-rose-400">{Number(r.hidden_missing_teams ?? 0).toLocaleString()}</td>
                    <td className={`p-2 text-right ${pctColor(Number(r.statistics_coverage_pct))}`}>{r.statistics_coverage_pct ?? 0}%</td>
                    <td className="p-2 text-zinc-400">{r.hidden_reason ?? "—"}</td>
                    <td className="p-2 text-zinc-500">{r.last_sync ? fmtDate(r.last_sync) : "—"}</td>
                    <td className="p-2 text-rose-400 max-w-[240px] truncate" title={r.last_error ?? ""}>{r.last_error ?? "—"}</td>
                    <td className="p-2">
                      <button
                        disabled={!!busy}
                        onClick={() => run("sync-comp", { league_keys: [`${r.country}:${r.league}`] })}
                        className="text-xs text-emerald-400 hover:underline"
                        title="Re-sync this competition only"
                      >
                        Sync
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={16} className="p-3 text-zinc-500">No competitions match the filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-zinc-500 mt-3">
            "Displayed" = upcoming matches that pass team-resolution. "Hidden (no stats)" = upcoming whose home or away team has no statistics_cache row;
            they still render but without percentages. Friendlies, national teams and World Cup competitions appear here only if a source is enabled in
            <code className="text-zinc-400"> league_sources</code> AND its last sync imported scheduled fixtures.
          </p>
        </CardContent>
      </Card>

      {/* Import logs */}
      <Card className="bg-zinc-900/40 border-white/5">
        <CardHeader className="text-sm font-medium">Import logs (recent 100 sync jobs)</CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-h-[420px]">
            <table className="w-full text-xs">
              <thead className="text-zinc-500 sticky top-0 bg-zinc-900/80">
                <tr>
                  <th className="text-left p-2">Timestamp</th>
                  <th className="text-left p-2">Source</th>
                  <th className="text-left p-2">Competition</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-right p-2">Records</th>
                  <th className="text-left p-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j: any) => {
                  const parts = (j.job_name ?? "").split(":");
                  return (
                    <tr key={j.id} className="border-t border-white/5">
                      <td className="p-2 text-zinc-400 whitespace-nowrap">{fmtDate(j.created_at)}</td>
                      <td className="p-2 text-zinc-300">{parts[0] ?? "—"}</td>
                      <td className="p-2 text-zinc-200">{parts.slice(1, -1).join(":") || "—"}</td>
                      <td className="p-2">
                        <Badge variant="outline" className={j.status === "success" ? "border-emerald-500/40 text-emerald-300" : "border-rose-500/40 text-rose-300"}>
                          {j.status}
                        </Badge>
                      </td>
                      <td className="p-2 text-right text-emerald-400">{Number(j.processed_records ?? 0).toLocaleString()}</td>
                      <td className="p-2 text-rose-400 max-w-[360px] truncate" title={j.error_message ?? ""}>{j.error_message ?? "—"}</td>
                    </tr>
                  );
                })}
                {jobs.length === 0 && <tr><td colSpan={6} className="p-3 text-zinc-500">No jobs recorded.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Error logs */}
      <Card className="bg-rose-500/5 border-rose-500/20">
        <CardHeader className="text-sm font-medium flex items-center gap-2 text-rose-200">
          <AlertTriangle className="size-4" /> Error logs ({errorJobs.length})
        </CardHeader>
        <CardContent>
          {errorJobs.length === 0 ? (
            <p className="text-xs text-zinc-400">No errors in the last 100 jobs.</p>
          ) : (
            <div className="space-y-2 max-h-[360px] overflow-y-auto">
              {errorJobs.map((j: any) => {
                const parts = (j.job_name ?? "").split(":");
                return (
                  <div key={j.id} className="border border-rose-500/20 rounded p-2 text-xs">
                    <div className="flex justify-between text-zinc-400">
                      <span>{parts[0]} — {parts.slice(1, -1).join(":")}</span>
                      <span>{fmtDate(j.created_at)}</span>
                    </div>
                    <div className="text-rose-300 mt-1 break-all">{j.error_message}</div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
