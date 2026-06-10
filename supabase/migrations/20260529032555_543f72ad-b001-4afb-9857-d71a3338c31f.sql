
-- 1. Normalization function for league names
CREATE OR REPLACE FUNCTION public.normalize_league_name(input text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE v text;
BEGIN
  IF input IS NULL THEN RETURN NULL; END IF;
  v := lower(trim(input));
  BEGIN v := unaccent(v); EXCEPTION WHEN undefined_function THEN NULL; END;
  v := regexp_replace(v, '\b(liga|league|championship|division|primera|premier|super|premiership|premiere|primeira)\b', '\1', 'g');
  v := regexp_replace(v, '[^a-z0-9 ]', '', 'g');
  v := regexp_replace(v, '\s+', ' ', 'g');
  RETURN trim(v);
END;$$;

-- 2. Columns on leagues
ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS normalized_name text,
  ADD COLUMN IF NOT EXISTS canonical_key text;

UPDATE public.leagues
SET normalized_name = public.normalize_league_name(name),
    canonical_key = public.normalize_league_name(name) || '|' || lower(country)
WHERE normalized_name IS NULL OR canonical_key IS NULL;

CREATE OR REPLACE FUNCTION public.leagues_set_normalized()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  NEW.normalized_name := public.normalize_league_name(NEW.name);
  NEW.canonical_key   := NEW.normalized_name || '|' || lower(NEW.country);
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS leagues_set_normalized_trg ON public.leagues;
CREATE TRIGGER leagues_set_normalized_trg
  BEFORE INSERT OR UPDATE OF name, country ON public.leagues
  FOR EACH ROW EXECUTE FUNCTION public.leagues_set_normalized();

CREATE INDEX IF NOT EXISTS leagues_canonical_idx ON public.leagues(canonical_key, season);

-- 3. league_aliases table
CREATE TABLE IF NOT EXISTS public.league_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (normalized_alias, source)
);

GRANT SELECT ON public.league_aliases TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.league_aliases TO authenticated;
GRANT ALL ON public.league_aliases TO service_role;

ALTER TABLE public.league_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "League aliases readable" ON public.league_aliases FOR SELECT USING (true);
CREATE POLICY "Auth manage league aliases" ON public.league_aliases FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS league_aliases_league_idx ON public.league_aliases(league_id);

