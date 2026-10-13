-- =====================================================================
-- BLINE SHOP LOCK (one file: main records + detail lines)
-- A login can be locked to one book. The DATABASE itself then enforces:
--   * he only sees rows of his book (your OLD / LCL 2026 rows are invisible to him)
--   * everything he saves is stamped into his book, whatever the screen sends
--   * he gets his own investor (your investor is never touched)
--   * masters (items, suppliers, customers) are shared: he can ADD, not edit or delete
--   * your Capital, Expenses and Warehouse tables are closed to him
-- Your own login (admin) works exactly as before.
-- Nothing is deleted. Safe to run more than once. Run on your MAIN project only.
-- =====================================================================

-- 1. which book a login is locked to (empty = normal)
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS book text;

CREATE OR REPLACE FUNCTION public.my_locked_book() RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT book FROM public.app_users
  WHERE user_id = auth.uid() AND role <> 'admin' AND book IS NOT NULL
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.my_locked_book() TO authenticated, anon;

-- 2. investors get a book too (your existing investor stays shared by OLD + LCL 2026)
ALTER TABLE public.investors ADD COLUMN IF NOT EXISTS book text;


-- 3. stamp: anything a locked login saves goes into his book
CREATE OR REPLACE FUNCTION public.stamp_locked_book() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lb text := public.my_locked_book();
BEGIN
  IF lb IS NOT NULL THEN NEW.book := lb; END IF;
  RETURN NEW;
END $$;

