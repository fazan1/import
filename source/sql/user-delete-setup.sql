-- =====================================================================
-- Lets an ADMIN delete another login (Settings -> Users -> Delete).
-- Only the LOGIN is removed. Every record that login created stays exactly
-- where it is (same book); it is simply handed over to the admin who deletes it.
-- You cannot delete yourself or the last admin.
-- This file itself deletes nothing. Safe to re-run. Run on your MAIN project only.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.is_app_admin() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_users WHERE user_id = auth.uid() AND role = 'admin' AND is_active);
$$;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE me uuid := auth.uid(); r record; n bigint;
BEGIN
  IF NOT public.is_app_admin() THEN RAISE EXCEPTION 'Only an admin can delete a login'; END IF;
  IF p_user = me THEN RAISE EXCEPTION 'You cannot delete your own login'; END IF;
  IF EXISTS (SELECT 1 FROM public.app_users WHERE user_id = p_user AND role = 'admin')
     AND (SELECT count(*) FROM public.app_users WHERE role = 'admin' AND is_active) <= 1 THEN
    RAISE EXCEPTION 'This is the last admin - it cannot be deleted';
  END IF;

  -- hand every record the login created over to you, so nothing is lost or blocked
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f'
      AND c.confrelid = 'auth.users'::regclass
      AND c.connamespace = 'public'::regnamespace
      AND c.conrelid <> 'public.app_users'::regclass
  LOOP
    EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', r.tbl, r.col, r.col) USING me, p_user;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE '% rows in %.% handed over', n, r.tbl, r.col; END IF;
  END LOOP;

  DELETE FROM public.app_users WHERE user_id = p_user;
  DELETE FROM auth.users WHERE id = p_user;
END $$;
REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
SELECT 'delete user ready' AS status;
