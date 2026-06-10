
CREATE OR REPLACE FUNCTION public.get_top_picks_for_leagues(_sample_size integer DEFAULT 10, _hours integer DEFAULT NULL::integer, _limit integer DEFAULT NULL::integer, _league_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(match_id uuid, competition_id uuid, competition_name text, competition_country text, match_date timestamp with time zone, home_team_id uuid, home_team_name text, away_team_id uuid, away_team_name text, category stat_category, market text, home_pct numeric, away_pct numeric, combined_avg numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH upcoming AS (
  SELECT *
  FROM public.team_upcoming_matches
  WHERE (_hours IS NULL OR match_date <= now() + make_interval(hours => _hours))
    AND ( _league_ids IS NULL
          OR array_length(_league_ids, 1) IS NULL
          OR competition_id = ANY(_league_ids)
          OR home_league_id = ANY(_league_ids)
          OR away_league_id = ANY(_league_ids) )
), markets AS (
  SELECT * FROM (VALUES
    -- Goals: exclude trivial over_0_5
    ('goals'::stat_category, 'under_0_5'),
    ('goals'::stat_category, 'over_1_5'), ('goals'::stat_category, 'under_1_5'),
    ('goals'::stat_category, 'over_2_5'), ('goals'::stat_category, 'under_2_5'),
    ('goals'::stat_category, 'over_3_5'), ('goals'::stat_category, 'under_3_5'),
    ('goals'::stat_category, 'over_4_5'), ('goals'::stat_category, 'under_4_5'),
    -- Cards: exclude trivial over_0_5 / over_1_5
    ('cards'::stat_category, 'over_2_5'), ('cards'::stat_category, 'under_2_5'),
    ('cards'::stat_category, 'over_3_5'), ('cards'::stat_category, 'under_3_5'),
    ('cards'::stat_category, 'over_4_5'), ('cards'::stat_category, 'under_4_5'),
    ('cards'::stat_category, 'over_5_5'), ('cards'::stat_category, 'under_5_5'),
    ('cards'::stat_category, 'over_6_5'), ('cards'::stat_category, 'under_6_5'),
    -- Corners: exclude trivial over_5_5
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
