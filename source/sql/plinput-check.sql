-- READ ONLY. Nothing changes.

-- 1. the bills that PL Input can see in each book
SELECT b.book, b.batch_number, b.cnv_invoice_number, b.bill_number, b.bill_date,
       (SELECT count(*) FROM public.purchase_bill_items i WHERE i.purchase_bill_id = b.id) AS items
FROM public.purchase_bills b
ORDER BY b.book, b.batch_number;

-- 2. PL Input rows that already exist, and which bill they came from
SELECT p.book, p.batch_number, p.packing_list_no, p.supplier_name, p.date, p.status,
       p.purchase_bill_id IS NOT NULL AS linked_to_a_bill
FROM public.pl_input p
ORDER BY p.book, p.batch_number, p.date;

-- 3. count per book
SELECT 'purchase_bills' AS table_name, book, count(*) FROM public.purchase_bills GROUP BY book
UNION ALL SELECT 'pl_input', book, count(*) FROM public.pl_input GROUP BY book
UNION ALL SELECT 'packing_lists', book, count(*) FROM public.packing_lists GROUP BY book
ORDER BY 1, 2;
