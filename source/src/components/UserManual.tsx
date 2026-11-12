import { useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, Printer, Search } from 'lucide-react';

/* User Manual (Tools -> User Manual). Plain-English, step-by-step: the order of work the owner agreed on.
   Static text, nothing read from the database. Keep every step short and in the order it must be done. */

interface Section { id: string; title: string; when: string; steps: string[]; notes?: string[] }

const SECTIONS: Section[] = [
  {
    id: 'shipment', title: 'One shipment, start to finish (CN Portal)', when: 'Every LC / shipment, in this order',
    steps: [
      'Purchase Order — make the PO for the supplier with the items and quantities.',
      'Purchase Bill — when the supplier bills you, make the bill from the PO. Type the batch number (the shipment batch) on the bill.',
      'PL Input → Add from Bill — pick the batch, tick the bills, Import. Each bill becomes one packing list number. A bill with no batch number goes to the Unassigned tab.',
      'Packing List — fill every item: quantity, cartons, kg and CBM. Costing and charges read from here.',
      'Shipping → Charges — type the agent\'s bulk charge for the whole shipment (total kg or CBM × rate, or Fixed) and "Save & bill agent".',
      'Clearing Agents — record what you paid the agent against that bill. The ledger shows what is still owed.',
      'Costing — pick the ship type (KG / CBM / PCS / Fixed) and rate per item, or use "Charge the items" for all shown items. The check strip must show Bulk = On items.',
      'Warehouse — receive the goods in, into their location.',
      'CN Reports → Shipment profitability — the shipment must show a landed cost, not "not costed".',
    ],
    notes: ['Packing List before Costing, always: Costing takes each item\'s kg, CBM and quantity from the packing list.', 'Charges can be typed before the packing list is ready; Costing cannot.'],
  },
  {
    id: 'paying', title: 'Paying suppliers and agents', when: 'As you pay',
    steps: [
      'Purchase Bills — open the bill, record the payment. The bill shows paid / balance.',
      'Outstanding (CN) — the list of what is still owed to suppliers. Pay from here when you clear several bills.',
      'Clearing Agents — pay the agent, pick the shipment. "Pay agent" is also on the Shipping → Charges screen.',
      'Investor Ledger — record money received from or paid to the investor.',
    ],
  },
  {
    id: 'sales', title: 'Selling (SL Portal)', when: 'Every sale',
    steps: [
      'Sales Order (optional) — quotation / order for the customer. Convert it to an invoice when confirmed; the order is then locked.',
      'Sales Invoice — the invoice. Saving it takes the stock out of the Warehouse automatically.',
      'For a Double invoice type the partner\'s name and profit share. Tick "Partner paid the cost" if they financed the goods.',
      'Sales Payments — record the customer\'s payment against the invoice. Print the receipt from the printer icon.',
      'Customer Outstanding — who owes what, oldest first. Chase from here.',
    ],
    notes: ['Deleting an invoice puts the stock back. Editing re-issues it.', 'A returned cheque is left out of "Collected".'],
  },
  {
    id: 'partners', title: 'Partner Payouts (SL Portal)', when: 'After customers pay',
    steps: [
      'Open Partner Payouts. "Can pay now" = the partner\'s share of what the customer has actually paid, minus what you already paid the partner.',
      'Pay partner — type the amount, date, mode. More than "Can pay now" is refused.',
      'Printer icon on the payment — the Partner payment invoice, for the partner to sign.',
      'Statement button on the partner\'s row — the full statement of all their invoices, to forward.',
    ],
    notes: ['Rule: the partner is paid only from money the customer has paid.'],
  },
  {
    id: 'warehouse', title: 'Warehouse', when: 'Goods in, goods out, month-end check',
    steps: [
      'Goods in — receive from a shipment or add by hand ("In").',
      'Sales invoices issue stock by themselves. Hand issues: "Issue".',
      'Transfer between locations; Adjust to correct a count.',
      'Sold (month) column — what left this month. Master items not kept as stock are listed at the bottom; "Keep stock" adds one.',
      'A negative quantity means more was issued than received at that location — fix with Transfer or Adjust.',
      '"Rebuild stock from invoices" re-issues every invoice from its lines if the stock looks wrong.',
    ],
  },
  {
    id: 'monthend', title: 'Month-end routine', when: 'Last day of the month, in this order',
    steps: [
      'CN: all bills and supplier outstanding paid and recorded. Every arrived shipment: packing list, charges, agent paid, costing, received in warehouse.',
      'SL: all invoices and customer payments entered. Customer Outstanding checked.',
      'Partner Payouts — pay what "Can pay now" shows, send invoices and statements.',
      'Expenses (Tools) — every payment typed. Press Tally: count bank and cash drawer against the system. Fix a difference with a payment or deposit entry, then Print the month.',
      'Warehouse — Sold (month) matches what left; no negative stock.',
      'CEO Network — update this month\'s row: bank, cash in hand, cheques, shop receivable, stocks, supplier / agent payables, investors, sales, cost or margin %, expenses. Month report, and screenshot "At a glance" for the brothers.',
      'Capital — edit the month: working capital, gross profit, expenses, liquid cash, customers owe. Record charity and savings when the money actually moves. Print, or Copy summary.',
      'Backup (Settings) — export.',
    ],
    notes: ['CEO Network "New month" is pressed on the 1st of the new month, never before: it dates the row with today.', 'Expenses has no close button — the balance carries by itself; just move to the next month with the arrow.'],
  },
  {
    id: 'ceo', title: 'CEO Network', when: 'Once a month, typed by hand',
    steps: [
      'One row per month. Tap a cell to type. Tap a column name to rename it.',
      'We own: stocks (shop stock at selling price), receivables, cheques in hand, import goods, factory deposits, bank, cash in hand.',
      'We owe: investor, factory investor, LCL investor, supplier payable, agent payable, bank loan, cheques issued.',
      'Net capital = we own − we owe. Ready cash = bank + cash + cheques in hand.',
      'Sales, cost of sales (or margin %), expenses → gross and net profit. "est." means profit came from the margin %.',
      '"New month" on the 1st copies the balances; sales and expenses start at zero.',
      'Month report = one A4 page. "At a glance" box = 8 lines with the change since last month; Copy summary pastes it as text.',
    ],
    notes: ['CEO Network is standalone: nothing is copied from the portals.'],
  },
  {
    id: 'capital', title: 'Capital (money exchange)', when: 'Once a month, typed by hand',
    steps: [
      'Add month — working capital (pre-filled from what last month carried), gross profit, expenses, money put in / taken out, liquid cash (bank + cash + USDT), customers owe.',
      'The mentor grades the month and gives the plan: charity %, keep in business, profit to savings, idle capital to savings, next target.',
      '"Record … moved to savings" — press it when the money really moves; the entry is dated month-end and comes off the carry-over.',
      '"Record charity given" — a gift bigger than the due spills to older months, and anything extra is held as an advance for the coming months.',
      'Money flow box shows how the carry-over is worked out; Liquid cash box shows what is liquid, with customers, in goods.',
      'Print = the full report with Liquid cash and Priorities. Copy summary = WhatsApp text.',
    ],
    notes: ['Capital is a separate business: never linked to the SL / CN portals or CEO Network.', 'Savings only changes when you press Put into / Take from savings.'],
  },
  {
    id: 'expenses', title: 'Expenses (personal pool)', when: 'Daily / month-end',
    steps: [
      'Put money into the pool (deposit, Cash or Bank). Pay an expense (category, Cash or Bank). Move bank ↔ cash.',
      'Categories & budgets — set a budget per category; the month view shows spent against budget.',
      'Tally — type what is really in the bank and the drawer; the difference is shown and saved. It does not change the balance: record the missing or extra amount as a payment or deposit.',
      'Arrows / month list to move between months. Print and Excel for the month.',
    ],
  },
  {
    id: 'factory', title: 'Factory', when: 'Glove machine',
    steps: [
      'Factory Problems — log each fault and what fixed it. My Data — your own records.',
      'Pattern Settings / Mechanical Settings / Other Parameters — the machine guides. Tap a setting: value, what it is, too high / too low, action.',
      '"Ask about this setting" under a setting — ask in plain words; the answer uses that setting, the page table and the guide. Every question is saved under the setting.',
      'Density rule: a HIGHER number = longer stitch = longer, looser zone. LOWER = tighter, shorter.',
    ],
  },
  {
    id: 'books', title: 'Books (OLD / LCL 2026 / BLINE SHOP)', when: 'Always',
    steps: [
      'Book switch in the header. LCL 2026 = your imports. BLINE SHOP = the shop (login mfeshal is locked to it). OLD = collection only: no new documents, payments allowed.',
      'Masters (items, suppliers, customers, agents) are shared by all books. A shop login can add masters but not edit or delete.',
      '"All books" = OLD + LCL 2026, read only. Never the shop.',
      'Shop shipments get a SHOP- prefix.',
    ],
  },
  {
    id: 'backup', title: 'Backup — keeping the data safe', when: 'Automatic every night + manual any time',
    steps: [
      'Automatic: every night at 03:00 Sri Lanka time the site copies EVERY table of the database into your private GitHub repository "import-backups" (backups/YYYY-MM-DD.json and latest.json). Settings → Backup shows the last run: date, tables, rows, size. Red = failed or older than 2 days → check Vercel.',
      'One-time switch-on: create the private GitHub repo, make a GitHub token (repo scope), copy the Supabase service_role key, then add them in Vercel → Settings → Environment Variables (the four names are listed on the Settings → Backup page). Run backup-log.sql once in Supabase. Redeploy.',
      'Test it: open the site address followed by /api/backup?key= and your cron secret in the browser — it answers ok:true with the row count, and the file appears in GitHub.',
      'Laptop copy: install GitHub Desktop, clone import-backups to the laptop, and let a nightly scheduled "git pull" keep it up to date. Then the data is in three places: Supabase, GitHub, your laptop.',
      'Manual: Settings → Backup → "Export all data" = one Excel file of every table, every book. Do it before any big change (SQL, bulk import, clearing a list).',
      'Restore: Settings → Backup → "Import data" accepts the Excel file or a nightly .json file. Only rows that do not exist are added; every row goes back into its own book. Safe to run twice.',
      'If Supabase itself is lost: make a new Supabase project, run the SQL files from the repo (source/sql) to create the tables, point Vercel at the new project, then Import latest.json. Ask for the exact list when the day comes.',
    ],
    notes: ['Supabase daily backups with point-in-time restore exist only on the paid plan (Pro). The GitHub copy is free and independent of Supabase.'],
  },
  {
    id: 'admin', title: 'Settings, users, backup', when: 'Admin only',
    steps: [
      'Settings → Users — make logins, choose modules per user, set the book lock. No public sign-up.',
      'Recycle Bin — deleted records go here; restore from here.',
      'Backup — export all books; restore keeps each row in its book.',
      'Tools are behind the Tools PIN each session.',
    ],
  },
];

