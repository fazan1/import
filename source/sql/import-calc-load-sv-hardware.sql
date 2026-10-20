-- IMPORT CALCULATOR: load calculations from the owner's CSV exports as saved files with all their lines.
-- Each one is added only once (same customer + landed total). The saved date is taken from the archive when the totals match there.
-- Safe to re-run. Run on the MAIN Supabase project only.

INSERT INTO public.import_calculations (customer_name, reference, config, lines, total_landed, total_sell, total_profit, created_at, updated_at)
SELECT 'SV Hardware (Scafolding)', '',
  '{"buyCurrency": "CNY", "localCurrency": "LKR", "exchangeRate": 55.0, "seafreight": 0.0, "totalImportCost": 324998.0, "importTaxPercent": null, "boostedSettings": null, "allocMode": "kg"}'::jsonb,
  '[{"id": "782cc680-8fcd-4ff2-af06-b1d1121299ac", "code": "Couupler Nut", "buyPrice": 0.7, "dutyRate": null, "unit": "pcs", "qty": 5000.0, "weight": 0.045, "totalWeight": null, "cubic": null, "marginPercent": null, "marketPrice": null, "sellPrice": 66.0}, {"id": "922d5cee-025f-4fde-b494-206b3ae218b1", "code": "Triangle Clamp 8\"", "buyPrice": 2.0, "dutyRate": null, "unit": "pcs", "qty": 5000.0, "weight": 0.28, "totalWeight": null, "cubic": null, "marginPercent": null, "marketPrice": null, "sellPrice": 190.0}]'::jsonb,
  1067498.0, 1280000.0, 212502.0,
  coalesce((SELECT min(created_at) FROM public.import_calculations_archive WHERE round(total_landed, 0) = round(1067498.0::numeric, 0)), now()), now()
WHERE NOT EXISTS (SELECT 1 FROM public.import_calculations WHERE customer_name = 'SV Hardware (Scafolding)' AND round(total_landed, 0) = round(1067498.0::numeric, 0));

SELECT customer_name, reference, jsonb_array_length(lines) AS items, total_landed, total_sell, total_profit, created_at::date AS saved_on
FROM public.import_calculations ORDER BY created_at;
