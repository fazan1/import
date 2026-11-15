-- Expenses NG: the clearing / logistics payments and other expenses of the first two shipments. Run on the MAIN project
-- after nigeria-expenses.sql. Safe to re-run (each line is skipped when the same reference + description + amount exists).
-- Rate = the default Naira-per-RMB rate saved in Expenses NG (NULL if not saved yet; the page then uses the default rate).
INSERT INTO public.ng_expenses (entry_date, category, description, amount, currency, rate, reference, note)
SELECT v.d, v.cat, v.descr, v.amt, 'NGN',
       NULLIF((SELECT (value->>'naira_per_rmb')::numeric FROM public.ng_settings WHERE key = 'rate'), 0),
       v.ref, v.note
FROM (VALUES
  (DATE '2026-11-06', 'Clearing agent', 'Fred-Mac Global Logistics — clearing & logistics, bolt and nut shipment', 1485540, 'PI-001',            'FCMB receipt 06 Nov 2026, from Solid Way Ultimate Services Ltd'),
  (DATE '2026-11-06', 'Other',          'Other expenses — bolt and nut shipment',                                   135000, 'PI-001',            NULL),
  (DATE '2026-11-11', 'Clearing agent', 'Sea Riders Nigeria Limited — clearing & logistics, anchor bolt shipment',  3825000, 'PO-AB-2026-07-17', 'Zenith receipt 11 Nov 2026, EXTTRF|1794380586932689'),
  (DATE '2026-11-11', 'Other',          'Other expenses — anchor bolt shipment',                                     170000, 'PO-AB-2026-07-17', NULL)
) AS v(d, cat, descr, amt, ref, note)
WHERE NOT EXISTS (SELECT 1 FROM public.ng_expenses e WHERE e.reference = v.ref AND e.description = v.descr AND e.amount = v.amt);
SELECT reference, category, description, amount AS naira, entry_date FROM public.ng_expenses ORDER BY reference, entry_date;
