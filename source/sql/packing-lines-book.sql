-- =====================================================================
-- PACKING LIST LINES: give every line its book (v96)
-- From v96 the screens show packing-list lines per book (LCL 2026 never counts OLD lines).
-- Most lines already carry their book. This tags the ones that don't, using:
--   1. the shipment with the same number (LCL-2610-01 ...)
--   2. the PL Input rows of the same batch, when they are all in one book
-- Lines it cannot place are NOT guessed: they are listed at the end (paste the result back).
-- Nothing is deleted. Safe to re-run. Run on your MAIN project only.
-- =====================================================================
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS book text;

-- 1. by shipment number
UPDATE public.packing_list_items i SET book = s.book
  FROM public.shipments s
 WHERE i.book IS NULL AND i.batch_number IS NOT NULL AND i.batch_number <> '' AND s.shipment_no = i.batch_number AND s.book IS NOT NULL;

-- 2. by the PL Input rows of the same batch (only when that batch is in one single book)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pl_input' AND column_name='batch_number') THEN
    UPDATE public.packing_list_items i SET book = x.book
      FROM (SELECT batch_number, min(book) AS book FROM public.pl_input
            WHERE batch_number IS NOT NULL AND book IS NOT NULL
            GROUP BY batch_number HAVING count(DISTINCT book) = 1) x
     WHERE i.book IS NULL AND i.batch_number = x.batch_number;
  END IF;
END $$;

-- 3. index for the per-book screens
CREATE INDEX IF NOT EXISTS packing_list_items_book_idx ON public.packing_list_items(book);

-- 4. check: lines per book, and any line still without a book (should be 0 rows below)
SELECT book, count(*) AS lines FROM public.packing_list_items GROUP BY book ORDER BY 1;
SELECT id, batch_number, packing_list_no, item_name FROM public.packing_list_items WHERE book IS NULL ORDER BY batch_number, packing_list_no LIMIT 50;
SELECT 'packing lines tagged' AS status;
