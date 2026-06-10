CREATE OR REPLACE FUNCTION public.get_top_defeats(_sample_size integer DEFAULT 10, _hours integer DEFAULT NULL::integer, _limit integer DEFAULT NULL::integer, _league_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(match_id uuid, competition_id uuid, competition_name text, competition_country text, match_date timestamp with time zone, home_team_id uuid, home_team_name text, away_team_id uuid, away_team_name text, home_loss_pct numeric, away_loss_pct numeric, predicted_loser text, predicted_loser_team_name text, loss_pct numeric)
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
), joined AS (
  SELECT
    u.id AS match_id, u.competition_id, u.competition_name, u.competition_country, u.match_date,
    u.home_team_id, u.home_team_name, u.away_team_id, u.away_team_name,
    NULLIF((hc.statistics ->> 'loss'), '')::numeric AS home_loss_pct,
    NULLIF((ac.statistics ->> 'loss'), '')::numeric AS away_loss_pct
  FROM upcoming u
  LEFT JOIN public.statistics_cache hc
    ON hc.team_id = u.home_team_id
   AND hc.category = 'result'
   AND hc.sample_size = _sample_size
   AND hc.venue = 'overall'
  LEFT JOIN public.statistics_cache ac
    ON ac.team_id = u.away_team_id
   AND ac.category = 'result'
   AND ac.sample_size = _sample_size
   AND ac.venue = 'overall'
)
SELECT
  match_id, competition_id, competition_name, competition_country, match_date,
  home_team_id, home_team_name, away_team_id, away_team_name,
  home_loss_pct, away_loss_pct,
  CASE
    WHEN COALESCE(home_loss_pct, -1) >= COALESCE(away_loss_pct, -1) THEN 'home'
    ELSE 'away'
  END AS predicted_loser,
  CASE
    WHEN COALESCE(home_loss_pct, -1) >= COALESCE(away_loss_pct, -1) THEN home_team_name
    ELSE away_team_name
  END AS predicted_loser_team_name,
  GREATEST(COALESCE(home_loss_pct, -1), COALESCE(away_loss_pct, -1)) AS loss_pct
FROM joined
WHERE home_loss_pct IS NOT NULL OR away_loss_pct IS NOT NULL
ORDER BY loss_pct DESC NULLS LAST, match_date ASC
LIMIT _limit;
$function$;