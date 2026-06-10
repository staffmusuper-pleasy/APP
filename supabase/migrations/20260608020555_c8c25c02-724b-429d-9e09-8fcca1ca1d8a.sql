
-- =========================================================
-- 1. SOURCE PRIORITIES
-- =========================================================
CREATE TABLE IF NOT EXISTS public.source_priorities (
  source text PRIMARY KEY,
  priority int NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.source_priorities TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.source_priorities TO authenticated;
GRANT ALL ON public.source_priorities TO service_role;
ALTER TABLE public.source_priorities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "source_priorities readable" ON public.source_priorities FOR SELECT USING (true);
CREATE POLICY "source_priorities auth write" ON public.source_priorities FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.source_priorities(source, priority) VALUES
  ('api-football', 1),
  ('football-data', 2),
  ('thesportsdb', 3),
  ('worldfootballr', 4),
  ('openfootball', 5)
ON CONFLICT (source) DO NOTHING;

-- =========================================================
-- 2. TEAMS MASTER
-- =========================================================
CREATE TABLE IF NOT EXISTS public.teams_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  official_name text NOT NULL,
  normalized_name text NOT NULL,
  country text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(normalized_name, country)
);
GRANT SELECT ON public.teams_master TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams_master TO authenticated;
GRANT ALL ON public.teams_master TO service_role;
ALTER TABLE public.teams_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "teams_master readable" ON public.teams_master FOR SELECT USING (true);
CREATE POLICY "teams_master auth write" ON public.teams_master FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS master_id uuid REFERENCES public.teams_master(id);
CREATE INDEX IF NOT EXISTS teams_master_id_idx ON public.teams(master_id);

CREATE OR REPLACE FUNCTION public.resolve_team_master(_name text, _country text)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_norm text := public.normalize_team_name(_name);
  v_id uuid;
BEGIN
  IF v_norm IS NULL OR v_norm = '' THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.teams_master
    WHERE normalized_name = v_norm AND lower(country) = lower(COALESCE(_country, ''));
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  -- Fallback: same normalized name in any country
  SELECT id INTO v_id FROM public.teams_master WHERE normalized_name = v_norm LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.teams_master(official_name, normalized_name, country)
    VALUES (trim(_name), v_norm, COALESCE(_country, ''))
    ON CONFLICT (normalized_name, country) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.teams_link_master()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.master_id IS NULL THEN
    NEW.master_id := public.resolve_team_master(NEW.name, NEW.country);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS teams_link_master_trg ON public.teams;
CREATE TRIGGER teams_link_master_trg
  BEFORE INSERT OR UPDATE OF name, country ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.teams_link_master();

-- Backfill
INSERT INTO public.teams_master(official_name, normalized_name, country)
SELECT DISTINCT ON (public.normalize_team_name(name), country)
       name, public.normalize_team_name(name), COALESCE(country, '')
FROM public.teams
WHERE name IS NOT NULL
ON CONFLICT (normalized_name, country) DO NOTHING;

UPDATE public.teams t SET master_id = m.id
FROM public.teams_master m
WHERE t.master_id IS NULL
  AND m.normalized_name = public.normalize_team_name(t.name)
  AND lower(m.country) = lower(COALESCE(t.country, ''));

-- =========================================================
-- 3. MATCHES: extra stat columns
-- =========================================================
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS ht_home_goals int,
  ADD COLUMN IF NOT EXISTS ht_away_goals int,
  ADD COLUMN IF NOT EXISTS home_yellow int,
  ADD COLUMN IF NOT EXISTS away_yellow int,
  ADD COLUMN IF NOT EXISTS home_red int,
  ADD COLUMN IF NOT EXISTS away_red int,
  ADD COLUMN IF NOT EXISTS home_possession numeric,
  ADD COLUMN IF NOT EXISTS away_possession numeric,
  ADD COLUMN IF NOT EXISTS home_shots int,
  ADD COLUMN IF NOT EXISTS away_shots int,
  ADD COLUMN IF NOT EXISTS raw_payload jsonb;

