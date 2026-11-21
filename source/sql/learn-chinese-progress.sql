-- LEARN CHINESE: saves each login's progress (marks, daily review, mistakes, streak, goal) in the database,
-- so it follows you to every phone / computer and is in the nightly backup. One row per login; each login sees only its own.
-- Safe to re-run. Deletes nothing. Run on the MAIN Supabase project only.
CREATE TABLE IF NOT EXISTS public.learn_chinese_progress (
  user_id    uuid PRIMARY KEY DEFAULT auth.uid(),
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.learn_chinese_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.learn_chinese_progress FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.learn_chinese_progress TO authenticated;
DROP POLICY IF EXISTS "own row" ON public.learn_chinese_progress;
CREATE POLICY "own row" ON public.learn_chinese_progress FOR ALL TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'is_app_member') THEN
    DROP POLICY IF EXISTS "members only" ON public.learn_chinese_progress;
    CREATE POLICY "members only" ON public.learn_chinese_progress AS RESTRICTIVE FOR ALL TO anon, authenticated USING ((SELECT public.is_app_member())) WITH CHECK ((SELECT public.is_app_member()));
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
SELECT count(*) AS saved_logins, 'learn chinese progress table ready' AS status FROM public.learn_chinese_progress;
