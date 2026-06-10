CREATE OR REPLACE FUNCTION public.get_top_picks_for_leagues(_sample_size integer DEFAULT 10, _hours integer DEFAULT NULL::integer, _limit integer DEFAULT NULL::integer, _league_ids uuid[] DEFAULT NULL::uuid[])
RETURNS TABLE(match_id uuid, competition_id uuid, competition_name text, competition_country text, match_date timestamptz, home_team_id uuid, home_team_name text, away_team_id uuid, away_team_name text, category stat_category, market text, home_pct numeric, away_pct numeric, combined_avg numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
WITH upcoming AS (
  SELECT *
  FROM public.team_upcoming_matches
  WHERE match_date >= now()
    AND (_hours IS NULL OR match_date <= now() + make_interval(hours => _hours))
    AND ( _league_ids IS NULL
          OR array_length(_league_ids, 1) IS NULL
          OR competition_id = ANY(_league_ids)
          OR home_league_id = ANY(_league_ids)
          OR away_league_id = ANY(_league_ids) )
), markets AS (
  SELECT * FROM (VALUES
    ('goals'::stat_category, 'under_0_5'),
    ('goals'::stat_category, 'over_1_5'), ('goals'::stat_category, 'under_1_5'),
    ('goals'::stat_category, 'over_2_5'), ('goals'::stat_category, 'under_2_5'),
    ('goals'::stat_category, 'over_3_5'), ('goals'::stat_category, 'under_3_5'),
    ('goals'::stat_category, 'over_4_5'), ('goals'::stat_category, 'under_4_5'),
    ('cards'::stat_category, 'over_2_5'), ('cards'::stat_category, 'under_2_5'),
    ('cards'::stat_category, 'over_3_5'), ('cards'::stat_category, 'under_3_5'),
    ('cards'::stat_category, 'over_4_5'), ('cards'::stat_category, 'under_4_5'),
    ('cards'::stat_category, 'over_5_5'), ('cards'::stat_category, 'under_5_5'),
    ('cards'::stat_category, 'over_6_5'), ('cards'::stat_category, 'under_6_5'),
    ('corners'::stat_category, 'under_5_5'),
    ('corners'::stat_category, 'over_6_5'), ('corners'::stat_category, 'under_6_5'),
    ('corners'::stat_category, 'over_7_5'), ('corners'::stat_category, 'under_7_5'),
    ('corners'::stat_category, 'over_8_5'), ('corners'::stat_category, 'under_8_5'),
    ('corners'::stat_category, 'over_9_5'), ('corners'::stat_category, 'under_9_5'),
    ('corners'::stat_category, 'over_10_5'), ('corners'::stat_category, 'under_10_5'),
    ('corners'::stat_category, 'over_11_5'), ('corners'::stat_category, 'under_11_5')
  ) AS v(category, market)
), candidates AS (
  SELECT u.id AS match_id, u.competition_id, u.competition_name, u.competition_country, u.match_date,
         u.home_team_id, u.home_team_name, u.away_team_id, u.away_team_name,
         m.category, m.market,
         COALESCE(
           NULLIF((hc_exact.statistics ->> m.market), '')::numeric,
           NULLIF((hc_any.statistics ->> m.market), '')::numeric
         ) AS home_pct,
         COALESCE(
           NULLIF((ac_exact.statistics ->> m.market), '')::numeric,
           NULLIF((ac_any.statistics ->> m.market), '')::numeric
         ) AS away_pct
  FROM upcoming u
  CROSS JOIN markets m
  LEFT JOIN public.statistics_cache hc_exact
    ON hc_exact.league_id = u.competition_id AND hc_exact.team_id = u.home_team_id
   AND hc_exact.sample_size = _sample_size AND hc_exact.category = m.category
  LEFT JOIN public.statistics_cache ac_exact
    ON ac_exact.league_id = u.competition_id AND ac_exact.team_id = u.away_team_id
   AND ac_exact.sample_size = _sample_size AND ac_exact.category = m.category
  LEFT JOIN LATERAL (
    SELECT statistics FROM public.statistics_cache s
    WHERE s.team_id = u.home_team_id AND s.sample_size = _sample_size AND s.category = m.category
    ORDER BY CASE WHEN s.league_id = u.home_league_id THEN 0 ELSE 1 END, s.updated_at DESC
    LIMIT 1
  ) hc_any ON TRUE
  LEFT JOIN LATERAL (
    SELECT statistics FROM public.statistics_cache s
    WHERE s.team_id = u.away_team_id AND s.sample_size = _sample_size AND s.category = m.category
    ORDER BY CASE WHEN s.league_id = u.away_league_id THEN 0 ELSE 1 END, s.updated_at DESC
    LIMIT 1
  ) ac_any ON TRUE
), scored AS (
  SELECT *,
         CASE
           WHEN home_pct IS NULL AND away_pct IS NULL THEN NULL
           ELSE ROUND((COALESCE(home_pct,0) + COALESCE(away_pct,0)) /
                      NULLIF((CASE WHEN home_pct IS NULL THEN 0 ELSE 1 END) +
                             (CASE WHEN away_pct IS NULL THEN 0 ELSE 1 END), 0), 2)
         END AS combined_avg
  FROM candidates
), ranked AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY match_id
    ORDER BY combined_avg DESC NULLS LAST, category, market
  ) AS rn
  FROM scored
)
SELECT match_id, competition_id, competition_name, competition_country, match_date,
       home_team_id, home_team_name, away_team_id, away_team_name,
       category, market, home_pct, away_pct, combined_avg
