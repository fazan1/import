# Import CRM (HDR&CO) — project notes for Claude

## What this is
React + Vite + TypeScript + Tailwind app, database on Supabase (project mhvkhqexkorjjzuldqzp).
Live site: import-psi.vercel.app, deployed from GitHub repo fazan1/import.
Owner: Fazeem (not a developer). He wants exact copy-paste SQL and files, not descriptions.

## How to build and deliver (always do this)
1. `npx tsc -b && npx vite build --assetsDir .`  → produces dist/ with 3 flat files: index.html, index-*.js, index-*.css
2. Bump the version in src/App.tsx: `{APP_TITLE} / VNN` and `">vNN<` (version on the Sign out button) (current: V112)
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
CnHome (shop/CN dashboard), CnReports (purchase-side reports), ClearingAgents (+ agent_ledger), ShipmentCharges (per-ITEM freight since v102, opened from Shipping "Charges" button), ShipmentJourney (dashboard widget), Growth.tsx = the "Capital" page (money-exchange monthly mentor, savings ledger in capital_savings).

## Repo layout (since v95)
Built files go at the top level (Vercel serves them). Source lives in /source (src, sql, configs).
source/.env is not committed; it needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for a build.

## Security rules (v95, sql/security-lock.sql)
- anon (the public key) has no table access; every public table has a RESTRICTIVE "members only" policy (active app_users row).
- Only an admin can insert/update/delete app_users; others read only their own row.
- ANY NEW TABLE: re-run security-lock.sql after creating it (health-check.sql shows if one is missing).
- Print/PDF HTML: always wrap DB text in esc() from src/lib/html.ts.
- "All books" is read-only for new records (supabase.ts refuses insert/upsert on booked tables).
- Detail lines: use replaceLines() from src/lib/lines.ts (puts old lines back if the insert fails); bills: deletePurchaseBill() in src/lib/bills.ts.
- No public sign-up link; logins are made in Settings -> Users.

## SQL files already applied to the live database (all in /sql)
book-switch-setup, savings-setup, shop-lock-all (19 "book lock" policies), shipments-admin-view, staff-password-setup, user-delete-setup, clearing-agents-setup, rename-to-bline-shop,
and (confirmed ALL TRUE by check-everything.sql on 13 Oct 2026) security-lock, packing-lines-book, old-collection-only, books-separate,
charity-setup, bulk-import-admin-only, item-charges-costing. Applied 14 Oct 2026: history-and-auto-charges (v111 + v112 trigger without sibling-rate copy). check-everything.sql (read-only, 13 rows) and health-check.sql verify it.

## Open items
- Books decided (v96): LCL 2026 is the only new book; it must never count OLD. OLD stays open until old customers are paid
  (collection), then gets locked as reference. packing_list_items is booked since v96.
- v96 sql/old-collection-only.sql: table book_settings (open/collection/closed), trigger trg_zz_book_mode
  (guard_book_mode) on booked tables; OLD = collection (no NEW documents; payments/edits/Recycle Bin restore ok).
  Close OLD later: UPDATE public.book_settings SET mode='closed' WHERE book='OLD'. Client mirrors it in supabase.ts writeRefusal().
- v97: ONE customer-balance rule (src/lib/receivables.ts) on every screen; totals load all pages (fetchAllPages);
  recycle_bin is booked (sql/books-separate.sql) and the shop login is kept out of every table its screens don't use;
  Backup exports all books (each row keeps its book; old backups restore into OLD).
- v99: BLINE SHOP choice remembered per tab only (new visit = own books); companyFor(book) in src/lib/company.ts
  (BLINE Traders for the shop book) on header, CN Home and purchase-side prints; print fixes (package count once
  per PL, costing totals, invoice tax label); index.css "Long prints" rule stops print pop-ups clipping to page 1.
- v100 Capital (Growth.tsx): charity = share of each month's NET profit only (no profit = nothing due); mode fixed % or
  sliding by month strength (capital_settings 'mentor', shared across devices). capital_charity records gifts
  (for_month, source business|savings); business gifts come off carried capital, savings gifts off the savings balance.
  sql/charity-setup.sql. Not real zakat-on-wealth (owner gives from monthly earnings by choice).
- No per-LC books: each LC is a shipment in LCL 2026. Shop sees prices/costs (costing-duty in SHOP_MODULES);
  admin corrects shop records by switching to BLINE SHOP.
