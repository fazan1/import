-- =====================================================================
-- CHANGE HISTORY + CHARGES PER PACKING LIST + PACKING LIST CONNECTION  (v111)
-- Part 1: history.  Part 2: when an item's kg / CBM / qty changes in Packing List, its shipping
-- charge is worked out again with the rate saved in Shipping -> Charges, and Costing follows.
-- The database itself writes down every change to:
--   packing list lines (kg, CBM, packages, qty, ...), shipping charges per item,
--   clearing agent account lines and costing lines
-- with WHO changed it, WHEN, and each field's OLD -> NEW value.
-- Nobody can edit or delete the history from the app (it is written by the database only).
-- Each entry keeps its book, so the shop login only sees the shop's history.
-- Part 2: the shipping charge per packing list (bulk amount) gets its own table.
-- Nothing is deleted. Safe to re-run. The "book lock" count goes UP by two.
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

CREATE TABLE IF NOT EXISTS public.change_log (
  id bigserial PRIMARY KEY,
  changed_at timestamptz NOT NULL DEFAULT now(),
  table_name text NOT NULL,
  row_id text,
  action text NOT NULL,              -- added / changed / deleted
  batch text,                        -- shipment / batch number, to show the history of one shipment
  label text,                        -- item name / reference, so a person can read it
  changes jsonb,                     -- { "weight_kg": [old, new], ... }
  user_id uuid,
  user_email text,
  book text
);
CREATE INDEX IF NOT EXISTS change_log_batch_idx ON public.change_log(batch, changed_at DESC);
CREATE INDEX IF NOT EXISTS change_log_row_idx ON public.change_log(table_name, row_id);

CREATE OR REPLACE FUNCTION public.log_changes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  n jsonb := CASE WHEN TG_OP IN ('UPDATE', 'INSERT') THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
  r jsonb := CASE WHEN TG_OP = 'DELETE' THEN o ELSE n END;
  diff jsonb := '{}'::jsonb; k text; b text; who text; lbl text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(n) LOOP
      IF k NOT IN ('updated_at', 'created_at') AND (o -> k) IS DISTINCT FROM (n -> k) THEN
        diff := diff || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
      END IF;
    END LOOP;
    IF diff = '{}'::jsonb THEN RETURN NEW; END IF;          -- nothing really changed
  ELSE
    diff := r - 'created_at' - 'updated_at';
  END IF;

  b := COALESCE(r ->> 'batch_number', NULL);
  IF b IS NULL AND (r ->> 'shipment_id') IS NOT NULL THEN
    SELECT shipment_no INTO b FROM public.shipments WHERE id = (r ->> 'shipment_id')::uuid;
  END IF;
  SELECT email INTO who FROM public.app_users WHERE user_id = auth.uid();
  -- a readable name for lines that don't carry one
  IF TG_TABLE_NAME = 'shipment_item_charges' THEN
    SELECT item_name INTO lbl FROM public.packing_list_items WHERE id = (r ->> 'packing_list_item_id')::uuid;
  ELSIF TG_TABLE_NAME = 'shipment_pl_charges' THEN
    lbl := 'PL ' || COALESCE(r ->> 'packing_list_no', '-') || ' — shipping charge';
  ELSIF TG_TABLE_NAME = 'agent_ledger' THEN
    SELECT name INTO lbl FROM public.clearing_agents WHERE id = (r ->> 'agent_id')::uuid;
    lbl := COALESCE(lbl, 'Agent') || ' — ' || COALESCE(r ->> 'kind', '');
  END IF;

  INSERT INTO public.change_log (table_name, row_id, action, batch, label, changes, user_id, user_email, book)
  VALUES (TG_TABLE_NAME, r ->> 'id',
          CASE TG_OP WHEN 'INSERT' THEN 'added' WHEN 'UPDATE' THEN 'changed' ELSE 'deleted' END,
          b, COALESCE(lbl, r ->> 'item_name', r ->> 'description', r ->> 'reference', r ->> 'packing_list_no'),
          diff, auth.uid(), COALESCE(who, auth.jwt() ->> 'email'), r ->> 'book');
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['packing_list_items', 'shipment_item_charges', 'agent_ledger', 'costing_duty_sheet'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS zzzzz_log_changes ON public.%I', t);
      -- AFTER trigger: it records what was really saved (after every other calculation)
      EXECUTE format('CREATE TRIGGER zzzzz_log_changes AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_changes()', t);
    END IF;
  END LOOP;
END $$;

-- read-only for logins (only the database writes it), split by book, public key gets nothing
REVOKE ALL ON public.change_log FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.change_log FROM authenticated;
GRANT SELECT ON public.change_log TO authenticated;
ALTER TABLE public.change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read history" ON public.change_log;
CREATE POLICY "read history" ON public.change_log FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "book lock" ON public.change_log;
CREATE POLICY "book lock" ON public.change_log AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.my_locked_book()) IS NULL OR book = (SELECT public.my_locked_book()))
  WITH CHECK ((SELECT public.my_locked_book()) IS NULL OR book = (SELECT public.my_locked_book()));
