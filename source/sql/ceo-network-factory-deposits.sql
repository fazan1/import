-- CEO NETWORK: new column "Factory deposits" (deposits paid to factories for orders not yet shipped; counted in "We own").
-- Nothing is deleted or changed in existing figures. Safe to re-run. Run on your MAIN project only.
ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS factory_deposits numeric NOT NULL DEFAULT 0;
NOTIFY pgrst, 'reload schema';
SELECT count(*) AS records, 'factory deposits column ready' AS status FROM public.financial_records;
