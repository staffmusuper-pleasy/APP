
-- 1) Table
CREATE TABLE public.match_provider_ids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_match_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_provider_ids_provider_pmid_unique UNIQUE (provider, provider_match_id),
  CONSTRAINT match_provider_ids_match_provider_unique UNIQUE (match_id, provider)
);

GRANT SELECT ON public.match_provider_ids TO anon, authenticated;
GRANT ALL ON public.match_provider_ids TO service_role;

ALTER TABLE public.match_provider_ids ENABLE ROW LEVEL SECURITY;

CREATE POLICY "match_provider_ids public read"
  ON public.match_provider_ids FOR SELECT
  USING (true);

CREATE POLICY "match_provider_ids service role write"
  ON public.match_provider_ids FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 2) Indexes
CREATE INDEX IF NOT EXISTS match_provider_ids_provider_pmid_idx
  ON public.match_provider_ids(provider, provider_match_id);
CREATE INDEX IF NOT EXISTS match_provider_ids_match_id_idx
  ON public.match_provider_ids(match_id);

-- 3) Resolver helper
CREATE OR REPLACE FUNCTION public.resolve_match_provider_id(_match_id uuid, _provider text)
RETURNS TABLE(match_id uuid, provider text, provider_match_id text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT m.match_id, m.provider, m.provider_match_id
  FROM public.match_provider_ids m
  WHERE m.match_id = _match_id AND m.provider = _provider
  LIMIT 1;
$$;

-- 4) Backfill from pipeline_logs (only api-football has historically logged provider_fixture_id)
INSERT INTO public.match_provider_ids (match_id, provider, provider_match_id)
SELECT DISTINCT ON (provider, provider_fixture_id)
  match_id, provider, provider_fixture_id
FROM public.pipeline_logs
WHERE match_id IS NOT NULL
  AND provider IS NOT NULL
  AND provider_fixture_id IS NOT NULL
  AND provider_fixture_id <> ''
ORDER BY provider, provider_fixture_id, created_at DESC
ON CONFLICT DO NOTHING;