-- 4. lock every transaction table + investors
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'purchase_orders','purchase_bills','purchase_payments','shipments',
    'costing_duty_sheet','packing_lists','pl_input',
    'busy_sales_orders','busy_sales_invoices','busy_sales_payments',
    'customer_payments','investor_ledger','investors'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relname = t AND c.relkind IN ('r','p')) THEN
      IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || quote_ident(t))::regclass) THEN
        EXECUTE format('DROP POLICY IF EXISTS "open all" ON public.%I', t);
        EXECUTE format('CREATE POLICY "open all" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t);
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      END IF;
      EXECUTE format('DROP POLICY IF EXISTS "book lock" ON public.%I', t);
      EXECUTE format($p$CREATE POLICY "book lock" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
        USING ((SELECT public.my_locked_book()) IS NULL OR book = (SELECT public.my_locked_book()))
        WITH CHECK ((SELECT public.my_locked_book()) IS NULL OR book = (SELECT public.my_locked_book()))$p$, t);
      EXECUTE format('DROP TRIGGER IF EXISTS trg_stamp_locked_book ON public.%I', t);
      EXECUTE format('CREATE TRIGGER trg_stamp_locked_book BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.stamp_locked_book()', t);
      RAISE NOTICE 'locked by book: %', t;
    END IF;
  END LOOP;
END $$;

-- 5. masters: shared, he can add but not change or delete yours
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['items','suppliers','customers'] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relname = t AND c.relkind IN ('r','p')) THEN
      IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || quote_ident(t))::regclass) THEN
        EXECUTE format('DROP POLICY IF EXISTS "open all" ON public.%I', t);
        EXECUTE format('CREATE POLICY "open all" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t);
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      END IF;
      EXECUTE format('DROP POLICY IF EXISTS "locked no edit" ON public.%I', t);
      EXECUTE format('CREATE POLICY "locked no edit" ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT public.my_locked_book()) IS NULL)', t);
      EXECUTE format('DROP POLICY IF EXISTS "locked no delete" ON public.%I', t);
      EXECUTE format('CREATE POLICY "locked no delete" ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT public.my_locked_book()) IS NULL)', t);
      RAISE NOTICE 'masters add-only for locked logins: %', t;
    END IF;
  END LOOP;
END $$;

-- 6. your private pages are closed to a locked login
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'growth_months','capital_savings',
    'ep_deposits','ep_expenses','ep_categories','ep_tallies','ep_moves',
    'wh_products','wh_stock','wh_notes','wh_note_lines','wh_locations'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relname = t AND c.relkind IN ('r','p')) THEN
      IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || quote_ident(t))::regclass) THEN
        EXECUTE format('DROP POLICY IF EXISTS "open all" ON public.%I', t);
        EXECUTE format('CREATE POLICY "open all" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t);
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      END IF;
      EXECUTE format('DROP POLICY IF EXISTS "locked keep out" ON public.%I', t);
      EXECUTE format('CREATE POLICY "locked keep out" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.my_locked_book()) IS NULL) WITH CHECK ((SELECT public.my_locked_book()) IS NULL)', t);
      RAISE NOTICE 'closed to locked logins: %', t;
    END IF;
  END LOOP;
END $$;

-- 7. supplier payment -> investor ledger: use the investor of the payment's OWN book
CREATE OR REPLACE FUNCTION public.investor_for_book(p_book text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  IF p_book IN ('OLD', 'LCL 2026') THEN
    SELECT id INTO v FROM public.investors WHERE is_active AND book IS NULL ORDER BY created_at LIMIT 1;
  ELSE
    SELECT id INTO v FROM public.investors WHERE is_active AND book = p_book ORDER BY created_at LIMIT 1;
    IF v IS NULL THEN
      INSERT INTO public.investors (name, is_active, book) VALUES ('Investor', true, p_book) RETURNING id INTO v;
    END IF;
  END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.sync_investor_ledger_from_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cnv text; v_bill text; v_bill_rate numeric; v_rate numeric; inv uuid;
BEGIN
  IF NEW.funded_by IS DISTINCT FROM 'investor' THEN
    DELETE FROM public.investor_ledger WHERE purchase_payment_id = NEW.id;
    RETURN NEW;
  END IF;
  inv := COALESCE(NEW.investor_id, public.investor_for_book(NEW.book));
  IF inv IS NULL THEN RETURN NEW; END IF;
  SELECT cnv_invoice_number, bill_number, exchange_rate INTO v_cnv, v_bill, v_bill_rate
    FROM public.purchase_bills WHERE id = NEW.purchase_bill_id;
  v_rate := COALESCE(NEW.rate_lkr, v_bill_rate, 0);
  INSERT INTO public.investor_ledger (investor_id, entry_date, kind, direction, rmb, rate, lkr, purchase_payment_id, purchase_bill_id, reference, note, payment_mode, book)
  VALUES (inv, NEW.payment_date, 'supplier_payment', 'owe', NEW.amount, v_rate, NEW.amount * v_rate, NEW.id, NEW.purchase_bill_id,
          COALESCE(v_cnv, v_bill), COALESCE(NEW.account_name, '') || CASE WHEN NEW.narration IS NOT NULL THEN ' - ' || NEW.narration ELSE '' END, NEW.payment_mode, NEW.book)
  ON CONFLICT (purchase_payment_id) DO UPDATE
    SET entry_date = EXCLUDED.entry_date, rmb = EXCLUDED.rmb, rate = EXCLUDED.rate, lkr = EXCLUDED.lkr,
        purchase_bill_id = EXCLUDED.purchase_bill_id, reference = EXCLUDED.reference, note = EXCLUDED.note,
        payment_mode = EXCLUDED.payment_mode, book = EXCLUDED.book;
  IF NEW.rate_lkr IS NULL AND v_rate > 0 THEN
    UPDATE public.purchase_payments SET rate_lkr = v_rate WHERE id = NEW.id;
  END IF;
  IF v_rate > 0 THEN
    UPDATE public.purchase_bills SET exchange_rate = v_rate WHERE id = NEW.purchase_bill_id AND exchange_rate IS DISTINCT FROM v_rate;
  END IF;
  RETURN NEW;
END $$;

-- 8. check: every table should show its lock
SELECT c.relname AS table_name, c.relrowsecurity AS row_security_on,
       string_agg(p.polname, ', ' ORDER BY p.polname) AS policies
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public' AND c.relname IN (
  'purchase_orders','purchase_bills','purchase_payments','shipments','packing_lists','pl_input','investor_ledger','investors',
  'items','suppliers','customers','growth_months','capital_savings')
GROUP BY c.relname, c.relrowsecurity ORDER BY 1;



-- =====================================================================
-- PART 2: detail lines
-- =====================================================================
-- the lock helper (same as part 1; repeated so this file can run on its own)
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS book text;
CREATE OR REPLACE FUNCTION public.my_locked_book() RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT book FROM public.app_users
  WHERE user_id = auth.uid() AND role <> 'admin' AND book IS NOT NULL
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.my_locked_book() TO authenticated, anon;

-- 1. book column on the detail tables
ALTER TABLE public.purchase_bill_items  ADD COLUMN IF NOT EXISTS book text;
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS book text;
ALTER TABLE public.packing_list_items   ADD COLUMN IF NOT EXISTS book text;
DO $$ BEGIN
  IF to_regclass('public.so_po_links') IS NOT NULL THEN
    ALTER TABLE public.so_po_links ADD COLUMN IF NOT EXISTS book text;
  END IF;
END $$;

-- 2. tag existing lines from their parent
UPDATE public.purchase_bill_items i SET book = b.book
  FROM public.purchase_bills b WHERE b.id = i.purchase_bill_id AND i.book IS DISTINCT FROM b.book;

UPDATE public.purchase_order_items i SET book = o.book
  FROM public.purchase_orders o WHERE o.id = i.purchase_order_id AND i.book IS DISTINCT FROM o.book;

UPDATE public.packing_list_items i SET book = p.book
  FROM public.pl_input p WHERE p.id = i.pl_input_id AND i.book IS DISTINCT FROM p.book;
UPDATE public.packing_list_items i SET book = p.book
  FROM public.packing_lists p WHERE i.book IS NULL AND p.id = i.packing_list_id;
UPDATE public.packing_list_items i SET book = b.book
  FROM public.purchase_bill_items bi JOIN public.purchase_bills b ON b.id = bi.purchase_bill_id
  WHERE i.book IS NULL AND bi.id = i.purchase_bill_item_id;
UPDATE public.packing_list_items i SET book = x.book
  FROM (SELECT batch_number, min(book) AS book FROM public.purchase_bills
        WHERE batch_number IS NOT NULL GROUP BY batch_number HAVING count(DISTINCT book) = 1) x
  WHERE i.book IS NULL AND i.batch_number = x.batch_number;

DO $$ BEGIN
  IF to_regclass('public.so_po_links') IS NOT NULL THEN
    UPDATE public.so_po_links l SET book = o.book
      FROM public.purchase_orders o WHERE o.id = l.purchase_order_id AND l.book IS DISTINCT FROM o.book;
  END IF;
END $$;

-- 3. new lines take their parent's book automatically (and the shop login is always forced to its own)
CREATE OR REPLACE FUNCTION public.detail_book() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b text; lb text := public.my_locked_book();
BEGIN
  IF TG_TABLE_NAME = 'purchase_bill_items' THEN
    SELECT book INTO b FROM public.purchase_bills WHERE id = NEW.purchase_bill_id;
  ELSIF TG_TABLE_NAME IN ('purchase_order_items', 'so_po_links') THEN
    SELECT book INTO b FROM public.purchase_orders WHERE id = NEW.purchase_order_id;
  ELSIF TG_TABLE_NAME = 'packing_list_items' THEN
    SELECT book INTO b FROM public.pl_input WHERE id = NEW.pl_input_id;
    IF b IS NULL THEN SELECT book INTO b FROM public.packing_lists WHERE id = NEW.packing_list_id; END IF;
    IF b IS NULL THEN
      SELECT pb.book INTO b FROM public.purchase_bill_items bi JOIN public.purchase_bills pb ON pb.id = bi.purchase_bill_id
      WHERE bi.id = NEW.purchase_bill_item_id;
    END IF;
  END IF;
  IF lb IS NOT NULL THEN NEW.book := lb;
  ELSIF b IS NOT NULL THEN NEW.book := b;
  END IF;
  RETURN NEW;
END $$;


-- 4. the lock: the shop login only sees / saves lines of its own book
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_bill_items','purchase_order_items','packing_list_items','so_po_links'] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relname = t AND c.relkind IN ('r','p')) THEN
      IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || quote_ident(t))::regclass) THEN
        EXECUTE format('DROP POLICY IF EXISTS "open all" ON public.%I', t);
        EXECUTE format('CREATE POLICY "open all" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t);
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      END IF;
      EXECUTE format('DROP TRIGGER IF EXISTS trg_detail_book ON public.%I', t);
      EXECUTE format('CREATE TRIGGER trg_detail_book BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.detail_book()', t);
      EXECUTE format('DROP POLICY IF EXISTS "book lock" ON public.%I', t);
      EXECUTE format($p$CREATE POLICY "book lock" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
        USING ((SELECT public.my_locked_book()) IS NULL OR book = (SELECT public.my_locked_book()))
        WITH CHECK ((SELECT public.my_locked_book()) IS NULL OR book = (SELECT public.my_locked_book()))$p$, t);
      RAISE NOTICE 'locked by book: %', t;
    END IF;
  END LOOP;
END $$;

-- 5. check: how the existing lines are tagged (BLINE SHOP should be 0 or only the shop's own)
SELECT 'packing_list_items' AS lines, book, count(*) FROM public.packing_list_items GROUP BY book
UNION ALL SELECT 'purchase_bill_items', book, count(*) FROM public.purchase_bill_items GROUP BY book
UNION ALL SELECT 'purchase_order_items', book, count(*) FROM public.purchase_order_items GROUP BY book
ORDER BY 1, 2;

SELECT (SELECT count(*) FROM pg_policy WHERE polname = 'book lock') AS book_locks_total;

SELECT 'shop lock ready' AS status;
