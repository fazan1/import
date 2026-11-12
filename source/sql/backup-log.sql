-- Nightly backup log (v196). Run on the MAIN project. Safe to re-run; deletes nothing.
-- /api/backup writes one row per run; Settings -> Backup shows the last automatic backup.
CREATE TABLE IF NOT EXISTS public.backup_log (
  id bigserial PRIMARY KEY,
  taken_at timestamptz NOT NULL DEFAULT now(),
  tables integer NOT NULL DEFAULT 0,
  rows integer NOT NULL DEFAULT 0,
  bytes bigint NOT NULL DEFAULT 0,
  "where" text,
  ok boolean NOT NULL DEFAULT true,
  note text,
  seconds integer
);
ALTER TABLE public.backup_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read backup_log" ON public.backup_log;
CREATE POLICY "members read backup_log" ON public.backup_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users u WHERE u.user_id = auth.uid() AND u.is_active));
REVOKE ALL ON public.backup_log FROM anon;
GRANT SELECT ON public.backup_log TO authenticated;
GRANT ALL ON public.backup_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.backup_log_id_seq TO service_role;
SELECT 'backup log ready' AS what, count(*) AS runs_recorded FROM public.backup_log;