- PL Input "2 bills": fixed in v95 (LCL-2610-01 and FCL-2610-01 were merged as the same batch).
- bulk-import-admin-only.sql wraps bulk_import with an admin check (original kept as bulk_import_unchecked).
- Warehouse items without cost; hide OLD book later when old customers settle.
- v104: Shipping Charges are set PER PACKING LIST (his PL weight/CBM sit on the PL's first line only); the PL charge is
  shared by its items: v105 = KG charge by each item's own weight, CBM charge by each item's own CBM when every item of the
  PL has it filled in Packing List (owner now fills each item's kg/CBM for accuracy); otherwise by quantity (with a note). "Charge items separately" per PL for mixed bases. Each item's
  share is still saved in shipment_item_charges, so costing is unchanged.
- v108: KG/CBM charge per item = its OWN kg/CBM x rate (items without kg get nothing until filled; only if no item has any
  kg it shares by qty). Charges screen reads kg/CBM fresh from Packing List each time. Packing List cells save ONCE
  (committedRef; Enter/Tab/blur) — fixed double-save on menu click. sql/history-and-auto-charges.sql: change_log table
  (written only by trigger zzzzz_log_changes on packing_list_items, shipment_item_charges, agent_ledger, costing_duty_sheet;
  read-only, booked) + trigger zzzz_packing_to_charges: packing list kg/CBM/qty change -> item charge (qty x saved rate)
  -> costing charge_per_unit -> bill total -> shipment actual_charges -> agent ledger line (only if no agent_invoice typed).
  ChangeHistory.tsx = History button on Packing List, Shipping Charges, Costing. Clearing Agents: "View details" link.
- v109 (owner's idea): Shipping -> Charges = BULK amount only (agent's invoice total, shipments.agent_invoice; posted to
  agent_ledger). The charge per ITEM is set in COSTING: Ship type (KG/CBM/PCS/Fixed) + Rate per line, "Charge the items"
  bar applies a type+rate to the shown (filtered) items. Kg/CBM/qty always come from Packing List (costingCharges.ts
  saveItemCharges / refreshShipmentCharges / syncCostingCharges). Check strip: Bulk vs On items vs Difference (no spreading).
  ShipmentCharges refreshes the Shipping list only when it closes (refreshing earlier remounted it and reset the form).
- v112 CN Portal review: every list/total uses fetchAllPages (no 1000-row cut), local-date defaults (not toISOString),
  failed saves/loads now alert, PO/bill lines via replaceLines, PO with a bill can't be deleted, bill save re-reads paid
  total, PL numbers = highest+1 + double-click guards, PL Input batch change moves its packing lines, Shipment History
  batch filter fixed + filtered totals, Shipping edit no longer overwrites actual_charges. SQL trigger no longer gives an
  uncharged item its neighbour's rate (Costing is typed by the owner).
  Open questions for owner: Product Ref total CBM = qty x CTN volume (should be cartons?); investor ledger split by book.
- v111 (owner's final rule): TWO SIDES, compared, never copied. BULK = Shipping -> Charges per packing list: PL total
  kg/CBM/pcs (sum of its items) x rate, or Fixed (table shipment_pl_charges, key plKeyOf = pl_input_id|packing_list_no).
  Sum = bulk, billed to the agent ("Save & bill agent"); optional agent's invoice when it differs. COSTING = each item's own
  type + rate typed in Costing (shipment_item_charges). Each PL card shows its Costing amount and the difference; Costing's
  check strip shows Bulk vs On items. Charges screen also shows Billed / Paid / Still to pay and a "Pay agent" form
  (agent_ledger kind payment, shipment_id). DB trigger + refreshShipmentCharges keep PL totals, shipment total and the
  agent bill (when no agent invoice) in step with Packing List.
- (superseded) v110: Shipping -> Charges is PER PACKING LIST again: PL total kg / CBM / pcs (sum of its items in Packing List) shown,
  owner picks KG/CBM/PCS + rate; bulk = sum of PL charges. Save gives every item of the PL that type+rate (item = own
  kg/CBM/qty x rate, so PL total x rate = items total). Items charged differently in Costing (other type/rate or Fixed)
  are kept. Optional "Agent's invoice" only when the agent billed a different total (then that is posted).
- v102 COSTING: shipping charges are entered PER PACKING-LIST ITEM (shipment_item_charges: basis KG/CBM/PCS/FIXED, qty, rate, amount).
  NO spreading/allocation (owner's rule). Costing charge_per_unit = item amount / qty (src/lib/costingCharges.ts syncCostingCharges);
  DB trigger zzzz_costing_calc computes unit_price_lkr, duty_per_unit(=charge), landed, profit, totals. Old duty basis/rate,
  estimate duty and lump-sum box removed. shipment_charges (per bill) is still written as item sums for CN Reports.
  sql/item-charges-costing.sql. Summary in CostingDutyPrint summarizeCosting() is shared by screen, Excel and print.