DO $$ BEGIN
  IF to_regprocedure('public.is_app_member()') IS NOT NULL THEN
    DROP POLICY IF EXISTS "members only" ON public.change_log;
    CREATE POLICY "members only" ON public.change_log AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING ((SELECT public.is_app_member())) WITH CHECK ((SELECT public.is_app_member()));
  END IF;
END $$;

-- =====================================================================
-- PART 2: shipping charge PER PACKING LIST (the bulk amount, v111)
--   Shipping -> Charges: each packing list's total kg / CBM / pcs (from Packing List) x the rate typed there.
--   All packing lists added up = the shipment's bulk amount, billed to the clearing agent.
--   Costing keeps its OWN charge per item (type + rate typed in Costing); the screens show the difference.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.shipment_pl_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  pl_key text NOT NULL,                 -- PL Input id | packing list no  ('-' when empty)
  pl_input_id uuid,
  packing_list_no text,
  basis text NOT NULL DEFAULT 'KG' CHECK (basis IN ('KG', 'CBM', 'PCS', 'FIXED')),
  qty numeric NOT NULL DEFAULT 0,       -- the packing list's total kg / CBM / pcs
  rate numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  book text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shipment_id, pl_key)
);
-- book = the shipment's book (same rule as the item charges)
DROP TRIGGER IF EXISTS trg_pl_charge_book ON public.shipment_pl_charges;
CREATE TRIGGER trg_pl_charge_book BEFORE INSERT OR UPDATE ON public.shipment_pl_charges
  FOR EACH ROW EXECUTE FUNCTION public.item_charge_book();
REVOKE ALL ON public.shipment_pl_charges FROM anon;
ALTER TABLE public.shipment_pl_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "open all" ON public.shipment_pl_charges;
CREATE POLICY "open all" ON public.shipment_pl_charges FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "book lock" ON public.shipment_pl_charges;
CREATE POLICY "book lock" ON public.shipment_pl_charges AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.my_locked_book()) IS NULL OR book = (SELECT public.my_locked_book()))
  WITH CHECK ((SELECT public.my_locked_book()) IS NULL OR book = (SELECT public.my_locked_book()));
