
-- 1) Add btts to stat_category enum
ALTER TYPE public.stat_category ADD VALUE IF NOT EXISTS 'btts';

-- 2) Retention helper: purge finished matches older than Jan 1 of (current_year - 2)
CREATE OR REPLACE FUNCTION public.purge_old_matches()
RETURNS TABLE(cutoff date, deleted bigint)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cutoff date := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int - 2, 1, 1);
  v_deleted bigint;
BEGIN
  DELETE FROM public.matches
  WHERE match_date < v_cutoff;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT v_cutoff, v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_old_matches() TO service_role;
