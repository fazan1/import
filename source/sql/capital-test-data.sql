-- =====================================================================
-- TEST DATA for the Capital page (v80 rule: capital = money rotating, BEFORE profit)
-- 7 months, October 2026 – April 2027. Marked note = 'TEST DATA'.
-- Adds the months, or corrects them if you already ran the earlier test file.
-- Your real September is NOT touched. Run on your MAIN project.
-- =====================================================================
INSERT INTO public.growth_months (month, net_capital, profit, expenses, capital_added, withdrawn, note)
VALUES
  ('2026-10', 34100000, 8000000, 4000000, 0, 0,       'TEST DATA'),  -- capital grew, return fell  -> idle money to savings
  ('2026-11', 38100000, 9000000, 3800000, 0, 0,       'TEST DATA'),  -- strong, return held        -> keep half in
  ('2026-12', 43300000, 3000000, 2800000, 0, 0,       'TEST DATA'),  -- quiet month                -> hold, 0% giving
  ('2027-01', 43500000, 9500000, 3900000, 0, 0,       'TEST DATA'),  -- back from quiet            -> strong
  ('2027-02', 49100000, 8500000, 3700000, 0, 3000000, 'TEST DATA'),  -- 3 M taken out              -> idle money
  ('2027-03', 50900000, 4500000, 3600000, 0, 0,       'TEST DATA'),  -- soft month                 -> weak
  ('2027-04', 51800000, 4000000, 3500000, 0, 0,       'TEST DATA')   -- second soft month          -> RISKY
ON CONFLICT (month) DO UPDATE
  SET net_capital = EXCLUDED.net_capital, profit = EXCLUDED.profit, expenses = EXCLUDED.expenses,
      capital_added = EXCLUDED.capital_added, withdrawn = EXCLUDED.withdrawn
  WHERE public.growth_months.note = 'TEST DATA';

SELECT month, net_capital, profit, expenses, withdrawn, note FROM public.growth_months ORDER BY month;

-- When finished testing, remove the dashes and run this line on its own (deletes only TEST DATA rows):
-- DELETE FROM public.growth_months WHERE note = 'TEST DATA';
