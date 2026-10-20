-- IMPORT CALCULATOR: load calculations from the owner's CSV exports as saved files with all their lines.
-- Each one is added only once (same customer + landed total). The saved date is taken from the archive when the totals match there.
-- Safe to re-run. Run on the MAIN Supabase project only.

INSERT INTO public.import_calculations (customer_name, reference, config, lines, total_landed, total_sell, total_profit, created_at, updated_at)
SELECT 'Fouzer Plumbings', '',
  '{"buyCurrency": "CNY", "localCurrency": "LKR", "exchangeRate": 55.0, "seafreight": 20000.0, "totalImportCost": 141000.0, "importTaxPercent": null, "boostedSettings": null, "allocMode": "kg"}'::jsonb,
  '[{"id": "1ac6cc0c-1226-42ef-a927-2b2feb00be1f", "code": "Tee 1/2\"", "buyPrice": 0.85, "dutyRate": null, "unit": "pcs", "qty": 5600.0, "weight": 0.029, "totalWeight": null, "cubic": 0.42, "marginPercent": 0.0, "marketPrice": null, "sellPrice": 80.0}, {"id": "e5077e37-b336-4da4-93c8-48498b357680", "code": "Socket 1/2\"", "buyPrice": 0.7, "dutyRate": null, "unit": "pcs", "qty": 5000.0, "weight": 0.019, "totalWeight": null, "cubic": 0.18, "marginPercent": 0.0, "marketPrice": null, "sellPrice": 75.0}, {"id": "c536c189-d44d-47be-8718-a7359e899328", "code": "Elbow 1/2\"", "buyPrice": 0.7, "dutyRate": null, "unit": "pcs", "qty": 5000.0, "weight": 0.024, "totalWeight": null, "cubic": 0.42, "marginPercent": 0.0, "marketPrice": null, "sellPrice": 75.0}]'::jsonb,
  807800.0, 1198000.0, 390200.0,
  coalesce((SELECT min(created_at) FROM public.import_calculations_archive WHERE round(total_landed, 0) = round(807800.0::numeric, 0)), now()), now()
WHERE NOT EXISTS (SELECT 1 FROM public.import_calculations WHERE customer_name = 'Fouzer Plumbings' AND round(total_landed, 0) = round(807800.0::numeric, 0));

SELECT customer_name, reference, jsonb_array_length(lines) AS items, total_landed, total_sell, total_profit, created_at::date AS saved_on
FROM public.import_calculations ORDER BY created_at;
