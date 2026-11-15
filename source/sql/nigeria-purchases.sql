-- NG purchasing (v206): own suppliers, purchase orders / proformas and payments to the Chinese suppliers.
-- Completely separate from the Sri Lanka / shop CN Portal. Run on the MAIN project after nigeria-setup.sql.
-- Safe to re-run; deletes nothing.
CREATE TABLE IF NOT EXISTS public.ng_suppliers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  contact    text,
  phone      text,
  note       text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ng_purchases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number      text NOT NULL UNIQUE,                 -- NG-PO-001
  kind        text NOT NULL DEFAULT 'po' CHECK (kind IN ('po', 'pi')),
  supplier_id uuid REFERENCES public.ng_suppliers(id) ON DELETE RESTRICT,
  order_date  date NOT NULL DEFAULT CURRENT_DATE,
  status      text NOT NULL DEFAULT 'ordered' CHECK (status IN ('draft', 'ordered', 'paid', 'received', 'cancelled')),
  total_rmb   numeric NOT NULL DEFAULT 0,
  terms       text,                                 -- price term / packing / delivery
  note        text,
  received_at date,                                 -- set when "Receive into stock" is pressed
  user_id     uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ng_purchase_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.ng_purchases(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES public.ng_items(id) ON DELETE RESTRICT,
  quantity    numeric NOT NULL,                     -- in the item's unit (pcs)
  tons        numeric,                              -- as on the proforma, when bought per ton
  unit_price  numeric NOT NULL,                     -- RMB per unit
  amount_rmb  numeric NOT NULL,
  remark      text,
  sort_order  integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ng_purchase_items_purchase_idx ON public.ng_purchase_items (purchase_id);
CREATE TABLE IF NOT EXISTS public.ng_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.ng_suppliers(id) ON DELETE RESTRICT,
  purchase_id uuid REFERENCES public.ng_purchases(id) ON DELETE SET NULL,
  pay_date    date NOT NULL DEFAULT CURRENT_DATE,
  amount_rmb  numeric NOT NULL,
  paid_with   text,                                 -- TT / USDT / cash / agent
  paid_amount numeric,                              -- what it cost in the paying currency (optional)
  paid_currency text,                               -- LKR / NGN / USD
  reference   text,
  note        text,
  user_id     uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ng_payments_supplier_idx ON public.ng_payments (supplier_id, pay_date);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ng_suppliers', 'ng_purchases', 'ng_purchase_items', 'ng_payments'] LOOP
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
SELECT 'ng purchasing ready' AS status, (SELECT count(*) FROM public.ng_suppliers) AS suppliers, (SELECT count(*) FROM public.ng_purchases) AS purchases, (SELECT count(*) FROM public.ng_payments) AS payments;
