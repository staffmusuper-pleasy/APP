
-- Drop and recreate to add competition fields
CREATE OR REPLACE VIEW public.team_upcoming_matches AS
SELECT
  m.id,
  m.match_date,
  m.season,
  m.round,
  m.status,
  -- competition = the actual league the match is being played in
  m.league_id AS competition_id,
  l.name      AS competition_name,
  l.country   AS competition_country,
  -- home team + its registered league
  m.home_team_id,
  ht.name      AS home_team_name,
  ht.league_id AS home_league_id,
  hl.name      AS home_league_name,
  hl.country   AS home_league_country,
  -- away team + its registered league
  m.away_team_id,
  at.name      AS away_team_name,
  at.league_id AS away_league_id,
  al.name      AS away_league_name,
  al.country   AS away_league_country
FROM public.matches m
JOIN public.leagues l ON l.id = m.league_id
JOIN public.teams   ht ON ht.id = m.home_team_id
JOIN public.teams   at ON at.id = m.away_team_id
LEFT JOIN public.leagues hl ON hl.id = ht.league_id
LEFT JOIN public.leagues al ON al.id = at.league_id
WHERE m.status = 'scheduled'::match_status
  AND m.match_date >= now();

GRANT SELECT ON public.team_upcoming_matches TO anon, authenticated, service_role;

-- Get upcoming matches involving teams that belong to any of the supplied home leagues.
-- Pass NULL or empty array for "all leagues".
CREATE OR REPLACE FUNCTION public.get_upcoming_for_leagues(
  _league_ids uuid[] DEFAULT NULL,
  _limit int DEFAULT 100
)
RETURNS SETOF public.team_upcoming_matches
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT * FROM public.team_upcoming_matches
  WHERE _league_ids IS NULL
     OR array_length(_league_ids, 1) IS NULL
     OR home_league_id = ANY(_league_ids)
     OR away_league_id = ANY(_league_ids)
  ORDER BY match_date ASC
  LIMIT GREATEST(_limit, 1);
$$;

-- Top defeats: for each upcoming match, pick the side with highest historical loss_pct,
-- read from statistics_cache where category='result' and market='loss'.
CREATE OR REPLACE FUNCTION public.get_top_defeats(
  _sample_size int DEFAULT 10,
  _hours int DEFAULT 48,
  _limit int DEFAULT 100,
  _league_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
  match_id uuid,
  competition_id uuid,
  competition_name text,
  competition_country text,
  match_date timestamptz,
  home_team_id uuid,
  home_team_name text,
  away_team_id uuid,
  away_team_name text,
  home_loss_pct numeric,
  away_loss_pct numeric,
  predicted_loser text,
  predicted_loser_team_name text,
  loss_pct numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH upcoming AS (
  SELECT * FROM public.team_upcoming_matches
  WHERE match_date <= now() + make_interval(hours => _hours)
    AND ( _league_ids IS NULL
          OR array_length(_league_ids, 1) IS NULL
          OR home_league_id = ANY(_league_ids)
          OR away_league_id = ANY(_league_ids) )
),
joined AS (
  SELECT
    u.id AS match_id, u.competition_id, u.competition_name, u.competition_country, u.match_date,
    u.home_team_id, u.home_team_name, u.away_team_id, u.away_team_name,
    NULLIF((hc.statistics ->> 'loss'), '')::numeric AS home_loss_pct,
    NULLIF((ac.statistics ->> 'loss'), '')::numeric AS away_loss_pct
  FROM upcoming u
  LEFT JOIN public.statistics_cache hc
    ON hc.team_id = u.home_team_id AND hc.category = 'result' AND hc.sample_size = _sample_size
  LEFT JOIN public.statistics_cache ac
    ON ac.team_id = u.away_team_id AND ac.category = 'result' AND ac.sample_size = _sample_size
)
SELECT
  match_id, competition_id, competition_name, competition_country, match_date,
  home_team_id, home_team_name, away_team_id, away_team_name,
  home_loss_pct, away_loss_pct,
  CASE WHEN COALESCE(home_loss_pct,0) >= COALESCE(away_loss_pct,0) THEN 'home' ELSE 'away' END AS predicted_loser,
  CASE WHEN COALESCE(home_loss_pct,0) >= COALESCE(away_loss_pct,0) THEN home_team_name ELSE away_team_name END AS predicted_loser_team_name,
  GREATEST(COALESCE(home_loss_pct,0), COALESCE(away_loss_pct,0)) AS loss_pct
FROM joined
WHERE home_loss_pct IS NOT NULL OR away_loss_pct IS NOT NULL
ORDER BY loss_pct DESC, match_date ASC
LIMIT _limit;
$$;

-- Top picks scoped to teams from selected home leagues. Mirrors get_top_picks
-- but uses team_upcoming_matches so cross-competition fixtures are included.
CREATE OR REPLACE FUNCTION public.get_top_picks_for_leagues(
  _sample_size int DEFAULT 10,
  _hours int DEFAULT 48,
  _limit int DEFAULT 100,
  _league_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
  match_id uuid,
  competition_id uuid,
  competition_name text,
  competition_country text,
  match_date timestamptz,
  home_team_id uuid,
  home_team_name text,
  away_team_id uuid,
  away_team_name text,
  category stat_category,
  market text,
  home_pct numeric,
  away_pct numeric,
  combined_avg numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH upcoming AS (
  SELECT * FROM public.team_upcoming_matches
  WHERE match_date <= now() + make_interval(hours => _hours)
    AND ( _league_ids IS NULL
          OR array_length(_league_ids, 1) IS NULL
          OR home_league_id = ANY(_league_ids)
          OR away_league_id = ANY(_league_ids) )
),
candidates AS (
  SELECT u.id AS match_id, u.competition_id, u.competition_name, u.competition_country, u.match_date,
         u.home_team_id, u.home_team_name, u.away_team_id, u.away_team_name,
         hc.category, m.key AS market,
         NULLIF((hc.statistics ->> m.key), '')::numeric AS home_pct,
         NULLIF((ac.statistics ->> m.key), '')::numeric AS away_pct
  FROM upcoming u
  JOIN public.statistics_cache hc
    ON hc.team_id = u.home_team_id AND hc.sample_size = _sample_size AND hc.category <> 'result'
  JOIN public.statistics_cache ac
    ON ac.team_id = u.away_team_id AND ac.sample_size = _sample_size AND ac.category = hc.category
  CROSS JOIN LATERAL jsonb_object_keys(hc.statistics) AS m(key)
  WHERE ac.statistics ? m.key
    AND m.key <> 'matches_used'
),
scored AS (
  SELECT *, ROUND((COALESCE(home_pct,0) + COALESCE(away_pct,0))/2.0, 2) AS combined_avg
  FROM candidates
  WHERE home_pct IS NOT NULL AND away_pct IS NOT NULL
),
ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY match_id ORDER BY combined_avg DESC) AS rn
  FROM scored
)
SELECT match_id, competition_id, competition_name, competition_country, match_date,
       home_team_id, home_team_name, away_team_id, away_team_name,
       category, market, home_pct, away_pct, combined_avg
FROM ranked WHERE rn = 1
ORDER BY combined_avg DESC
LIMIT _limit;
$$;
