-- Backup read access (v197). Run on the MAIN project. Safe to re-run; deletes nothing.
-- The two archive tables were created without a read grant, so "Export all data" could not read them.
-- Gives active members READ ONLY on them (write stays as it was).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['import_calculations_archive', 'trade_contacts_archive'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS "members read %s" ON public.%I', t, t);
      EXECUTE format('CREATE POLICY "members read %s" ON public.%I FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.app_users u WHERE u.user_id = auth.uid() AND u.is_active))', t, t);
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
  END LOOP;
END $$;
SELECT 'backup read access ready' AS what,
       count(*) AS archive_tables_readable
FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'members read %_archive';
