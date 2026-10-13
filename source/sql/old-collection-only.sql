-- =====================================================================
-- OLD BOOK = COLLECTION ONLY  (v96)
-- The OLD book stays open so you can collect what old customers owe and pay old suppliers:
--   ALLOWED in OLD : customer receipts, cheques, opening-balance payments, supplier payments,
--                    investor / agent entries, and correcting or deleting existing old records
--   BLOCKED in OLD : NEW purchase orders, bills, shipments, PL input, packing lists, costing sheets,
--                    sales orders and sales invoices  -> these go in LCL 2026
--   (restoring a deleted old record from the Recycle Bin still works)
-- LCL 2026 and BLINE SHOP are not affected. The shop login is not affected.
--
-- Later, when every old customer has paid, lock OLD completely (reference only) with this one line:
--   UPDATE public.book_settings SET mode = 'closed', updated_at = now() WHERE book = 'OLD';
-- and to undo:   UPDATE public.book_settings SET mode = 'collection', updated_at = now() WHERE book = 'OLD';
--
-- Nothing is deleted. The "book lock" policies are not touched. Safe to re-run
-- (re-running never changes a mode you already set). Run on your MAIN project only.
-- =====================================================================

-- 1. the setting per book: open / collection / closed
CREATE TABLE IF NOT EXISTS public.book_settings (
  book text PRIMARY KEY,
  mode text NOT NULL DEFAULT 'open' CHECK (mode IN ('open', 'collection', 'closed')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.book_settings (book, mode) VALUES ('OLD', 'collection') ON CONFLICT (book) DO NOTHING;
INSERT INTO public.book_settings (book, mode) VALUES ('LCL 2026', 'open')  ON CONFLICT (book) DO NOTHING;
INSERT INTO public.book_settings (book, mode) VALUES ('BLINE SHOP', 'open') ON CONFLICT (book) DO NOTHING;

-- every login may read it, only an admin may change it, the public key gets nothing
REVOKE ALL ON public.book_settings FROM anon;
ALTER TABLE public.book_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "open all" ON public.book_settings;
CREATE POLICY "open all" ON public.book_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
DO $$ BEGIN
  IF to_regprocedure('public.is_app_member()') IS NOT NULL THEN
    DROP POLICY IF EXISTS "members only" ON public.book_settings;
    CREATE POLICY "members only" ON public.book_settings AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING ((SELECT public.is_app_member())) WITH CHECK ((SELECT public.is_app_member()));
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.is_app_admin() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_users WHERE user_id = auth.uid() AND role = 'admin' AND is_active);
$$;
DROP POLICY IF EXISTS "admin changes book settings" ON public.book_settings;
CREATE POLICY "admin changes book settings" ON public.book_settings AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK ((SELECT public.is_app_admin()));
DROP POLICY IF EXISTS "admin updates book settings" ON public.book_settings;
CREATE POLICY "admin updates book settings" ON public.book_settings AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING ((SELECT public.is_app_admin())) WITH CHECK ((SELECT public.is_app_admin()));
DROP POLICY IF EXISTS "admin removes book settings" ON public.book_settings;
CREATE POLICY "admin removes book settings" ON public.book_settings AS RESTRICTIVE FOR DELETE TO anon, authenticated
  USING ((SELECT public.is_app_admin()));

CREATE OR REPLACE FUNCTION public.book_mode(p_book text) RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE((SELECT mode FROM public.book_settings WHERE book = p_book), 'open');
$$;
REVOKE EXECUTE ON FUNCTION public.book_mode(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_mode(text) TO authenticated, service_role;

-- 2. the guard. TG_ARGV[0] = 'document' (new ones blocked in collection mode) or 'other'
CREATE OR REPLACE FUNCTION public.guard_book_mode() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b text; ob text; m text; restoring boolean := false;
  what text := replace(TG_TABLE_NAME, '_', ' ');
BEGIN
  IF TG_OP = 'DELETE' THEN b := OLD.book; ELSE b := NEW.book; END IF;
  IF TG_OP = 'UPDATE' THEN ob := OLD.book; END IF;

  -- closed book: no change of any kind (also not moving a record out of it)
  IF public.book_mode(b) = 'closed' OR (ob IS NOT NULL AND public.book_mode(ob) = 'closed') THEN
    RAISE EXCEPTION 'The % book is closed (reference only). Nothing can be added, changed or deleted there.', COALESCE(CASE WHEN public.book_mode(b) = 'closed' THEN b END, ob);
  END IF;

  m := public.book_mode(b);
  IF m = 'collection' AND TG_OP = 'INSERT' AND TG_ARGV[0] = 'document' THEN
    -- putting back a record from the Recycle Bin is allowed
    IF to_regclass('public.recycle_bin') IS NOT NULL THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.recycle_bin WHERE source_id::text = $1)' INTO restoring USING NEW.id::text;
    END IF;
    IF NOT restoring THEN
      RAISE EXCEPTION 'The % book is collection-only: receipts and payments can be recorded there, but new % must be made in LCL 2026.', b, what;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- 3. attach it (named trg_zz_... so it runs AFTER the book-stamping triggers)
DO $$
DECLARE t text; kind text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'purchase_orders','purchase_bills','shipments','costing_duty_sheet','packing_lists','pl_input',
    'busy_sales_orders','busy_sales_invoices',
    'purchase_payments','busy_sales_payments','customer_payments','investor_ledger',
    'shipment_charges','agent_ledger','packing_list_items'
  ] LOOP
    kind := CASE WHEN t IN ('purchase_orders','purchase_bills','shipments','costing_duty_sheet','packing_lists','pl_input',
                            'busy_sales_orders','busy_sales_invoices') THEN 'document' ELSE 'other' END;
    IF to_regclass('public.' || t) IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'book') THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_zz_book_mode ON public.%I', t);
      EXECUTE format('CREATE TRIGGER trg_zz_book_mode BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_book_mode(%L)', t, kind);
      RAISE NOTICE 'book mode guard (%): %', kind, t;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- 4. check (paste the result back)
SELECT book, mode FROM public.book_settings ORDER BY book;
SELECT c.relname AS guarded_table FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
WHERE tg.tgname = 'trg_zz_book_mode' ORDER BY 1;
SELECT (SELECT count(*) FROM pg_policy WHERE polname = 'book lock') AS book_locks_total,
       'old book collection-only ready' AS status;
