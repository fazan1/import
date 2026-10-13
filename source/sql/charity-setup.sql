-- =====================================================================
-- CHARITY RECORD for the Capital page  (v100)
--   capital_charity  : every gift — date, for which month's earnings, amount, to whom,
--                      paid from the business or from savings
--   capital_settings : the giving % (and other Capital settings), so every phone / computer
--                      uses the same figures
-- Charity is only from a month's earnings: a month with no profit has nothing due.
-- Only your own login can see or change these (the shop login is kept out, the public key gets nothing).
-- Nothing is deleted. Safe to re-run. Run on your MAIN project only.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.capital_charity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,          -- the day it was given
  for_month text NOT NULL CHECK (for_month ~ '^\d{4}-\d{2}$'), -- the month's earnings it comes from (YYYY-MM)
  amount numeric NOT NULL CHECK (amount > 0),
  given_to text,
  source text NOT NULL DEFAULT 'business' CHECK (source IN ('business', 'savings')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS capital_charity_month_idx ON public.capital_charity(for_month);

CREATE TABLE IF NOT EXISTS public.capital_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- lock helper (same as before; repeated so this file can run on its own)
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS book text;
CREATE OR REPLACE FUNCTION public.my_locked_book() RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT book FROM public.app_users
  WHERE user_id = auth.uid() AND role <> 'admin' AND book IS NOT NULL
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.my_locked_book() TO authenticated, anon;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['capital_charity', 'capital_settings'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "open all" ON public.%I', t);
    EXECUTE format('CREATE POLICY "open all" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
    EXECUTE format('DROP POLICY IF EXISTS "locked keep out" ON public.%I', t);
    EXECUTE format('CREATE POLICY "locked keep out" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.my_locked_book()) IS NULL) WITH CHECK ((SELECT public.my_locked_book()) IS NULL)', t);
    IF to_regprocedure('public.is_app_member()') IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "members only" ON public.%I', t);
      EXECUTE format('CREATE POLICY "members only" ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING ((SELECT public.is_app_member())) WITH CHECK ((SELECT public.is_app_member()))', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

SELECT (SELECT count(*) FROM public.capital_charity) AS gifts_recorded,
       (SELECT count(*) FROM pg_policy WHERE polname = 'book lock') AS book_locks_total,
       'charity ready' AS status;
