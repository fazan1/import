-- GUIDE PAGES -> "Ask about this setting": saves every question + answer against the setting it was asked on,
-- so the earlier answers show again under that setting on every phone / computer.
-- Safe to re-run. Deletes nothing. Run on the MAIN Supabase project only.
CREATE TABLE IF NOT EXISTS public.factory_setting_chats (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guide         text NOT NULL,          -- Pattern settings / Mechanical settings / Other parameters
  setting_title text NOT NULL,          -- the setting name shown on the page
  question      text NOT NULL,
  answer        text NOT NULL,
  user_id       uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS factory_setting_chats_setting_idx ON public.factory_setting_chats (guide, setting_title, created_at DESC);
ALTER TABLE public.factory_setting_chats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.factory_setting_chats FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.factory_setting_chats TO authenticated;
DROP POLICY IF EXISTS "open all" ON public.factory_setting_chats;
CREATE POLICY "open all" ON public.factory_setting_chats FOR ALL TO authenticated USING (true) WITH CHECK (true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'is_app_member') THEN
    DROP POLICY IF EXISTS "members only" ON public.factory_setting_chats;
    CREATE POLICY "members only" ON public.factory_setting_chats AS RESTRICTIVE FOR ALL TO anon, authenticated USING ((SELECT public.is_app_member())) WITH CHECK ((SELECT public.is_app_member()));
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
SELECT count(*) AS saved_chats, 'setting chats table ready' AS status FROM public.factory_setting_chats;