FROM ranked
WHERE rn = 1
ORDER BY combined_avg DESC NULLS LAST, match_date ASC
LIMIT _limit;
$function$;

GRANT EXECUTE ON FUNCTION public.get_top_picks_for_leagues(integer, integer, integer, uuid[]) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_pipeline_diagnostics();

CREATE OR REPLACE FUNCTION public.get_pipeline_diagnostics()
RETURNS TABLE(
  league_id uuid,
  league text,
  country text,
  season text,
  sources text,
  source_used text,
  fixtures_imported bigint,
  total_matches bigint,
  finished_matches bigint,
  upcoming_matches bigint,
  hidden_missing_stats bigint,
  hidden_missing_teams bigint,
  displayed_matches bigint,
  statistics_coverage_pct numeric,
  hidden_reason text,
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
           string_agg(source || CASE WHEN enabled THEN '' ELSE '(off)' END, ', ' ORDER BY priority) AS sources,
           (array_agg(source ORDER BY priority) FILTER (WHERE enabled AND source <> 'worldfootballr'))[1] AS preferred_fixture_source
    FROM public.league_sources
    GROUP BY league_name, country
  ),
  parsed_jobs AS (
    SELECT split_part(job_name, ':', 1) AS source,
           split_part(job_name, ':', 2) AS league_name,
           status::text AS status,
           processed_records,
           error_message,
           created_at
    FROM public.sync_jobs
  ),
  jobs AS (
    SELECT league_name,
           MAX(created_at) AS last_sync,
           MAX(error_message) FILTER (WHERE error_message IS NOT NULL) AS last_error,
           COALESCE(SUM(processed_records) FILTER (WHERE status = 'success'), 0)::bigint AS fixtures_imported,
           (array_agg(source ORDER BY CASE WHEN status = 'success' AND processed_records > 0 THEN 0 ELSE 1 END, created_at DESC))[1] AS source_used
    FROM parsed_jobs
    WHERE source IN ('openfootball', 'api-football', 'sync-upcoming-fixtures', 'scraper')
    GROUP BY league_name
  )
  SELECT
    a.league_id, a.league, a.country, a.season,
    COALESCE(s.sources, '—') AS sources,
    COALESCE(j.source_used, s.preferred_fixture_source, '—') AS source_used,
    COALESCE(j.fixtures_imported, a.total_matches, 0)::bigint AS fixtures_imported,
    a.total_matches, a.finished_matches, a.upcoming_matches,
    a.hidden_missing_stats, a.hidden_missing_teams,
    GREATEST(a.upcoming_matches - a.hidden_missing_teams, 0) AS displayed_matches,
    CASE WHEN a.upcoming_matches = 0 THEN 0
         ELSE ROUND(100.0 * (a.upcoming_matches - a.hidden_missing_stats) / a.upcoming_matches, 2)
    END AS statistics_coverage_pct,
    CASE
      WHEN a.total_matches = 0 AND j.last_error IS NOT NULL THEN 'source failure'
      WHEN a.total_matches = 0 THEN 'source failure or not imported'
      WHEN a.upcoming_matches = 0 THEN 'no future fixtures / date filter'
      WHEN a.hidden_missing_teams > 0 THEN 'missing teams'
      WHEN a.hidden_missing_stats > 0 THEN 'missing statistics'
      ELSE 'displayed'
    END AS hidden_reason,
    j.last_sync,
    j.last_error
  FROM agg a
  LEFT JOIN srcs s ON s.league_name = a.league AND s.country = a.country
  LEFT JOIN jobs j ON j.league_name = a.league OR j.league_name = a.country OR j.league_name = 'europe'
  ORDER BY a.upcoming_matches DESC, a.total_matches DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_pipeline_diagnostics() TO anon, authenticated, service_role;