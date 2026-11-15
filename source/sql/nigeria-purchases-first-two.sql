-- Purchases NG: the two orders already in stock, as purchase records (so payments, outstanding and the landed-cost table
-- tie to them). Numbers = the stock references PI-001 and PO-AB-2026-07-17; both are marked RECEIVED (the stock is already
-- in — do NOT press "Receive into stock" on them again). Run on the MAIN project after nigeria-purchases.sql.
-- Safe to re-run; deletes nothing. Rename the bolt supplier afterwards in Suppliers NG if the factory has another name.
INSERT INTO public.ng_suppliers (name, note)
SELECT v.name, v.note FROM (VALUES ('Anchor Bolt', 'Wedge anchors — ex-tax, ex-transport, pallet included'), ('Bolt & Nut Factory', 'Hex bolts, nuts, washers — 25 kg PP woven bags, deliver to Guangzhou warehouse')) AS v(name, note)
WHERE NOT EXISTS (SELECT 1 FROM public.ng_suppliers s WHERE lower(s.name) = lower(v.name));

INSERT INTO public.ng_purchases (number, kind, supplier_id, order_date, status, total_rmb, terms, note, received_at)
SELECT v.number, v.kind, (SELECT id FROM public.ng_suppliers WHERE lower(name) = lower(v.supplier) LIMIT 1), v.d, 'received', v.total, v.terms, 'Entered from the proforma / PO; goods already in Stock NG',
       COALESCE((SELECT min(entry_date) FROM public.ng_stock WHERE reference = v.number AND kind = 'in'), v.d)
FROM (VALUES
  ('PI-001',           'pi', 'Bolt & Nut Factory', DATE '2026-10-01', 56550,   'TOTALLY CHINESE RMB ONLY · Packing: 25 kg 2-layer waterproof PP woven bag · Price term: deliver to Guangzhou warehouse'),
  ('PO-AB-2026-07-17', 'po', 'Anchor Bolt',        DATE '2026-07-17', 34650,   'Currency CNY · ex-tax, ex-transportation, pallet included, neutral packing')
) AS v(number, kind, supplier, d, total, terms)
WHERE NOT EXISTS (SELECT 1 FROM public.ng_purchases p WHERE p.number = v.number);

-- lines of PI-001: 1 ton each, amount = price per ton
INSERT INTO public.ng_purchase_items (purchase_id, item_id, quantity, tons, unit_price, amount_rmb, remark, sort_order)
SELECT p.id, i.id, i.pcs_per_ton, 1, round(v.price_ton::numeric / i.pcs_per_ton, 4), v.price_ton, v.finish, v.n
FROM public.ng_purchases p
JOIN (VALUES
  (1, 'Hex Bolt + Nut', 'M12x30',   'ZP',  5270), (2, 'Hex Bolt + Nut', 'M12x40', 'ZP',  5170), (3, 'Hex Bolt + Nut', 'M16x50', 'ZP',  5070),
  (4, 'Hex Bolt + Nut', 'M12x40',   'HDG', 6170), (5, 'Hex Bolt + Nut', 'M16x50', 'HDG', 6070), (6, 'Hex Bolt + Nut', 'M20x60', 'HDG', 6020),
  (7, 'Flat Washer',    'M12x24x2', 'ZP',  5370), (8, 'Hex Nut',        'M16',    'ZP',  5370), (9, 'Hex Nut',        'M20',    'ZP',  5370),
  (10, 'Hex Nut',       'M30',      'HDG', 6670)
) AS v(n, name, spec, finish, price_ton) ON p.number = 'PI-001'
JOIN public.ng_items i ON lower(i.name) = lower(v.name) AND lower(coalesce(i.specification, '')) = lower(v.spec) AND lower(coalesce(i.finish, '')) = lower(v.finish)
WHERE NOT EXISTS (SELECT 1 FROM public.ng_purchase_items x WHERE x.purchase_id = p.id);

-- lines of PO-AB-2026-07-17: 15,000 pcs each
INSERT INTO public.ng_purchase_items (purchase_id, item_id, quantity, tons, unit_price, amount_rmb, remark, sort_order)
SELECT p.id, i.id, v.qty, NULL, v.price, v.qty * v.price, '(AB)NG', v.n
FROM public.ng_purchases p
JOIN (VALUES (1, 'M12x100', 15000, 0.41), (2, 'M16x100', 15000, 0.80), (3, 'M16x150', 15000, 1.10)) AS v(n, spec, qty, price) ON p.number = 'PO-AB-2026-07-17'
JOIN public.ng_items i ON lower(i.name) = 'wedge anchor' AND lower(coalesce(i.specification, '')) = lower(v.spec) AND lower(coalesce(i.finish, '')) = 'zp'
WHERE NOT EXISTS (SELECT 1 FROM public.ng_purchase_items x WHERE x.purchase_id = p.id);

SELECT p.number, s.name AS supplier, p.order_date, p.status, p.received_at, p.total_rmb, (SELECT count(*) FROM public.ng_purchase_items x WHERE x.purchase_id = p.id) AS lines,
       (SELECT round(sum(amount_rmb), 2) FROM public.ng_purchase_items x WHERE x.purchase_id = p.id) AS lines_total
FROM public.ng_purchases p LEFT JOIN public.ng_suppliers s ON s.id = p.supplier_id ORDER BY p.order_date;
