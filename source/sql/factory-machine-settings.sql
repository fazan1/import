-- FACTORY -> MACHINE SETTINGS: one row per machine per setting (the owner's notebook of each glove machine's controller values).
-- Safe to re-run. Deletes nothing. Run on the MAIN Supabase project only.
CREATE TABLE IF NOT EXISTS public.factory_machine_settings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine    text NOT NULL,
  param_key  text NOT NULL,
  value      text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (machine, param_key)
);
ALTER TABLE public.factory_machine_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.factory_machine_settings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.factory_machine_settings TO authenticated;
DROP POLICY IF EXISTS "open all" ON public.factory_machine_settings;
CREATE POLICY "open all" ON public.factory_machine_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'is_app_member') THEN
    DROP POLICY IF EXISTS "members only" ON public.factory_machine_settings;
    CREATE POLICY "members only" ON public.factory_machine_settings AS RESTRICTIVE FOR ALL TO anon, authenticated USING ((SELECT public.is_app_member())) WITH CHECK ((SELECT public.is_app_member()));
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
SELECT count(*) AS rows_saved, 'machine settings table ready' AS status FROM public.factory_machine_settings;
