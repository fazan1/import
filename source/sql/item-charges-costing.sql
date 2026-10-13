-- =====================================================================
-- SHIPPING CHARGES PER ITEM  ->  COSTING  (v102)
-- 1. Shipping -> Charges is now entered ITEM BY ITEM: each packing-list item gets its own
--    basis (KG / CBM / PCS / FIXED), quantity, rate and amount  (table shipment_item_charges).
-- 2. Costing & Duty takes that item's charge and divides it by the item's quantity:
--        charge per unit  = item charge / qty
--        landed per unit  = (CNY price x rate) + charge per unit
--    The old "duty basis / duty rate" estimate is no longer used (the columns stay, unused).
-- 3. The costing figures are worked out by ONE known calculation (trigger zzzz_costing_calc),
--    so every screen (Costing, Shipping, Dashboard, Reports) shows the same numbers.
-- Existing costings keep their landed cost: their old "duty per unit" becomes "charge per unit".
-- Nothing is deleted. Safe to re-run. The "book lock" count goes UP by one.
-- Run on your MAIN project only.
-- =====================================================================

-- helper (repeated so this file runs on its own)
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS book text;
CREATE OR REPLACE FUNCTION public.my_locked_book() RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT book FROM public.app_users
  WHERE user_id = auth.uid() AND role <> 'admin' AND book IS NOT NULL
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.my_locked_book() TO authenticated, anon;

SELECT (SELECT count(*) FROM pg_policy WHERE polname = 'book lock') AS book_locks_before;

-- ---------------------------------------------------------------------
-- 1. charges per item
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shipment_item_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  packing_list_item_id uuid NOT NULL,
  purchase_bill_id uuid,
  basis text NOT NULL DEFAULT 'KG' CHECK (basis IN ('KG', 'CBM', 'PCS', 'FIXED')),
  qty numeric NOT NULL DEFAULT 0,       -- kg / cbm / pieces the rate applies to
  rate numeric NOT NULL DEFAULT 0,      -- LKR per kg / cbm / piece
  amount numeric NOT NULL DEFAULT 0,    -- LKR for this item (qty x rate, or the fixed amount)
  book text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shipment_id, packing_list_item_id)
);
CREATE INDEX IF NOT EXISTS shipment_item_charges_item_idx ON public.shipment_item_charges(packing_list_item_id);

-- book: the shipment's book (the shop login is always its own book) — same rule as shipment_charges
CREATE OR REPLACE FUNCTION public.item_charge_book() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b text; lb text := public.my_locked_book();
BEGIN
  SELECT book INTO b FROM public.shipments WHERE id = NEW.shipment_id;
  IF lb IS NOT NULL THEN NEW.book := lb;
  ELSIF b IS NOT NULL THEN NEW.book := b;
  ELSIF NEW.book IS NULL THEN NEW.book := 'LCL 2026';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_item_charge_book ON public.shipment_item_charges;
CREATE TRIGGER trg_item_charge_book BEFORE INSERT OR UPDATE ON public.shipment_item_charges
  FOR EACH ROW EXECUTE FUNCTION public.item_charge_book();

REVOKE ALL ON public.shipment_item_charges FROM anon;
ALTER TABLE public.shipment_item_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "open all" ON public.shipment_item_charges;
CREATE POLICY "open all" ON public.shipment_item_charges FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "book lock" ON public.shipment_item_charges;
CREATE POLICY "book lock" ON public.shipment_item_charges AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.my_locked_book()) IS NULL OR book = (SELECT public.my_locked_book()))
  WITH CHECK ((SELECT public.my_locked_book()) IS NULL OR book = (SELECT public.my_locked_book()));
