-- =====================================================================
-- BOOK SWITCH — two sets of books in one system
--   OLD        = everything you have entered up to now
--   LCL 2026   = the fresh start (empty)
-- Nothing is deleted. Every existing record is simply tagged OLD.
-- ALREADY APPLIED. Step 2 now skips itself once any OLD record exists, so running this
-- file again can never move your LCL 2026 records into OLD. Run on your MAIN project only.
-- =====================================================================

-- 1. add the book column to every transaction table, defaulting new rows to LCL 2026
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'purchase_orders','purchase_bills','purchase_payments','shipments',
    'costing_duty_sheet','packing_lists','pl_input',
    'busy_sales_orders','busy_sales_invoices','busy_sales_payments',
    'customer_payments','investor_ledger'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS book text NOT NULL DEFAULT %L', t, 'LCL 2026');
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(book)', t || '_book_idx', t);
    END IF;
  END LOOP;
END $$;

-- 2. everything that already exists becomes the OLD books
--    (only rows created before this moment; run once)
DO $$
DECLARE t text; n bigint; total bigint := 0;
BEGIN
  -- already done once? then stop: a second run would move every LCL 2026 record into OLD
  IF EXISTS (SELECT 1 FROM public.purchase_bills WHERE book = 'OLD')
     OR EXISTS (SELECT 1 FROM public.purchase_orders WHERE book = 'OLD') THEN
    RAISE NOTICE 'OLD books already exist - step 2 skipped, nothing moved';
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'purchase_orders','purchase_bills','purchase_payments','shipments',
    'costing_duty_sheet','packing_lists','pl_input',
    'busy_sales_orders','busy_sales_invoices','busy_sales_payments',
    'customer_payments','investor_ledger'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('UPDATE public.%I SET book = %L WHERE book = %L', t, 'OLD', 'LCL 2026');
      GET DIAGNOSTICS n = ROW_COUNT;
      total := total + n;
      RAISE NOTICE '% -> % rows tagged OLD', t, n;
    END IF;
  END LOOP;
  RAISE NOTICE 'TOTAL % rows moved to the OLD books', total;
END $$;

-- 3. what you now have in each book
SELECT 'purchase_bills' AS table_name, book, count(*) FROM public.purchase_bills GROUP BY book
UNION ALL SELECT 'purchase_payments', book, count(*) FROM public.purchase_payments GROUP BY book
UNION ALL SELECT 'busy_sales_invoices', book, count(*) FROM public.busy_sales_invoices GROUP BY book
UNION ALL SELECT 'busy_sales_payments', book, count(*) FROM public.busy_sales_payments GROUP BY book
UNION ALL SELECT 'investor_ledger', book, count(*) FROM public.investor_ledger GROUP BY book
UNION ALL SELECT 'shipments', book, count(*) FROM public.shipments GROUP BY book
ORDER BY 1, 2;

-- =====================================================================
-- 4. the investor-ledger trigger must put its line in the SAME book as the payment
-- =====================================================================
CREATE OR REPLACE FUNCTION public.sync_investor_ledger_from_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cnv text; v_bill text; v_bill_rate numeric; v_rate numeric; inv uuid;
BEGIN
  IF NEW.funded_by IS DISTINCT FROM 'investor' THEN
    DELETE FROM public.investor_ledger WHERE purchase_payment_id = NEW.id;
    RETURN NEW;
  END IF;
  inv := COALESCE(NEW.investor_id, public.default_investor_id());
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

DROP TRIGGER IF EXISTS trg_sync_investor_ledger ON public.purchase_payments;
CREATE TRIGGER trg_sync_investor_ledger AFTER INSERT OR UPDATE ON public.purchase_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_investor_ledger_from_payment();

-- make sure existing ledger lines sit in the same book as their payment
UPDATE public.investor_ledger l SET book = p.book
  FROM public.purchase_payments p WHERE p.id = l.purchase_payment_id AND l.book IS DISTINCT FROM p.book;

SELECT 'book switch ready' AS status;
