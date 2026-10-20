# Import CRM (HDR&CO) — project notes for Claude

## What this is
React + Vite + TypeScript + Tailwind app, database on Supabase (project mhvkhqexkorjjzuldqzp).
Live site: import-psi.vercel.app, deployed from GitHub repo fazan1/import.
Owner: Fazeem (not a developer). He wants exact copy-paste SQL and files, not descriptions.

## How to build and deliver (always do this)
1. `npx tsc -b && npx vite build --assetsDir .`  → produces dist/ with 3 flat files: index.html, index-*.js, index-*.css
2. Bump the version in src/App.tsx: `{APP_TITLE} / VNN` and `">vNN<` (version on the Sign out button) (current: V155)
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
charity-setup, bulk-import-admin-only, item-charges-costing. Applied 14 Oct 2026: history-and-auto-charges (v111 + v112 trigger without sibling-rate copy). Applied 16 Oct 2026: sales-numbers-unique (all 3 rules on), ceo-network-upgrade. Applied 18 Oct 2026: partner-payouts, trade-finder-setup + trade-finder-data (871 companies / 48 contacts / 22 saved). Applied 19 Oct 2026: warehouse-invoice-link (link column already existed; 3 wh_notes were already linked to invoices before v142 — some older mechanism (DB trigger?) made them; syncInvoiceStock deletes+recreates per invoice so there is no double deduction either way). check-everything.sql (read-only, 13 rows) and health-check.sql verify it.

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
- v113 Import Calculator: Exchange Rate box is what counts (a saved import_settings CNY rate only pre-fills it; before it
  silently overrode the box); Duty Rate (%) per line now counts (duty = buy price LKR x %); Cubic = the item's TOTAL CBM
  (owner: 90000 x 3 CBM / qty = per piece), labelled "Total CBM (item)"; Import Tax % is a note only; CSV quotes commas.
