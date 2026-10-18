-- =====================================================================
-- TRADE FINDER — clear Contacts & Follow-up (the 48 records imported from the old app)
-- The records are COPIED to trade_contacts_archive first (nothing is lost), then the list is emptied.
-- Safe to re-run (a second run finds nothing to move). Run on your MAIN project only.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.trade_contacts_archive (LIKE public.trade_contacts INCLUDING ALL);
ALTER TABLE public.trade_contacts_archive ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
REVOKE ALL ON public.trade_contacts_archive FROM anon;
ALTER TABLE public.trade_contacts_archive ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF to_regprocedure('public.is_app_member()') IS NOT NULL THEN
    DROP POLICY IF EXISTS "members only" ON public.trade_contacts_archive;
    CREATE POLICY "members only" ON public.trade_contacts_archive AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING ((SELECT public.is_app_member())) WITH CHECK ((SELECT public.is_app_member()));
  END IF;
END $$;

WITH moved AS (
  DELETE FROM public.trade_contacts RETURNING id, shop_name, channel, product, status, note, handler, contacted_at, updated_at
)
INSERT INTO public.trade_contacts_archive (id, shop_name, channel, product, status, note, handler, contacted_at, updated_at)
SELECT id, shop_name, channel, product, status, note, handler, contacted_at, updated_at FROM moved
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

SELECT (SELECT count(*) FROM public.trade_contacts) AS contacts_now,
       (SELECT count(*) FROM public.trade_contacts_archive) AS kept_in_archive,
       'contacts cleared' AS status;
