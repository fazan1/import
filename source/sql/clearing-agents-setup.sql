-- =====================================================================
-- CLEARING AGENTS  — master list, shipping charges per bill, agent account
--   clearing_agents   : name + phone (shared list, like suppliers)
--   shipment_charges  : per bill: type (CBM/KG/PCS/FIXED), qty, rate, amount
--   agent_ledger      : charges (we owe) and payments (we paid), per book
-- Works for BOTH books: your LCL 2026 / OLD and BLINE SHOP stay separate.
-- Nothing is deleted. Safe to re-run. Run on your MAIN project only.
-- =====================================================================

-- lock helper (same as the shop lock; repeated so this file can run on its own)
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS book text;
CREATE OR REPLACE FUNCTION public.my_locked_book() RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT book FROM public.app_users
  WHERE user_id = auth.uid() AND role <> 'admin' AND book IS NOT NULL
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.my_locked_book() TO authenticated, anon;

-- 1. the agents (shared list)
CREATE TABLE IF NOT EXISTS public.clearing_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. shipment gets an agent, other charges and the agent's invoice total
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.clearing_agents(id);
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS other_charges numeric NOT NULL DEFAULT 0;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS agent_invoice numeric NOT NULL DEFAULT 0;

-- 3. charges per bill
CREATE TABLE IF NOT EXISTS public.shipment_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  purchase_bill_id uuid NOT NULL REFERENCES public.purchase_bills(id) ON DELETE CASCADE,
  basis text NOT NULL DEFAULT 'CBM' CHECK (basis IN ('CBM','KG','PCS','FIXED')),
  qty numeric NOT NULL DEFAULT 0,
  rate numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  book text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shipment_id, purchase_bill_id)
);
CREATE INDEX IF NOT EXISTS shipment_charges_bill_idx ON public.shipment_charges(purchase_bill_id);

-- 4. the agent account
CREATE TABLE IF NOT EXISTS public.agent_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.clearing_agents(id),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  kind text NOT NULL CHECK (kind IN ('charge','payment')),
  amount numeric NOT NULL CHECK (amount > 0),
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE SET NULL,
  reference text,
  payment_mode text,
  note text,
  book text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_ledger_agent_idx ON public.agent_ledger(agent_id, entry_date);
-- one charge line per shipment (re-posting updates it instead of doubling)
CREATE UNIQUE INDEX IF NOT EXISTS agent_ledger_one_charge_per_shipment
  ON public.agent_ledger(shipment_id) WHERE kind = 'charge' AND shipment_id IS NOT NULL;

-- 5. book stamping: charges follow their shipment's book; a locked (shop) login is always forced to its own book
CREATE OR REPLACE FUNCTION public.agent_book() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b text; lb text := public.my_locked_book();
BEGIN
  IF NEW.shipment_id IS NOT NULL THEN
    SELECT book INTO b FROM public.shipments WHERE id = NEW.shipment_id;
  END IF;
  IF lb IS NOT NULL THEN NEW.book := lb;
  ELSIF b IS NOT NULL THEN NEW.book := b;
  ELSIF NEW.book IS NULL THEN NEW.book := 'LCL 2026';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_agent_book ON public.shipment_charges;
CREATE TRIGGER trg_agent_book BEFORE INSERT OR UPDATE ON public.shipment_charges FOR EACH ROW EXECUTE FUNCTION public.agent_book();
DROP TRIGGER IF EXISTS trg_agent_book ON public.agent_ledger;
CREATE TRIGGER trg_agent_book BEFORE INSERT OR UPDATE ON public.agent_ledger FOR EACH ROW EXECUTE FUNCTION public.agent_book();

-- 6. security
ALTER TABLE public.clearing_agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agents all" ON public.clearing_agents;
CREATE POLICY "agents all" ON public.clearing_agents FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- shop login can add agents but not change or delete them
DROP POLICY IF EXISTS "locked no edit" ON public.clearing_agents;
CREATE POLICY "locked no edit" ON public.clearing_agents AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT public.my_locked_book()) IS NULL);
DROP POLICY IF EXISTS "locked no delete" ON public.clearing_agents;
CREATE POLICY "locked no delete" ON public.clearing_agents AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT public.my_locked_book()) IS NULL);

ALTER TABLE public.shipment_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "charges all" ON public.shipment_charges;
CREATE POLICY "charges all" ON public.shipment_charges FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "book lock" ON public.shipment_charges;
CREATE POLICY "book lock" ON public.shipment_charges AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.my_locked_book()) IS NULL OR book = (SELECT public.my_locked_book()))
  WITH CHECK ((SELECT public.my_locked_book()) IS NULL OR book = (SELECT public.my_locked_book()));

ALTER TABLE public.agent_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent ledger all" ON public.agent_ledger;
CREATE POLICY "agent ledger all" ON public.agent_ledger FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "book lock" ON public.agent_ledger;
CREATE POLICY "book lock" ON public.agent_ledger AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.my_locked_book()) IS NULL OR book = (SELECT public.my_locked_book()))
  WITH CHECK ((SELECT public.my_locked_book()) IS NULL OR book = (SELECT public.my_locked_book()));

NOTIFY pgrst, 'reload schema';

SELECT (SELECT count(*) FROM pg_policy WHERE polname = 'book lock') AS book_locks,
       'clearing agents ready' AS status;
