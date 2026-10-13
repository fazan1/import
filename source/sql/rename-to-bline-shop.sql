-- Renames the book "Brother 2026" to "BLINE SHOP".
-- Only rows already tagged "Brother 2026" change. Your OLD and LCL 2026 books are not touched.
-- Nothing is deleted. Safe to run even if the book is still empty. Run on your MAIN project only.
DO $$
DECLARE t text; n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'purchase_orders','purchase_bills','purchase_payments','shipments',
    'costing_duty_sheet','packing_lists','pl_input',
    'busy_sales_orders','busy_sales_invoices','busy_sales_payments',
    'customer_payments','investor_ledger','investors','app_users'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='book') THEN
      EXECUTE format('UPDATE public.%I SET book = %L WHERE book = %L', t, 'BLINE SHOP', 'Brother 2026');
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN RAISE NOTICE '% -> % rows renamed', t, n; END IF;
    END IF;
  END LOOP;
END $$;

SELECT email, role, book FROM public.app_users ORDER BY role, email;
