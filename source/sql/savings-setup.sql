-- Capital page: savings account ledger. Safe to re-run. Nothing is deleted.
-- Run on your MAIN project only.
CREATE TABLE IF NOT EXISTS public.capital_savings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  kind text NOT NULL CHECK (kind IN ('deposit','withdraw')),
  amount numeric NOT NULL CHECK (amount > 0),
  purpose text,          -- withdraw: business / property / zakat / personal / other
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS capital_savings_date_idx ON public.capital_savings(entry_date);
ALTER TABLE public.capital_savings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "savings all" ON public.capital_savings;
CREATE POLICY "savings all" ON public.capital_savings FOR ALL TO authenticated USING (true) WITH CHECK (true);
SELECT 'savings ready' AS status;
