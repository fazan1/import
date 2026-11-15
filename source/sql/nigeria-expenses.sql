-- NG expenses & duty (v204). Run on the MAIN project after nigeria-setup.sql. Safe to re-run; deletes nothing.
CREATE TABLE IF NOT EXISTS public.ng_expenses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date  date NOT NULL DEFAULT CURRENT_DATE,
  category    text NOT NULL DEFAULT 'Other',         -- Customs duty / Shipping / Clearing / Transport / Rent / Salary / Other
  description text,
  amount      numeric NOT NULL,                      -- in the currency below
  currency    text NOT NULL DEFAULT 'NGN' CHECK (currency IN ('NGN', 'RMB')),
  rate        numeric,                               -- Naira per 1 RMB used for this entry
  reference   text,                                  -- shipment / proforma it belongs to (PI-001); empty = general
  note        text,
  user_id     uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ng_expenses_date_idx ON public.ng_expenses (entry_date);
ALTER TABLE public.ng_expenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ng_expenses FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ng_expenses TO authenticated;
DROP POLICY IF EXISTS "open all" ON public.ng_expenses;
CREATE POLICY "open all" ON public.ng_expenses FOR ALL TO authenticated USING (true) WITH CHECK (true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'is_app_member') THEN
    DROP POLICY IF EXISTS "members only" ON public.ng_expenses;
    CREATE POLICY "members only" ON public.ng_expenses AS RESTRICTIVE FOR ALL TO anon, authenticated USING ((SELECT public.is_app_member())) WITH CHECK ((SELECT public.is_app_member()));
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
SELECT 'ng expenses ready' AS status, count(*) AS rows FROM public.ng_expenses;
