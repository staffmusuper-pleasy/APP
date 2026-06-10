
-- Season guard log table
CREATE TABLE IF NOT EXISTS public.season_guard_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL CHECK (action IN ('rerouted','blocked')),
  source text,
  original_league_id uuid,
  resolved_league_id uuid,
  declared_season text,
  match_year int,
  match_date timestamptz,
  home_team_id uuid,
  away_team_id uuid,
  reason text
);

GRANT SELECT ON public.season_guard_log TO authenticated;
GRANT ALL ON public.season_guard_log TO service_role;
ALTER TABLE public.season_guard_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read season guard log" ON public.season_guard_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "service all season guard log" ON public.season_guard_log FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_season_guard_log_occurred ON public.season_guard_log(occurred_at DESC);

-- Helpers ----------------------------------------------------------------

-- Extract the set of calendar years a season string covers.
-- "2025-26" / "2025/2026" -> {2025,2026}; "2026" -> {2026}.
CREATE OR REPLACE FUNCTION public.season_year_set(_season text)
RETURNS int[]
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  m text[];
  y1 int;
  y2 int;
BEGIN
  IF _season IS NULL OR btrim(_season) = '' THEN RETURN NULL; END IF;
  -- pattern: 4-digit / 2-or-4-digit
  m := regexp_match(_season, '(\d{4})\s*[-/]\s*(\d{2,4})');
  IF m IS NOT NULL THEN
    y1 := m[1]::int;
    y2 := CASE WHEN length(m[2]) = 2 THEN (y1/100)*100 + m[2]::int ELSE m[2]::int END;
    IF y2 < y1 THEN y2 := y1 + 1; END IF;
    RETURN ARRAY[y1, y2];
  END IF;
  m := regexp_match(_season, '(\d{4})');
  IF m IS NOT NULL THEN RETURN ARRAY[m[1]::int]; END IF;
  RETURN NULL;
END; $$;

-- Resolve / create a league row that owns _match_year for the same name+country.
CREATE OR REPLACE FUNCTION public.resolve_league_for_year(_league_id uuid, _match_year int)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  l record;
  cand uuid;
  new_season text;
BEGIN
  SELECT id, name, country, season INTO l FROM public.leagues WHERE id = _league_id;
  IF l.id IS NULL THEN RETURN NULL; END IF;

  -- Already correct?
  IF _match_year = ANY(COALESCE(public.season_year_set(l.season), ARRAY[]::int[])) THEN
    RETURN l.id;
  END IF;

  -- Find a sibling league row with the same name+country whose season covers the year
  SELECT id INTO cand
  FROM public.leagues
  WHERE name = l.name AND country = l.country
    AND _match_year = ANY(COALESCE(public.season_year_set(season), ARRAY[]::int[]))
  ORDER BY created_at DESC
  LIMIT 1;
  IF cand IS NOT NULL THEN RETURN cand; END IF;

  -- Create a new season row for that year. Use single-year format.
  new_season := _match_year::text;
  INSERT INTO public.leagues(name, country, season, active)
  VALUES (l.name, l.country, new_season, true)
  RETURNING id INTO cand;
  RETURN cand;
END; $$;

-- BEFORE INSERT trigger on matches: reroute or block season-mismatched rows.
CREATE OR REPLACE FUNCTION public.matches_season_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  l record;
  ys int[];
  yr int;
  new_lid uuid;
BEGIN
  IF NEW.league_id IS NULL OR NEW.match_date IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, name, country, season INTO l FROM public.leagues WHERE id = NEW.league_id;
  IF l.id IS NULL THEN
    RETURN NEW; -- nothing to guard against
  END IF;

  yr := EXTRACT(year FROM NEW.match_date)::int;
  ys := public.season_year_set(COALESCE(NEW.season, l.season));

  -- If declared/league season is unparseable, accept but log
  IF ys IS NULL THEN
    RETURN NEW;
  END IF;

  IF yr = ANY(ys) THEN
    RETURN NEW; -- ok
  END IF;

  -- Attempt reroute
  new_lid := public.resolve_league_for_year(NEW.league_id, yr);

  IF new_lid IS NOT NULL AND new_lid <> NEW.league_id THEN
    INSERT INTO public.season_guard_log(action, source, original_league_id, resolved_league_id,
      declared_season, match_year, match_date, home_team_id, away_team_id, reason)
    VALUES ('rerouted', NEW.source, NEW.league_id, new_lid,
      COALESCE(NEW.season, l.season), yr, NEW.match_date, NEW.home_team_id, NEW.away_team_id,
      'match_date year not in declared season');
    NEW.league_id := new_lid;
    -- Sync the season column to the target league
    SELECT season INTO NEW.season FROM public.leagues WHERE id = new_lid;
    RETURN NEW;
  END IF;

  -- Block
  INSERT INTO public.season_guard_log(action, source, original_league_id, resolved_league_id,
    declared_season, match_year, match_date, home_team_id, away_team_id, reason)
  VALUES ('blocked', NEW.source, NEW.league_id, NULL,
    COALESCE(NEW.season, l.season), yr, NEW.match_date, NEW.home_team_id, NEW.away_team_id,
    'no league row covers match year and reroute failed');
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_matches_season_guard ON public.matches;
CREATE TRIGGER trg_matches_season_guard
BEFORE INSERT ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.matches_season_guard();
