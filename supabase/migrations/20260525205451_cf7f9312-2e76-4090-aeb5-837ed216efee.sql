
-- =========================================================
-- VIEWS
-- =========================================================

-- Upcoming matches with denormalized league and team names
CREATE OR REPLACE VIEW public.upcoming_matches AS
SELECT
  m.id,
  m.league_id,
  l.name      AS league_name,
  l.country   AS league_country,
  m.season,
  m.round,
  m.status,
  m.match_date,
  m.home_team_id,
  ht.name     AS home_team_name,
  m.away_team_id,
  at.name     AS away_team_name
FROM public.matches m
JOIN public.leagues l ON l.id = m.league_id
JOIN public.teams ht  ON ht.id = m.home_team_id
JOIN public.teams at  ON at.id = m.away_team_id
WHERE m.status IN ('scheduled', 'live')
  AND m.match_date >= now() - interval '3 hours';

-- Finished matches from each team's perspective (one row per team per match)
CREATE OR REPLACE VIEW public.recent_team_matches AS
SELECT
  m.id              AS match_id,
  m.league_id,
  m.season,
  m.match_date,
  m.home_team_id    AS team_id,
  TRUE              AS is_home,
  m.away_team_id    AS opponent_id,
  m.home_goals      AS team_goals,
  m.away_goals      AS opponent_goals,
  m.home_cards      AS team_cards,
  m.away_cards      AS opponent_cards,
  m.home_corners    AS team_corners,
  m.away_corners    AS opponent_corners,
  COALESCE(m.home_goals,   0) + COALESCE(m.away_goals,   0) AS total_goals,
  COALESCE(m.home_cards,   0) + COALESCE(m.away_cards,   0) AS total_cards,
  COALESCE(m.home_corners, 0) + COALESCE(m.away_corners, 0) AS total_corners
FROM public.matches m
WHERE m.status = 'finished'
UNION ALL
SELECT
  m.id,
  m.league_id,
  m.season,
  m.match_date,
  m.away_team_id,
  FALSE,
  m.home_team_id,
  m.away_goals,
  m.home_goals,
  m.away_cards,
  m.home_cards,
  m.away_corners,
  m.home_corners,
  COALESCE(m.home_goals,   0) + COALESCE(m.away_goals,   0),
  COALESCE(m.home_cards,   0) + COALESCE(m.away_cards,   0),
  COALESCE(m.home_corners, 0) + COALESCE(m.away_corners, 0)
FROM public.matches m
WHERE m.status = 'finished';

-- Helpful indexes for the views
CREATE INDEX IF NOT EXISTS idx_matches_status_date ON public.matches (status, match_date);
CREATE INDEX IF NOT EXISTS idx_matches_finished_date ON public.matches (match_date DESC) WHERE status = 'finished';

-- =========================================================
-- FUNCTIONS
-- =========================================================

-- Upcoming matches by league
CREATE OR REPLACE FUNCTION public.get_upcoming_matches_by_league(
  _league_id UUID,
  _limit INT DEFAULT 20
)
RETURNS SETOF public.upcoming_matches
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT *
  FROM public.upcoming_matches
  WHERE league_id = _league_id
  ORDER BY match_date ASC
  LIMIT GREATEST(_limit, 1);
$$;

-- Last N matches by team (N must be 10 or 20)
CREATE OR REPLACE FUNCTION public.get_last_team_matches(
  _team_id UUID,
  _sample_size INT DEFAULT 10
)
RETURNS TABLE (
  match_id UUID,
  league_id UUID,
  season TEXT,
  match_date TIMESTAMPTZ,
  is_home BOOLEAN,
  opponent_id UUID,
  opponent_name TEXT,
  team_goals INT,
  opponent_goals INT,
  team_cards INT,
  opponent_cards INT,
  team_corners INT,
  opponent_corners INT,
  total_goals INT,
  total_cards INT,
  total_corners INT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    r.match_id, r.league_id, r.season, r.match_date, r.is_home,
    r.opponent_id, o.name AS opponent_name,
    r.team_goals, r.opponent_goals,
    r.team_cards, r.opponent_cards,
    r.team_corners, r.opponent_corners,
    r.total_goals, r.total_cards, r.total_corners
  FROM public.recent_team_matches r
  JOIN public.teams o ON o.id = r.opponent_id
  WHERE r.team_id = _team_id
  ORDER BY r.match_date DESC
  LIMIT CASE WHEN _sample_size = 20 THEN 20 ELSE 10 END;
$$;

-- Single team market lookup from statistics_cache.
-- _market is the cache key, e.g. 'over_2_5', 'under_1_5'.
CREATE OR REPLACE FUNCTION public.get_team_market_stat(
  _league_id UUID,
  _team_id UUID,
  _category public.stat_category,
  _market TEXT,
  _sample_size INT
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT NULLIF((s.statistics ->> _market), '')::numeric
  FROM public.statistics_cache s
  WHERE s.league_id = _league_id
    AND s.team_id = _team_id
    AND s.category = _category
    AND s.sample_size = _sample_size
  LIMIT 1;
$$;

-- Matchup statistics: home stats, away stats, combined average for one market
CREATE OR REPLACE FUNCTION public.get_matchup_stats(
  _league_id UUID,
  _home_team_id UUID,
  _away_team_id UUID,
  _category public.stat_category,
  _market TEXT,
  _sample_size INT DEFAULT 10
)
RETURNS TABLE (
  league_id UUID,
  category public.stat_category,
  market TEXT,
  sample_size INT,
  home_team_id UUID,
  home_pct NUMERIC,
  home_sample JSONB,
  away_team_id UUID,
  away_pct NUMERIC,
  away_sample JSONB,
  combined_avg NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH h AS (
    SELECT statistics FROM public.statistics_cache
    WHERE league_id = _league_id AND team_id = _home_team_id
      AND category = _category AND sample_size = _sample_size
    LIMIT 1
  ),
  a AS (
    SELECT statistics FROM public.statistics_cache
    WHERE league_id = _league_id AND team_id = _away_team_id
      AND category = _category AND sample_size = _sample_size
    LIMIT 1
  )
  SELECT
    _league_id,
    _category,
    _market,
    _sample_size,
    _home_team_id,
    NULLIF((h.statistics ->> _market), '')::numeric AS home_pct,
    h.statistics                                    AS home_sample,
    _away_team_id,
    NULLIF((a.statistics ->> _market), '')::numeric AS away_pct,
    a.statistics                                    AS away_sample,
    ROUND(
      (
        COALESCE(NULLIF((h.statistics ->> _market), '')::numeric, 0) +
        COALESCE(NULLIF((a.statistics ->> _market), '')::numeric, 0)
      ) / NULLIF(
        (CASE WHEN h.statistics ? _market THEN 1 ELSE 0 END) +
        (CASE WHEN a.statistics ? _market THEN 1 ELSE 0 END), 0
      ), 2
    ) AS combined_avg
  FROM h FULL OUTER JOIN a ON TRUE;
$$;
