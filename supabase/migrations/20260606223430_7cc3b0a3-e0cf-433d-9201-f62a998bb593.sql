
-- Aggregated source status from sync_jobs
CREATE OR REPLACE FUNCTION public.get_source_status()
RETURNS TABLE(
  source text,
  total_runs bigint,
  last_run timestamptz,
  last_status text,
  records_imported bigint,
  failed_runs bigint,
  last_error text
)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH parsed AS (
    SELECT
      split_part(job_name, ':', 1) AS source,
      status::text AS status,
      processed_records,
      error_message,
      finished_at,
      created_at,
      ROW_NUMBER() OVER (PARTITION BY split_part(job_name, ':', 1) ORDER BY created_at DESC) AS rn,
      ROW_NUMBER() OVER (PARTITION BY split_part(job_name, ':', 1) ORDER BY CASE WHEN error_message IS NOT NULL THEN created_at END DESC NULLS LAST) AS rn_err
    FROM public.sync_jobs
  )
  SELECT
    p.source,
    COUNT(*)::bigint AS total_runs,
    MAX(p.created_at) AS last_run,
    MAX(p.status) FILTER (WHERE p.rn = 1) AS last_status,
    COALESCE(SUM(p.processed_records), 0)::bigint AS records_imported,
    COUNT(*) FILTER (WHERE p.error_message IS NOT NULL)::bigint AS failed_runs,
    MAX(p.error_message) FILTER (WHERE p.rn_err = 1) AS last_error
  FROM parsed p
  GROUP BY p.source
  ORDER BY last_run DESC NULLS LAST;
$$;

-- Per-competition pipeline diagnostics
CREATE OR REPLACE FUNCTION public.get_pipeline_diagnostics()
RETURNS TABLE(
  league_id uuid,
  league text,
  country text,
  season text,
  sources text,
  total_matches bigint,
  finished_matches bigint,
  upcoming_matches bigint,
  hidden_missing_stats bigint,
  hidden_missing_teams bigint,
  displayed_matches bigint,
  statistics_coverage_pct numeric,
  last_sync timestamptz,
  last_error text
)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH m AS (
    SELECT l.id AS league_id, l.name AS league, l.country, l.season,
           m.id AS match_id, m.status::text AS status, m.match_date,
           m.home_team_id, m.away_team_id
    FROM public.leagues l
    LEFT JOIN public.matches m ON m.league_id = l.id
  ),
  agg AS (
    SELECT
      league_id, league, country, season,
      COUNT(match_id) AS total_matches,
      COUNT(*) FILTER (WHERE status = 'finished') AS finished_matches,
      COUNT(*) FILTER (WHERE status = 'scheduled' AND match_date >= now()) AS upcoming_matches,
      COUNT(*) FILTER (
        WHERE status = 'scheduled' AND match_date >= now()
          AND (home_team_id IS NULL OR away_team_id IS NULL)
      ) AS hidden_missing_teams,
      COUNT(*) FILTER (
        WHERE status = 'scheduled' AND match_date >= now()
          AND home_team_id IS NOT NULL AND away_team_id IS NOT NULL
          AND (
            NOT EXISTS (SELECT 1 FROM public.statistics_cache sc WHERE sc.team_id = home_team_id AND sc.sample_size = 10)
            OR NOT EXISTS (SELECT 1 FROM public.statistics_cache sc WHERE sc.team_id = away_team_id AND sc.sample_size = 10)
          )
      ) AS hidden_missing_stats
    FROM m
    GROUP BY league_id, league, country, season
  ),
  srcs AS (
    SELECT league_name, country,
           string_agg(source || CASE WHEN enabled THEN '' ELSE '(off)' END, ', ' ORDER BY priority) AS sources
    FROM public.league_sources
    GROUP BY league_name, country
  ),
  jobs AS (
    SELECT split_part(job_name, ':', 2) AS league_name,
           MAX(created_at) AS last_sync,
           MAX(error_message) FILTER (WHERE error_message IS NOT NULL) AS last_error
    FROM public.sync_jobs
    GROUP BY split_part(job_name, ':', 2)
  )
  SELECT
    a.league_id, a.league, a.country, a.season,
    COALESCE(s.sources, '—') AS sources,
    a.total_matches, a.finished_matches, a.upcoming_matches,
    a.hidden_missing_stats, a.hidden_missing_teams,
    GREATEST(a.upcoming_matches - a.hidden_missing_teams, 0) AS displayed_matches,
    CASE WHEN a.upcoming_matches = 0 THEN 0
         ELSE ROUND(100.0 * (a.upcoming_matches - a.hidden_missing_stats) / a.upcoming_matches, 2)
    END AS statistics_coverage_pct,
    j.last_sync,
    j.last_error
  FROM agg a
  LEFT JOIN srcs s ON s.league_name = a.league AND s.country = a.country
  LEFT JOIN jobs j ON j.league_name = a.league
  ORDER BY a.upcoming_matches DESC, a.total_matches DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_source_status() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pipeline_diagnostics() TO anon, authenticated, service_role;
