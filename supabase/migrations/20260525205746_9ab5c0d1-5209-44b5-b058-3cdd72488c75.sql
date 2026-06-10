
CREATE OR REPLACE FUNCTION public.validate_match()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.home_goals   IS NOT NULL AND NEW.home_goals   < 0 THEN RAISE EXCEPTION 'home_goals must be >= 0'; END IF;
  IF NEW.away_goals   IS NOT NULL AND NEW.away_goals   < 0 THEN RAISE EXCEPTION 'away_goals must be >= 0'; END IF;
  IF NEW.home_cards   IS NOT NULL AND NEW.home_cards   < 0 THEN RAISE EXCEPTION 'home_cards must be >= 0'; END IF;
  IF NEW.away_cards   IS NOT NULL AND NEW.away_cards   < 0 THEN RAISE EXCEPTION 'away_cards must be >= 0'; END IF;
  IF NEW.home_corners IS NOT NULL AND NEW.home_corners < 0 THEN RAISE EXCEPTION 'home_corners must be >= 0'; END IF;
  IF NEW.away_corners IS NOT NULL AND NEW.away_corners < 0 THEN RAISE EXCEPTION 'away_corners must be >= 0'; END IF;
  IF NEW.status = 'finished' AND (NEW.home_goals IS NULL OR NEW.away_goals IS NULL) THEN
    RAISE EXCEPTION 'finished matches require home_goals and away_goals';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_match ON public.matches;
CREATE TRIGGER trg_validate_match BEFORE INSERT OR UPDATE ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.validate_match();

CREATE OR REPLACE FUNCTION public.validate_statistics_cache()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF jsonb_typeof(NEW.statistics) <> 'object' THEN
    RAISE EXCEPTION 'statistics must be a JSON object';
  END IF;
  IF NEW.sample_size NOT IN (10, 20) THEN
    RAISE EXCEPTION 'sample_size must be 10 or 20';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_statistics_cache ON public.statistics_cache;
CREATE TRIGGER trg_validate_statistics_cache BEFORE INSERT OR UPDATE ON public.statistics_cache
FOR EACH ROW EXECUTE FUNCTION public.validate_statistics_cache();

CREATE OR REPLACE FUNCTION public.validate_sync_job()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.finished_at IS NOT NULL AND NEW.started_at IS NOT NULL
     AND NEW.finished_at < NEW.started_at THEN
    RAISE EXCEPTION 'finished_at cannot be before started_at';
  END IF;
  IF NEW.processed_records < 0 THEN
    RAISE EXCEPTION 'processed_records must be >= 0';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_sync_job ON public.sync_jobs;
CREATE TRIGGER trg_validate_sync_job BEFORE INSERT OR UPDATE ON public.sync_jobs
FOR EACH ROW EXECUTE FUNCTION public.validate_sync_job();

-- Dedup fixtures (use raw kickoff timestamp — immutable)
CREATE UNIQUE INDEX IF NOT EXISTS uq_matches_fixture
  ON public.matches (league_id, season, home_team_id, away_team_id, match_date);

-- Lookup indexes
CREATE INDEX IF NOT EXISTS idx_leagues_country      ON public.leagues (country);
CREATE INDEX IF NOT EXISTS idx_leagues_active       ON public.leagues (active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_leagues_season       ON public.leagues (season);
CREATE INDEX IF NOT EXISTS idx_teams_country        ON public.teams (country);
CREATE INDEX IF NOT EXISTS idx_teams_league_country ON public.teams (league_id, country);

CREATE INDEX IF NOT EXISTS idx_matches_upcoming
  ON public.matches (league_id, match_date)
  WHERE status IN ('scheduled', 'live');

CREATE INDEX IF NOT EXISTS idx_matches_home_finished_date
  ON public.matches (home_team_id, match_date DESC) WHERE status = 'finished';
CREATE INDEX IF NOT EXISTS idx_matches_away_finished_date
  ON public.matches (away_team_id, match_date DESC) WHERE status = 'finished';
CREATE INDEX IF NOT EXISTS idx_matches_league_season_date
  ON public.matches (league_id, season, match_date DESC);

CREATE INDEX IF NOT EXISTS idx_stats_cache_team_cat_size
  ON public.statistics_cache (team_id, category, sample_size);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_recent
  ON public.sync_jobs (started_at DESC NULLS LAST);

COMMENT ON TABLE public.leagues          IS 'Football competitions per country and season.';
COMMENT ON TABLE public.teams            IS 'Clubs with normalized names for cross-source matching.';
COMMENT ON TABLE public.matches          IS 'Fixtures and results. Cards/corners populated by secondary sources.';
COMMENT ON TABLE public.statistics_cache IS 'Precomputed over/under percentages per team/league/category/sample_size.';
COMMENT ON TABLE public.data_sources     IS 'Registered ingestion sources (e.g. openfootball).';
COMMENT ON TABLE public.sync_jobs        IS 'Audit log of ingestion runs.';
COMMENT ON COLUMN public.matches.status              IS 'scheduled | live | finished | postponed | cancelled';
COMMENT ON COLUMN public.statistics_cache.statistics IS 'JSON: { matches_used, over_X_Y, under_X_Y, ... }';

ANALYZE public.leagues;
ANALYZE public.teams;
ANALYZE public.matches;
ANALYZE public.statistics_cache;
ANALYZE public.sync_jobs;
ANALYZE public.data_sources;
