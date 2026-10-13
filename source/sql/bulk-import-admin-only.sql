-- =====================================================================
-- RESTORE (bulk_import) = ADMIN ONLY  (v100)
-- Settings -> Backup & Restore calls the database function bulk_import. It skips the normal
-- row rules, so until now any active login could call it directly. This puts an admin check
-- in front of it — your existing function is kept exactly as it is (renamed to
-- bulk_import_unchecked) and only an admin can reach it.
-- Your Restore button works as before. Nothing is deleted. Safe to re-run.
-- Run on your MAIN project only.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.is_app_admin() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_users WHERE user_id = auth.uid() AND role = 'admin' AND is_active);
$$;

DO $do$
DECLARE
  f oid; args text; ident text; ret text; names text[]; types oid[]; call_args text := ''; i int;
BEGIN
  -- 1. keep the original, once (a re-run finds it already renamed)
  IF to_regproc('public.bulk_import_unchecked') IS NULL THEN
    IF to_regproc('public.bulk_import') IS NULL THEN
      RAISE NOTICE 'No bulk_import function in this database - nothing to do.';
      RETURN;
    END IF;
    SELECT p.oid INTO f FROM pg_proc p WHERE p.oid = 'public.bulk_import'::regproc;
    EXECUTE format('ALTER FUNCTION public.bulk_import(%s) RENAME TO bulk_import_unchecked', pg_get_function_identity_arguments(f));
  END IF;

  -- 2. same name, same parameters, same result as the original — plus the admin check
  SELECT p.oid INTO f FROM pg_proc p WHERE p.oid = 'public.bulk_import_unchecked'::regproc;
  args  := pg_get_function_arguments(f);
  ident := pg_get_function_identity_arguments(f);
  ret   := pg_get_function_result(f);
  SELECT p.proargnames, p.proargtypes::oid[] INTO names, types FROM pg_proc p WHERE p.oid = f;
  FOR i IN 1 .. COALESCE(array_length(types, 1), 0) LOOP
    call_args := call_args || CASE WHEN i > 1 THEN ', ' ELSE '' END || quote_ident(names[i]);
  END LOOP;

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION public.bulk_import(%s) RETURNS %s
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$
    BEGIN
      IF NOT public.is_app_admin() THEN
        RAISE EXCEPTION 'Only an admin can restore a backup';
      END IF;
      %s public.bulk_import_unchecked(%s);
    END $body$
    $fn$,
    args, ret,
    CASE WHEN ret = 'void' THEN 'PERFORM' ELSE 'RETURN' END, call_args);

  -- 3. only the checked one can be called from the website
  EXECUTE format('REVOKE ALL ON FUNCTION public.bulk_import_unchecked(%s) FROM PUBLIC, anon, authenticated', ident);
  EXECUTE format('REVOKE ALL ON FUNCTION public.bulk_import(%s) FROM PUBLIC, anon', ident);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.bulk_import(%s) TO authenticated, service_role', ident);
  RAISE NOTICE 'bulk_import is now admin-only';
END $do$;

NOTIFY pgrst, 'reload schema';

SELECT p.proname AS function_name, pg_get_function_arguments(p.oid) AS takes,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS logins_can_call
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('bulk_import', 'bulk_import_unchecked')
ORDER BY 1;
SELECT 'restore is admin-only' AS status;
