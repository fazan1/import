-- IMPORT CALCULATOR: load calculations from the owner's CSV exports as saved files with all their lines.
-- Each one is added only once (same customer + landed total). The saved date is taken from the archive when the totals match there.
-- Safe to re-run. Run on the MAIN Supabase project only.

INSERT INTO public.import_calculations (customer_name, reference, config, lines, total_landed, total_sell, total_profit, created_at, updated_at)
SELECT 'Dhanushka Engineering(LPG Meter)', '',
  '{"buyCurrency": "CNY", "localCurrency": "LKR", "exchangeRate": 55.0, "seafreight": 0.0, "totalImportCost": 66499.0, "importTaxPercent": null, "boostedSettings": null, "allocMode": "kg"}'::jsonb,
  '[{"id": "548fcc1c-cff2-45eb-adbb-bbfe4785b5de", "code": "LPG Meter 50mm", "buyPrice": 3400.0, "dutyRate": null, "unit": "pcs", "qty": 3.0, "weight": 38.0, "totalWeight": null, "cubic": null, "marginPercent": 40.0, "marketPrice": null, "sellPrice": null}, {"id": "2385e840-04ea-4639-8c00-8b3e3428abe1", "code": "LPG Meter 40mm", "buyPrice": 3000.0, "dutyRate": null, "unit": "pcs", "qty": 2.0, "weight": 35.0, "totalWeight": null, "cubic": null, "marginPercent": null, "marketPrice": null, "sellPrice": 243000.0}]'::jsonb,
  957499.0, 1329080.65, 371581.65,
  coalesce((SELECT min(created_at) FROM public.import_calculations_archive WHERE round(total_landed, 0) = round(957499.0::numeric, 0)), now()), now()
WHERE NOT EXISTS (SELECT 1 FROM public.import_calculations WHERE customer_name = 'Dhanushka Engineering(LPG Meter)' AND round(total_landed, 0) = round(957499.0::numeric, 0));

SELECT customer_name, reference, jsonb_array_length(lines) AS items, total_landed, total_sell, total_profit, created_at::date AS saved_on
FROM public.import_calculations ORDER BY created_at;
