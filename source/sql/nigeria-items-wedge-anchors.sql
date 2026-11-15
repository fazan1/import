-- Items NG: Wedge Anchors (blue-white zinc plated), priced per PIECE in RMB. Run on the MAIN project. Safe to re-run; deletes nothing.
-- pcs_per_ton = 1,000,000 g / unit weight (so tons convert to pieces in Stock NG). Note keeps qty per box and weight.
INSERT INTO public.ng_items (name, specification, finish, unit, pcs_per_ton, cost_rmb, note)
SELECT 'Wedge Anchor', v.spec, 'ZP', 'pcs', round(1000000.0 / v.weight_g), v.price, 'Blue-white zinc plated · ' || v.per_box || ' pcs/box · ' || v.weight_g || ' g each · ex-tax, ex-transport, pallet included'
FROM (VALUES
  ('M12x100', 320, 0.41,  87),
  ('M12x120', 320, 0.49, 100),
  ('M12x150', 240, 0.60, 121),
  ('M16x100', 200, 0.80, 162),
  ('M16x120', 160, 0.92, 187),
  ('M16x150', 120, 1.10, 226),
  ('M16x200', 120, 1.39, 289),
  ('M20x120', 120, 1.58, 300),
  ('M20x150',  96, 1.88, 363),
  ('M20x200',  80, 2.41, 464)
) AS v(spec, per_box, price, weight_g)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ng_items i WHERE lower(i.name) = 'wedge anchor' AND lower(coalesce(i.specification, '')) = lower(v.spec) AND lower(coalesce(i.finish, '')) = 'zp'
);
SELECT name, specification, finish, pcs_per_ton, cost_rmb AS cost_per_pc_rmb, note FROM public.ng_items WHERE name = 'Wedge Anchor' ORDER BY specification;
