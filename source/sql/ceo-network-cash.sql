-- CEO NETWORK: new column "Cash in hand" (counted in "We own" and as cash in the advice).
-- Nothing is deleted or changed in existing figures. Safe to re-run. Run on your MAIN project only.
ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS cash_in_hand numeric NOT NULL DEFAULT 0;
NOTIFY pgrst, 'reload schema';
SELECT count(*) AS records, 'cash in hand column ready' AS status FROM public.financial_records;
