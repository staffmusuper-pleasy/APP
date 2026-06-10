
CREATE TYPE public.stat_category AS ENUM ('goals', 'cards', 'corners');

CREATE TABLE public.statistics_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  category public.stat_category NOT NULL,
  sample_size INTEGER NOT NULL CHECK (sample_size IN (10, 20)),
  statistics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, league_id, category, sample_size)
);

CREATE INDEX idx_stats_cache_team ON public.statistics_cache(team_id);
CREATE INDEX idx_stats_cache_league ON public.statistics_cache(league_id);
CREATE INDEX idx_stats_cache_lookup ON public.statistics_cache(team_id, league_id, category, sample_size);
CREATE INDEX idx_stats_cache_category ON public.statistics_cache(category);
CREATE INDEX idx_stats_cache_statistics ON public.statistics_cache USING GIN (statistics);

ALTER TABLE public.statistics_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Stats cache readable by everyone"
  ON public.statistics_cache FOR SELECT USING (true);

CREATE POLICY "Auth insert stats cache"
  ON public.statistics_cache FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Auth update stats cache"
  ON public.statistics_cache FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Auth delete stats cache"
  ON public.statistics_cache FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_statistics_cache_updated_at
  BEFORE UPDATE ON public.statistics_cache
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON COLUMN public.statistics_cache.statistics IS
  'JSONB with over/under percentages. goals: keys over_0_5..over_4_5 and under_*; cards: 0_5..6_5; corners: 5_5..11_5';
