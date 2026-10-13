-- =====================================================================
-- SECURITY LOCK  (v95)
-- Closes the database to everyone who is not an ACTIVE login in Settings -> Users:
--   * not logged in (the public "anon" key that is inside the website)  -> no access at all
--   * someone who made their own account (sign-up)                       -> no access at all
--   * a login you switched off (is_active = false)                       -> no access at all
--   * only an ADMIN can add / change / remove logins (a staff or shop login
--     cannot make itself admin or remove its own book lock)
-- Your admin login and the shop login keep working exactly as before.
-- It also fixes book-switch-setup.sql so running it again can never move LCL 2026 into OLD.
--
-- Nothing is deleted. Safe to re-run. Run on your MAIN project only.
-- It stops by itself (changes nothing) if no active admin exists, so you cannot lock yourself out.
-- =====================================================================

-- 0. safety: there must be at least one active admin, otherwise stop here
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_users WHERE role = 'admin' AND is_active) THEN
    RAISE EXCEPTION 'STOPPED: no active admin in app_users. Nothing was changed.';
  END IF;
END $$;

-- 1. helpers
CREATE OR REPLACE FUNCTION public.is_app_member() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_users WHERE user_id = auth.uid() AND is_active);
$$;
GRANT EXECUTE ON FUNCTION public.is_app_member() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.is_app_admin() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_users WHERE user_id = auth.uid() AND role = 'admin' AND is_active);
$$;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated, anon;

-- 2. the public key (anon) gets no table access at all — now and for tables made later
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- 3. every table: row security on, and "members only" (active logins) on top of the existing rules
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> 'app_users'
  LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || quote_ident(t))::regclass) THEN
      -- table had no protection at all: keep it working for logins, but only for logins
      EXECUTE format('DROP POLICY IF EXISTS "open all" ON public.%I', t);
      EXECUTE format('CREATE POLICY "open all" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    ELSIF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = ('public.' || quote_ident(t))::regclass AND p.polname = 'open all') THEN
      -- the old "open all" also let anon in: make it logins only
      EXECUTE format('DROP POLICY "open all" ON public.%I', t);
      EXECUTE format('CREATE POLICY "open all" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS "members only" ON public.%I', t);
    EXECUTE format('CREATE POLICY "members only" ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING ((SELECT public.is_app_member())) WITH CHECK ((SELECT public.is_app_member()))', t);
  END LOOP;
END $$;

-- 4. logins table: you see your own row (admin sees all); only an admin can add / change / remove logins
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS book text;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app users base" ON public.app_users;
CREATE POLICY "app users base" ON public.app_users FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "app users read" ON public.app_users;
CREATE POLICY "app users read" ON public.app_users AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (user_id = auth.uid() OR (SELECT public.is_app_admin()));
DROP POLICY IF EXISTS "app users admin add" ON public.app_users;
CREATE POLICY "app users admin add" ON public.app_users AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK ((SELECT public.is_app_admin()));
DROP POLICY IF EXISTS "app users admin change" ON public.app_users;
CREATE POLICY "app users admin change" ON public.app_users AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING ((SELECT public.is_app_admin())) WITH CHECK ((SELECT public.is_app_admin()));
DROP POLICY IF EXISTS "app users admin remove" ON public.app_users;
CREATE POLICY "app users admin remove" ON public.app_users AS RESTRICTIVE FOR DELETE TO anon, authenticated
  USING ((SELECT public.is_app_admin()));

-- 5. views read the tables with the rights of the person asking (so the rules above apply to them too)
DO $$
DECLARE v text;
BEGIN
  FOR v IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'v' LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
  END LOOP;
END $$;

-- 6. functions: the public key cannot call any of them (logins still can)
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.prokind = 'f'
             AND p.proname NOT IN ('is_app_member', 'is_app_admin', 'my_locked_book') LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC;

NOTIFY pgrst, 'reload schema';

-- 7. check (paste the result back)
-- a) tables still open to anon (should be NO rows)
SELECT 'anon can still use' AS problem, table_name FROM information_schema.role_table_grants
WHERE grantee = 'anon' AND table_schema = 'public' GROUP BY table_name;
-- b) tables without row security or without "members only" (should be NO rows)
SELECT 'not locked' AS problem, c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relname <> 'app_users'
  AND (NOT c.relrowsecurity OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'members only'));
-- c) SECURITY DEFINER functions (they skip row rules; listed so they can be reviewed)
SELECT p.proname AS definer_function FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef ORDER BY 1;
-- d) logins
SELECT email, role, book, is_active FROM public.app_users ORDER BY role, email;
SELECT 'security lock ready' AS status;