-- 4. Resolver: find league_id by alias / canonical / fuzzy
CREATE OR REPLACE FUNCTION public.resolve_league(_name text, _country text, _season text, _source text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE
  norm text := public.normalize_league_name(_name);
  ck text := norm || '|' || lower(_country);
  found uuid;
BEGIN
  -- alias hit
  SELECT league_id INTO found FROM public.league_aliases
   WHERE normalized_alias = norm AND (_source IS NULL OR source = _source) LIMIT 1;
  IF found IS NOT NULL THEN RETURN found; END IF;
  -- canonical + season
  SELECT id INTO found FROM public.leagues
   WHERE canonical_key = ck AND season = _season LIMIT 1;
  IF found IS NOT NULL THEN RETURN found; END IF;
  -- canonical any season (newest)
  SELECT id INTO found FROM public.leagues
   WHERE canonical_key = ck ORDER BY season DESC LIMIT 1;
  RETURN found;
END;$$;

-- 5. Merge function: move all FKs from drop_id to keep_id
CREATE OR REPLACE FUNCTION public.merge_leagues(keep_id uuid, drop_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF keep_id = drop_id THEN RETURN; END IF;
  UPDATE public.matches          SET league_id = keep_id WHERE league_id = drop_id;
  UPDATE public.teams            SET league_id = keep_id WHERE league_id = drop_id;
  UPDATE public.statistics_cache SET league_id = keep_id WHERE league_id = drop_id;
  -- league_sources: move alias info to new league, then drop dupes
  INSERT INTO public.league_aliases (league_id, alias, normalized_alias, source)
  SELECT keep_id, name, public.normalize_league_name(name), 'merge'
  FROM public.leagues WHERE id = drop_id
  ON CONFLICT DO NOTHING;
  DELETE FROM public.leagues WHERE id = drop_id;
END;$$;

-- 6. Auto-merge duplicates by (canonical_key, season): keep the one with most matches
DO $$
DECLARE r record; keeper uuid;
BEGIN
  FOR r IN
    SELECT canonical_key, season, array_agg(id ORDER BY (SELECT COUNT(*) FROM matches m WHERE m.league_id = leagues.id) DESC, created_at ASC) AS ids
    FROM public.leagues
    GROUP BY canonical_key, season
    HAVING COUNT(*) > 1
  LOOP
    keeper := r.ids[1];
    FOR i IN 2..array_length(r.ids,1) LOOP
      PERFORM public.merge_leagues(keeper, r.ids[i]);
    END LOOP;
  END LOOP;
END$$;

-- 7. Seed aliases from current league_sources so future imports resolve correctly
INSERT INTO public.league_aliases (league_id, alias, normalized_alias, source)
SELECT l.id, ls.league_name, public.normalize_league_name(ls.league_name), ls.source
FROM public.league_sources ls
JOIN public.leagues l
  ON l.canonical_key = public.normalize_league_name(ls.league_name) || '|' || lower(ls.country)
ON CONFLICT DO NOTHING;

-- 8. Cleanup: deactivate empty stub leagues (0 matches AND no source produced data)
UPDATE public.leagues l
SET active = false
WHERE NOT EXISTS (SELECT 1 FROM public.matches m WHERE m.league_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.league_id = l.id AND t.id IN (SELECT home_team_id FROM matches));

-- 9. Disable league_sources rows whose only source is api-football and league has no rows / no matches
UPDATE public.league_sources ls
SET enabled = false
WHERE source = 'api-football'
  AND NOT EXISTS (
    SELECT 1 FROM public.leagues l
    WHERE l.canonical_key = public.normalize_league_name(ls.league_name) || '|' || lower(ls.country)
      AND EXISTS (SELECT 1 FROM public.matches m WHERE m.league_id = l.id)
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.league_sources ls2
    WHERE ls2.league_key = ls.league_key
      AND ls2.source = 'openfootball'
      AND ls2.enabled
  );

-- 10. RPC: top picks across all markets for upcoming matches
CREATE OR REPLACE FUNCTION public.get_top_picks(_sample_size integer DEFAULT 10, _hours integer DEFAULT 48, _limit integer DEFAULT 100)
RETURNS TABLE(
  match_id uuid,
  league_id uuid,
  league_name text,
  league_country text,
  match_date timestamptz,
  home_team_id uuid, home_team_name text,
  away_team_id uuid, away_team_name text,
  category stat_category,
  market text,
  home_pct numeric,
  away_pct numeric,
  combined_avg numeric
) LANGUAGE sql STABLE SET search_path=public AS $$
WITH upcoming AS (
  SELECT * FROM public.upcoming_matches
  WHERE match_date >= now()
    AND match_date <= now() + make_interval(hours => _hours)
),
candidates AS (
  SELECT u.id AS match_id, u.league_id, u.league_name, u.league_country, u.match_date,
         u.home_team_id, u.home_team_name, u.away_team_id, u.away_team_name,
         hc.category, m.key AS market,
         NULLIF((hc.statistics ->> m.key), '')::numeric AS home_pct,
         NULLIF((ac.statistics ->> m.key), '')::numeric AS away_pct
  FROM upcoming u
  JOIN public.statistics_cache hc
    ON hc.league_id = u.league_id AND hc.team_id = u.home_team_id AND hc.sample_size = _sample_size
  JOIN public.statistics_cache ac
    ON ac.league_id = u.league_id AND ac.team_id = u.away_team_id AND ac.sample_size = _sample_size
      AND ac.category = hc.category
  CROSS JOIN LATERAL jsonb_object_keys(hc.statistics) AS m(key)
  WHERE ac.statistics ? m.key
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
SELECT match_id, league_id, league_name, league_country, match_date,
       home_team_id, home_team_name, away_team_id, away_team_name,
       category, market, home_pct, away_pct, combined_avg
FROM ranked WHERE rn = 1
ORDER BY combined_avg DESC
LIMIT _limit;
$$;
