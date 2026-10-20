-- CEO NETWORK: two new "We owe" columns — "Factory investor" and "LCL investor" (money owed to each investor).
-- Nothing is deleted or changed in existing figures. Safe to re-run. Run on your MAIN project only.
ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS factory_investor_liability numeric NOT NULL DEFAULT 0;
ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS lcl_investor_liability     numeric NOT NULL DEFAULT 0;
NOTIFY pgrst, 'reload schema';
SELECT count(*) AS records, 'investor columns ready' AS status FROM public.financial_records;
