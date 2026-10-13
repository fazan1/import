# Import CRM (HDR&CO) — project notes for Claude

## What this is
React + Vite + TypeScript + Tailwind app, database on Supabase (project mhvkhqexkorjjzuldqzp).
Live site: import-psi.vercel.app, deployed from GitHub repo fazan1/import.
Owner: Fazeem (not a developer). He wants exact copy-paste SQL and files, not descriptions.

## How to build and deliver (always do this)
1. `npx tsc -b && npx vite build --assetsDir .`  → produces dist/ with 3 flat files: index.html, index-*.js, index-*.css
2. Bump the version in src/App.tsx: `{APP_TITLE} / VNN` and `text-neutral-600">vNN<` (current: V94)
3. Zip: site-flat-vNN.zip (the 3 files inside dist/) and source-full-vNN.zip (src, index.html, package.json, vite.config.ts, tsconfig*.json, postcss.config.js, tailwind.config.js)
4. He uploads the 3 flat files to the TOP LEVEL of the GitHub repo (replace), Vercel deploys. Header shows VNN.
5. Any database change goes in a separate .sql file for Supabase SQL Editor. Always: safe to re-run, nothing deleted, say it must run on the MAIN project only, and test on a local Postgres first (su postgres … pg_ctl, see history).

## Books (the most important rule)
Three books share one database: OLD (before changeover), LCL 2026 (his imports), BLINE SHOP (the shop, run by login mfeshal).
- src/lib/book.ts: BOOK_OLD / BOOK_NEW / BOOK_BRO ('BLINE SHOP') / BOOK_ALL; BOOKED_TABLES lists every table that is split by book.
- src/lib/supabase.ts patches supabase.from(): select adds .eq('book', current), insert/upsert stamps book. ANY new table that holds transactions must be added to BOOKED_TABLES AND locked in SQL (policy "book lock" + trigger that stamps book; see clearing-agents-setup.sql for the pattern).
- Masters (items, suppliers, customers, clearing_agents) are shared. A locked (shop) login can add masters but not edit/delete.
- app_users.book = 'BLINE SHOP' locks a login to that book (my_locked_book()). Admin has book NULL.
- Admin switching to BLINE SHOP sees only SHOP_MODULES (src/lib/modules.ts).
- "All books" means OLD + LCL 2026 only — never the shop.
- Shop shipments can get a SHOP- prefix (shop-shipment-numbers.sql).

## React rule that bit twice
All useState/useEffect hooks must sit ABOVE any early `return` in App.tsx — otherwise white screen (React #310).

## Pages added recently
CnHome (shop/CN dashboard), CnReports (purchase-side reports), ClearingAgents (+ agent_ledger), ShipmentCharges (per-bill freight, opened from Shipping "Charges" button), ShipmentJourney (dashboard widget), Growth.tsx = the "Capital" page (money-exchange monthly mentor, savings ledger in capital_savings).

## SQL files already applied to the live database (all in /sql)
book-switch-setup, savings-setup, shop-lock-all (19 "book lock" policies), shipments-admin-view, staff-password-setup, user-delete-setup, clearing-agents-setup, rename-to-bline-shop. health-check.sql is read-only and verifies all of it.

## Open items
- PL Input: selection/"2 bills"/can't deselect bug reported once; never diagnosed (plinput-check.sql).
- Warehouse items without cost; hide OLD book later when old customers settle.
- Shipping cost per bill is in CN Reports but not yet pulled into Costing & Duty landed cost.
