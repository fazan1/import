-- CEO NETWORK: new column "LC-2026 stock" (your import stock, typed by you each month, counted in "We own").
-- Nothing is deleted or changed in existing figures. Safe to re-run. Run on your MAIN project only.
ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS lc_stock_value numeric NOT NULL DEFAULT 0;
NOTIFY pgrst, 'reload schema';
SELECT count(*) AS records, 'lc stock column ready' AS status FROM public.financial_records;
