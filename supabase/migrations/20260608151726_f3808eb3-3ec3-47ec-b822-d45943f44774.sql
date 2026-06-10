
-- ============================================================
-- 1. Venue dimension on statistics_cache
-- ============================================================
ALTER TABLE public.statistics_cache
  ADD COLUMN IF NOT EXISTS venue text NOT NULL DEFAULT 'overall';

-- enforce allowed values
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'statistics_cache_venue_check'
  ) THEN
    ALTER TABLE public.statistics_cache
      ADD CONSTRAINT statistics_cache_venue_check
      CHECK (venue IN ('overall','home','away'));
  END IF;
END $$;

-- Replace old unique key with one that includes venue
ALTER TABLE public.statistics_cache
  DROP CONSTRAINT IF EXISTS statistics_cache_team_id_league_id_category_sample_size_key;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'statistics_cache_team_league_cat_size_venue_key'
  ) THEN
    ALTER TABLE public.statistics_cache
      ADD CONSTRAINT statistics_cache_team_league_cat_size_venue_key
      UNIQUE (team_id, league_id, category, sample_size, venue);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stats_cache_lookup_venue
  ON public.statistics_cache (team_id, league_id, category, sample_size, venue);

-- ============================================================
-- 2. Helper: is_national_team_competition(country)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_national_team_competition(_country text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT lower(coalesce(_country,'')) IN
    ('international','world','europe','south america','north america','africa','asia','oceania');
$$;

-- ============================================================
-- 3. Rewrite get_top_picks_for_leagues with venue split + sample gate
--    - Home team contributes its venue='home' stats (fallback to overall)
--    - Away team contributes its venue='away' stats (fallback to overall)
--    - Hide rows where either team's matches_used < _min_matches_used
--    - For national-team competitions the effective sample size is bumped to 20
-- ============================================================
DROP FUNCTION IF EXISTS public.get_top_picks_for_leagues(integer, integer, integer, uuid[]);
DROP FUNCTION IF EXISTS public.get_top_picks_for_leagues(integer, integer, integer, uuid[], integer);

CREATE OR REPLACE FUNCTION public.get_top_picks_for_leagues(
  _sample_size integer DEFAULT 10,
  _hours integer DEFAULT NULL,
  _limit integer DEFAULT NULL,
  _league_ids uuid[] DEFAULT NULL,
  _min_matches_used integer DEFAULT 8
)
RETURNS TABLE(
  match_id uuid, competition_id uuid, competition_name text, competition_country text,
  match_date timestamptz, home_team_id uuid, home_team_name text,
  away_team_id uuid, away_team_name text,
  category stat_category, market text,
  home_pct numeric, away_pct numeric, combined_avg numeric,
  home_matches_used integer, away_matches_used integer
)
LANGUAGE sql STABLE SET search_path = public AS $$
WITH upcoming AS (
  SELECT *,
    public.is_national_team_competition(competition_country) AS is_national,
    -- Bump sample to 20 for national-team comps if caller passed default 10
    CASE WHEN public.is_national_team_competition(competition_country) AND _sample_size = 10
         THEN 20 ELSE _sample_size END AS effective_size
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
    ('btts'::stat_category, 'yes'), ('btts'::stat_category, 'no'),
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
  SELECT
    u.id AS match_id, u.competition_id, u.competition_name, u.competition_country, u.match_date,
    u.home_team_id, u.home_team_name, u.away_team_id, u.away_team_name,
    m.category, m.market, u.effective_size,
    -- Home team: prefer venue='home', fallback to overall
    COALESCE(
      NULLIF((h_home.statistics ->> m.market), '')::numeric,
      NULLIF((h_over.statistics ->> m.market), '')::numeric
    ) AS home_pct,
    COALESCE(
      NULLIF((h_home.statistics ->> 'matches_used'),'')::int,
      NULLIF((h_over.statistics ->> 'matches_used'),'')::int
    ) AS home_used,
    -- Away team: prefer venue='away', fallback to overall
    COALESCE(
      NULLIF((a_away.statistics ->> m.market), '')::numeric,
      NULLIF((a_over.statistics ->> m.market), '')::numeric
    ) AS away_pct,
    COALESCE(
      NULLIF((a_away.statistics ->> 'matches_used'),'')::int,
      NULLIF((a_over.statistics ->> 'matches_used'),'')::int
    ) AS away_used
  FROM upcoming u
  CROSS JOIN markets m
  LEFT JOIN public.statistics_cache h_home
    ON h_home.team_id = u.home_team_id AND h_home.category = m.category
   AND h_home.sample_size = u.effective_size AND h_home.venue = 'home'
   AND (h_home.league_id = u.competition_id OR h_home.league_id = u.home_league_id)
  LEFT JOIN public.statistics_cache h_over
    ON h_over.team_id = u.home_team_id AND h_over.category = m.category
   AND h_over.sample_size = u.effective_size AND h_over.venue = 'overall'
  LEFT JOIN public.statistics_cache a_away
    ON a_away.team_id = u.away_team_id AND a_away.category = m.category
   AND a_away.sample_size = u.effective_size AND a_away.venue = 'away'
   AND (a_away.league_id = u.competition_id OR a_away.league_id = u.away_league_id)
  LEFT JOIN public.statistics_cache a_over
    ON a_over.team_id = u.away_team_id AND a_over.category = m.category
   AND a_over.sample_size = u.effective_size AND a_over.venue = 'overall'
), gated AS (
  -- Hide rows where either side has insufficient sample
  SELECT * FROM candidates
  WHERE (home_used IS NULL OR home_used >= _min_matches_used)
    AND (away_used IS NULL OR away_used >= _min_matches_used)
    AND NOT (home_used IS NULL AND away_used IS NULL)
), scored AS (
  SELECT *,
    CASE
      WHEN home_pct IS NULL AND away_pct IS NULL THEN NULL
      ELSE ROUND((COALESCE(home_pct,0) + COALESCE(away_pct,0)) /
                 NULLIF((CASE WHEN home_pct IS NULL THEN 0 ELSE 1 END) +
                        (CASE WHEN away_pct IS NULL THEN 0 ELSE 1 END), 0), 2)
    END AS combined_avg
  FROM gated
), ranked AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY match_id
    ORDER BY combined_avg DESC NULLS LAST, category, market
  ) AS rn
  FROM scored
)
SELECT match_id, competition_id, competition_name, competition_country, match_date,
       home_team_id, home_team_name, away_team_id, away_team_name,
       category, market, home_pct, away_pct, combined_avg,
       home_used AS home_matches_used, away_used AS away_matches_used
FROM ranked
WHERE rn = 1
ORDER BY combined_avg DESC NULLS LAST, match_date ASC
LIMIT _limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_top_picks_for_leagues(integer,integer,integer,uuid[],integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_national_team_competition(text) TO anon, authenticated, service_role;
