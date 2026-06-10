
ALTER TABLE public.league_sources
  ADD COLUMN IF NOT EXISTS season_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_match_imported timestamptz,
  ADD COLUMN IF NOT EXISTS total_matches_stored integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_successful_sync timestamptz,
  ADD COLUMN IF NOT EXISTS api_calls_saved integer NOT NULL DEFAULT 0;
