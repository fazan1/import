-- READ-ONLY check: what the warehouse knows about sales-invoice issues. Safe anywhere. Paste the result back.
SELECT n.note_no, n.note_date, n.issued_to, n.remarks, n.sales_invoice_id IS NOT NULL AS linked,
       (SELECT count(*) FROM public.wh_note_lines l WHERE l.note_id = n.id) AS lines,
       (SELECT string_agg(p.name || ' x ' || l.qty, ', ') FROM public.wh_note_lines l JOIN public.wh_products p ON p.id = l.product_id WHERE l.note_id = n.id) AS items
FROM public.wh_notes n
WHERE n.kind = 'issue'
ORDER BY n.created_at DESC
LIMIT 15;

SELECT p.name, loc.name AS location, s.qty
FROM public.wh_stock s JOIN public.wh_products p ON p.id = s.product_id JOIN public.wh_locations loc ON loc.id = s.location_id
WHERE p.name ILIKE '%buldo%' OR p.name ILIKE '%sliding%'
ORDER BY p.name, loc.name;

SELECT tgname AS trigger_on_note_lines FROM pg_trigger WHERE tgrelid = 'public.wh_note_lines'::regclass AND NOT tgisinternal;
