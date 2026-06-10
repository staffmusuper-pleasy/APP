
-- 1) team_aliases
CREATE TABLE public.team_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  source text NOT NULL, -- 'openfootball' | 'api-football' | 'fbref' | 'manual'
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (normalized_alias, source)
);
CREATE INDEX team_aliases_team_id_idx ON public.team_aliases(team_id);
CREATE INDEX team_aliases_normalized_idx ON public.team_aliases(normalized_alias);

GRANT SELECT ON public.team_aliases TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_aliases TO authenticated;
GRANT ALL ON public.team_aliases TO service_role;

ALTER TABLE public.team_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team aliases readable by everyone" ON public.team_aliases FOR SELECT USING (true);
CREATE POLICY "Auth insert team aliases" ON public.team_aliases FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update team aliases" ON public.team_aliases FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete team aliases" ON public.team_aliases FOR DELETE TO authenticated USING (true);

-- 2) league_sources
CREATE TABLE public.league_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_key text NOT NULL,           -- stable identifier, e.g. "br.1", "sa.1", "es.w"
  league_name text NOT NULL,
  country text NOT NULL,
  source text NOT NULL,               -- 'openfootball' | 'worldfootballr' | 'api-football'
  source_ref jsonb NOT NULL DEFAULT '{}'::jsonb, -- e.g. {"url":"..."} or {"league_id":307,"season":2026}
  priority integer NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_key, source)
);
CREATE INDEX league_sources_key_priority_idx ON public.league_sources(league_key, priority);

GRANT SELECT ON public.league_sources TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.league_sources TO authenticated;
GRANT ALL ON public.league_sources TO service_role;

ALTER TABLE public.league_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "League sources readable by everyone" ON public.league_sources FOR SELECT USING (true);
CREATE POLICY "Auth insert league sources" ON public.league_sources FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update league sources" ON public.league_sources FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete league sources" ON public.league_sources FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_league_sources_updated_at BEFORE UPDATE ON public.league_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) API-Football identifiers on leagues + teams
ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS api_football_id integer;
ALTER TABLE public.teams   ADD COLUMN IF NOT EXISTS api_football_id integer;
CREATE INDEX IF NOT EXISTS leagues_api_football_id_idx ON public.leagues(api_football_id);
CREATE INDEX IF NOT EXISTS teams_api_football_id_idx   ON public.teams(api_football_id);

-- 4) Seed league_sources for the requested coverage.
-- Existing OpenFootball leagues — priority 1.
INSERT INTO public.league_sources (league_key, league_name, country, source, source_ref, priority) VALUES
  ('en.1','English Premier League','England','openfootball','{"of_key":"en.1"}'::jsonb,1),
  ('es.1','Primera División','Spain','openfootball','{"of_key":"es.1"}'::jsonb,1),
  ('de.1','Bundesliga','Germany','openfootball','{"of_key":"de.1"}'::jsonb,1),
  ('it.1','Serie A','Italy','openfootball','{"of_key":"it.1"}'::jsonb,1),
  ('fr.1','Ligue 1','France','openfootball','{"of_key":"fr.1"}'::jsonb,1),
  ('nl.1','Eredivisie','Netherlands','openfootball','{"of_key":"nl.1"}'::jsonb,1),
  ('pt.1','Primeira Liga','Portugal','openfootball','{"of_key":"pt.1"}'::jsonb,1),
  ('tr.1','Süper Lig','Turkey','openfootball','{"of_key":"tr.1"}'::jsonb,1),
  ('sco.1','Scottish Premiership','Scotland','openfootball','{"of_key":"sco.1"}'::jsonb,1),
  ('gr.1','Super League','Greece','openfootball','{"of_key":"gr.1"}'::jsonb,1),
  ('br.1','Campeonato Brasileiro Série A','Brazil','openfootball','{"of_key":"br.1"}'::jsonb,1),
  ('eg.1','Egyptian Premier League','Egypt','openfootball','{"of_key":"eg.1"}'::jsonb,1)
ON CONFLICT (league_key, source) DO NOTHING;

-- API-Football as priority 2 for live fixtures / cards / corners on European leagues.
-- API-Football league IDs (well-known).
INSERT INTO public.league_sources (league_key, league_name, country, source, source_ref, priority) VALUES
  ('en.1','English Premier League','England','api-football','{"af_league_id":39}'::jsonb,2),
  ('es.1','Primera División','Spain','api-football','{"af_league_id":140}'::jsonb,2),
  ('de.1','Bundesliga','Germany','api-football','{"af_league_id":78}'::jsonb,2),
  ('it.1','Serie A','Italy','api-football','{"af_league_id":135}'::jsonb,2),
  ('fr.1','Ligue 1','France','api-football','{"af_league_id":61}'::jsonb,2),
  ('nl.1','Eredivisie','Netherlands','api-football','{"af_league_id":88}'::jsonb,2),
  ('pt.1','Primeira Liga','Portugal','api-football','{"af_league_id":94}'::jsonb,2),
  ('tr.1','Süper Lig','Turkey','api-football','{"af_league_id":203}'::jsonb,2),
  ('sco.1','Scottish Premiership','Scotland','api-football','{"af_league_id":179}'::jsonb,2),
  ('gr.1','Super League','Greece','api-football','{"af_league_id":197}'::jsonb,2),
  ('br.1','Campeonato Brasileiro Série A','Brazil','api-football','{"af_league_id":71}'::jsonb,2),
  ('eg.1','Egyptian Premier League','Egypt','api-football','{"af_league_id":233}'::jsonb,2)
ON CONFLICT (league_key, source) DO NOTHING;

-- API-Football only (no OpenFootball coverage) — priority 1.
INSERT INTO public.league_sources (league_key, league_name, country, source, source_ref, priority) VALUES
  ('sa.1','Saudi Pro League','Saudi Arabia','api-football','{"af_league_id":307}'::jsonb,1),
  ('us.1','Major League Soccer','USA','api-football','{"af_league_id":253}'::jsonb,1),
  ('wal.1','Cymru Premier','Wales','api-football','{"af_league_id":110}'::jsonb,1),
  ('rs.1','SuperLiga','Serbia','api-football','{"af_league_id":286}'::jsonb,1),
  ('br.w','Campeonato Brasileiro Feminino','Brazil','api-football','{"af_league_id":74}'::jsonb,1),
  ('es.w','Liga F','Spain','api-football','{"af_league_id":141}'::jsonb,1),
  ('fr.w','D1 Arkema','France','api-football','{"af_league_id":64}'::jsonb,1)
ON CONFLICT (league_key, source) DO NOTHING;

-- worldfootballR (FBref via proxy) — priority 3 for cards/corners only.
INSERT INTO public.league_sources (league_key, league_name, country, source, source_ref, priority) VALUES
  ('en.1','English Premier League','England','worldfootballr','{"fbref_id":"9","fbref_slug":"Premier-League"}'::jsonb,3),
  ('es.1','Primera División','Spain','worldfootballr','{"fbref_id":"12","fbref_slug":"La-Liga"}'::jsonb,3),
  ('de.1','Bundesliga','Germany','worldfootballr','{"fbref_id":"20","fbref_slug":"Bundesliga"}'::jsonb,3),
  ('it.1','Serie A','Italy','worldfootballr','{"fbref_id":"11","fbref_slug":"Serie-A"}'::jsonb,3),
  ('fr.1','Ligue 1','France','worldfootballr','{"fbref_id":"13","fbref_slug":"Ligue-1"}'::jsonb,3)
ON CONFLICT (league_key, source) DO NOTHING;
