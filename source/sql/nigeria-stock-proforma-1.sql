-- Stock NG: put the first proforma into stock — 1 ton of each of the 10 lines (reference PI-001).
-- Run on the MAIN project after nigeria-setup.sql and nigeria-items-proforma-1.sql. Safe to re-run: a line that is
-- already in stock with reference PI-001 is skipped. Deletes nothing. Change the date below to the real arrival date.
INSERT INTO public.ng_stock (item_id, kind, entry_date, quantity, cost_rmb, reference, note)
SELECT i.id, 'in', DATE '2026-11-15', v.tons * i.pcs_per_ton, round(v.tons * i.pcs_per_ton * i.cost_rmb, 2), 'PI-001', v.tons || ' ton from proforma'
FROM (VALUES
  ('Hex Bolt + Nut', 'M12x30',   'ZP',  1),
  ('Hex Bolt + Nut', 'M12x40',   'ZP',  1),
  ('Hex Bolt + Nut', 'M16x50',   'ZP',  1),
  ('Hex Bolt + Nut', 'M12x40',   'HDG', 1),
  ('Hex Bolt + Nut', 'M16x50',   'HDG', 1),
  ('Hex Bolt + Nut', 'M20x60',   'HDG', 1),
  ('Flat Washer',    'M12x24x2', 'ZP',  1),
  ('Hex Nut',        'M16',      'ZP',  1),
  ('Hex Nut',        'M20',      'ZP',  1),
  ('Hex Nut',        'M30',      'HDG', 1)
) AS v(name, spec, finish, tons)
JOIN public.ng_items i ON lower(i.name) = lower(v.name) AND lower(coalesce(i.specification, '')) = lower(v.spec) AND lower(coalesce(i.finish, '')) = lower(v.finish)
WHERE NOT EXISTS (SELECT 1 FROM public.ng_stock s WHERE s.item_id = i.id AND s.kind = 'in' AND s.reference = 'PI-001');
SELECT i.name, i.specification, i.finish, s.quantity AS pcs_in_stock, s.cost_rmb
FROM public.ng_stock s JOIN public.ng_items i ON i.id = s.item_id WHERE s.reference = 'PI-001' ORDER BY i.name, i.finish, i.specification;
