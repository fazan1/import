-- IMPORT CALCULATOR: its two tables were never created in the main database (no SQL file existed for them).
--   import_calculations : saved calculations (customer, reference, lines, totals)
--   import_settings     : the saved rates (CNY/USD -> LKR, duty, charges) that pre-fill the calculator
-- Safe to re-run. Deletes NOTHING (existing tables and rows are kept). Run on the MAIN Supabase project only.

CREATE TABLE IF NOT EXISTS public.import_calculations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid,
  customer_name text NOT NULL DEFAULT '',
  reference     text NOT NULL DEFAULT '',
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,
  lines         jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_landed  numeric NOT NULL DEFAULT 0,
  total_sell    numeric NOT NULL DEFAULT 0,
  total_profit  numeric NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.import_settings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customs_duty_lkr  numeric NOT NULL DEFAULT 0,
  other_charges_lkr numeric NOT NULL DEFAULT 0,
  ocean_freight_usd numeric NOT NULL DEFAULT 0,
  usd_to_lkr_rate   numeric NOT NULL DEFAULT 0,
  cny_to_lkr_rate   numeric NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- in case an older copy of the table exists without some column
ALTER TABLE public.import_calculations
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS customer_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reference text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS total_landed numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_sell numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_profit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.import_settings
  ADD COLUMN IF NOT EXISTS customs_duty_lkr numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_charges_lkr numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ocean_freight_usd numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usd_to_lkr_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cny_to_lkr_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- security, same rules as every other table: logged-in members only, public key no access, shop login kept out
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['import_calculations','import_settings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS "open all" ON public.%I', t);
    EXECUTE format('CREATE POLICY "open all" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'is_app_member') THEN
      EXECUTE format('DROP POLICY IF EXISTS "members only" ON public.%I', t);
      EXECUTE format('CREATE POLICY "members only" ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING ((SELECT public.is_app_member())) WITH CHECK ((SELECT public.is_app_member()))', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'my_locked_book') THEN
      EXECUTE format('DROP POLICY IF EXISTS "locked keep out" ON public.%I', t);
      EXECUTE format('CREATE POLICY "locked keep out" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.my_locked_book()) IS NULL) WITH CHECK ((SELECT public.my_locked_book()) IS NULL)', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- check
SELECT 'import_calculations' AS table_name, count(*) AS rows_saved FROM public.import_calculations
UNION ALL SELECT 'import_settings', count(*) FROM public.import_settings;
