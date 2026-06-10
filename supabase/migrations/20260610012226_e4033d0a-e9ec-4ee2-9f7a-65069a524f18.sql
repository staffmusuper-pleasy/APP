ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS sofascore_id integer;
CREATE INDEX IF NOT EXISTS idx_leagues_sofascore_id ON public.leagues (sofascore_id) WHERE sofascore_id IS NOT NULL;