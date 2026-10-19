-- MASTERS ARE SHARED: items / suppliers / customers / clearing_agents must be visible to EVERY login,
-- including the shop login (mfeshal). A "book lock" style rule on these tables hides the other book's
-- rows from a locked login (only the few items the shop added itself were showing).
-- Safe to re-run. Deletes NO data. Run on the MAIN Supabase project only.
-- Keeps: "locked no edit" / "locked no delete" (shop can add masters, not change or delete yours),
--        "members only" (active app_users only).

DO $$
DECLARE t text; p record;
BEGIN
  FOREACH t IN ARRAY ARRAY['items','suppliers','customers','clearing_agents'] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relname = t AND c.relkind IN ('r','p')) THEN
      -- 1. drop every rule that filters rows by book (any name), except the ones we keep
      FOR p IN SELECT policyname FROM pg_policies
               WHERE schemaname = 'public' AND tablename = t
                 AND policyname NOT IN ('locked no edit','locked no delete','members only','open all')
                 AND (coalesce(qual,'') ILIKE '%book%' OR coalesce(with_check,'') ILIKE '%book%')
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
        RAISE NOTICE 'removed book rule "%" from %', p.policyname, t;
      END LOOP;
      -- 2. make sure a read-all rule exists for logged-in users
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='open all') THEN
        EXECUTE format('CREATE POLICY "open all" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
        RAISE NOTICE 'added "open all" to %', t;
      END IF;
      -- 3. the shop's book stamp makes no sense on a shared master
      EXECUTE format('DROP TRIGGER IF EXISTS trg_stamp_locked_book ON public.%I', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- check: rules left on the masters (there must be NO rule that mentions "book")
SELECT tablename, policyname, cmd, permissive, coalesce(qual,'-') AS using_rule
FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('items','suppliers','customers','clearing_agents')
ORDER BY tablename, policyname;
