
-- LEAGUES
CREATE TABLE public.leagues (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  season TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, country, season)
);

-- TEAMS
CREATE TABLE public.teams (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  country TEXT NOT NULL,
  league_id UUID REFERENCES public.leagues(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (normalized_name, country)
);

CREATE INDEX idx_teams_league_id ON public.teams(league_id);
CREATE INDEX idx_teams_normalized_name ON public.teams(normalized_name);

-- MATCH STATUS ENUM
CREATE TYPE public.match_status AS ENUM ('scheduled', 'live', 'finished', 'postponed', 'cancelled');

-- MATCHES
CREATE TABLE public.matches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  season TEXT NOT NULL,
  round TEXT,
  status public.match_status NOT NULL DEFAULT 'scheduled',
  match_date TIMESTAMPTZ NOT NULL,
  home_team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  away_team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  home_goals INTEGER,
  away_goals INTEGER,
  home_cards INTEGER,
  away_cards INTEGER,
  home_corners INTEGER,
  away_corners INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT different_teams CHECK (home_team_id <> away_team_id)
);

CREATE INDEX idx_matches_league_season ON public.matches(league_id, season);
CREATE INDEX idx_matches_home_team ON public.matches(home_team_id);
CREATE INDEX idx_matches_away_team ON public.matches(away_team_id);
CREATE INDEX idx_matches_date ON public.matches(match_date DESC);
CREATE INDEX idx_matches_status ON public.matches(status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_leagues_updated_at BEFORE UPDATE ON public.leagues
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_teams_updated_at BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_matches_updated_at BEFORE UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

-- Public read
CREATE POLICY "Leagues readable by everyone" ON public.leagues FOR SELECT USING (true);
CREATE POLICY "Teams readable by everyone" ON public.teams FOR SELECT USING (true);
CREATE POLICY "Matches readable by everyone" ON public.matches FOR SELECT USING (true);

-- Authenticated write
CREATE POLICY "Auth insert leagues" ON public.leagues FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update leagues" ON public.leagues FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete leagues" ON public.leagues FOR DELETE TO authenticated USING (true);

CREATE POLICY "Auth insert teams" ON public.teams FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update teams" ON public.teams FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete teams" ON public.teams FOR DELETE TO authenticated USING (true);

CREATE POLICY "Auth insert matches" ON public.matches FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update matches" ON public.matches FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete matches" ON public.matches FOR DELETE TO authenticated USING (true);
