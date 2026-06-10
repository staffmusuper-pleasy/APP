CREATE TABLE public.pipeline_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL,
  job_run_id uuid,
  league_id uuid,
  match_id uuid,
  provider_fixture_id text,
  match_date timestamptz,
  cards_found boolean,
  corners_found boolean,
  cards_written boolean,
  corners_written boolean,
  status text NOT NULL CHECK (status IN ('success','partial','skipped','failed')),
  error_message text,
  payload jsonb
);

CREATE INDEX idx_pipeline_logs_created ON public.pipeline_logs (created_at DESC);
CREATE INDEX idx_pipeline_logs_provider ON public.pipeline_logs (provider, created_at DESC);
CREATE INDEX idx_pipeline_logs_status ON public.pipeline_logs (status) WHERE status <> 'success';
CREATE INDEX idx_pipeline_logs_match ON public.pipeline_logs (match_id);

GRANT SELECT ON public.pipeline_logs TO authenticated;
GRANT ALL ON public.pipeline_logs TO service_role;

ALTER TABLE public.pipeline_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipeline_logs readable by authenticated"
  ON public.pipeline_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "pipeline_logs writable by service_role"
  ON public.pipeline_logs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);