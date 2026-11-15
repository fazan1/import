-- NIGERIA business (v199): its own items and stock, completely separate from the Sri Lanka items / books.
-- Safe to re-run. Deletes nothing. Run on the MAIN Supabase project only.
-- ng_items   = "Items NG": product, specification, finish, the unit sold in, pieces per ton, cost per unit in RMB
-- ng_stock   = every stock movement: in (purchase, cost RMB), out (sale, Naira), adjust; stock = in - out +/- adjust
-- ng_settings = key/value (default Naira-per-RMB rate, company name/address for prints)
CREATE TABLE IF NOT EXISTS public.ng_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  specification text,
  finish        text,                                -- ZP / HDG / ...
  unit          text NOT NULL DEFAULT 'pcs',         -- pcs / kg / bag / ton
  pcs_per_ton   numeric,
  cost_rmb      numeric NOT NULL DEFAULT 0,          -- cost per UNIT in RMB (latest purchase)
  sell_naira    numeric,                             -- partner's selling price per unit (optional)
  is_active     boolean NOT NULL DEFAULT true,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ng_stock (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       uuid NOT NULL REFERENCES public.ng_items(id) ON DELETE RESTRICT,
  kind          text NOT NULL CHECK (kind IN ('in', 'out', 'adjust')),
  entry_date    date NOT NULL DEFAULT CURRENT_DATE,
  quantity      numeric NOT NULL,                    -- in the item's unit; adjust may be negative
  cost_rmb      numeric,                             -- IN: total RMB paid for this quantity
  sale_naira    numeric,                             -- OUT: total Naira the partner sold for
  rate          numeric,                             -- Naira per 1 RMB on that day (OUT)
  reference     text,                                -- proforma / invoice number
  note          text,
  user_id       uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ng_stock_item_idx ON public.ng_stock (item_id, entry_date);
CREATE TABLE IF NOT EXISTS public.ng_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.ng_settings (key, value) VALUES ('rate', '{"naira_per_rmb": 0}'::jsonb) ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ng_items', 'ng_stock', 'ng_settings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS "open all" ON public.%I', t);
    EXECUTE format('CREATE POLICY "open all" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'is_app_member') THEN
      EXECUTE format('DROP POLICY IF EXISTS "members only" ON public.%I', t);
      EXECUTE format('CREATE POLICY "members only" ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING ((SELECT public.is_app_member())) WITH CHECK ((SELECT public.is_app_member()))', t);
    END IF;
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
SELECT 'nigeria tables ready' AS status, (SELECT count(*) FROM public.ng_items) AS items, (SELECT count(*) FROM public.ng_stock) AS stock_rows;
