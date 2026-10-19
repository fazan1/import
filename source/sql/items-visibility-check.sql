-- READ-ONLY CHECK: why does the shop login (mfeshal) see only a few items?
-- Run on the MAIN Supabase project. Changes nothing. Paste all result tabs back.

-- 1. how many items exist, and how many are switched off
SELECT 'items total' AS what, count(*)::text AS value FROM public.items
UNION ALL SELECT 'items inactive', count(*)::text FROM public.items WHERE is_active = false
UNION ALL SELECT 'items has a book column', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='items' AND column_name='book')::text
UNION ALL SELECT 'warehouse products', count(*)::text FROM public.wh_products WHERE is_active IS DISTINCT FROM false
UNION ALL SELECT 'warehouse products NOT in Items master',
  count(*)::text FROM public.wh_products w
  WHERE w.is_active IS DISTINCT FROM false
    AND NOT EXISTS (SELECT 1 FROM public.items i WHERE i.id = w.master_item_id
                    OR lower(regexp_replace(i.item_name, '[^a-zA-Z0-9]+', ' ', 'g')) = lower(regexp_replace(w.name, '[^a-zA-Z0-9]+', ' ', 'g')));

-- 2. the rules (policies) on the items table — the shop login must be able to SELECT every row
SELECT policyname, cmd, permissive, roles::text, qual AS using_rule
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'items' ORDER BY policyname;

-- 3. the shop login itself
SELECT email, role, book, is_active, modules FROM public.app_users WHERE lower(email) LIKE '%feshal%';

-- 4. items added by month (to see if most items were added recently / by whom)
SELECT to_char(created_at, 'YYYY-MM') AS month, count(*) AS items_added FROM public.items GROUP BY 1 ORDER BY 1 DESC LIMIT 12;
