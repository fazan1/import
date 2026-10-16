-- =====================================================================
-- SALES NUMBERS UNIQUE PER BOOK (v125)
-- Stops two orders / invoices / receipts getting the same number in the same book
-- (e.g. two people saving at the same moment). The app now tries the next number by itself.
--   busy_sales_orders.order_number, busy_sales_invoices.invoice_number, busy_sales_payments.payment_number
-- Each book keeps its own numbering (LCL 2026 and BLINE SHOP may both have SO-202610-0001).
-- Nothing is deleted. If a book already has a duplicate number, that rule is skipped and the
-- duplicates are listed at the end, so you can send them to Claude. Safe to re-run. Run on your MAIN project only.
-- =====================================================================
DO $$
DECLARE
  t record; c record; dups int;
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('busy_sales_orders',   'order_number'),
      ('busy_sales_invoices', 'invoice_number'),
      ('busy_sales_payments', 'payment_number')) v(tbl, col)
  LOOP
    -- an old rule "number unique across ALL books" would block each book's own numbering: replace it with per book
    FOR c IN
      SELECT con.conname FROM pg_constraint con
      WHERE con.conrelid = ('public.' || t.tbl)::regclass AND con.contype = 'u'
        AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = ('public.' || t.tbl)::regclass AND attname = t.col)]
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t.tbl, c.conname);
      RAISE NOTICE '% : old all-books rule % replaced by per-book rule', t.tbl, c.conname;
    END LOOP;
    FOR c IN
      SELECT i.relname FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
      WHERE x.indrelid = ('public.' || t.tbl)::regclass AND x.indisunique AND NOT x.indisprimary
        AND x.indnatts = 1
        AND x.indkey[0] = (SELECT attnum FROM pg_attribute WHERE attrelid = ('public.' || t.tbl)::regclass AND attname = t.col)
    LOOP
      EXECUTE format('DROP INDEX public.%I', c.relname);
      RAISE NOTICE '% : old all-books index % replaced by per-book rule', t.tbl, c.relname;
    END LOOP;

    EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM public.%I WHERE %I IS NOT NULL GROUP BY book, %I HAVING count(*) > 1) d',
                   t.tbl, t.col, t.col) INTO dups;
    IF dups = 0 THEN
      EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (book, %I)', t.tbl || '_book_number_uq', t.tbl, t.col);
    ELSE
      RAISE NOTICE '% : % duplicate number(s) already exist, rule NOT added (see list below)', t.tbl, dups;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- Result: one row per table. rule_on = true means it is protected now.
SELECT 'busy_sales_orders' AS table_name, to_regclass('public.busy_sales_orders_book_number_uq') IS NOT NULL AS rule_on,
       (SELECT string_agg(book || ' ' || order_number, ', ') FROM (SELECT book, order_number FROM public.busy_sales_orders WHERE order_number IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1) d) AS duplicates
UNION ALL
SELECT 'busy_sales_invoices', to_regclass('public.busy_sales_invoices_book_number_uq') IS NOT NULL,
       (SELECT string_agg(book || ' ' || invoice_number, ', ') FROM (SELECT book, invoice_number FROM public.busy_sales_invoices WHERE invoice_number IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1) d)
UNION ALL
SELECT 'busy_sales_payments', to_regclass('public.busy_sales_payments_book_number_uq') IS NOT NULL,
       (SELECT string_agg(book || ' ' || payment_number, ', ') FROM (SELECT book, payment_number FROM public.busy_sales_payments WHERE payment_number IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1) d);
