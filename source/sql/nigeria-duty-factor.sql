-- Items NG: duty factor per item (v210). Run on the MAIN project. Safe to re-run; deletes nothing.
-- 1 = normal share of the shipment's duty & expenses; 1.5 = carries more (small items); 0.7 = carries less (big items).
ALTER TABLE public.ng_items ADD COLUMN IF NOT EXISTS duty_factor numeric NOT NULL DEFAULT 1;
NOTIFY pgrst, 'reload schema';
SELECT 'duty factor ready' AS status, count(*) AS items FROM public.ng_items;
