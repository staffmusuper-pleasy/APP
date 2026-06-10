
CREATE TYPE public.sync_job_status AS ENUM ('pending', 'running', 'success', 'failed', 'cancelled');

CREATE TABLE public.data_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  last_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_data_sources_active ON public.data_sources(active);

CREATE TABLE public.sync_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_name TEXT NOT NULL,
  source UUID NOT NULL REFERENCES public.data_sources(id) ON DELETE CASCADE,
  status public.sync_job_status NOT NULL DEFAULT 'pending',
  processed_records INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_jobs_source ON public.sync_jobs(source);
CREATE INDEX idx_sync_jobs_status ON public.sync_jobs(status);
CREATE INDEX idx_sync_jobs_started_at ON public.sync_jobs(started_at DESC);
CREATE INDEX idx_sync_jobs_source_status ON public.sync_jobs(source, status);

ALTER TABLE public.data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Data sources readable by everyone"
  ON public.data_sources FOR SELECT USING (true);
CREATE POLICY "Auth insert data sources"
  ON public.data_sources FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update data sources"
  ON public.data_sources FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete data sources"
  ON public.data_sources FOR DELETE TO authenticated USING (true);

CREATE POLICY "Sync jobs readable by everyone"
  ON public.sync_jobs FOR SELECT USING (true);
CREATE POLICY "Auth insert sync jobs"
  ON public.sync_jobs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update sync jobs"
  ON public.sync_jobs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete sync jobs"
  ON public.sync_jobs FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_data_sources_updated_at
  BEFORE UPDATE ON public.data_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_sync_jobs_updated_at
  BEFORE UPDATE ON public.sync_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Team name normalization helper (lowercase, strip suffixes/punctuation, collapse spaces)
CREATE OR REPLACE FUNCTION public.normalize_team_name(input TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v TEXT;
BEGIN
  IF input IS NULL THEN RETURN NULL; END IF;
  v := lower(trim(input));
  v := unaccent(v);
  v := regexp_replace(v, '\s+(fc|cf|sc|ac|afc|cfc|fk|sk|bk|if|kf|club|football club|calcio|ssd|asd)\.?$', '', 'gi');
  v := regexp_replace(v, '^(fc|cf|sc|ac|afc|cfc|fk|sk|bk|if|kf)\s+', '', 'gi');
  v := regexp_replace(v, '[^a-z0-9 ]', '', 'g');
  v := regexp_replace(v, '\s+', ' ', 'g');
  RETURN trim(v);
EXCEPTION WHEN undefined_function THEN
  -- unaccent extension missing; fall back without it
  v := lower(trim(input));
  v := regexp_replace(v, '\s+(fc|cf|sc|ac|afc|cfc|fk|sk|bk|if|kf|club|football club|calcio|ssd|asd)\.?$', '', 'gi');
  v := regexp_replace(v, '^(fc|cf|sc|ac|afc|cfc|fk|sk|bk|if|kf)\s+', '', 'gi');
  v := regexp_replace(v, '[^a-z0-9 ]', '', 'g');
  v := regexp_replace(v, '\s+', ' ', 'g');
  RETURN trim(v);
END;
$$;

CREATE EXTENSION IF NOT EXISTS unaccent;

-- Auto-fill teams.normalized_name on insert/update if not provided
CREATE OR REPLACE FUNCTION public.teams_set_normalized_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.normalized_name IS NULL OR NEW.normalized_name = '' OR NEW.normalized_name IS DISTINCT FROM public.normalize_team_name(NEW.name) THEN
    NEW.normalized_name := public.normalize_team_name(NEW.name);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_teams_normalize_name
  BEFORE INSERT OR UPDATE OF name ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.teams_set_normalized_name();

-- Seed sources
INSERT INTO public.data_sources (name, active) VALUES
  ('openfootball', true),
  ('cards_source_placeholder', false),
  ('corners_source_placeholder', false)
ON CONFLICT (name) DO NOTHING;
