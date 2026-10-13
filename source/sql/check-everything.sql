-- READ ONLY: confirms all database changes (v95–v102). Changes nothing. Every "ok" should be true.
SELECT check_name, ok FROM (VALUES
 (1, 'security: public key has no table access',
     NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE grantee='anon' AND table_schema='public')),
 (2, 'security: every table members-only',
     NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'app_users'
                   AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='members only'))),
 (3, 'security: only admin edits logins',
     EXISTS (SELECT 1 FROM pg_policy WHERE polname='app users admin change')),
 (4, 'book locks 19 or more',
     (SELECT count(*) FROM pg_policy WHERE polname='book lock') >= 19),
 (5, 'packing lines all have a book',
     NOT EXISTS (SELECT 1 FROM public.packing_list_items WHERE book IS NULL)),
 (6, 'OLD is collection-only',
     to_regclass('public.book_settings') IS NOT NULL
     AND (SELECT mode FROM public.book_settings WHERE book='OLD') = 'collection'),
 (7, 'collection guard on 12+ tables',
     (SELECT count(*) FROM pg_trigger WHERE tgname='trg_zz_book_mode') >= 12),
 (8, 'recycle bin split by book',
     EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relname='recycle_bin' AND p.polname='book lock')),
 (9, 'shop kept out of private tables',
     EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relname='growth_months' AND p.polname='locked keep out')),
 (10, 'charity tables ready',
     to_regclass('public.capital_charity') IS NOT NULL AND to_regclass('public.capital_settings') IS NOT NULL),
 (11, 'restore is admin-only (or there is no restore function)',
     to_regproc('public.bulk_import') IS NULL
     OR COALESCE(NOT has_function_privilege('authenticated', to_regproc('public.bulk_import_unchecked')::oid, 'EXECUTE'), false)),
 (12, 'at least one active admin',
     EXISTS (SELECT 1 FROM public.app_users WHERE role='admin' AND is_active)),
 (13, 'shipping charges per item + costing calc',
     to_regclass('public.shipment_item_charges') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='zzzz_costing_calc'))
) AS t(n, check_name, ok) ORDER BY n;