export default function UserManual() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ shipment: true, monthend: true });
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase(); if (!t) return SECTIONS;
    return SECTIONS.map((s) => ({ ...s, steps: s.steps.filter((x) => x.toLowerCase().includes(t)), notes: (s.notes || []).filter((x) => x.toLowerCase().includes(t)) }))
      .filter((s) => s.title.toLowerCase().includes(t) || s.steps.length || s.notes.length);
  }, [q]);
  const isOpen = (id: string) => !!q || open[id];
  const all = (v: boolean) => setOpen(Object.fromEntries(SECTIONS.map((s) => [s.id, v])));
  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><BookOpen className="w-6 h-6 text-[#e8552a]" />User Manual</h1>
          <p className="text-sm text-gray-500">The order of work for every part of the CRM. Open a section, follow the steps top to bottom.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => all(true)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">Open all</button>
          <button onClick={() => all(false)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">Close all</button>
          <button onClick={() => window.print()} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white flex items-center gap-1"><Printer className="w-4 h-4" />Print</button>
        </div>
      </div>
      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the manual — e.g. costing, tally, partner, new month" className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white" />
      </div>
      {shown.length === 0 && <p className="text-sm text-gray-500 p-4">Nothing found for “{q}”.</p>}
      {shown.map((s) => (
        <div key={s.id} className="bg-white border border-gray-200 rounded-xl print:break-inside-avoid">
          <button onClick={() => setOpen({ ...open, [s.id]: !open[s.id] })} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
            <span>
              <span className="block font-semibold text-gray-900">{s.title}</span>
              <span className="block text-[11px] font-mono uppercase tracking-[0.12em] text-gray-500 mt-0.5">{s.when}</span>
            </span>
            {isOpen(s.id) ? <ChevronDown className="w-4 h-4 text-gray-400 print:hidden" /> : <ChevronRight className="w-4 h-4 text-gray-400 print:hidden" />}
          </button>
          {(isOpen(s.id) || true) && (
            <div className={`${isOpen(s.id) ? '' : 'hidden print:block'} px-4 pb-4`}>
              <ol className="space-y-2 text-sm text-gray-800">
                {s.steps.map((st, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#111] text-white text-xs font-semibold flex items-center justify-center">{i + 1}</span>
                    <span className="pt-0.5">{st}</span>
                  </li>
                ))}
              </ol>
              {s.notes && s.notes.length > 0 && (
                <div className="mt-3 border-l-2 border-[#e8552a] pl-3 space-y-1">
                  {s.notes.map((n, i) => <p key={i} className="text-xs text-gray-600">{n}</p>)}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
