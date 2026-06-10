
-- Merge duplicate Atlético Mineiro rows.
-- Empty shell dd5fcbd0 has 0 matches / 0 stats / 0 aliases — safe to delete.
-- Surviving row c0b4f503 (currently named "CA Mineiro") gets renamed to the
-- canonical "Atlético Mineiro" and receives the standard aliases.

BEGIN;

-- 1. Drop the empty shell team and its now-orphan teams_master row.
DELETE FROM public.teams         WHERE id = 'dd5fcbd0-31c3-4905-a2ba-fc75d5edaf72';
DELETE FROM public.teams_master  WHERE id = '9729af1d-54f5-4af1-9aa1-328ab6d7d2bb';

-- 2. Rename surviving canonical row. teams_set_normalized_name trigger will
--    recompute normalized_name to 'atletico mineiro'.
UPDATE public.teams
   SET name = 'Atlético Mineiro'
 WHERE id = 'c0b4f503-a25c-4965-86d1-d2d80e9d0b5d';

UPDATE public.teams_master
   SET official_name   = 'Atlético Mineiro',
       normalized_name = public.normalize_team_name('Atlético Mineiro')
 WHERE id = '53b25447-2d91-4335-af67-c30100780a76';

-- 3. Add aliases on the surviving row.
INSERT INTO public.team_aliases (team_id, alias, normalized_alias, source) VALUES
  ('c0b4f503-a25c-4965-86d1-d2d80e9d0b5d', 'CA Mineiro',                public.normalize_team_name('CA Mineiro'),                'merge'),
  ('c0b4f503-a25c-4965-86d1-d2d80e9d0b5d', 'Clube Atlético Mineiro',    public.normalize_team_name('Clube Atlético Mineiro'),    'merge'),
  ('c0b4f503-a25c-4965-86d1-d2d80e9d0b5d', 'Atlético-MG',               public.normalize_team_name('Atlético-MG'),               'merge'),
  ('c0b4f503-a25c-4965-86d1-d2d80e9d0b5d', 'Atlético MG',               public.normalize_team_name('Atlético MG'),               'merge')
ON CONFLICT DO NOTHING;

COMMIT;
