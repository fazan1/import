-- Capital page: "Liquid cash" box (v188). Run on the MAIN project. Safe to re-run; deletes nothing.
-- Makes sure growth_months has the four "where the capital sits" columns the form now fills.
ALTER TABLE public.growth_months
  ADD COLUMN IF NOT EXISTS bank numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usdt_lkr numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receivables numeric NOT NULL DEFAULT 0;

SELECT 'capital liquid cash columns ready' AS what,
       count(*) FILTER (WHERE column_name IN ('bank','cash','usdt_lkr','receivables')) AS columns_present
FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'growth_months';