DO $$ BEGIN
  IF to_regprocedure('public.is_app_member()') IS NOT NULL THEN
    DROP POLICY IF EXISTS "members only" ON public.shipment_item_charges;
    CREATE POLICY "members only" ON public.shipment_item_charges AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING ((SELECT public.is_app_member())) WITH CHECK ((SELECT public.is_app_member()));
  END IF;
  IF to_regprocedure('public.guard_book_mode()') IS NOT NULL THEN       -- a closed book can't be changed
    DROP TRIGGER IF EXISTS trg_zz_book_mode ON public.shipment_item_charges;
    CREATE TRIGGER trg_zz_book_mode BEFORE INSERT OR UPDATE OR DELETE ON public.shipment_item_charges
      FOR EACH ROW EXECUTE FUNCTION public.guard_book_mode('other');
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. costing: charge per unit, worked out by one known calculation
-- ---------------------------------------------------------------------
ALTER TABLE public.costing_duty_sheet ADD COLUMN IF NOT EXISTS charge_per_unit numeric;
ALTER TABLE public.costing_duty_sheet ADD COLUMN IF NOT EXISTS charge_basis text;   -- KG / CBM / PCS / FIXED / MANUAL (for display)

-- figures that used to be calculated inside the column become normal columns (values kept)
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'costing_duty_sheet' AND is_generated = 'ALWAYS' LOOP
    EXECUTE format('ALTER TABLE public.costing_duty_sheet ALTER COLUMN %I DROP EXPRESSION', c);
    RAISE NOTICE 'costing column is now a normal column (value kept): %', c;
  END LOOP;
END $$;

-- existing costings keep their landed cost: the old duty per unit becomes the charge per unit
UPDATE public.costing_duty_sheet SET charge_per_unit = COALESCE(duty_per_unit, 0), charge_basis = COALESCE(charge_basis, 'OLD')
 WHERE charge_per_unit IS NULL;
ALTER TABLE public.costing_duty_sheet ALTER COLUMN charge_per_unit SET DEFAULT 0;

CREATE OR REPLACE FUNCTION public.costing_calc() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.qty             := COALESCE(NEW.qty, 0);
  NEW.charge_per_unit := COALESCE(NEW.charge_per_unit, 0);
  NEW.unit_price_lkr  := round(COALESCE(NEW.unit_price_cny, 0) * COALESCE(NEW.cny_rate, 0), 4);
  NEW.duty_per_unit   := NEW.charge_per_unit;                               -- old screens read this name
  NEW.landed_cost_per_unit := NEW.unit_price_lkr + NEW.charge_per_unit;
  NEW.total_landed_cost    := round(NEW.landed_cost_per_unit * NEW.qty, 2);
  IF COALESCE(NEW.selling_price, 0) > 0 THEN
    NEW.profit_per_unit := NEW.selling_price - NEW.landed_cost_per_unit;
    NEW.total_sales     := round(NEW.selling_price * NEW.qty, 2);
    NEW.total_profit    := round(NEW.profit_per_unit * NEW.qty, 2);
  ELSE
    NEW.profit_per_unit := 0; NEW.total_sales := 0; NEW.total_profit := 0;
  END IF;
  RETURN NEW;
END $$;
-- named zzzz_ so it runs after any other "before" trigger on this table: its figures are the final ones
DROP TRIGGER IF EXISTS zzzz_costing_calc ON public.costing_duty_sheet;
CREATE TRIGGER zzzz_costing_calc BEFORE INSERT OR UPDATE ON public.costing_duty_sheet
  FOR EACH ROW EXECUTE FUNCTION public.costing_calc();

NOTIFY pgrst, 'reload schema';

-- 3. check (paste the result back)
SELECT (SELECT count(*) FROM public.costing_duty_sheet WHERE charge_per_unit IS NOT NULL) AS costing_lines_ready,
       (SELECT count(*) FROM pg_trigger WHERE tgname = 'zzzz_costing_calc') AS costing_calc_on,
       (SELECT count(*) FROM pg_policy WHERE polname = 'book lock') AS book_locks_after,
       'item charges ready' AS status;
