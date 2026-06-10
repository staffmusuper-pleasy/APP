-- Add FBref identifiers used by worldfootballR-style scraping
ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS fbref_id text,
  ADD COLUMN IF NOT EXISTS fbref_slug text;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS fbref_id text;

CREATE INDEX IF NOT EXISTS idx_teams_fbref_id ON public.teams(fbref_id);
CREATE INDEX IF NOT EXISTS idx_leagues_fbref_id ON public.leagues(fbref_id);

-- Seed FBref ids for the 5 leagues we already sync from OpenFootball.
-- Slug is the human-readable suffix FBref uses in its URLs.
UPDATE public.leagues SET fbref_id = '9',  fbref_slug = 'Premier-League'   WHERE name = 'English Premier League';
UPDATE public.leagues SET fbref_id = '12', fbref_slug = 'La-Liga'          WHERE name = 'Primera División';
UPDATE public.leagues SET fbref_id = '20', fbref_slug = 'Bundesliga'       WHERE name = 'Bundesliga';
UPDATE public.leagues SET fbref_id = '11', fbref_slug = 'Serie-A'          WHERE name = 'Serie A';
UPDATE public.leagues SET fbref_id = '13', fbref_slug = 'Ligue-1'          WHERE name = 'Ligue 1';