-- =========================================================
-- 4. INDEXES
-- =========================================================
CREATE INDEX IF NOT EXISTS matches_league_idx ON public.matches(league_id);
CREATE INDEX IF NOT EXISTS matches_season_idx ON public.matches(season);
CREATE INDEX IF NOT EXISTS matches_match_date_idx ON public.matches(match_date);
CREATE INDEX IF NOT EXISTS matches_home_team_idx ON public.matches(home_team_id);
CREATE INDEX IF NOT EXISTS matches_away_team_idx ON public.matches(away_team_id);
CREATE INDEX IF NOT EXISTS matches_league_date_idx ON public.matches(league_id, match_date);
CREATE INDEX IF NOT EXISTS matches_source_col_idx ON public.matches(source);

-- =========================================================
-- 5. BOOKMAKERS + ODDS PLACEHOLDERS
-- =========================================================
CREATE TABLE IF NOT EXISTS public.bookmakers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  country text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.bookmakers TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bookmakers TO authenticated;
GRANT ALL ON public.bookmakers TO service_role;
ALTER TABLE public.bookmakers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bookmakers readable" ON public.bookmakers FOR SELECT USING (true);
CREATE POLICY "bookmakers auth write" ON public.bookmakers FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.odds_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL,
  bookmaker_id uuid NOT NULL REFERENCES public.bookmakers(id) ON DELETE CASCADE,
  market text NOT NULL,
  selection text NOT NULL,
  price numeric NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS odds_history_match_idx ON public.odds_history(match_id);
GRANT SELECT ON public.odds_history TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.odds_history TO authenticated;
GRANT ALL ON public.odds_history TO service_role;
ALTER TABLE public.odds_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "odds_history readable" ON public.odds_history FOR SELECT USING (true);
CREATE POLICY "odds_history auth write" ON public.odds_history FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.opening_odds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL,
  bookmaker_id uuid NOT NULL REFERENCES public.bookmakers(id) ON DELETE CASCADE,
  market text NOT NULL,
  selection text NOT NULL,
  price numeric NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(match_id, bookmaker_id, market, selection)
);
GRANT SELECT ON public.opening_odds TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.opening_odds TO authenticated;
GRANT ALL ON public.opening_odds TO service_role;
ALTER TABLE public.opening_odds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "opening_odds readable" ON public.opening_odds FOR SELECT USING (true);
CREATE POLICY "opening_odds auth write" ON public.opening_odds FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.closing_odds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL,
  bookmaker_id uuid NOT NULL REFERENCES public.bookmakers(id) ON DELETE CASCADE,
  market text NOT NULL,
  selection text NOT NULL,
  price numeric NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(match_id, bookmaker_id, market, selection)
);
GRANT SELECT ON public.closing_odds TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.closing_odds TO authenticated;
GRANT ALL ON public.closing_odds TO service_role;
ALTER TABLE public.closing_odds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "closing_odds readable" ON public.closing_odds FOR SELECT USING (true);
CREATE POLICY "closing_odds auth write" ON public.closing_odds FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =========================================================
-- 6. IMPORT LOGS
-- =========================================================
CREATE TABLE IF NOT EXISTS public.import_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  competition text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  matches_imported int NOT NULL DEFAULT 0,
  matches_updated int NOT NULL DEFAULT 0,
  errors_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  error_sample text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS import_logs_started_idx ON public.import_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS import_logs_source_idx ON public.import_logs(source);
GRANT SELECT ON public.import_logs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_logs TO authenticated;
GRANT ALL ON public.import_logs TO service_role;
ALTER TABLE public.import_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "import_logs readable" ON public.import_logs FOR SELECT USING (true);
CREATE POLICY "import_logs auth write" ON public.import_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =========================================================
-- 7. VIEWS
-- =========================================================
CREATE OR REPLACE VIEW public.competition_coverage AS
WITH per_source AS (
  SELECT league_id, source, count(*) AS c,
         row_number() OVER (PARTITION BY league_id ORDER BY count(*) DESC NULLS LAST) AS rn
  FROM public.matches
  WHERE source IS NOT NULL
  GROUP BY league_id, source
)
SELECT
  l.id AS league_id,
  l.name AS competition,
  l.country,
  l.season,
  (SELECT count(*) FROM public.matches m WHERE m.league_id = l.id) AS total_matches,
  (SELECT count(*) FROM public.matches m WHERE m.league_id = l.id AND m.status = 'scheduled' AND m.match_date >= now()) AS future_fixtures,
  (SELECT source FROM per_source WHERE league_id = l.id AND rn = 1) AS source_used,
  (SELECT max(last_successful_sync) FROM public.league_sources ls WHERE ls.league_name = l.name AND ls.country = l.country) AS last_sync
