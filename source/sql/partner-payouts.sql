-- =====================================================================
-- PARTNER PAYOUTS (v128) — paying the partner's share of DOUBLE sales invoices
--   sl_partner_payouts : each payment you make to a partner (date, amount, cash/bank), linked to the invoice
--   busy_sales_invoices.partner_gets_cost : tick when the PARTNER paid the cost (then you owe cost + share)
-- Rule in the app: you can pay the partner only out of what the customer has already paid.
-- Kept per book (LCL 2026 / BLINE SHOP never mix). Nothing is deleted. Safe to re-run. Run on your MAIN project only.
-- =====================================================================

ALTER TABLE public.busy_sales_invoices ADD COLUMN IF NOT EXISTS partner_gets_cost boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.sl_partner_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_invoice_id uuid REFERENCES public.busy_sales_invoices(id) ON DELETE SET NULL,
  invoice_number text,
  partner_name text NOT NULL,
  payout_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL CHECK (amount > 0),
  payment_mode text,
  note text,
  book text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sl_partner_payouts_invoice_idx ON public.sl_partner_payouts(sales_invoice_id);

-- lock helper (same as the shop lock; repeated so this file can run on its own)
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS book text;
CREATE OR REPLACE FUNCTION public.my_locked_book() RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT book FROM public.app_users
  WHERE user_id = auth.uid() AND role <> 'admin' AND book IS NOT NULL
  LIMIT 1;
$$;

-- book stamping: a payout follows its invoice's book; a locked (shop) login is always its own book
CREATE OR REPLACE FUNCTION public.partner_payout_book() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b text; lb text := public.my_locked_book();
BEGIN
  IF NEW.sales_invoice_id IS NOT NULL THEN
    SELECT book INTO b FROM public.busy_sales_invoices WHERE id = NEW.sales_invoice_id;
  END IF;
  IF lb IS NOT NULL THEN NEW.book := lb;
  ELSIF b IS NOT NULL THEN NEW.book := b;
  ELSIF NEW.book IS NULL THEN NEW.book := 'LCL 2026';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_partner_payout_book ON public.sl_partner_payouts;
CREATE TRIGGER trg_partner_payout_book BEFORE INSERT OR UPDATE ON public.sl_partner_payouts
  FOR EACH ROW EXECUTE FUNCTION public.partner_payout_book();

-- security: logged-in members only, shop login only its own book
REVOKE ALL ON public.sl_partner_payouts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sl_partner_payouts TO authenticated;
ALTER TABLE public.sl_partner_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payouts all" ON public.sl_partner_payouts;
CREATE POLICY "payouts all" ON public.sl_partner_payouts FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "book lock" ON public.sl_partner_payouts;
CREATE POLICY "book lock" ON public.sl_partner_payouts AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.my_locked_book()) IS NULL OR book = (SELECT public.my_locked_book()))
  WITH CHECK ((SELECT public.my_locked_book()) IS NULL OR book = (SELECT public.my_locked_book()));
DO $$
BEGIN
  IF to_regprocedure('public.is_app_member()') IS NOT NULL THEN
    DROP POLICY IF EXISTS "members only" ON public.sl_partner_payouts;
    CREATE POLICY "members only" ON public.sl_partner_payouts AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING ((SELECT public.is_app_member())) WITH CHECK ((SELECT public.is_app_member()));
  END IF;
  -- closed book = no changes (same guard as the other money tables)
  IF to_regprocedure('public.guard_book_mode()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_zz_book_mode ON public.sl_partner_payouts;
    CREATE TRIGGER trg_zz_book_mode BEFORE INSERT OR UPDATE OR DELETE ON public.sl_partner_payouts
      FOR EACH ROW EXECUTE FUNCTION public.guard_book_mode('other');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

SELECT to_regclass('public.sl_partner_payouts') IS NOT NULL AS payouts_table,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'busy_sales_invoices' AND column_name = 'partner_gets_cost') AS cost_tick,
       EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.sl_partner_payouts'::regclass AND polname = 'members only') AS members_only,
       'partner payouts ready' AS status;
