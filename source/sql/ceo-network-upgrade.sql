-- =====================================================================
-- CEO NETWORK UPGRADE (v121)
-- Adds to each monthly record:
--   We owe:   suppliers, clearing agent, bank loan, cheques issued (the investor was already there)
--   Income:   usual margin % (gross profit = sales x margin % when cost of sales is not known), monthly expenses
-- Nothing is deleted or changed in your existing figures. Safe to re-run. Run on your MAIN project only.
-- =====================================================================
ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS supplier_payable numeric NOT NULL DEFAULT 0;
ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS agent_payable    numeric NOT NULL DEFAULT 0;
ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS bank_loan        numeric NOT NULL DEFAULT 0;
ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS cheques_issued   numeric NOT NULL DEFAULT 0;
ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS margin_percent   numeric NOT NULL DEFAULT 0;
ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS monthly_expenses numeric NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';

SELECT count(*) AS records, 'ceo network ready' AS status FROM public.financial_records;
