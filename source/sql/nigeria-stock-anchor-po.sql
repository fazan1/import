-- Stock NG: the Anchor Bolt purchase order of 17 Jul 2026 (CNY 34,650) into stock — 15,000 pcs each of
-- Wedge Anchor M12x100, M16x100, M16x150, reference 'PO-AB-2026-07-17'. Run on the MAIN project after
-- nigeria-items-wedge-anchors.sql. Safe to re-run (skipped when that reference is already in stock). Deletes nothing.
-- The stock date is today; change DATE below to the real arrival date if you know it.
INSERT INTO public.ng_stock (item_id, kind, entry_date, quantity, cost_rmb, reference, note)
SELECT i.id, 'in', CURRENT_DATE, v.qty, round(v.qty * v.price, 2), 'PO-AB-2026-07-17', 'Anchor Bolt PO 17 Jul 2026 — ' || v.qty || ' pcs @ ' || v.price || ' CNY'
FROM (VALUES
  ('M12x100', 15000, 0.41),
  ('M16x100', 15000, 0.80),
  ('M16x150', 15000, 1.10)
) AS v(spec, qty, price)
JOIN public.ng_items i ON lower(i.name) = 'wedge anchor' AND lower(coalesce(i.specification, '')) = lower(v.spec) AND lower(coalesce(i.finish, '')) = 'zp'
WHERE NOT EXISTS (SELECT 1 FROM public.ng_stock s WHERE s.item_id = i.id AND s.kind = 'in' AND s.reference = 'PO-AB-2026-07-17');
SELECT i.name, i.specification, s.quantity AS pcs, s.cost_rmb, s.reference
FROM public.ng_stock s JOIN public.ng_items i ON i.id = s.item_id WHERE s.reference = 'PO-AB-2026-07-17' ORDER BY i.specification;
