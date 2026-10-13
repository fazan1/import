-- =====================================================================
-- 1. Lets an ADMIN set a new password for another login (Settings -> Users -> edit).
--    Also marks that login's email as confirmed, so it can sign in straight away.
-- 2. Makes sure every admin works in the normal books (no book lock).
-- 3. Shows every login and its settings.
-- Nothing is deleted. Safe to re-run. Run on your MAIN project only.
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.is_app_admin() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_users WHERE user_id = auth.uid() AND role = 'admin' AND is_active);
$$;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_password(p_user uuid, p_password text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, auth AS $$
BEGIN
  IF NOT public.is_app_admin() THEN RAISE EXCEPTION 'Only an admin can change another login''s password'; END IF;
  IF p_password IS NULL OR length(p_password) < 6 THEN RAISE EXCEPTION 'Password must be at least 6 characters'; END IF;
  UPDATE auth.users
     SET encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         email_confirmed_at = COALESCE(email_confirmed_at, now()),
         updated_at = now()
   WHERE id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Login not found'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_password(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_password(uuid, text) TO authenticated;

-- admins are never locked to a book
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS book text;
UPDATE public.app_users SET book = NULL WHERE role = 'admin' AND book IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- check: you = admin with no book; the shop login = staff, BLINE SHOP
SELECT a.email, a.role, a.book, a.is_active, array_length(a.modules, 1) AS modules,
       (u.email_confirmed_at IS NOT NULL) AS email_confirmed
FROM public.app_users a JOIN auth.users u ON u.id = a.user_id
ORDER BY a.role, a.email;
