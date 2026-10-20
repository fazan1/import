-- IMPORT CALCULATOR: load calculations from the owner's CSV exports as saved files with all their lines.
-- Each one is added only once (same customer + landed total). The saved date is taken from the archive when the totals match there.
-- Safe to re-run. Run on the MAIN Supabase project only.

INSERT INTO public.import_calculations (customer_name, reference, config, lines, total_landed, total_sell, total_profit, created_at, updated_at)
SELECT 'Dhanushka Engineering(Green Meter)', '',
  '{"buyCurrency": "CNY", "localCurrency": "LKR", "exchangeRate": 55.0, "seafreight": 0.0, "totalImportCost": 55998.0, "importTaxPercent": null, "boostedSettings": null, "allocMode": "kg"}'::jsonb,
  '[{"id": "9235cc05-12f8-4ed3-a529-cd4b812dba6b", "code": "Green Meter 50mm", "buyPrice": 1400.0, "dutyRate": null, "unit": "pcs", "qty": 3.0, "weight": 28.0, "totalWeight": null, "cubic": null, "marginPercent": 50.0, "marketPrice": null, "sellPrice": null}, {"id": "53a63754-5a50-4922-a69f-4874d08e19e3", "code": "Green Meter 40mm", "buyPrice": 1050.0, "dutyRate": null, "unit": "pcs", "qty": 3.0, "weight": 25.0, "totalWeight": null, "cubic": null, "marginPercent": 45.0, "marketPrice": null, "sellPrice": null}]'::jsonb,
  460248.0, 680388.79, 220140.79,
  coalesce((SELECT min(created_at) FROM public.import_calculations_archive WHERE round(total_landed, 0) = round(460248.0::numeric, 0)), now()), now()
WHERE NOT EXISTS (SELECT 1 FROM public.import_calculations WHERE customer_name = 'Dhanushka Engineering(Green Meter)' AND round(total_landed, 0) = round(460248.0::numeric, 0));

INSERT INTO public.import_calculations (customer_name, reference, config, lines, total_landed, total_sell, total_profit, created_at, updated_at)
SELECT 'Dhanushka Engineering(Fuel Meter)', '',
  '{"buyCurrency": "CNY", "localCurrency": "LKR", "exchangeRate": 55.0, "seafreight": 0.0, "totalImportCost": 38500.0, "importTaxPercent": null, "boostedSettings": null, "allocMode": "kg"}'::jsonb,
  '[{"id": "9eb2717f-953b-4f94-b3d9-e78e1ef025d6", "code": "1.5\" Fuel Meter", "buyPrice": 2300.0, "dutyRate": null, "unit": "pcs", "qty": 5.0, "weight": 22.0, "totalWeight": null, "cubic": null, "marginPercent": null, "marketPrice": null, "sellPrice": 220000.0}]'::jsonb,
  671000.0, 1100000.0, 429000.0,
  coalesce((SELECT min(created_at) FROM public.import_calculations_archive WHERE round(total_landed, 0) = round(671000.0::numeric, 0)), now()), now()
WHERE NOT EXISTS (SELECT 1 FROM public.import_calculations WHERE customer_name = 'Dhanushka Engineering(Fuel Meter)' AND round(total_landed, 0) = round(671000.0::numeric, 0));

INSERT INTO public.import_calculations (customer_name, reference, config, lines, total_landed, total_sell, total_profit, created_at, updated_at)
SELECT 'Dhanushka Engineering(Air Inflator)', '',
  '{"buyCurrency": "CNY", "localCurrency": "LKR", "exchangeRate": 50.0, "seafreight": 0.0, "totalImportCost": 0.0, "importTaxPercent": null, "boostedSettings": null, "allocMode": "kg"}'::jsonb,
  '[{"id": "a23d98a9-e36b-497f-bb9f-28cc2e225f02", "code": "Air Inflator", "buyPrice": 1800.0, "dutyRate": null, "unit": "pcs", "qty": 5.0, "weight": null, "totalWeight": null, "cubic": 0.73, "marginPercent": null, "marketPrice": null, "sellPrice": null}]'::jsonb,
  450000.0, 0, 0,
  coalesce((SELECT min(created_at) FROM public.import_calculations_archive WHERE round(total_landed, 0) = round(450000.0::numeric, 0)), now()), now()
WHERE NOT EXISTS (SELECT 1 FROM public.import_calculations WHERE customer_name = 'Dhanushka Engineering(Air Inflator)' AND round(total_landed, 0) = round(450000.0::numeric, 0));

SELECT customer_name, reference, jsonb_array_length(lines) AS items, total_landed, total_sell, total_profit, created_at::date AS saved_on
FROM public.import_calculations ORDER BY created_at;
