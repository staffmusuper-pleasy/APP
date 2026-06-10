import { createServerFn } from "@tanstack/react-start";

export type ApiQuota = {
  name: string;
  limit: number | null;
  used: number | null;
  remaining: number | null;
  period: string | null;
  error: string | null;
};

export const getApiQuotas = createServerFn({ method: "GET" }).handler(async (): Promise<ApiQuota[]> => {
  const out: ApiQuota[] = [];

  // API-Football /status
  const afKey = process.env.API_FOOTBALL_KEY;
  if (!afKey) {
    out.push({ name: "API-Football", limit: null, used: null, remaining: null, period: null, error: "API_FOOTBALL_KEY missing" });
  } else {
    try {
      const r = await fetch("https://v3.football.api-sports.io/status", {
        headers: { "x-apisports-key": afKey },
      });
      const j = await r.json();
      const req = j?.response?.requests;
      out.push({
        name: "API-Football",
        limit: req?.limit_day ?? null,
        used: req?.current ?? null,
        remaining: req?.limit_day != null && req?.current != null ? req.limit_day - req.current : null,
        period: "day",
        error: null,
      });
    } catch (e) {
      out.push({ name: "API-Football", limit: null, used: null, remaining: null, period: null, error: String(e) });
    }
  }

  // ScraperAPI /account
  const scKey = process.env.SCRAPERAPI_KEY;
  if (!scKey) {
    out.push({ name: "ScraperAPI", limit: null, used: null, remaining: null, period: null, error: "SCRAPERAPI_KEY missing" });
  } else {
    try {
      const r = await fetch(`https://api.scraperapi.com/account?api_key=${scKey}`);
      const j = await r.json();
      const limit = Number(j?.requestLimit ?? 0);
      const used = Number(j?.requestCount ?? 0);
      out.push({
        name: "ScraperAPI",
        limit: limit || null,
        used,
        remaining: limit ? Math.max(0, limit - used) : null,
        period: "month",
        error: null,
      });
    } catch (e) {
      out.push({ name: "ScraperAPI", limit: null, used: null, remaining: null, period: null, error: String(e) });
    }
  }

  return out;
});
