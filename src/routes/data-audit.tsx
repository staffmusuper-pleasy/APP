import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Play, ShieldCheck } from "lucide-react";
import { getApiQuotas } from "@/lib/api-quotas.functions";

export const Route = createFileRoute("/data-audit")({
  component: DataAuditRoute,
  ssr: false,
});

function DataAuditRoute() {
  if (typeof window !== "undefined" && sessionStorage.getItem("admin_unlocked") !== "1") {
    return (
      <div className="min-h-screen grid place-items-center bg-zinc-950 text-zinc-100 px-4">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold">Admin area</h1>
          <p className="text-sm text-zinc-400">Unlock the Admin tab from the home page to access Data Audit.</p>
          <Link to="/" className="inline-flex items-center px-3 py-1.5 text-sm rounded border border-white/10 hover:bg-white/5">Go home</Link>
        </div>
      </div>
    );
  }
  return <DataAudit />;
}

export { DataAudit };

type DiagRow = {
  league_id: string;
  league: string;
  country: string;
  season: string;
  sources: string;
  source_used: string;
  fixtures_imported: number;
  total_matches: number;
  finished_matches: number;
  upcoming_matches: number;
  hidden_missing_stats: number;
  hidden_missing_teams: number;
  displayed_matches: number;
  statistics_coverage_pct: number;
  hidden_reason: string;
  last_sync: string | null;
  last_error: string | null;
};

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function DataAudit() {
  const fetchQuotas = useServerFn(getApiQuotas);

  const diag = useQuery({
    queryKey: ["audit-diag"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_pipeline_diagnostics");
      if (error) throw error;
      return (data ?? []) as DiagRow[];
    },
  });

  const nextMatches = useQuery({
    queryKey: ["audit-next-per-league"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("league_id, match_date, status")
        .eq("status", "scheduled")
        .gte("match_date", new Date().toISOString())
        .order("match_date", { ascending: true })
        .limit(2000);
      if (error) throw error;
      const map = new Map<string, string>();
      for (const m of data ?? []) {
        if (!map.has(m.league_id)) map.set(m.league_id, m.match_date as string);
      }
      return map;
    },
  });

  const quotas = useQuery({
    queryKey: ["audit-quotas"],
    queryFn: () => fetchQuotas(),
    refetchOnWindowFocus: false,
  });

  const sourceStats = useQuery({
    queryKey: ["audit-source-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("league_sources")
        .select("source, season_completed, total_matches_stored, api_calls_saved, next_retry_at, last_status, last_match_imported, last_successful_sync");
      if (error) throw error;
      return data ?? [];
    },
  });

  const sourceCoverage = useQuery({
    queryKey: ["audit-source-coverage"],
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const sources = ["openfootball", "football-data", "thesportsdb", "api-football", "worldfootballr", null];
      const results = await Promise.all(sources.map(async (src) => {
        const base = supabase.from("matches").select("id", { count: "exact", head: true });
        const totalQ = src === null ? base.is("source", null) : base.eq("source", src);
        const { count: total } = await totalQ;
        const futureBase = supabase.from("matches").select("id", { count: "exact", head: true })
          .eq("status", "scheduled").gte("match_date", nowIso);
        const { count: future } = src === null
          ? await futureBase.is("source", null)
          : await futureBase.eq("source", src);
        return { source: src ?? "(unknown / legacy)", total: total ?? 0, future: future ?? 0 };
      }));
      return results;
    },
  });

  // --- New: source priorities ---
  const priorities = useQuery({
    queryKey: ["source-priorities"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("source_priorities").select("*").order("priority");
      if (error) throw error;
      return data ?? [];
    },
  });
  const updatePriority = async (source: string, patch: { priority?: number; enabled?: boolean }) => {
    await supabase.from("source_priorities").update(patch).eq("source", source);
    priorities.refetch();
  };

  // --- New: competition coverage view ---
  const competitionCoverage = useQuery({
    queryKey: ["competition-coverage"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competition_coverage").select("*").order("total_matches", { ascending: false }).limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  // --- New: data quality ---
  const dataQuality = useQuery({
    queryKey: ["data-quality"],
    queryFn: async () => {
      const [{ data: dq }, { data: sq }] = await Promise.all([
        supabase.from("data_quality_summary").select("*").maybeSingle(),
        supabase.from("source_quality").select("*"),
      ]);
      return { summary: dq, sources: sq ?? [] };
    },
  });

  // --- New: import logs ---
  const importLogs = useQuery({
    queryKey: ["import-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_logs").select("*").order("started_at", { ascending: false }).limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  // --- New: dry-run / full-sync controls ---
  const [dryRunReport, setDryRunReport] = useState<any>(null);
  const [running, setRunning] = useState<"dry" | "full" | null>(null);
  const lastDryRun = (importLogs.data ?? []).find((l: any) => l.source === "dry-run");
  const lastDryRunOk = lastDryRun
    && lastDryRun.status === "success"
    && Date.now() - new Date(lastDryRun.started_at).getTime() < 30 * 60_000;

  const runDryRun = async () => {
    setRunning("dry");
    try {
      const { data, error } = await supabase.functions.invoke("sync-dry-run", { body: {} });
      if (error) throw error;
      setDryRunReport(data);
      importLogs.refetch();
    } finally { setRunning(null); }
  };
  const runFullSync = async () => {
    if (!lastDryRunOk) return;
    setRunning("full");
    try {
      await supabase.functions.invoke("sync-orchestrator", { body: {} });
      diag.refetch(); importLogs.refetch(); competitionCoverage.refetch(); dataQuality.refetch();
    } finally { setRunning(null); }
  };

  const rows = diag.data ?? [];
  const nextMap = nextMatches.data ?? new Map<string, string>();

  // Focus competitions requested by the user
  const focusNames = [
    "International Friendlies",
    "FIFA World Cup",
    "FIFA Club World Cup",
    "UEFA Nations League",
    "Copa América",
    "CONCACAF Gold Cup",
    "World Cup Qualifiers - UEFA",
    "World Cup Qualifiers - CONMEBOL",
    "World Cup Qualifiers - CONCACAF",
    "World Cup Qualifiers - AFC",
    "World Cup Qualifiers - CAF",
    "World Cup Qualifiers - OFC",
    "Major League Soccer",
    "UEFA Champions League",
    // Libertadores not yet configured — surface its absence
  ];
  const focusRows = focusNames.map((n) => {
    const matched = rows
      .filter((r) => r.league === n)
      .sort((a, b) => (b.upcoming_matches ?? 0) - (a.upcoming_matches ?? 0))[0];
    return { name: n, row: matched };
  });

  const withFuture = rows.filter((r) => (r.upcoming_matches ?? 0) > 0);
  const withoutFuture = rows.filter((r) => (r.upcoming_matches ?? 0) === 0);

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link to="/">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
          </Link>
          <h1 className="text-2xl font-bold">Data Audit</h1>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => { diag.refetch(); nextMatches.refetch(); quotas.refetch(); }}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* Quotas */}
        <Card>
          <CardHeader><h2 className="font-semibold">API credits</h2></CardHeader>
          <CardContent>
            {quotas.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
              <div className="grid md:grid-cols-2 gap-3">
                {(quotas.data ?? []).map((q) => (
                  <div key={q.name} className="rounded border border-border p-3">
                    <div className="font-medium">{q.name} <span className="text-xs text-muted-foreground">({q.period ?? "—"})</span></div>
                    {q.error ? (
                      <div className="text-rose-400 text-sm mt-1">{q.error}</div>
                    ) : (
                      <div className="text-sm mt-1 flex gap-4">
                        <span>Limit: <b>{q.limit ?? "—"}</b></span>
                        <span>Used: <b>{q.used ?? "—"}</b></span>
                        <span>Remaining: <b className={q.remaining != null && q.remaining < 10 ? "text-rose-400" : "text-emerald-400"}>{q.remaining ?? "—"}</b></span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Incremental sync savings */}
        <Card>
          <CardHeader><h2 className="font-semibold">Incremental sync</h2></CardHeader>
          <CardContent>
            {sourceStats.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (() => {
              const rows = sourceStats.data ?? [];
              const completed = rows.filter((r: any) => r.season_completed).length;
              const inCooldown = rows.filter((r: any) => r.next_retry_at && new Date(r.next_retry_at).getTime() > Date.now()).length;
              const savedCalls = rows.reduce((a: number, r: any) => a + (r.api_calls_saved ?? 0), 0);
              const totalMatches = rows.reduce((a: number, r: any) => a + (r.total_matches_stored ?? 0), 0);
              return (
                <div className="grid md:grid-cols-4 gap-3 text-sm">
                  <div className="rounded border border-border p-3">
                    <div className="text-muted-foreground">Locked seasons</div>
                    <div className="text-xl font-bold">{completed}</div>
                    <div className="text-xs text-muted-foreground">never re-scraped</div>
                  </div>
                  <div className="rounded border border-border p-3">
                    <div className="text-muted-foreground">In cooldown (24h)</div>
                    <div className="text-xl font-bold">{inCooldown}</div>
                    <div className="text-xs text-muted-foreground">skipping after failure</div>
                  </div>
                  <div className="rounded border border-border p-3">
                    <div className="text-muted-foreground">API calls saved</div>
                    <div className="text-xl font-bold text-emerald-400">{savedCalls}</div>
                    <div className="text-xs text-muted-foreground">via historical lock</div>
                  </div>
                  <div className="rounded border border-border p-3">
                    <div className="text-muted-foreground">Stored matches</div>
                    <div className="text-xl font-bold">{totalMatches}</div>
                    <div className="text-xs text-muted-foreground">used as primary source</div>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Coverage by source */}
        <Card>
          <CardHeader><h2 className="font-semibold">Coverage by source</h2></CardHeader>
          <CardContent>
            {sourceCoverage.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
              <div className="grid md:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                {(sourceCoverage.data ?? []).map((s) => (
                  <div key={s.source} className="rounded border border-border p-3">
                    <div className="font-medium">{s.source}</div>
                    <div className="text-xs text-muted-foreground">Total matches</div>
                    <div className="text-lg font-bold">{s.total}</div>
                    <div className="text-xs text-muted-foreground mt-1">Future fixtures</div>
                    <div className={`text-lg font-bold ${s.future > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>{s.future}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Validation & full sync gate */}
        <Card className="border-primary/40">
          <CardHeader>
            <h2 className="font-semibold flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Validation & full sync</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button onClick={runDryRun} disabled={running !== null} size="sm">
                {running === "dry" ? "Running…" : "Run dry-run validation"}
              </Button>
              <Button
                onClick={runFullSync}
                disabled={running !== null || !lastDryRunOk}
                variant={lastDryRunOk ? "default" : "outline"}
                size="sm"
              >
                <Play className="h-3 w-3 mr-1" />
                {running === "full" ? "Syncing…" : "Run full sync"}
              </Button>
              {!lastDryRunOk && (
                <span className="text-xs text-muted-foreground self-center">
                  Run a dry-run validation (within last 30 min, no errors) to unlock the full sync.
                </span>
              )}
            </div>
            {dryRunReport && (
              <div className="grid md:grid-cols-5 gap-3 text-sm">
                <Stat label="Competitions" value={dryRunReport.competitions_detected} />
                <Stat label="Seasons" value={dryRunReport.seasons_detected} />
                <Stat label="Matches expected" value={dryRunReport.matches_expected} />
                <Stat label="Teams expected" value={dryRunReport.teams_expected} />
                <Stat label="Potential duplicates" value={dryRunReport.potential_duplicates} warn={dryRunReport.potential_duplicates > 0} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Source priority editor */}
        <Card>
          <CardHeader><h2 className="font-semibold">Source priority</h2></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr><th className="p-2">Source</th><th className="p-2">Priority</th><th className="p-2">Enabled</th></tr>
              </thead>
              <tbody>
                {(priorities.data ?? []).map((p: any) => (
                  <tr key={p.source} className="border-t border-border">
                    <td className="p-2 font-medium">{p.source}</td>
                    <td className="p-2">
                      <input
                        type="number" min={1} className="w-16 bg-background border border-border rounded px-2 py-1"
                        defaultValue={p.priority}
                        onBlur={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!Number.isNaN(v) && v !== p.priority) updatePriority(p.source, { priority: v });
                        }}
                      />
                    </td>
                    <td className="p-2">
                      <Switch checked={p.enabled} onCheckedChange={(v) => updatePriority(p.source, { enabled: v })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Data quality */}
        <Card>
          <CardHeader><h2 className="font-semibold">Data quality</h2></CardHeader>
          <CardContent className="space-y-3">
            {dataQuality.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
              <>
                <div className="grid md:grid-cols-4 gap-3 text-sm">
                  <Stat label="Duplicate matches" value={dataQuality.data?.summary?.duplicates_detected ?? 0} warn={(dataQuality.data?.summary?.duplicates_detected ?? 0) > 0} />
                  <Stat label="Unmatched teams" value={dataQuality.data?.summary?.unmatched_teams ?? 0} warn={(dataQuality.data?.summary?.unmatched_teams ?? 0) > 0} />
                  <Stat label="Missing statistics" value={dataQuality.data?.summary?.matches_missing_stats ?? 0} />
                  <Stat label="Failed imports 24h" value={dataQuality.data?.summary?.failed_imports ?? 0} warn={(dataQuality.data?.summary?.failed_imports ?? 0) > 0} />
                </div>
                {dataQuality.data && dataQuality.data.sources.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs text-muted-foreground mb-1">Per-source success rate</div>
                    <table className="w-full text-xs">
                      <thead className="text-left text-muted-foreground">
                        <tr><th className="p-2">Source</th><th className="p-2">Successful</th><th className="p-2">Failed</th><th className="p-2">Coverage %</th><th className="p-2">Last success</th></tr>
                      </thead>
                      <tbody>
                        {dataQuality.data.sources.map((s: any) => (
                          <tr key={s.source} className="border-t border-border">
                            <td className="p-2">{s.source}</td>
                            <td className="p-2 text-emerald-400">{s.successful_runs}</td>
                            <td className={`p-2 ${s.failed_runs > 0 ? "text-rose-400" : ""}`}>{s.failed_runs}</td>
                            <td className="p-2">{s.coverage_pct ?? "—"}%</td>
                            <td className="p-2">{fmt(s.last_successful_sync)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Coverage by competition */}
        <Card>
          <CardHeader><h2 className="font-semibold">Coverage by competition</h2></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr><th className="p-2">Competition</th><th className="p-2">Country</th><th className="p-2">Season</th><th className="p-2">Total</th><th className="p-2">Future</th><th className="p-2">Source used</th><th className="p-2">Last sync</th></tr>
              </thead>
              <tbody>
                {(competitionCoverage.data ?? []).map((c: any) => (
                  <tr key={c.league_id} className="border-t border-border">
                    <td className="p-2">{c.competition}</td>
                    <td className="p-2">{c.country}</td>
                    <td className="p-2">{c.season}</td>
                    <td className="p-2">{c.total_matches}</td>
                    <td className={`p-2 font-semibold ${c.future_fixtures > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>{c.future_fixtures}</td>
                    <td className="p-2">{c.source_used ?? "—"}</td>
                    <td className="p-2">{fmt(c.last_sync)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Import logs */}
        <Card>
          <CardHeader><h2 className="font-semibold">Recent imports</h2></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr><th className="p-2">Started</th><th className="p-2">Source</th><th className="p-2">Competition</th><th className="p-2">Imported</th><th className="p-2">Updated</th><th className="p-2">Errors</th><th className="p-2">Status</th></tr>
              </thead>
              <tbody>
                {(importLogs.data ?? []).map((l: any) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="p-2 whitespace-nowrap">{fmt(l.started_at)}</td>
                    <td className="p-2">{l.source}</td>
                    <td className="p-2">{l.competition ?? "—"}</td>
                    <td className="p-2">{l.matches_imported}</td>
                    <td className="p-2">{l.matches_updated}</td>
                    <td className={`p-2 ${l.errors_count > 0 ? "text-rose-400" : ""}`}>{l.errors_count}</td>
                    <td className="p-2">
                      {l.status === "success"
                        ? <Badge className="bg-emerald-600">success</Badge>
                        : l.status === "error"
                          ? <Badge variant="destructive">error</Badge>
                          : <Badge variant="outline">{l.status}</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>


        {/* Summary */}


        <div className="grid md:grid-cols-3 gap-3">
          <Card><CardContent className="p-4">
            <div className="text-sm text-muted-foreground">Competitions</div>
            <div className="text-2xl font-bold">{rows.length}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-sm text-muted-foreground">With future matches</div>
            <div className="text-2xl font-bold text-emerald-400">{withFuture.length}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-sm text-muted-foreground">Without future matches</div>
            <div className="text-2xl font-bold text-rose-400">{withoutFuture.length}</div>
          </CardContent></Card>
        </div>

        {/* Focus competitions */}
        <Card>
          <CardHeader><h2 className="font-semibold">Focus competitions</h2></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr><th className="p-2">Competition</th><th className="p-2">Total</th><th className="p-2">Future</th><th className="p-2">Next kickoff</th><th className="p-2">Source used</th><th className="p-2">Last sync</th><th className="p-2">Status</th></tr>
              </thead>
              <tbody>
                {focusRows.map(({ name, row }) => (
                  <tr key={name} className="border-t border-border">
                    <td className="p-2 font-medium">{name}</td>
                    <td className="p-2">{row?.total_matches ?? 0}</td>
                    <td className={`p-2 font-bold ${row && row.upcoming_matches > 0 ? "text-emerald-400" : "text-rose-400"}`}>{row?.upcoming_matches ?? 0}</td>
                    <td className="p-2">{row ? fmt(nextMap.get(row.league_id) ?? null) : "—"}</td>
                    <td className="p-2">{row?.source_used ?? "—"}</td>
                    <td className="p-2">{fmt(row?.last_sync ?? null)}</td>
                    <td className="p-2">
                      {!row ? <Badge variant="destructive">not configured</Badge>
                        : row.upcoming_matches > 0 ? <Badge className="bg-emerald-600"><CheckCircle2 className="h-3 w-3 mr-1" />ok</Badge>
                        : <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />{row.hidden_reason}</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* All leagues table */}
        <Card>
          <CardHeader><h2 className="font-semibold">All competitions ({rows.length})</h2></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="p-2">Competition</th><th className="p-2">Country</th><th className="p-2">Season</th>
                  <th className="p-2">Total</th><th className="p-2">Future</th><th className="p-2">Next</th>
                  <th className="p-2">Source used</th><th className="p-2">Last sync</th>
                  <th className="p-2">Data availability</th>
                  <th className="p-2">Reason / error</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const availability = r.upcoming_matches > 0
                    ? { icon: "✓", label: "Future fixtures available", cls: "text-emerald-400" }
                    : r.total_matches > 0
                      ? { icon: "⚠", label: "Historical data only", cls: "text-amber-400" }
                      : { icon: "✗", label: "Source returned no future fixtures", cls: "text-rose-400" };
                  return (
                    <tr key={r.league_id} className="border-t border-border">
                      <td className="p-2">{r.league}</td>
                      <td className="p-2">{r.country}</td>
                      <td className="p-2">{r.season}</td>
                      <td className="p-2">{r.total_matches}</td>
                      <td className={`p-2 font-semibold ${r.upcoming_matches > 0 ? "text-emerald-400" : "text-rose-400"}`}>{r.upcoming_matches}</td>
                      <td className="p-2">{fmt(nextMap.get(r.league_id) ?? null)}</td>
                      <td className="p-2">{r.source_used}</td>
                      <td className="p-2">{fmt(r.last_sync)}</td>
                      <td className={`p-2 whitespace-nowrap ${availability.cls}`}>{availability.icon} {availability.label}</td>
                      <td className="p-2 text-muted-foreground">
                        {r.upcoming_matches > 0 ? "—" : (
                          <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-400" />{r.hidden_reason}{r.last_error ? ` · ${r.last_error.slice(0, 80)}` : ""}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Final report */}
        <div className="grid md:grid-cols-2 gap-3">
          <Card>
            <CardHeader><h2 className="font-semibold text-emerald-400">Competitions with future matches</h2></CardHeader>
            <CardContent>
              {withFuture.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
                <ul className="text-sm space-y-1">
                  {withFuture.map((r) => (
                    <li key={r.league_id} className="flex justify-between border-b border-border py-1">
                      <span>{r.league} <span className="text-muted-foreground text-xs">({r.country})</span></span>
                      <span className="font-mono text-emerald-400">{r.upcoming_matches}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><h2 className="font-semibold text-rose-400">Competitions without future matches</h2></CardHeader>
            <CardContent>
              <ul className="text-sm space-y-1 max-h-[400px] overflow-y-auto">
                {withoutFuture.map((r) => (
                  <li key={r.league_id} className="flex justify-between border-b border-border py-1">
                    <span>{r.league} <span className="text-muted-foreground text-xs">({r.country})</span></span>
                    <span className="text-xs text-muted-foreground">{r.hidden_reason}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4 text-sm space-y-2">
            <div className="font-semibold flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-400" /> Audit summary</div>
            <p>The Top % filter (<code>status='scheduled' AND match_date &gt; now()</code>) is correct — it is not hiding valid matches.</p>
            <p>If a competition shows 0 future matches above, the data is genuinely absent from every configured source. Most European 2025-26 seasons ended in May 2026 and the 2026-27 season has not been published yet by OpenFootball nor API-Football, so they will only repopulate once upstream releases the new fixtures.</p>
            <p>National-team windows (Friendlies, World Cup Qualifiers, Nations League) appear only during their FIFA windows. Check API-Football quota above before triggering another full sync.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div className="rounded border border-border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className={`text-xl font-bold ${warn ? "text-rose-400" : ""}`}>{value}</div>
    </div>
  );
}