FROM public.leagues l;

CREATE OR REPLACE VIEW public.data_quality_summary AS
WITH dup AS (
  SELECT count(*) AS duplicates_detected FROM (
    SELECT league_id, match_date, home_team_id, away_team_id, count(*) c
    FROM public.matches
    GROUP BY league_id, match_date, home_team_id, away_team_id
    HAVING count(*) > 1
  ) d
),
unmatched AS (
  SELECT count(*) AS unmatched_teams FROM public.teams t WHERE t.master_id IS NULL
),
missing_stats AS (
  SELECT count(*) AS matches_missing_stats
  FROM public.matches m
  WHERE m.status = 'scheduled' AND m.match_date >= now()
    AND (
      NOT EXISTS (SELECT 1 FROM public.statistics_cache s WHERE s.team_id = m.home_team_id AND s.sample_size = 10)
      OR NOT EXISTS (SELECT 1 FROM public.statistics_cache s WHERE s.team_id = m.away_team_id AND s.sample_size = 10)
    )
),
failed AS (
  SELECT count(*) AS failed_imports FROM public.import_logs
  WHERE status = 'error' AND started_at >= now() - interval '24 hours'
)
SELECT (SELECT duplicates_detected FROM dup) AS duplicates_detected,
       (SELECT unmatched_teams FROM unmatched) AS unmatched_teams,
       (SELECT matches_missing_stats FROM missing_stats) AS matches_missing_stats,
       (SELECT failed_imports FROM failed) AS failed_imports;

CREATE OR REPLACE VIEW public.source_quality AS
SELECT source,
       max(completed_at) FILTER (WHERE status = 'success') AS last_successful_sync,
       count(*) FILTER (WHERE status = 'success') AS successful_runs,
       count(*) FILTER (WHERE status = 'error') AS failed_runs,
       CASE WHEN count(*) = 0 THEN NULL
            ELSE round(100.0 * count(*) FILTER (WHERE status = 'success') / count(*), 1)
       END AS coverage_pct
FROM public.import_logs
GROUP BY source;

CREATE OR REPLACE VIEW public.match_analytics AS
SELECT
  m.id AS match_id,
  m.league_id,
  m.match_date,
  m.home_team_id,
  m.away_team_id,
  (m.home_goals > 0 AND m.away_goals > 0) AS btts,
  (COALESCE(m.home_goals,0) + COALESCE(m.away_goals,0)) AS total_goals,
  ((COALESCE(m.home_goals,0) + COALESCE(m.away_goals,0)) > 0) AS over_0_5,
  ((COALESCE(m.home_goals,0) + COALESCE(m.away_goals,0)) > 1) AS over_1_5,
  ((COALESCE(m.home_goals,0) + COALESCE(m.away_goals,0)) > 2) AS over_2_5,
  ((COALESCE(m.home_goals,0) + COALESCE(m.away_goals,0)) > 3) AS over_3_5,
  ((COALESCE(m.home_goals,0) + COALESCE(m.away_goals,0)) > 4) AS over_4_5,
  (COALESCE(m.ht_home_goals,0) + COALESCE(m.ht_away_goals,0)) AS first_half_goals,
  CASE WHEN m.ht_home_goals IS NOT NULL AND m.ht_away_goals IS NOT NULL
       THEN (COALESCE(m.home_goals,0) - m.ht_home_goals) + (COALESCE(m.away_goals,0) - m.ht_away_goals)
       ELSE NULL END AS second_half_goals,
  CASE WHEN m.home_goals IS NULL OR m.away_goals IS NULL THEN NULL
       WHEN m.home_goals > m.away_goals THEN 'H'
       WHEN m.home_goals < m.away_goals THEN 'A'
       ELSE 'D' END AS match_result,
  (m.away_goals = 0) AS home_clean_sheet,
  (m.home_goals = 0) AS away_clean_sheet
FROM public.matches m;