DO $$ BEGIN
  IF to_regprocedure('public.is_app_member()') IS NOT NULL THEN
    DROP POLICY IF EXISTS "members only" ON public.shipment_pl_charges;
    CREATE POLICY "members only" ON public.shipment_pl_charges AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING ((SELECT public.is_app_member())) WITH CHECK ((SELECT public.is_app_member()));
  END IF;
  IF to_regprocedure('public.guard_book_mode()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_zz_book_mode ON public.shipment_pl_charges;
    CREATE TRIGGER trg_zz_book_mode BEFORE INSERT OR UPDATE OR DELETE ON public.shipment_pl_charges
      FOR EACH ROW EXECUTE FUNCTION public.guard_book_mode('other');
  END IF;
  DROP TRIGGER IF EXISTS zzzzz_log_changes ON public.shipment_pl_charges;
  CREATE TRIGGER zzzzz_log_changes AFTER INSERT OR UPDATE OR DELETE ON public.shipment_pl_charges
    FOR EACH ROW EXECUTE FUNCTION public.log_changes();
END $$;

-- =====================================================================
-- PART 3: Packing List kg / CBM / qty change -> everything follows, automatically
--   Costing side: the item's own charge (its kg / CBM / qty x the rate typed in Costing) -> costing per unit.
--     (only items that already have a charge in Costing; nothing is charged by itself)
--   Bulk side: the packing list's total x the rate in Charges -> the shipment's total -> the agent's
--     account line (only when no different agent invoice was typed).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.packing_to_charges() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; q numeric; tq numeric; tot numeric; s record; k text;
BEGIN
  -- ---- costing side: the item's own charge ----
  IF to_regclass('public.shipment_item_charges') IS NOT NULL THEN
    FOR c IN SELECT * FROM public.shipment_item_charges WHERE packing_list_item_id = NEW.id AND basis IN ('KG', 'CBM', 'PCS') LOOP
      q := CASE c.basis WHEN 'KG' THEN COALESCE(NEW.weight_kg, 0) WHEN 'CBM' THEN COALESCE(NEW.cbm, 0) ELSE COALESCE(NEW.quantity, 0) END;
      IF q = COALESCE(c.qty, 0) THEN CONTINUE; END IF;
      UPDATE public.shipment_item_charges SET qty = q, amount = round(q * COALESCE(rate, 0), 2) WHERE id = c.id;
      SELECT COALESCE(sum(qty), 0) INTO tq FROM public.costing_duty_sheet WHERE packing_list_item_id = NEW.id;
      UPDATE public.costing_duty_sheet
         SET charge_per_unit = CASE WHEN tq > 0 THEN round(q * COALESCE(c.rate, 0) / tq, 4) ELSE 0 END, charge_basis = c.basis
       WHERE packing_list_item_id = NEW.id;
      IF c.purchase_bill_id IS NOT NULL AND to_regclass('public.shipment_charges') IS NOT NULL THEN
        UPDATE public.shipment_charges SET amount = (SELECT COALESCE(sum(amount), 0) FROM public.shipment_item_charges
                                                      WHERE shipment_id = c.shipment_id AND purchase_bill_id = c.purchase_bill_id)
         WHERE shipment_id = c.shipment_id AND purchase_bill_id = c.purchase_bill_id;
      END IF;
    END LOOP;
  END IF;

  -- ---- bulk side: the packing list's total x the rate in Charges ----
  IF NEW.batch_number IS NOT NULL THEN
    k := COALESCE(NEW.pl_input_id::text, '-') || '|' || COALESCE(NULLIF(NEW.packing_list_no, ''), '-');
    FOR c IN SELECT pc.* FROM public.shipment_pl_charges pc JOIN public.shipments sh ON sh.id = pc.shipment_id
              WHERE sh.shipment_no = NEW.batch_number AND pc.pl_key = k AND pc.basis IN ('KG', 'CBM', 'PCS') LOOP
      SELECT COALESCE(sum(CASE c.basis WHEN 'KG' THEN weight_kg WHEN 'CBM' THEN cbm ELSE quantity END), 0) INTO q
        FROM public.packing_list_items
       WHERE batch_number = NEW.batch_number AND pl_input_id IS NOT DISTINCT FROM NEW.pl_input_id
         AND COALESCE(NULLIF(packing_list_no, ''), '-') = COALESCE(NULLIF(NEW.packing_list_no, ''), '-');
      IF q = COALESCE(c.qty, 0) THEN CONTINUE; END IF;
      UPDATE public.shipment_pl_charges SET qty = q, amount = round(q * COALESCE(rate, 0), 2) WHERE id = c.id;
      SELECT id, COALESCE(agent_invoice, 0) AS inv, COALESCE(other_charges, 0) AS oth INTO s FROM public.shipments WHERE id = c.shipment_id;
      SELECT COALESCE(sum(amount), 0) INTO tot FROM public.shipment_pl_charges WHERE shipment_id = c.shipment_id;
      IF s.inv = 0 THEN
        UPDATE public.shipments SET actual_charges = round(tot + s.oth, 2) WHERE id = c.shipment_id;
        IF tot > 0 AND to_regclass('public.agent_ledger') IS NOT NULL THEN
          UPDATE public.agent_ledger SET amount = round(tot, 2) WHERE shipment_id = c.shipment_id AND kind = 'charge';
        END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zzzz_packing_to_charges ON public.packing_list_items;
CREATE TRIGGER zzzz_packing_to_charges AFTER UPDATE OF weight_kg, cbm, quantity ON public.packing_list_items
  FOR EACH ROW EXECUTE FUNCTION public.packing_to_charges();

NOTIFY pgrst, 'reload schema';

SELECT (SELECT count(*) FROM pg_trigger WHERE tgname = 'zzzzz_log_changes') AS tables_with_history,
       (SELECT count(*) FROM public.shipment_pl_charges) AS pl_charges,
       (SELECT count(*) FROM pg_trigger WHERE tgname = 'zzzz_packing_to_charges') AS packing_list_connected,
       (SELECT count(*) FROM pg_policy WHERE polname = 'book lock') AS book_locks_total,
       'history and auto charges ready' AS status;
