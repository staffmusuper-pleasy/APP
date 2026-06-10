
ALTER TABLE public.pipeline_logs
  ADD COLUMN IF NOT EXISTS provider_attempt_order integer,
  ADD COLUMN IF NOT EXISTS provider_response_time_ms integer,
  ADD COLUMN IF NOT EXISTS provider_success boolean,
  ADD COLUMN IF NOT EXISTS cards_count integer,
  ADD COLUMN IF NOT EXISTS corners_count integer;

CREATE INDEX IF NOT EXISTS idx_pipeline_logs_match_attempt
  ON public.pipeline_logs (match_id, provider_attempt_order);
