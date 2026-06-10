
-- 1) Track which provider imported each match (used by Data Audit)
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS source text;
CREATE INDEX IF NOT EXISTS matches_source_idx ON public.matches(source);

-- 2) Seed league_sources for the two new free providers.
-- Football-Data.org covers top European leagues + Champions League.
INSERT INTO public.league_sources (league_key, league_name, country, source, priority, source_ref, enabled)
VALUES
  ('eng.1',   'Premier League',         'England',  'football-data', 2, '{"code":"PL"}'::jsonb,  true),
  ('es.1',    'La Liga',                'Spain',    'football-data', 2, '{"code":"PD"}'::jsonb,  true),
  ('de.1',    'Bundesliga',             'Germany',  'football-data', 2, '{"code":"BL1"}'::jsonb, true),
  ('it.1',    'Serie A',                'Italy',    'football-data', 2, '{"code":"SA"}'::jsonb,  true),
  ('fr.1',    'Ligue 1',                'France',   'football-data', 2, '{"code":"FL1"}'::jsonb, true),
  ('eu.cl',   'UEFA Champions League',  'Europe',   'football-data', 2, '{"code":"CL"}'::jsonb,  true),
  ('eu.el',   'UEFA Europa League',     'Europe',   'football-data', 2, '{"code":"EL"}'::jsonb,  true),
  ('eu.ec',   'European Championship',  'Europe',   'football-data', 2, '{"code":"EC"}'::jsonb,  true),
  ('fifa.wc', 'FIFA World Cup',         'World',    'football-data', 2, '{"code":"WC"}'::jsonb,  true)
ON CONFLICT DO NOTHING;

-- TheSportsDB covers MLS, internationals, friendlies, and competitions missing elsewhere.
-- League IDs are TheSportsDB idLeague values.
INSERT INTO public.league_sources (league_key, league_name, country, source, priority, source_ref, enabled)
VALUES
  ('us.mls',          'Major League Soccer',      'USA',           'thesportsdb', 3, '{"idLeague":"4346"}'::jsonb, true),
  ('fifa.wc',         'FIFA World Cup',           'World',         'thesportsdb', 3, '{"idLeague":"4429"}'::jsonb, true),
  ('fifa.cwc',        'FIFA Club World Cup',     'World',         'thesportsdb', 3, '{"idLeague":"4486"}'::jsonb, true),
  ('uefa.nl',         'UEFA Nations League',      'Europe',        'thesportsdb', 3, '{"idLeague":"4753"}'::jsonb, true),
  ('conmebol.copa',   'Copa America',             'South America', 'thesportsdb', 3, '{"idLeague":"4480"}'::jsonb, true),
  ('concacaf.gold',   'Gold Cup',                 'North America', 'thesportsdb', 3, '{"idLeague":"4481"}'::jsonb, true),
  ('intl.friendlies', 'International Friendlies', 'World',         'thesportsdb', 3, '{"idLeague":"4506"}'::jsonb, true),
  ('fifa.wcq',        'World Cup Qualifiers',     'World',         'thesportsdb', 3, '{"idLeague":"4644"}'::jsonb, true)
ON CONFLICT DO NOTHING;

-- 3) Common team alias variants — prevents duplicates across providers.
-- These are inserted only when the canonical team already exists in public.teams.
WITH variants(canonical, alias) AS (
  VALUES
    ('Manchester United',  'Man United'),
    ('Manchester United',  'Man Utd'),
    ('Manchester City',    'Man City'),
    ('Tottenham Hotspur',  'Tottenham'),
    ('Tottenham Hotspur',  'Spurs'),
    ('Wolverhampton Wanderers', 'Wolves'),
    ('Brighton & Hove Albion',  'Brighton'),
    ('West Ham United',    'West Ham'),
    ('Newcastle United',   'Newcastle'),
    ('Leeds United',       'Leeds'),
    ('Paris Saint-Germain','PSG'),
    ('Paris Saint-Germain','Paris SG'),
    ('Internazionale',     'Inter'),
    ('Internazionale',     'Inter Milan'),
    ('AC Milan',           'Milan'),
    ('Bayern Munich',      'Bayern'),
    ('Bayern Munich',      'FC Bayern München'),
    ('Borussia Dortmund',  'Dortmund'),
    ('Borussia Dortmund',  'BVB'),
    ('Borussia Mönchengladbach','Mönchengladbach'),
    ('Atletico Madrid',    'Atlético Madrid'),
    ('Atletico Madrid',    'Atleti'),
    ('Real Madrid',        'R. Madrid'),
    ('Barcelona',          'FC Barcelona'),
    ('Barcelona',          'Barça'),
    ('Olympique Lyonnais', 'Lyon'),
    ('Olympique de Marseille', 'Marseille')
)
INSERT INTO public.team_aliases (team_id, alias, normalized_alias, source)
SELECT t.id, v.alias, public.normalize_team_name(v.alias), 'manual-seed'
FROM variants v
JOIN public.teams t ON t.normalized_name = public.normalize_team_name(v.canonical)
WHERE NOT EXISTS (
  SELECT 1 FROM public.team_aliases a
  WHERE a.normalized_alias = public.normalize_team_name(v.alias)
    AND a.team_id = t.id
);
