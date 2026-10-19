-- =====================================================================
-- WAREHOUSE <- SALES INVOICE LINK (v142)
-- A sales invoice now ISSUES its items from the warehouse by itself (issue note "Sales invoice INV-…"),
-- re-issues when the invoice is edited, and puts the stock back when the invoice is deleted.
-- This file only makes sure the link column exists. Nothing is deleted. Safe to re-run. MAIN project only.
-- =====================================================================
ALTER TABLE public.wh_notes ADD COLUMN IF NOT EXISTS sales_invoice_id uuid;
CREATE INDEX IF NOT EXISTS wh_notes_invoice_idx ON public.wh_notes (sales_invoice_id);

-- deleting a note must also remove its lines (that is what puts the stock back)
DO $$
DECLARE c record;
BEGIN
  SELECT con.conname, con.confdeltype INTO c
  FROM pg_constraint con
  WHERE con.conrelid = 'public.wh_note_lines'::regclass AND con.contype = 'f' AND con.confrelid = 'public.wh_notes'::regclass
  LIMIT 1;
  IF c.conname IS NOT NULL AND c.confdeltype <> 'c' THEN
    EXECUTE format('ALTER TABLE public.wh_note_lines DROP CONSTRAINT %I', c.conname);
    EXECUTE format('ALTER TABLE public.wh_note_lines ADD CONSTRAINT %I FOREIGN KEY (note_id) REFERENCES public.wh_notes(id) ON DELETE CASCADE', c.conname);
    RAISE NOTICE 'wh_note_lines: delete now follows the note (ON DELETE CASCADE)';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wh_notes' AND column_name = 'sales_invoice_id') AS link_column,
       (SELECT confdeltype = 'c' FROM pg_constraint WHERE conrelid = 'public.wh_note_lines'::regclass AND contype = 'f' AND confrelid = 'public.wh_notes'::regclass LIMIT 1) AS lines_follow_note,
       (SELECT count(*) FROM public.wh_notes WHERE sales_invoice_id IS NOT NULL) AS invoice_issues_so_far,
       'warehouse invoice link ready' AS status;
