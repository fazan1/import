-- =====================================================================
-- BOOKS STAY SEPARATE  (v97)
-- 1. Recycle Bin: every deleted record keeps its book. The shop login only sees the shop's
--    deleted records; your screens show the deleted records of the book you are in.
-- 2. The shop login is kept out of every table its screens do not use (CEO figures, calls,
--    old sales invoices, import calculator, factory, ...). Before, it could still read them
--    directly through the database. Its own screens are not affected.
-- Your admin login is not affected. Nothing is deleted. Safe to re-run.
-- Adds one "book lock" (Recycle Bin), so the count goes UP by one (never down).
-- Run on your MAIN project only.
-- =====================================================================

-- helper (same as before; repeated so this file can run on its own)
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS book text;
CREATE OR REPLACE FUNCTION public.my_locked_book() RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT book FROM public.app_users
  WHERE user_id = auth.uid() AND role <> 'admin' AND book IS NOT NULL
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.my_locked_book() TO authenticated, anon;

SELECT (SELECT count(*) FROM pg_policy WHERE polname = 'book lock') AS book_locks_before;

-- 1. Recycle Bin gets a book
DO $$ BEGIN
  IF to_regclass('public.recycle_bin') IS NOT NULL THEN
    ALTER TABLE public.recycle_bin ADD COLUMN IF NOT EXISTS book text;
    -- existing entries: the book of the deleted record; deleted masters (no book) belong to LCL 2026
    UPDATE public.recycle_bin SET book = COALESCE(NULLIF(record_data->>'book', ''), 'LCL 2026') WHERE book IS NULL;
    CREATE INDEX IF NOT EXISTS recycle_bin_book_idx ON public.recycle_bin(book);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.recycle_bin_book() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lb text := public.my_locked_book();
BEGIN
  IF lb IS NOT NULL THEN NEW.book := lb;                                     -- shop login: always the shop book
  ELSIF NEW.book IS NULL THEN NEW.book := COALESCE(NULLIF(NEW.record_data->>'book', ''), 'LCL 2026');
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF to_regclass('public.recycle_bin') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_recycle_bin_book ON public.recycle_bin;
    CREATE TRIGGER trg_recycle_bin_book BEFORE INSERT OR UPDATE ON public.recycle_bin
      FOR EACH ROW EXECUTE FUNCTION public.recycle_bin_book();
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.recycle_bin'::regclass) THEN
      DROP POLICY IF EXISTS "open all" ON public.recycle_bin;
      CREATE POLICY "open all" ON public.recycle_bin FOR ALL TO authenticated USING (true) WITH CHECK (true);
      ALTER TABLE public.recycle_bin ENABLE ROW LEVEL SECURITY;
    END IF;
    DROP POLICY IF EXISTS "book lock" ON public.recycle_bin;
    CREATE POLICY "book lock" ON public.recycle_bin AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT public.my_locked_book()) IS NULL OR book = (SELECT public.my_locked_book()))
      WITH CHECK ((SELECT public.my_locked_book()) IS NULL OR book = (SELECT public.my_locked_book()));
  END IF;
END $$;

-- 2. shop login: keep out of every table its screens don't use
DO $$
DECLARE t text;
  shop_uses text[] := ARRAY[
    -- the shop's own records (already split by book with "book lock")
    'purchase_orders','purchase_order_items','purchase_bills','purchase_bill_items','purchase_payments',
    'pl_input','packing_lists','packing_list_items','shipments','shipment_charges','costing_duty_sheet',
    'investors','investor_ledger','agent_ledger','so_po_links','recycle_bin',
    'busy_sales_orders','busy_sales_invoices','busy_sales_payments','customer_payments',
    -- shared lists (the shop can add, not change or delete)
    'items','suppliers','customers','clearing_agents',
    -- logins and book settings (each login reads only its own row)
    'app_users','book_settings'];
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT (c.relname = ANY (shop_uses))
  LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || quote_ident(t))::regclass) THEN
      EXECUTE format('DROP POLICY IF EXISTS "open all" ON public.%I', t);
      EXECUTE format('CREATE POLICY "open all" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS "locked keep out" ON public.%I', t);
    EXECUTE format('CREATE POLICY "locked keep out" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.my_locked_book()) IS NULL) WITH CHECK ((SELECT public.my_locked_book()) IS NULL)', t);
    RAISE NOTICE 'closed to the shop login: %', t;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- 3. check (paste the result back)
SELECT book, count(*) AS deleted_records FROM public.recycle_bin GROUP BY book ORDER BY 1;
SELECT string_agg(c.relname, ', ' ORDER BY c.relname) AS closed_to_shop
FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE p.polname = 'locked keep out';
SELECT (SELECT count(*) FROM pg_policy WHERE polname = 'book lock') AS book_locks_after,
       'books separate ready' AS status;
