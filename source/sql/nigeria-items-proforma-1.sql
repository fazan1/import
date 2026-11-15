-- Items NG: the 10 lines of the first proforma (56,550 RMB, 10 tons). Run on the MAIN project after nigeria-setup.sql.
-- Safe to re-run: a line that already exists (same product + specification + finish) is skipped. Deletes nothing.
-- cost_rmb = price per ton / pieces per ton (cost per piece). Unit = pcs.
INSERT INTO public.ng_items (name, specification, finish, unit, pcs_per_ton, cost_rmb, note)
SELECT v.name, v.spec, v.finish, 'pcs', v.pcs, round(v.price_ton::numeric / v.pcs::numeric, 4), 'Proforma 1 — ' || v.price_ton || ' RMB/ton, 25 kg 2-layer PP woven bag'
FROM (VALUES
  ('Hex Bolt + Nut', 'M12x30',   'ZP',  19600,  5270),
  ('Hex Bolt + Nut', 'M12x40',   'ZP',  17180,  5170),
  ('Hex Bolt + Nut', 'M16x50',   'ZP',   8000,  5070),
  ('Hex Bolt + Nut', 'M12x40',   'HDG', 17180,  6170),
  ('Hex Bolt + Nut', 'M16x50',   'HDG',  8000,  6070),
  ('Hex Bolt + Nut', 'M20x60',   'HDG',  4080,  6020),
  ('Flat Washer',    'M12x24x2', 'ZP', 192300,  5370),
  ('Hex Nut',        'M16',      'ZP',  40000,  5370),
  ('Hex Nut',        'M20',      'ZP',  20000,  5370),
  ('Hex Nut',        'M30',      'HDG',  5000,  6670)
) AS v(name, spec, finish, pcs, price_ton)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ng_items i
  WHERE lower(i.name) = lower(v.name) AND lower(coalesce(i.specification, '')) = lower(v.spec) AND lower(coalesce(i.finish, '')) = lower(v.finish)
);
SELECT name, specification, finish, pcs_per_ton, cost_rmb AS cost_per_pc_rmb FROM public.ng_items ORDER BY name, finish, specification;
