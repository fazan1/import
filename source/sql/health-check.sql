-- READ ONLY health check for the CN side + shop separation. Changes nothing.
-- Paste the whole result back.

-- 1. columns the pages rely on (every row should say true)
SELECT 'purchase_bill_items.unit'        AS needs, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchase_bill_items' AND column_name='unit') AS ok
UNION ALL SELECT 'purchase_payments.rate_lkr', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchase_payments' AND column_name='rate_lkr')
UNION ALL SELECT 'purchase_payments.funded_by', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchase_payments' AND column_name='funded_by')
UNION ALL SELECT 'purchase_orders.total_cbm', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchase_orders' AND column_name='total_cbm')
UNION ALL SELECT 'shipments.agent_id', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shipments' AND column_name='agent_id')
UNION ALL SELECT 'shipments.other_charges', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shipments' AND column_name='other_charges')
UNION ALL SELECT 'investors.book', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='investors' AND column_name='book')
UNION ALL SELECT 'app_users.book', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='app_users' AND column_name='book')
UNION ALL SELECT 'table clearing_agents', to_regclass('public.clearing_agents') IS NOT NULL
UNION ALL SELECT 'table shipment_charges', to_regclass('public.shipment_charges') IS NOT NULL
UNION ALL SELECT 'table agent_ledger', to_regclass('public.agent_ledger') IS NOT NULL
UNION ALL SELECT 'table capital_savings', to_regclass('public.capital_savings') IS NOT NULL
UNION ALL SELECT 'function my_locked_book', to_regprocedure('public.my_locked_book()') IS NOT NULL
UNION ALL SELECT 'function admin_set_password', to_regprocedure('public.admin_set_password(uuid,text)') IS NOT NULL
UNION ALL SELECT 'function admin_delete_user', to_regprocedure('public.admin_delete_user(uuid)') IS NOT NULL
UNION ALL SELECT 'function investor_for_book', to_regprocedure('public.investor_for_book(text)') IS NOT NULL
UNION ALL SELECT 'book locks >= 19', (SELECT count(*) FROM pg_policy WHERE polname='book lock') >= 19
UNION ALL SELECT 'OLD is collection-only or closed (v96)', EXISTS (SELECT 1 FROM pg_class WHERE relname='book_settings' AND relnamespace='public'::regnamespace) AND (SELECT mode FROM public.book_settings WHERE book='OLD') IN ('collection','closed')
UNION ALL SELECT 'recycle bin split by book (v97)', EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relname='recycle_bin' AND p.polname='book lock')
UNION ALL SELECT 'book mode guard on 12+ tables (v96)', (SELECT count(*) FROM pg_trigger WHERE tgname='trg_zz_book_mode') >= 12
UNION ALL SELECT 'admin sees all shipments', EXISTS (SELECT 1 FROM pg_policy WHERE polname='admin sees all shipments')
UNION ALL SELECT 'security lock (v95): members only on every table', NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'app_users' AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='members only'))
UNION ALL SELECT 'security lock (v95): anon has no table access', NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE grantee='anon' AND table_schema='public')
UNION ALL SELECT 'security lock (v95): only admin edits logins', EXISTS (SELECT 1 FROM pg_policy WHERE polname='app users admin change');

-- 2. logins
SELECT a.email, a.role, a.book, a.is_active, array_length(a.modules,1) AS modules, u.email_confirmed_at IS NOT NULL AS confirmed
FROM public.app_users a JOIN auth.users u ON u.id=a.user_id ORDER BY a.role, a.email;

-- 3. what sits in each book (shop should be 0 everywhere until it starts)
SELECT 'purchase_orders' AS t, book, count(*) FROM public.purchase_orders GROUP BY book
UNION ALL SELECT 'purchase_bills', book, count(*) FROM public.purchase_bills GROUP BY book
UNION ALL SELECT 'purchase_payments', book, count(*) FROM public.purchase_payments GROUP BY book
UNION ALL SELECT 'investor_ledger', book, count(*) FROM public.investor_ledger GROUP BY book
UNION ALL SELECT 'investors', book, count(*) FROM public.investors GROUP BY book
UNION ALL SELECT 'shipments', book, count(*) FROM public.shipments GROUP BY book
UNION ALL SELECT 'pl_input', book, count(*) FROM public.pl_input GROUP BY book
UNION ALL SELECT 'packing_list_items', book, count(*) FROM public.packing_list_items GROUP BY book
UNION ALL SELECT 'purchase_bill_items', book, count(*) FROM public.purchase_bill_items GROUP BY book
ORDER BY 1, 2;

-- 4. the shop's bills, if any, with their batch
SELECT bill_number, cnv_invoice_number, batch_number, bill_date FROM public.purchase_bills WHERE book='BLINE SHOP' ORDER BY bill_date;
