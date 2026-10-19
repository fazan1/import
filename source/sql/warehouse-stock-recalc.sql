-- =====================================================================
-- WAREHOUSE STOCK = WORKED OUT FROM THE NOTES (v145)
-- Found on 19 Oct 2026: nothing in the database kept wh_stock in step with the notes, so the sales-invoice
-- issue notes (and anything else written to the notes) did not change the stock figures.
-- This adds the rule: every change to a note or a note line recalculates that product's stock from ALL its notes:
--   in       = + qty at the "to" location
--   issue    = - qty at the "from" location
--   transfer = - qty at "from", + qty at "to"
--   adjust   = + qty (signed) at the "from" location   (the app writes "Set exact count" as a signed difference)
-- Then it recalculates every product once. Nothing is deleted except stale stock rows that are rebuilt.
-- Safe to re-run. Run on your MAIN project only.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.wh_recalc_stock(p_product uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.wh_stock WHERE product_id = p_product;
  INSERT INTO public.wh_stock (product_id, location_id, qty)
  SELECT p_product, m.location_id, sum(m.delta)
  FROM (
    SELECT n.to_location_id   AS location_id,  l.qty AS delta FROM public.wh_note_lines l JOIN public.wh_notes n ON n.id = l.note_id WHERE l.product_id = p_product AND n.kind = 'in'       AND n.to_location_id   IS NOT NULL
    UNION ALL
    SELECT n.from_location_id,                 -l.qty         FROM public.wh_note_lines l JOIN public.wh_notes n ON n.id = l.note_id WHERE l.product_id = p_product AND n.kind = 'issue'    AND n.from_location_id IS NOT NULL
    UNION ALL
    SELECT n.from_location_id,                 -l.qty         FROM public.wh_note_lines l JOIN public.wh_notes n ON n.id = l.note_id WHERE l.product_id = p_product AND n.kind = 'transfer' AND n.from_location_id IS NOT NULL
    UNION ALL
    SELECT n.to_location_id,                    l.qty         FROM public.wh_note_lines l JOIN public.wh_notes n ON n.id = l.note_id WHERE l.product_id = p_product AND n.kind = 'transfer' AND n.to_location_id   IS NOT NULL
    UNION ALL
    SELECT n.from_location_id,                  l.qty         FROM public.wh_note_lines l JOIN public.wh_notes n ON n.id = l.note_id WHERE l.product_id = p_product AND n.kind = 'adjust'   AND n.from_location_id IS NOT NULL
  ) m
  GROUP BY m.location_id
  HAVING sum(m.delta) <> 0;
END $$;

CREATE OR REPLACE FUNCTION public.wh_recalc_stock_all() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT id FROM public.wh_products LOOP PERFORM public.wh_recalc_stock(r.id); n := n + 1; END LOOP;
  RETURN n;
END $$;

-- a line changes -> that product's stock is rebuilt
CREATE OR REPLACE FUNCTION public.trg_wh_stock_from_lines() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM public.wh_recalc_stock(NEW.product_id); END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') AND (TG_OP = 'DELETE' OR OLD.product_id IS DISTINCT FROM NEW.product_id) THEN PERFORM public.wh_recalc_stock(OLD.product_id); END IF;
  RETURN NULL;
END $$;

-- a note's kind / locations change -> every product on it is rebuilt
CREATE OR REPLACE FUNCTION public.trg_wh_stock_from_notes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT product_id FROM public.wh_note_lines WHERE note_id = NEW.id LOOP PERFORM public.wh_recalc_stock(r.product_id); END LOOP;
  RETURN NULL;
END $$;

DO $$
DECLARE kind char;
BEGIN
  SELECT c.relkind INTO kind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'wh_stock';
  IF kind IS DISTINCT FROM 'r' THEN
    RAISE NOTICE 'wh_stock is not a plain table (%), nothing installed', kind;
    RETURN;
  END IF;
  DROP TRIGGER IF EXISTS zz_wh_stock_lines ON public.wh_note_lines;
  CREATE TRIGGER zz_wh_stock_lines AFTER INSERT OR UPDATE OR DELETE ON public.wh_note_lines
    FOR EACH ROW EXECUTE FUNCTION public.trg_wh_stock_from_lines();
  DROP TRIGGER IF EXISTS zz_wh_stock_notes ON public.wh_notes;
  CREATE TRIGGER zz_wh_stock_notes AFTER UPDATE OF kind, from_location_id, to_location_id ON public.wh_notes
    FOR EACH ROW EXECUTE FUNCTION public.trg_wh_stock_from_notes();
  -- a deleted note takes its lines with it (ON DELETE CASCADE from warehouse-invoice-link.sql), and those fire the line rule
  RAISE NOTICE 'stock rules installed; rebuilt % products', public.wh_recalc_stock_all();
END $$;

NOTIFY pgrst, 'reload schema';

SELECT (SELECT count(*) FROM pg_trigger WHERE tgname IN ('zz_wh_stock_lines', 'zz_wh_stock_notes')) AS rules_installed,
       (SELECT count(*) FROM public.wh_stock) AS stock_rows,
       (SELECT string_agg(p.name || ' = ' || t.total, ' · ') FROM (SELECT product_id, sum(qty) AS total FROM public.wh_stock GROUP BY product_id) t JOIN public.wh_products p ON p.id = t.product_id WHERE p.name ILIKE '%buldo%' OR p.name ILIKE '%sliding%') AS buldo_and_sliding_now,
       'warehouse stock recalculated' AS status;