- v112 CN Portal review: every list/total uses fetchAllPages (no 1000-row cut), local-date defaults (not toISOString),
  failed saves/loads now alert, PO/bill lines via replaceLines, PO with a bill can't be deleted, bill save re-reads paid
  total, PL numbers = highest+1 + double-click guards, PL Input batch change moves its packing lines, Shipment History
  batch filter fixed + filtered totals, Shipping edit no longer overwrites actual_charges. SQL trigger no longer gives an
  uncharged item its neighbour's rate (Costing is typed by the owner).
  v114 Product Ref: Total CBM = No. of CTN x 1 CTN volume (qty x volume only when no cartons), worked out on load too;
  shows CBM / Piece. Open question for owner: investor ledger split by book.
  v116 Costing "Charge the items" bar has "— none (clear) —" to remove leftover item rates (old v104-v110 copies).
  v117 Shipping -> Charges "Whole shipment (type total)": owner types the agent's total kg or CBM + all-in rate (or Fixed)
  before the packing list is ready; saved in shipment_pl_charges with pl_key 'SHIPMENT' (refreshPlCharges skips it; the
  SQL trigger never matches it). One way only: saving whole-shipment deletes the PL rows and vice versa.
  v118 (owner): "By packing list" removed from Charges — Charges = whole shipment only (typed total kg/CBM x all-in rate,
  or Fixed). Older per-PL rows are shown as one total (same basis+rate -> summed qty, else Fixed sum); Save converts them.
  Per-item detail is only in Costing (from Packing List).
  v119 HOUSE STYLE (owner chose design "A", whole site): IBM Plex Sans (text) + IBM Plex Mono (figures/labels) loaded in
  index.html + tailwind fontFamily; ONE accent orange #e8552a (teal palette is remapped to orange in tailwind.config),
  black #111 bars/headers, warm grey ground #f4f3f1, white cards radius 8-10px, pills rounded. All done centrally in
  src/index.css (blue/indigo/purple/cyan fills -> orange, gradients flattened, pale info tints -> white cards, white text on
  dark table headers). Prints use IBM Plex too (popups load the Google font). Keep red/green/amber for status only.
  Never add blue/purple/gradient styling again. Also fixed: CN/SL dashboard crashed (white screen) on a record with no date.
  v120 CEO Network (financial_records, not booked) shows ONLY in the LCL 2026 book (hidden in OLD / All books / BLINE SHOP;
  owner: not for the shop login).
  v121 CEO Network upgrade (sql/ceo-network-upgrade.sql adds supplier_payable, agent_payable, bank_loan, cheques_issued,
  margin_percent, monthly_expenses): We own / We owe / Net capital = own - ALL debts; gross profit = sales - cost of sales,
  or sales x margin % when no cost (marked estimate); net profit = GP - expenses. Advice compares with the previous record
  and states the real gap ("3 months"). "New month" carries last month's balances. Delete -> Recycle Bin.
  OWNER RULE: CEO Network is standalone typed data — NOT linked to CN / SL portal (no auto-fill).
  v122 OWNER: shop stock is typed at SELLING price (ERP cost prices are not real) — keep it that way every month;
  column labelled "Shop stock (sell. price)" and the advice notes Net capital includes unearned profit.
  v123 Margin % column (owner: items are 20-25%); Cost of sales cell shows sales x (1 - margin) in grey with * until typed.
  v124 SL Portal A-Z review: local dates (no UTC day-shift), fetchAllPages on orders/invoices/payments/customers, double-click guards, failed saves alert, order marked invoiced when converted (no double invoicing), invoice paid/balance re-read on edit, overpayment re-checked live, payment delete via Recycle Bin, receipt uses book company, returned cheques left out of Collected (Main dash, Customers), customer rename carries name to invoices/payments, delete refused while records exist, cents in amount-in-words, phone layout wraps; SO/PO print bar no longer squeezes document.
  v125 Invoiced sales orders are locked (no Edit; edit the invoice). Order/invoice/receipt numbers unique PER BOOK: sql/sales-numbers-unique.sql (replaces any all-books unique rule; skips + lists a table that already has duplicates); app retries the next number on 23505 (orders, invoices, BusySalesPayments, CollectPaymentModal insertNumbered).
  v126 Sales Invoice item drop-down was cut off (v124 put the item rows in an overflow-x-auto box, which clips absolute drop-downs) — rows now wrap on phone instead (never wrap drop-down inputs in overflow boxes). Items/customers/warehouse products in Sales Invoice and items in Purchase Orders load with fetchAllPages (items past 1000 were missing).
  v127 Item search (Sales Invoice + Sales Order): every typed word must appear, any order ("sliding deeper" finds "Deeper Sliding ..."), up to 30 results; Sales Invoice also lists active warehouse products not linked to an Items master (item_id null, wh sell_price/avg_cost); "No item found" hint; stockFor/costFor no longer break on an empty id.
  v128 PARTNER PAYOUTS (SL Portal menu, PartnerPayouts.tsx; sql/partner-payouts.sql = table sl_partner_payouts (booked, book follows invoice) + busy_sales_invoices.partner_gets_cost). Owner rule: partner is paid ONLY from what the customer has paid: owed = partner_profit (+ total_cost if partner paid the cost), can pay now = owed x amount_paid/total - paid; payout above that is refused. Delete via Recycle Bin.
  v129 TRADE FINDER (Tools -> Trade Finder, behind the Tools password): the owner's "Lanka Trade Finder" lead tool, now public/trade-finder.html served from this site (built into dist, top level of the repo). It uses the CRM database + login: supabase.ts writes {url,key} to localStorage "crm-sb-config", the page reads it, checks the session, sessionStorage tools-unlocked (else redirects to /#/trade-finder) and app_users modules ("trade-finder"). Tables: trade_businesses, trade_contacts, trade_saved_searches (sql/trade-finder-setup.sql, members-only, NOT booked). AI buttons call https://tycoon-vercel.vercel.app/api/trade-search (owner's own service; untestable from the sandbox). Fixes vs original: all text esc()-ed, fetchAll paging, local dates, saved AI results per district, Add lead keeps the phone + adds to directory, note double-save, errors shown. Data imported 18 Oct (871 companies).
  v130 Trade Finder shown INSIDE the CRM (TradeFinderLauncher = iframe /trade-finder.html?embed=1; html.embed hides its sidebar/back buttons and shows its 5 sections as a tab strip; same-origin so login/session/tools-unlocked are shared). Header menu: 8 groups did not fit under ~1366px (Tools pushed off, no scrollbar) — compact labels/padding below 2xl ("CN"/"SL"), full labels from 1536px; brand subtitle only xl+.
  v131 ONE DASHBOARD (owner: "why another home"): UnifiedDashboard = greeting + quick buttons for both sides, 6 key tiles (owe suppliers, owe investor, customers owe us, collected this month, shipments on the way, packing lists waiting), Today's to-do (unpaid bills, overdue customers, ETAs, PLs, low stock), ShipmentJourney, then the CN and SL sections. CN Portal "Home" (CnHome) is hidden for OLD/LCL 2026/All and only shown in the BLINE SHOP book (its landing, no sales side); /#/cn-home in other books renders the Dashboard. MainDashboard.tsx (unused) deleted. CN dashboard shipment card no longer shows Rs.NaN when rate columns are null.
  v132 busy_sales_invoice_items key column is sales_invoice_id (NOT invoice_id): SL dashboard + Profit report read it wrong -> "column ... does not exist" alert on the Dashboard; fixed. (The mock test DB accepts any column name, so it never caught this — check real column names against WarehouseReport/BusySalesInvoices.) Outstanding page restyled like the other SL pages (plain h1, 4 flat tiles) and moved to the LAST tab of SL Portal (owner).
  v133 Trade Finder AI (Smart Find / Deep Search / Assistant) failed on import-psi (cross-site call to tycoon-vercel.vercel.app). Fix: root vercel.json rewrites /api/trade-search -> that service (same-site for the browser); the page calls /api/trade-search first and falls back to the direct URL (localhost tests). Smart Find now says when the AI was not reached instead of silently showing the basic assessment. vercel.json lives at the repo ROOT next to the built files — never delete it in the deploy step.
  v134 Trade Finder ADVANCED SEARCH (owner: "where real money comes"): productIntel(p) asks the AI who buys/resells the product in SL (industries with why/role/search_terms/keywords + synonyms), cached in trade_saved_searches kind "profile". Deep Search = step 1 show the industries as tick-chips, step 2 one web search PER ticked industry (3 at a time), results grouped by industry, deduped against the whole directory, saved to trade_businesses with type "Industry — type — deals in product" and cached (kind deep, per district). Find Leads uses the cached synonyms + industry keywords (+7 score) so a boat yard matches "wire rope". Smart Find prompt gets the industry list. saveSearch accepts objects.
  v135 Smart Find no longer gives up when no directory name matches the product (e.g. "road cone"): it gets the product intel first, then adds up to 120 likely businesses of the product's categories (productProfile + catsForProduct, else hardware/safety/construction/industrial/tools) in the chosen area, fresh ones first, and lets the AI assess them; a note says so.
  v136 Deep Search hardened (3 scripted runs in /tmp/claude-0/pgtest/tf3runs.cjs: clean / messy / cache+edits): aiCall has a 2-min limit, clear messages for non-JSON or HTTP errors, accepts text|result|content|answer|message|output; extractJson() reads JSON out of fences/prose/trailing sentences (parseJsonObj/parseJsonArr); step 2 uses the product+district of step 1 (DEEP_FOR) and asks if the box changed; a failed industry gets a "retry" link; saved web results are shown in full (grouped) with "already in your directory".
  v137 Find Leads: (a) industry words from the AI count only when SPECIFIC (not in BROAD_WORDS and found in <8% of the directory: wordShare); broad words (construction, hardware…) give +1 — "road cone" matched 826/871 before, now only traffic/highway/event-type companies. (b) The 4-at-a-time batch UI ("Done with these — Next 4", 207 batches) is gone: best 20 first, "Show 20 more", "Show all", progress bar kept (PAGE_SIZE, showMore).
  v138 Smart Find ALWAYS checks the buyer/reseller categories of the product (productProfile primary+secondary + catsForProduct), direct matches first then fresh ones, cap 160 = 4 AI calls; note says "Checking N: X direct + Y likely …"; done line says "kept X of N". BUG FIXED: an empty AI list ("none of these fit") was treated as a failure and the whole batch was shown — parseJsonArr returns null only when there is no JSON at all; [] means none kept (Deep Search throws on null). Saved Smart Find view shows the count and that saved lists do not refresh.
  v139 "Make it realistic": Smart Find + Deep Search prompts ask the AI to think like a Sri Lankan salesman: fit High/Medium/Low (not all High), need (variant + monthly qty), contact (who to ask), channel, one specific reason, pitch (WhatsApp opener <=25 words from Bline Traders); Deep Search also requires "source" URL and empty phone over a guessed one. Cards show fit badge, Likely need / Ask for / Best, OPENING LINE box with Copy, WhatsApp button pre-filled with the pitch (waSend msg), source link. Results sorted High fit first (fitRank); done line counts high/medium/low. Trade Assistant told the same realism rules.
  v140 Contacts & Follow-up fixes: ONE record per shop (a new Call/WhatsApp updates channel/contacted_at and keeps status+note — before, every tap added a duplicate row); the product being searched is remembered on the record ("about welding rod"); status/note changes refresh updated_at locally (follow-up advice was stale); pipeline chart + Interested/Won tiles count the NEWEST status per shop (took the oldest / counted rows); export CSV has phone, staff, local dates. sql/trade-contacts-clear.sql = copy all contacts to trade_contacts_archive then empty the list (owner asked to clear the 48 imported ones). Local psql: when the socket is "Permission denied", use psql -h 127.0.0.1 -p 5433 -U postgres as root.
  v141 Reports > Shipment profitability: a shipment with no selling prices (and no factory goods) or no product cost in Costing is "not costed" — profit/margin shown as "not costed" (row, totals box "n of m costed", Excel export) and left out of the profit total. Before, the agent charges alone showed as a loss (owner: "-649,000" = 432,667/CBM x 1.5 CBM with sales 0, landed 0). Totals box now also shows total Charges.
  v142 SALES INVOICE -> WAREHOUSE (src/lib/whIssue.ts): saving an invoice issues its items from the warehouse (wh_notes kind issue, sales_invoice_id = invoice, issued_to = customer, remarks "Sales invoice INV-…", one note per location; item matched by wh_products.master_item_id = item_id, else by name; location = the one holding the most, else the first active); editing re-issues (delete + recreate); deleting the invoice deletes the notes (stock back). An alert summarises what was issued / skipped. sql/warehouse-invoice-link.sql adds wh_notes.sales_invoice_id and makes wh_note_lines ON DELETE CASCADE. Before v142 invoices never moved stock. A negative qty in one Warehouse location column = issued from a location that had none (the form allows it after a confirm); fix with Transfer/Adjust. mockdb now supports nested embeds (select=*,child(*)).
  v143 (owner: "no need to check which warehouse") invoice stock comes off wherever it is: biggest pile first, spilling over to the next location until covered; any shortfall goes negative on the biggest pile. "Issue stock for older invoices" button on Sales Invoices (backfillInvoiceStock): issues stock for every invoice with no linked wh_notes row (skips cancelled/draft/no lines), reports done/skipped/errors.
  v144 Backfill treats an invoice as done only when its linked note HAS LINES (the 3 pre-v142 linked notes may be empty); item-name matching ignores double spaces/punctuation (key() collapses non-alphanumerics); the button alert lists every invoice (issued what / already issued / not in warehouse) + PROBLEMS, and logs to console. sql/warehouse-check.sql = read-only diagnostic (issue notes with line counts, Buldo/Sliding stock per location, triggers on wh_note_lines).
  v145 wh_stock is a VIEW (sum of note lines by kind — correct, same as my formula; warehouse-stock-recalc.sql therefore installs nothing: rules_installed 0, harmless). Real cause of "not deducting": the invoice lines matched a DUPLICATE wh_products row (master-linked one with no stock) instead of the one holding stock. whIssue findProduct() now takes all candidates (master link OR same name) and uses the one holding the most stock. Button renamed "Rebuild stock from invoices": re-issues EVERY invoice from its lines (idempotent). Old note about warehouse-stock-recalc.sql: wh_recalc_stock(product) rebuilds that product's wh_stock rows from all notes (in +to, issue -from, transfer -from/+to, adjust signed at from), triggers zz_wh_stock_lines (AFTER I/U/D on wh_note_lines) + zz_wh_stock_notes (AFTER UPDATE OF kind/locations on wh_notes), wh_recalc_stock_all() run once. Only installs when wh_stock is a plain table. Tested: stale row rebuilt, live issue/delete correct.
  v146 Warehouse stock table: one "Sold (month)" column per product = qty on issue-note lines dated this month (sales invoices + hand issues), hover shows all time; wh_notes/wh_note_lines are loaded with fetchAllPages (no 1000-row cut).
  v147 (owner: "only warehouse items show") Warehouse stock table also lists MASTER ITEMS that are not kept as stock (no wh_products row linked by master_item_id or same name), at the bottom under "Master items — not kept as stock" and via a "Master items (N)" chip: Qty "not stocked", Sold (month) = sales invoice lines (by item_id, else by name; cancelled/draft left out), tooltip all time, "Keep stock" button adds it to the warehouse (QuickQty new). Warehouse loads busy_sales_invoices (+items) with fetchAllPages. PO / Sales Invoice drop-downs already listed every master item (unchanged).
  v148 (owner: shop login typing "shoe 37" in a PO found nothing) Purchase Order + Purchase Bill item search is word-by-word like Sales Invoice (every typed word anywhere in name/SKU, any order, 30 results) and shows a "No item found in Items" hint. The Items master had only 100 items — nothing is hidden from the shop login (items has read-all policies, no book column). sql/items-visibility-check.sql = read-only diagnostic (Supabase editor shows only the LAST statement's result — give owner one combined query).
  v149 (owner: "showing only 10 items") item drop-downs in Purchase Order, Purchase Bill, Sales Invoice, Sales Order list up to 300 matches (was 30; PO/Bill were 10 before v148), taller scroll box on PO/Bill.
  v150 PO item drop-down footer "showing X of Y items in Items master" + alert when the items load fails (owner in LCL 2026 sees only 12 items in a new PO although items has 100 rows — diagnosing: items is not booked/filtered in code; waiting for sql/items-visibility-check.sql result).
  v151 CEO Network: new typed column "LC-2026 stock" (financial_records.lc_stock_value, sql/ceo-network-lc-stock.sql) in We own, counted in total assets / stock share / Financial Targets; carried to the new month like the other balances. sql/masters-shared-fix.sql (given to owner, not yet confirmed run): shop login saw only a few ITEMS -> removes any book-filtering policy + trg_stamp_locked_book from items/suppliers/customers/clearing_agents, keeps locked no edit/delete.
  v152 CEO Network: "Cash in hand" column (financial_records.cash_in_hand, sql/ceo-network-cash.sql) after Bank in We own; counted in assets and in liquid cash (cashShare advice) + Financial Targets.
  v153 CEO Network column names are renameable by the owner: tap a header -> prompt; names stored in capital_settings key ceo_column_labels (jsonb {field: name}); empty = default label. Columns themselves (DB fields) stay the same.
  v154 Import Calculator "database not there": no SQL ever created import_calculations / import_settings -> sql/import-calculator-setup.sql (CREATE IF NOT EXISTS + missing columns + open all / members only / locked keep out; idempotent, tested twice). Save and Saved-list now alert the real error with a hint to run that file.
  v155 Import Calculator: the tables DID exist (35 saves); "empty" = some saves have config NULL / lines [] (saved before typing) and handleLoad crashed on cfg.x of null -> now tolerant (blank sheet + message); saved list shows "N items" or "empty" per row.
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
