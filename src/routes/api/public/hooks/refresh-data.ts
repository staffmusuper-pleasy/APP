import { createFileRoute } from "@tanstack/react-router";

// Public hook: runs the full refresh pipeline.
// 1. sync-orchestrator → leagues / teams / matches (multi-source priority)
// 2. calculate-statistics → statistics_cache (goals/cards/corners/result)
// Triggered by pg_cron every 2 hours.

export const Route = createFileRoute("/api/public/hooks/refresh-data")({
  server: {
    handlers: {
      POST: async () => {
        const url = process.env.SUPABASE_URL!;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        if (!url || !key) {
          return new Response(
            JSON.stringify({ error: "missing server env" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        const invoke = async (fn: string, body: unknown) => {
          const res = await fetch(`${url}/functions/v1/${fn}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${key}`,
              apikey: key,
            },
            body: JSON.stringify(body),
          });
          const txt = await res.text();
          let parsed: unknown = txt;
          try { parsed = JSON.parse(txt); } catch { /* keep text */ }
          return { ok: res.ok, status: res.status, body: parsed };
        };

        const started_at = new Date().toISOString();
        const orchestrator = await invoke("sync-orchestrator", {});
        const upcoming = await invoke("sync-upcoming-fixtures", {});
        const stats = await invoke("calculate-statistics", {});

        // Retention: purge matches older than Jan 1 of (current year - 2)
        let purge: unknown = null;
        try {
          const res = await fetch(`${url}/rest/v1/rpc/purge_old_matches`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${key}`,
              apikey: key,
            },
            body: "{}",
          });
          purge = await res.json();
        } catch (e) { purge = { error: String(e) }; }

        return new Response(
          JSON.stringify({ started_at, orchestrator, upcoming, stats, purge }),
          {
            status: orchestrator.ok && stats.ok ? 200 : 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    },
  },
});
