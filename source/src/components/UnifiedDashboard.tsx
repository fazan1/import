import { useEffect, useMemo, useState } from 'react';
import { Landmark, AlertTriangle, DollarSign, Ship, ListChecks, Users, Wallet, ClipboardList, Receipt, Container, FileText, CreditCard, Sun, Moon, CloudSun, CheckCircle2, ArrowRight, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchAllPages } from '../lib/fetchAll';
import { custKey, onAccountByCustomer, netOpening } from '../lib/receivables';
import { getBook, BOOK_ALL } from '../lib/book';
import { companyFor } from '../lib/company';
import CNPortalDashboard from './CNPortalDashboard';
import SLPortalDashboard from './SLPortalDashboard';
import ShipmentJourney from './ShipmentJourney';

interface Props { name?: string | null; onNavigate: (view: string) => void; }

// THE one dashboard: greeting + quick buttons for both sides, the key numbers (imports and sales together),
// today's to-do (suppliers, shipments, packing lists, overdue customers), where each shipment is,
// then the full import (CN) and sales (SL) sections. Reads only the current book.

const cny = (v: number) => '¥' + Math.round(v).toLocaleString('en-US');
const rs = (v: number) => 'Rs ' + Math.round(v).toLocaleString('en-US');
const localYMD = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysOld = (d: string | null | undefined) => !d ? 0 : Math.floor((Date.now() - new Date(d.slice(0, 10) + 'T00:00:00').getTime()) / 86400000);

interface Bill { no: string; date: string; supplier: string; bal: number }
interface Inv { customer: string; no: string; due: string | null; date: string; bal: number }

