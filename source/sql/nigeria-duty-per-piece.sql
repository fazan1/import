-- Expenses NG: duty per piece (v210). Run on the MAIN project. Safe to re-run; deletes nothing.
-- An expense can now belong to ONE item of a shipment (item_id): duty typed per piece × pieces received.
-- Such entries go onto that item only; entries without item_id are spread over the shipment by value × duty factor.
ALTER TABLE public.ng_expenses ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES public.ng_items(id) ON DELETE RESTRICT;
ALTER TABLE public.ng_expenses ADD COLUMN IF NOT EXISTS per_unit numeric;      -- the typed duty per piece (₦), kept for display
ALTER TABLE public.ng_expenses ADD COLUMN IF NOT EXISTS units numeric;         -- pieces it was applied to
ALTER TABLE public.ng_items ADD COLUMN IF NOT EXISTS duty_factor numeric NOT NULL DEFAULT 1;
NOTIFY pgrst, 'reload schema';
SELECT 'duty per piece ready' AS status, count(*) AS expenses FROM public.ng_expenses;
