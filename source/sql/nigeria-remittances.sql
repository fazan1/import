-- Sales NG: money received from the partner (v215). Run on the MAIN project after nigeria-setup.sql. Safe to re-run; deletes nothing.
CREATE TABLE IF NOT EXISTS public.ng_remittances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rec_date      date NOT NULL DEFAULT CURRENT_DATE,
  amount_ngn    numeric NOT NULL,                      -- Naira value the partner sent
  method        text,                                  -- Bank / USDT / Cash / Other
  got_amount    numeric,                               -- what we actually received (optional)
  got_currency  text,                                  -- LKR / USD / RMB
  sale_id       uuid REFERENCES public.ng_stock(id) ON DELETE SET NULL,   -- the sale it is for (optional; else oldest-first)
  reference     text,
  note          text,
  user_id       uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ng_remittances_date_idx ON public.ng_remittances (rec_date);
ALTER TABLE public.ng_remittances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ng_remittances FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ng_remittances TO authenticated;
DROP POLICY IF EXISTS "open all" ON public.ng_remittances;
CREATE POLICY "open all" ON public.ng_remittances FOR ALL TO authenticated USING (true) WITH CHECK (true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'is_app_member') THEN
    DROP POLICY IF EXISTS "members only" ON public.ng_remittances;
    CREATE POLICY "members only" ON public.ng_remittances AS RESTRICTIVE FOR ALL TO anon, authenticated USING ((SELECT public.is_app_member())) WITH CHECK ((SELECT public.is_app_member()));
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
SELECT 'ng remittances ready' AS status, count(*) AS rows FROM public.ng_remittances;