export default function UnifiedDashboard({ name, onNavigate }: Props) {
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [unpaidBills, setUnpaidBills] = useState<Bill[]>([]);
  const [investorOwed, setInvestorOwed] = useState(0);
  const [openShips, setOpenShips] = useState<{ no: string; eta: string | null; status: string; mode: string }[]>([]);
  const [plWaiting, setPlWaiting] = useState(0);
  const [lowStock, setLowStock] = useState(0);
  const [receivable, setReceivable] = useState(0);
  const [debtors, setDebtors] = useState(0);
  const [overdue, setOverdue] = useState<Inv[]>([]);
  const [collectedMonth, setCollectedMonth] = useState(0);
  const [salesMonth, setSalesMonth] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const month = localYMD().slice(0, 7);
      type BRaw = { bill_number: string | null; cnv_invoice_number: string | null; bill_date: string | null; amount_paid: number | null; purchase_orders: { suppliers: { name: string } | null } | null; purchase_bill_items: { quantity_received: number; unit_price_cny: number }[] | null };
      type IRaw = { invoice_number: string; invoice_date: string; due_date: string | null; customer_name: string | null; total_amount: number; amount_due: number; status: string };
      type PRaw = { customer_name: string | null; sales_invoice_id: string | null; amount: number; cheque_status: string | null; payment_date: string | null };
      const [b, s, p, l, inv, pay, cust, wp, ws] = await Promise.all([
        fetchAllPages<BRaw>(() => supabase.from('purchase_bills').select('id, bill_number, cnv_invoice_number, bill_date, amount_paid, purchase_orders(suppliers(name)), purchase_bill_items(quantity_received, unit_price_cny)').order('id')),
        fetchAllPages<{ shipment_no: string; status: string; eta: string | null; mode: string }>(() => supabase.from('shipments').select('id, shipment_no, status, eta, mode').order('id')),
        fetchAllPages<{ received: boolean }>(() => supabase.from('pl_input').select('id, received').order('id')),
        fetchAllPages<{ direction: string; lkr: number }>(() => supabase.from('investor_ledger').select('id, direction, lkr').order('id')),
        fetchAllPages<IRaw>(() => supabase.from('busy_sales_invoices').select('id, invoice_number, invoice_date, due_date, customer_name, total_amount, amount_due, status').order('id')),
        fetchAllPages<PRaw>(() => supabase.from('busy_sales_payments').select('id, customer_name, sales_invoice_id, amount, cheque_status, payment_date').order('id')),
        fetchAllPages<{ name: string; opening_balance: number | null }>(() => supabase.from('customers').select('id, name, opening_balance').order('id')),
        supabase.from('wh_products').select('id, min_qty, is_active'),
        supabase.from('wh_stock').select('product_id, qty'),
      ]);
      if (!alive) return;
      const err = b.error || s.error || p.error || l.error || inv.error || pay.error || cust.error || '';
      setLoadErr(err);

      // imports side
      setUnpaidBills(b.data.map((x) => {
        const total = (x.purchase_bill_items ?? []).reduce((t, i) => t + (Number(i.quantity_received) || 0) * (Number(i.unit_price_cny) || 0), 0);
        return { no: x.bill_number || x.cnv_invoice_number || '—', date: x.bill_date || '', supplier: x.purchase_orders?.suppliers?.name || '—', bal: total - (Number(x.amount_paid) || 0) };
      }).filter((x) => x.bal > 0.5).sort((a, c) => a.date.localeCompare(c.date)));
      setInvestorOwed(l.data.reduce((t, x) => t + (x.direction === 'owe' ? 1 : -1) * (Number(x.lkr) || 0), 0));
      setOpenShips(s.data.filter((x) => !['Cleared', 'closed', 'costed'].includes(x.status)).map((x) => ({ no: x.shipment_no, eta: x.eta, status: x.status, mode: x.mode })));
      setPlWaiting(p.data.filter((x) => !x.received).length);
      const q: Record<string, number> = {}; (ws.data ?? []).forEach((r) => { q[r.product_id] = (q[r.product_id] ?? 0) + Number(r.qty); });
      setLowStock((wp.data ?? []).filter((x) => x.is_active && Number(x.min_qty) > 0 && (q[x.id] ?? 0) < Number(x.min_qty)).length);

      // sales side — same balance rule as Customer Outstanding (receivables.ts)
      const dueBy = new Map<string, number>();
      const over: Inv[] = [];
      let sm = 0;
      inv.data.forEach((i) => {
        if (i.status === 'draft') return;
        if ((i.invoice_date || '').slice(0, 7) === month) sm += Number(i.total_amount) || 0;
        const bal = Number(i.amount_due) || 0;
        if (i.status !== 'paid' && bal > 0) {
          const k = custKey(i.customer_name);
          dueBy.set(k, (dueBy.get(k) || 0) + bal);
          const ref = i.due_date || i.invoice_date;
          if (daysOld(ref) > (i.due_date ? 0 : 30)) over.push({ customer: i.customer_name || '—', no: i.invoice_number, due: i.due_date, date: i.invoice_date, bal });
        }
      });
      setSalesMonth(sm);
      const onAcc = onAccountByCustomer(pay.data);
      const openingBy = new Map<string, number | null>();
      cust.data.forEach((c) => { if (!openingBy.has(custKey(c.name))) openingBy.set(custKey(c.name), c.opening_balance); });
      const all = new Map<string, number>(dueBy);
      openingBy.forEach((_, k) => { if (!all.has(k)) all.set(k, 0); });
      let rec = 0, n = 0;
      all.forEach((due, k) => { const t = due + netOpening(k, openingBy.get(k), onAcc); if (t > 0) { rec += t; n++; } });
      setReceivable(rec); setDebtors(n);
      setOverdue(over.sort((a, c) => c.bal - a.bal));
      setCollectedMonth(pay.data.filter((x) => x.cheque_status !== 'returned' && (x.payment_date || '').slice(0, 7) === month).reduce((t, x) => t + (Number(x.amount) || 0), 0));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [tick]);

  const oweSuppliers = unpaidBills.reduce((t, x) => t + x.bal, 0);

  // to-do: the most urgent few from both sides
  const todo = useMemo(() => {
    const t: { tone: string; text: string; sub: string; view: string }[] = [];
    unpaidBills.slice(0, 2).forEach((b) => t.push({ tone: daysOld(b.date) > 30 ? 'bg-red-500' : 'bg-amber-500', text: `Pay ${b.supplier} — ${cny(b.bal)}`, sub: `Bill ${b.no} · ${daysOld(b.date)} days old`, view: 'outstanding-payments' }));
    overdue.slice(0, 3).forEach((i) => t.push({ tone: 'bg-red-500', text: `Collect from ${i.customer} — ${rs(i.bal)}`, sub: `${i.no} · ${daysOld(i.due || i.date)} days ${i.due ? 'overdue' : 'old'}`, view: 'customer-outstanding' }));
    openShips.filter((s) => s.eta && s.status !== 'Arrived').forEach((s) => {
      const d = -daysOld(s.eta!);
      if (d <= 7) t.push({ tone: d < 0 ? 'bg-red-500' : 'bg-[#e8552a]', text: d < 0 ? `${s.no} was due ${-d} day${d === -1 ? '' : 's'} ago` : d === 0 ? `${s.no} arrives today` : `${s.no} arrives in ${d} day${d === 1 ? '' : 's'}`, sub: `${s.mode} · ${s.status}`, view: 'shipping' });
    });
    if (plWaiting) t.push({ tone: 'bg-neutral-800', text: `${plWaiting} packing list${plWaiting > 1 ? 's' : ''} still to receive`, sub: 'Ask the supplier, then tick received in PL Input', view: 'pl-input' });
    if (lowStock) t.push({ tone: 'bg-amber-500', text: `${lowStock} warehouse item${lowStock > 1 ? 's' : ''} below minimum`, sub: 'Check Warehouse before the next order', view: 'warehouse' });
    return t;
  }, [unpaidBills, overdue, openShips, plWaiting, lowStock]);

  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const GreetIcon = h < 12 ? Sun : h < 17 ? CloudSun : Moon;
  const first = (name || '').split(/[\s@.]/)[0];
  const book = getBook() === BOOK_ALL ? 'All books' : getBook();

  const actions = [
    { label: 'New PO', icon: ClipboardList, view: 'purchase-orders' },
    { label: 'Bills', icon: Receipt, view: 'purchase-bills' },
    { label: 'Pay supplier', icon: DollarSign, view: 'outstanding-payments' },
    { label: 'Shipping', icon: Container, view: 'shipping' },
    { label: 'New invoice', icon: FileText, view: 'busy-sales-invoices' },
    { label: 'Take payment', icon: CreditCard, view: 'busy-sales-payments' },
    { label: 'Outstanding', icon: Users, view: 'customer-outstanding' },
  ];
  const tiles = [
    { label: 'We owe suppliers', value: cny(oweSuppliers), sub: `${unpaidBills.length} bill${unpaidBills.length === 1 ? '' : 's'} open`, icon: DollarSign, tone: oweSuppliers > 0 ? 'text-red-700' : 'text-gray-900', view: 'outstanding-payments' },
    { label: 'We owe the investor', value: rs(investorOwed), sub: 'Investor ledger balance', icon: Landmark, tone: investorOwed > 0 ? 'text-red-700' : 'text-green-700', view: 'investor' },
    { label: 'Customers owe us', value: rs(receivable), sub: `${debtors} customer${debtors === 1 ? '' : 's'} · ${overdue.length} overdue invoice${overdue.length === 1 ? '' : 's'}`, icon: Users, tone: 'text-gray-900', view: 'customer-outstanding' },
    { label: 'Collected this month', value: rs(collectedMonth), sub: `Sales this month ${rs(salesMonth)}`, icon: Wallet, tone: 'text-green-700', view: 'busy-sales-payments' },
    { label: 'Shipments on the way', value: String(openShips.length), sub: openShips[0]?.eta ? `next ETA ${openShips.filter((s) => s.eta).sort((a, c) => (a.eta! > c.eta! ? 1 : -1))[0]?.eta}` : 'none booked', icon: Ship, tone: 'text-gray-900', view: 'shipping' },
    { label: 'Packing lists waiting', value: String(plWaiting), sub: lowStock ? `${lowStock} warehouse item${lowStock === 1 ? '' : 's'} low` : 'warehouse stock OK', icon: ListChecks, tone: plWaiting > 0 ? 'text-amber-700' : 'text-gray-900', view: 'pl-input' },
  ];

  return (
    <div className="space-y-6">
      {/* hello + quick buttons for both sides */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-[#f4f3f1] flex items-center justify-center shrink-0"><GreetIcon className="w-6 h-6 text-[#e8552a]" /></div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">{greet}{first ? `, ${first.charAt(0).toUpperCase() + first.slice(1)}` : ''}</h1>
            <p className="text-sm text-gray-500 flex flex-wrap items-center gap-2">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
              <span className="font-mono text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#fff1ec] text-[#c2410c]">{book} · {companyFor().name}</span></p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <button key={a.label} onClick={() => onNavigate(a.view)} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white border border-gray-200 text-sm text-gray-700 hover:border-[#e8552a] hover:text-[#c2410c]">
              <a.icon className="w-4 h-4" />{a.label}
            </button>
          ))}
          <button onClick={() => setTick((t) => t + 1)} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white border border-gray-200 text-sm text-gray-500 hover:border-gray-400" title="Refresh"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
      </div>

      {loadErr && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2">Some figures could not be loaded, so totals may be incomplete: {loadErr}</p>}

      {/* the key numbers: imports and sales side by side */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {tiles.map((t) => (
          <button key={t.label} onClick={() => onNavigate(t.view)} className="bg-white border border-gray-200 rounded-xl p-4 text-left hover:bg-gray-50 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[#f4f3f1] flex items-center justify-center mb-3"><t.icon className="w-5 h-5 text-[#e8552a]" /></div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-gray-500 truncate">{t.label}</div>
            <div className={`text-lg sm:text-xl font-bold tabular-nums truncate ${t.tone}`}>{loading ? '…' : t.value}</div>
            <div className="font-mono text-[10px] text-gray-400 truncate">{loading ? '' : t.sub}</div>
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 min-w-0"><ShipmentJourney onNavigate={onNavigate} /></div>
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">Today's to-do</h3><span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">imports + sales</span></div>
          {loading ? <p className="text-sm text-gray-500">Loading…</p> : todo.length === 0 ? (
            <div className="text-center py-6"><CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-1" /><p className="text-sm text-gray-500">Nothing waiting. All clear!</p></div>
          ) : (
            <ul className="space-y-1">
              {todo.slice(0, 8).map((t, i) => (
                <li key={i}>
                  <button onClick={() => onNavigate(t.view)} className="w-full flex items-start gap-3 text-left rounded-lg px-2 py-2 hover:bg-gray-50">
                    <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${t.tone}`} />
                    <span className="min-w-0"><span className="block text-sm text-gray-900 truncate">{t.text}</span><span className="block font-mono text-[10px] uppercase tracking-wide text-gray-500 truncate">{t.sub}</span></span>
                    <ArrowRight className="w-3.5 h-3.5 text-gray-300 ml-auto mt-1 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!loading && lowStock > 0 && <p className="mt-3 flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle className="w-3.5 h-3.5" /> Low stock is counted from the Warehouse minimums.</p>}
        </div>
      </div>

      <section>
        <div className="flex items-center gap-3 mb-3"><span className="font-mono text-[10px] tracking-[0.16em] text-[#e8552a] uppercase">Imports · CN</span><span className="flex-1 h-px bg-gray-200" /></div>
        <CNPortalDashboard onNavigate={onNavigate} embedded />
      </section>

      <section>
        <div className="flex items-center gap-3 mb-3"><span className="font-mono text-[10px] tracking-[0.16em] text-[#e8552a] uppercase">Sales · SL</span><span className="flex-1 h-px bg-gray-200" /></div>
        <SLPortalDashboard onNavigate={onNavigate} embedded />
      </section>
    </div>
  );
}
