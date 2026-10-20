-- IMPORT CALCULATOR: empty the saved calculations list (owner is re-loading them from his other database).
-- Every row is COPIED to import_calculations_archive first, so nothing is lost. The saved rates (import_settings) stay.
-- Safe to re-run (a second run finds nothing to move). Run on the MAIN Supabase project only.

CREATE TABLE IF NOT EXISTS public.import_calculations_archive (LIKE public.import_calculations INCLUDING ALL);
ALTER TABLE public.import_calculations_archive ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.import_calculations_archive DROP CONSTRAINT IF EXISTS import_calculations_archive_pkey;

INSERT INTO public.import_calculations_archive
  SELECT c.*, now() FROM public.import_calculations c;

DELETE FROM public.import_calculations;

-- keep the archive private like everything else
ALTER TABLE public.import_calculations_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.import_calculations_archive FROM anon, authenticated;

SELECT 'still in the list' AS what, count(*) AS rows FROM public.import_calculations
UNION ALL SELECT 'kept in archive', count(*) FROM public.import_calculations_archive;
