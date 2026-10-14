import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, Printer, RefreshCw, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { getBook, BOOK_ALL } from '../lib/book';
import { companyFor } from '../lib/company';
import { fetchAllPages } from '../lib/fetchAll';
import { esc } from '../lib/html';

/* CN Reports — purchase side only. Every query goes through the book filter,
   so a login locked to one book only ever reports on that book. */

type Tab = 'outstanding' | 'bills' | 'payments' | 'batches' | 'shipments' | 'freight' | 'agents' | 'investor';
type Cell = string | number;
type Report = { title: string; head: string[]; num: boolean[]; rows: Cell[][]; total?: Cell[]; link?: (row: number) => (() => void) | null };

interface Bill { id: string; no: string; date: string; batch: string; supplier: string; total: number; paid: number; bal: number; rate: number; status: string }
interface Pay { date: string; voucher: string; supplier: string; bill: string; batch: string; mode: string; rmb: number; rate: number; lkr: number; funded: string }
interface Ship { no: string; mode: string; forwarder: string; eta: string; status: string; charges: number; created: string }
interface Led { date: string; dir: 'owe' | 'paid'; lkr: number }
interface Chg { ship: string; bill: string; supplier: string; basis: string; qty: number; rate: number; amount: number; other: number; billRmb: number; billRate: number }
interface AgLine { agent: string; date: string; kind: 'charge' | 'payment'; amount: number; ref: string }

const n0 = (v: number) => Math.round(v).toLocaleString('en-US');
const n2 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// yyyy-mm-dd -> dd/mm/yyyy for the screen, print and Excel (sorting/filters use the ISO date)
const dmy = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const daysSince = (d: string) => Math.max(0, Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000));
const mlabel = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
const input = 'px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm bg-white';

export default function CnReports() {
  const [tab, setTab] = useState<Tab>('outstanding');
  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState<Bill[]>([]);
  const [pays, setPays] = useState<Pay[]>([]);
  const [ships, setShips] = useState<Ship[]>([]);
  const [led, setLed] = useState<Led[]>([]);
  const [chg, setChg] = useState<Chg[]>([]);
  const [ag, setAg] = useState<AgLine[]>([]);
  // filters
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [supplier, setSupplier] = useState('');
  const [batch, setBatch] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [payGroup, setPayGroup] = useState<'detail' | 'month' | 'supplier'>('detail');

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    // every page (Supabase stops at 1000 rows per call); the book filter is added automatically
    const [b, p, s, l, c, a] = await Promise.all([
      fetchAllPages<unknown>(() => supabase.from('purchase_bills').select('id, bill_number, cnv_invoice_number, bill_date, batch_number, exchange_rate, amount_paid, purchase_orders(suppliers(name)), purchase_bill_items(quantity_received, unit_price_cny)').order('id')),
      fetchAllPages<unknown>(() => supabase.from('purchase_payments').select('payment_date, voucher_number, payment_mode, amount, rate_lkr, funded_by, purchase_bills(bill_number, cnv_invoice_number, batch_number, exchange_rate, purchase_orders(suppliers(name)))').order('id')),
      fetchAllPages<unknown>(() => supabase.from('shipments').select('id, shipment_no, mode, forwarder, eta, status, actual_charges, other_charges, created_at').order('id')),
      fetchAllPages<unknown>(() => supabase.from('investor_ledger').select('entry_date, direction, lkr').order('id')),
      fetchAllPages<unknown>(() => supabase.from('shipment_charges').select('shipment_id, purchase_bill_id, basis, qty, rate, amount').order('id')),
      fetchAllPages<unknown>(() => supabase.from('agent_ledger').select('entry_date, kind, amount, reference, clearing_agents(name)').order('id')),
    ]);
    const err = b.error || p.error || s.error || l.error || c.error || a.error;
    if (err) alert('Could not load all report data: ' + err);
    type BRaw = { id: string; bill_number: string | null; cnv_invoice_number: string | null; bill_date: string; batch_number: string | null; exchange_rate: number | null; amount_paid: number | null; purchase_orders: { suppliers: { name: string } | null } | null; purchase_bill_items: { quantity_received: number; unit_price_cny: number }[] | null };
    setBills(((b.data ?? []) as unknown as BRaw[]).map((x) => {
      const total = (x.purchase_bill_items ?? []).reduce((t, i) => t + (Number(i.quantity_received) || 0) * (Number(i.unit_price_cny) || 0), 0);
      const paid = Number(x.amount_paid) || 0, bal = total - paid;
      return {
        id: x.id, no: [x.bill_number, x.cnv_invoice_number].filter(Boolean).join(' / ') || '—', date: x.bill_date || '', batch: x.batch_number || '', supplier: x.purchase_orders?.suppliers?.name || '(no supplier)',
        total, paid, bal, rate: Number(x.exchange_rate) || 0,
        status: total <= 0 ? 'Empty' : bal > 0.5 ? (paid > 0.5 ? 'Part paid' : 'Unpaid') : bal < -0.5 ? 'Overpaid' : 'Paid',
      };
    }));
    type PRaw = { payment_date: string; voucher_number: string | null; payment_mode: string | null; amount: number; rate_lkr: number | null; funded_by: string | null; purchase_bills: { bill_number: string | null; cnv_invoice_number: string | null; batch_number: string | null; exchange_rate: number | null; purchase_orders: { suppliers: { name: string } | null } | null } | null };
    setPays(((p.data ?? []) as unknown as PRaw[]).map((x) => {
      const rate = Number(x.rate_lkr) || Number(x.purchase_bills?.exchange_rate) || 0, rmb = Number(x.amount) || 0;
      return { date: x.payment_date || '', voucher: x.voucher_number || '', supplier: x.purchase_bills?.purchase_orders?.suppliers?.name || '(no supplier)', bill: x.purchase_bills?.bill_number || x.purchase_bills?.cnv_invoice_number || '', batch: x.purchase_bills?.batch_number || '', mode: x.payment_mode || '', rmb, rate, lkr: rmb * rate, funded: x.funded_by === 'investor' ? 'Investor' : 'Own' };
    }));
    type SRaw = { shipment_no: string; mode: string; forwarder: string | null; eta: string | null; status: string; actual_charges: number | null; created_at: string };
    setShips(((s.data ?? []) as SRaw[]).map((x) => ({ no: x.shipment_no, mode: x.mode, forwarder: x.forwarder || '', eta: x.eta || '', status: x.status, charges: Number(x.actual_charges) || 0, created: x.created_at.slice(0, 10) })));
    setLed(((l.data ?? []) as { entry_date: string; direction: 'owe' | 'paid'; lkr: number }[]).map((x) => ({ date: x.entry_date || '', dir: x.direction, lkr: Number(x.lkr) || 0 })));
    // freight per bill (other charges split by share inside each shipment)
    type SRaw2 = { id: string; shipment_no: string; other_charges: number | null };
    const shipById = new Map(((s.data ?? []) as unknown as SRaw2[]).map((x) => [x.id, x]));
    const billById = new Map(((b.data ?? []) as unknown as BRaw[]).map((x) => [x.id, x]));
    type CRaw = { shipment_id: string; purchase_bill_id: string; basis: string; qty: number; rate: number; amount: number };
    const craw = ((c.data ?? []) as CRaw[]).filter((x) => shipById.has(x.shipment_id));
    const freightByShip: Record<string, number> = {}; const countByShip: Record<string, number> = {};
    craw.forEach((x) => { freightByShip[x.shipment_id] = (freightByShip[x.shipment_id] ?? 0) + (Number(x.amount) || 0); countByShip[x.shipment_id] = (countByShip[x.shipment_id] ?? 0) + 1; });
    setChg(craw.map((x) => {
      const sh = shipById.get(x.shipment_id)!, bl = billById.get(x.purchase_bill_id);
      const oth = Number(sh.other_charges) || 0, f = freightByShip[x.shipment_id] || 0, amt = Number(x.amount) || 0;
      const share = oth <= 0 ? 0 : f > 0 ? oth * (amt / f) : oth / (countByShip[x.shipment_id] || 1);
      const rmb = bl ? (bl.purchase_bill_items ?? []).reduce((t, i) => t + (Number(i.quantity_received) || 0) * (Number(i.unit_price_cny) || 0), 0) : 0;
      return { ship: sh.shipment_no, bill: bl?.bill_number || bl?.cnv_invoice_number || '—', supplier: bl?.purchase_orders?.suppliers?.name || '—', basis: x.basis, qty: Number(x.qty) || 0, rate: Number(x.rate) || 0, amount: amt, other: share, billRmb: rmb, billRate: Number(bl?.exchange_rate) || 0 };
    }));
    type ARaw = { entry_date: string; kind: 'charge' | 'payment'; amount: number; reference: string | null; clearing_agents: { name: string } | null };
    setAg(((a.data ?? []) as unknown as ARaw[]).map((x) => ({ agent: x.clearing_agents?.name || '—', date: x.entry_date || '', kind: x.kind, amount: Number(x.amount) || 0, ref: x.reference || '' })));
    setLoading(false);
  }

  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);
  const suppliers = useMemo(() => Array.from(new Set([...bills.map((b) => b.supplier), ...pays.map((p) => p.supplier)])).sort(), [bills, pays]);
  const batches = useMemo(() => Array.from(new Set([...bills.map((b) => b.batch), ...chg.map((c) => c.ship)].filter(Boolean))).sort(), [bills, chg]);
  const q = search.trim().toLowerCase();
  const fBills = bills.filter((b) => inRange(b.date) && (!supplier || b.supplier === supplier) && (!batch || b.batch === batch) && (!q || `${b.no} ${b.batch} ${b.supplier}`.toLowerCase().includes(q)));
  const goSupplier = (s: string) => () => { setSupplier(s); setStatus(''); setTab('bills'); };
  const goBatch = (b: string) => () => { setBatch(b); setStatus(''); setTab('bills'); };

  const report: Report = useMemo(() => {
    if (tab === 'outstanding') {
      const m = new Map<string, { bills: number; total: number; paid: number; bal: number; oldest: string; a30: number; a60: number; a90: number; a90p: number }>();
      fBills.forEach((b) => {
        const r = m.get(b.supplier) ?? { bills: 0, total: 0, paid: 0, bal: 0, oldest: '', a30: 0, a60: 0, a90: 0, a90p: 0 };
        r.bills++; r.total += b.total; r.paid += b.paid; r.bal += b.bal;
        if (b.bal > 0.5) {
          if (!r.oldest || b.date < r.oldest) r.oldest = b.date;
          const d = daysSince(b.date);
          if (d <= 30) r.a30 += b.bal; else if (d <= 60) r.a60 += b.bal; else if (d <= 90) r.a90 += b.bal; else r.a90p += b.bal;
        }
        m.set(b.supplier, r);
      });
      const list = [...m.entries()].filter(([, r]) => !onlyOpen || r.bal > 0.5).sort((a, b) => b[1].bal - a[1].bal);
      const t = list.reduce((s, [, r]) => ({ total: s.total + r.total, paid: s.paid + r.paid, bal: s.bal + r.bal, a30: s.a30 + r.a30, a60: s.a60 + r.a60, a90: s.a90 + r.a90, a90p: s.a90p + r.a90p, bills: s.bills + r.bills }), { total: 0, paid: 0, bal: 0, a30: 0, a60: 0, a90: 0, a90p: 0, bills: 0 });
      return {
        title: 'Outstanding by supplier (RMB)',
        head: ['Supplier', 'Bills', 'Billed', 'Paid', 'Balance', '0–30 days', '31–60', '61–90', '90+ days', 'Oldest unpaid'],
        num: [false, true, true, true, true, true, true, true, true, false],
        rows: list.map(([s, r]) => [s, r.bills, n2(r.total), n2(r.paid), n2(r.bal), r.a30 ? n2(r.a30) : '', r.a60 ? n2(r.a60) : '', r.a90 ? n2(r.a90) : '', r.a90p ? n2(r.a90p) : '', r.oldest ? `${dmy(r.oldest)} (${daysSince(r.oldest)}d)` : '']),
        total: ['TOTAL', t.bills, n2(t.total), n2(t.paid), n2(t.bal), n2(t.a30), n2(t.a60), n2(t.a90), n2(t.a90p), ''],
        link: (i) => goSupplier(list[i][0]),
      };
    }
    if (tab === 'bills') {
      const list = fBills.filter((b) => !status || b.status === status).sort((a, b) => b.date.localeCompare(a.date));
      const t = list.reduce((s, b) => ({ total: s.total + b.total, paid: s.paid + b.paid, bal: s.bal + b.bal }), { total: 0, paid: 0, bal: 0 });
      return {
        title: 'Bills (RMB)',
        head: ['Date', 'Bill / CNV', 'Batch', 'Supplier', 'Total', 'Paid', 'Balance', 'Status', 'Age', 'Rate'],
        num: [false, false, false, false, true, true, true, false, true, true],
        rows: list.map((b) => [dmy(b.date), b.no, b.batch, b.supplier, n2(b.total), n2(b.paid), n2(b.bal), b.status, b.bal > 0.5 ? `${daysSince(b.date)}d` : '', b.rate ? n2(b.rate) : '']),
        total: ['TOTAL', `${list.length} bills`, '', '', n2(t.total), n2(t.paid), n2(t.bal), '', '', ''],
      };
    }
    if (tab === 'payments') {
      const list = pays.filter((p) => inRange(p.date) && (!supplier || p.supplier === supplier) && (!batch || p.batch === batch) && (!mode || p.mode === mode) && (!q || `${p.voucher} ${p.bill} ${p.supplier} ${p.batch}`.toLowerCase().includes(q))).sort((a, b) => b.date.localeCompare(a.date));
      const t = list.reduce((s, p) => ({ rmb: s.rmb + p.rmb, lkr: s.lkr + p.lkr }), { rmb: 0, lkr: 0 });
      if (payGroup !== 'detail') {
        const m = new Map<string, { n: number; rmb: number; lkr: number }>();
        list.forEach((p) => { const k = payGroup === 'month' ? p.date.slice(0, 7) : p.supplier; const r = m.get(k) ?? { n: 0, rmb: 0, lkr: 0 }; r.n++; r.rmb += p.rmb; r.lkr += p.lkr; m.set(k, r); });
        const g = [...m.entries()].sort((a, b) => (payGroup === 'month' ? b[0].localeCompare(a[0]) : b[1].rmb - a[1].rmb));
        return {
          title: `Supplier payments by ${payGroup}`,
          head: [payGroup === 'month' ? 'Month' : 'Supplier', 'Payments', 'RMB', 'LKR', 'Avg rate'],
          num: [false, true, true, true, true],
          rows: g.map(([k, r]) => [payGroup === 'month' ? mlabel(k) : k, r.n, n2(r.rmb), n0(r.lkr), r.rmb ? n2(r.lkr / r.rmb) : '']),
          total: ['TOTAL', list.length, n2(t.rmb), n0(t.lkr), t.rmb ? n2(t.lkr / t.rmb) : ''],
          link: payGroup === 'supplier' ? (i) => goSupplier(g[i][0]) : undefined,
        };
      }
      return {
        title: 'Supplier payments',
        head: ['Date', 'Voucher', 'Supplier', 'Bill', 'Batch', 'Mode', 'RMB', 'Rate', 'LKR', 'Funded by'],
        num: [false, false, false, false, false, false, true, true, true, false],
        rows: list.map((p) => [dmy(p.date), p.voucher, p.supplier, p.bill, p.batch, p.mode, n2(p.rmb), p.rate ? n2(p.rate) : '', n0(p.lkr), p.funded]),
        total: ['TOTAL', `${list.length} payments`, '', '', '', '', n2(t.rmb), t.rmb ? n2(t.lkr / t.rmb) : '', n0(t.lkr), ''],
      };
    }
    if (tab === 'batches') {
      const m = new Map<string, { sup: Set<string>; bills: number; total: number; paid: number; bal: number; first: string }>();
      fBills.forEach((b) => {
        const k = b.batch || '(no batch)';
        const r = m.get(k) ?? { sup: new Set<string>(), bills: 0, total: 0, paid: 0, bal: 0, first: b.date };
        r.sup.add(b.supplier); r.bills++; r.total += b.total; r.paid += b.paid; r.bal += b.bal; if (b.date < r.first) r.first = b.date;
        m.set(k, r);
      });
      const list = [...m.entries()].filter(([, r]) => !onlyOpen || r.bal > 0.5).sort((a, b) => b[1].first.localeCompare(a[1].first));
      const t = list.reduce((s, [, r]) => ({ total: s.total + r.total, paid: s.paid + r.paid, bal: s.bal + r.bal }), { total: 0, paid: 0, bal: 0 });
      return {
        title: 'By batch (RMB)',
        head: ['Batch', 'First bill', 'Suppliers', 'Bills', 'Billed', 'Paid', 'Balance', 'Paid %'],
        num: [false, false, true, true, true, true, true, true],
        rows: list.map(([k, r]) => [k, dmy(r.first), r.sup.size, r.bills, n2(r.total), n2(r.paid), n2(r.bal), r.total ? `${Math.round((r.paid / r.total) * 100)}%` : '']),
        total: ['TOTAL', '', '', list.reduce((s, [, r]) => s + r.bills, 0), n2(t.total), n2(t.paid), n2(t.bal), t.total ? `${Math.round((t.paid / t.total) * 100)}%` : ''],
        link: (i) => (list[i][0] === '(no batch)' ? null : goBatch(list[i][0])),
      };
    }
    if (tab === 'shipments') {
      const list = ships.filter((s) => inRange(s.eta || s.created) && (!status || s.status === status) && (!mode || s.mode === mode) && (!q || `${s.no} ${s.forwarder}`.toLowerCase().includes(q))).sort((a, b) => b.created.localeCompare(a.created));
      return {
        title: 'Shipments',
        head: ['Shipment', 'Mode', 'Forwarder', 'Created', 'ETD', 'Status', 'Charges (LKR)'],
        num: [false, false, false, false, false, false, true],
        rows: list.map((s) => [s.no, s.mode, s.forwarder, dmy(s.created), dmy(s.eta), s.status, s.charges ? n0(s.charges) : '']),
        total: ['TOTAL', `${list.length} shipments`, '', '', '', '', n0(list.reduce((t, s) => t + s.charges, 0))],
      };
    }
    if (tab === 'freight') {
      const list = chg.filter((x) => (!supplier || x.supplier === supplier) && (!batch || x.ship === batch) && (!q || `${x.bill} ${x.ship} ${x.supplier}`.toLowerCase().includes(q)));
      const t = list.reduce((s, x) => ({ a: s.a + x.amount, o: s.o + x.other }), { a: 0, o: 0 });
      return {
        title: 'Shipping cost per bill (LKR)',
        head: ['Shipment', 'Bill', 'Supplier', 'Type', 'Qty', 'Rate', 'Freight', '+ Other', 'Shipping total', 'Goods (Rs)', 'Shipping %'],
        num: [false, false, false, false, true, true, true, true, true, true, true],
        rows: list.map((x) => { const goods = x.billRmb * x.billRate; const tot = x.amount + x.other; return [x.ship, x.bill, x.supplier, x.basis === 'FIXED' ? 'Fixed' : x.basis, x.basis === 'FIXED' ? '' : x.qty.toLocaleString('en-US', { maximumFractionDigits: 3 }), x.basis === 'FIXED' ? '' : n0(x.rate), n0(x.amount), x.other ? n0(x.other) : '', n0(tot), goods ? n0(goods) : '', goods ? `${((tot / goods) * 100).toFixed(1)}%` : '']; }),
        total: ['TOTAL', `${list.length} bills`, '', '', '', '', n0(t.a), n0(t.o), n0(t.a + t.o), '', ''],
      };
    }
    if (tab === 'agents') {
      const list = ag.filter((x) => inRange(x.date) && (!q || `${x.agent} ${x.ref}`.toLowerCase().includes(q)));
      const m = new Map<string, { charged: number; paid: number; n: number }>();
      list.forEach((x) => { const r = m.get(x.agent) ?? { charged: 0, paid: 0, n: 0 }; if (x.kind === 'charge') r.charged += x.amount; else r.paid += x.amount; r.n++; m.set(x.agent, r); });
      // the balance is everything up to the "To" date (not only the chosen period): what we really owe the agent
      const owed = new Map<string, number>();
      ag.filter((x) => !to || x.date <= to).forEach((x) => owed.set(x.agent, (owed.get(x.agent) || 0) + (x.kind === 'charge' ? x.amount : -x.amount)));
      // agents with no entries in the period still owe their balance: list them too, so the balance total is complete
      owed.forEach((v, k) => { if (Math.abs(v) >= 0.5 && !m.has(k) && (!q || `${k}`.toLowerCase().includes(q))) m.set(k, { charged: 0, paid: 0, n: 0 }); });
      const g = [...m.entries()].sort((a, b) => (owed.get(b[0]) || 0) - (owed.get(a[0]) || 0));
      const t = g.reduce((s, [k, r]) => ({ c: s.c + r.charged, p: s.p + r.paid, b: s.b + (owed.get(k) || 0) }), { c: 0, p: 0, b: 0 });
      return {
        title: 'Clearing agents (LKR)',
        head: ['Agent', 'Entries', 'Charged (period)', 'Paid (period)', to ? 'Balance we owe (to date)' : 'Balance we owe (today)'],
        num: [false, true, true, true, true],
        rows: g.map(([k, r]) => [k, r.n, n0(r.charged), n0(r.paid), n0(owed.get(k) || 0)]),
        total: ['TOTAL', list.length, n0(t.c), n0(t.p), n0(t.b)],
      };
    }
    // investor: month by month
    const sorted = [...led].sort((a, b) => a.date.localeCompare(b.date));
    const m = new Map<string, { owe: number; paid: number }>();
    sorted.forEach((l) => { const k = l.date.slice(0, 7); const r = m.get(k) ?? { owe: 0, paid: 0 }; if (l.dir === 'owe') r.owe += l.lkr; else r.paid += l.lkr; m.set(k, r); });
    let bal = 0;
    const all = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, r]) => { const open = bal; bal += r.owe - r.paid; return { k, open, ...r, close: bal }; });
    const list = all.filter((r) => (!from || r.k >= from.slice(0, 7)) && (!to || r.k <= to.slice(0, 7))).reverse();
    return {
      title: 'Investor — month by month (LKR)',
      head: ['Month', 'Opening', 'Funded (we owe)', 'Paid to investor', 'Closing balance'],
      num: [false, true, true, true, true],
      rows: list.map((r) => [mlabel(r.k), n0(r.open), n0(r.owe), n0(r.paid), n0(r.close)]),
      total: ['TOTAL', '', n0(list.reduce((t, r) => t + r.owe, 0)), n0(list.reduce((t, r) => t + r.paid, 0)), list.length ? n0(list[0].close) : '0'],
    };
  }, [tab, fBills, pays, ships, led, chg, ag, status, mode, onlyOpen, payGroup, from, to, supplier, batch, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const bookName = getBook() === BOOK_ALL ? 'All books' : getBook();
  const filterLine = [from || to ? `${from ? dmy(from) : '…'} to ${dmy(to || today())}` : '', supplier, batch ? `Batch ${batch}` : '', status, mode, search ? `"${search}"` : ''].filter(Boolean).join(' · ');

  function excel() {
    const data = [report.head, ...report.rows, ...(report.total ? [report.total] : [])];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `${report.title.replace(/[^\w]+/g, '-').toLowerCase()}-${today()}.xlsx`);
  }
  function print() {
    const w = window.open('', '_blank'); if (!w) { alert('Allow pop-ups to print'); return; }
    const td = (v: Cell, i: number, tag = 'td') => `<${tag} style="text-align:${report.num[i] ? 'right' : 'left'}">${esc(v)}</${tag}>`;
    w.document.write(`<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"><title>${esc(report.title)}</title><style>body{font-family:'IBM Plex Sans',Arial,sans-serif;font-size:11px;margin:24px}h2{margin:0 0 2px}p{color:#666;margin:0 0 12px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:5px 6px;white-space:nowrap}th{background:#f3f4f6;font-size:10px;text-transform:uppercase}tfoot td{font-weight:bold;border-top:2px solid #333}</style></head><body>
      <div style="font-weight:bold;font-size:13px">${esc(companyFor().name)}</div><h2>${esc(report.title)}</h2><p>${esc(bookName)} · printed ${dmy(today())}${filterLine ? ' · ' + esc(filterLine) : ''}</p>
      <table><thead><tr>${report.head.map((h, i) => td(h, i, 'th')).join('')}</tr></thead><tbody>${report.rows.map((r) => `<tr>${r.map((c, i) => td(c, i)).join('')}</tr>`).join('')}</tbody>${report.total ? `<tfoot><tr>${report.total.map((c, i) => td(c, i)).join('')}</tr></tfoot>` : ''}</table>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }
  const clear = () => { setFrom(''); setTo(''); setSupplier(''); setBatch(''); setSearch(''); setStatus(''); setMode(''); };

  const tabs: [Tab, string][] = [['outstanding', 'Outstanding by supplier'], ['bills', 'Bills'], ['payments', 'Payments'], ['batches', 'By batch'], ['shipments', 'Shipments'], ['freight', 'Shipping cost per bill'], ['agents', 'Clearing agents'], ['investor', 'Investor']];
  const show = { supplier: ['outstanding', 'bills', 'payments', 'batches', 'freight'].includes(tab), batch: ['outstanding', 'bills', 'payments', 'batches', 'freight'].includes(tab), search: ['bills', 'payments', 'shipments', 'freight', 'agents'].includes(tab), open: ['outstanding', 'batches'].includes(tab) };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><BarChart3 className="w-6 h-6 text-teal-600" /> CN Reports</h2>
          <p className="text-sm text-gray-500">Purchase side · {bookName}. Pick a report, filter, then print or export.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex items-center gap-1.5 bg-white"><RefreshCw className="w-4 h-4" />Refresh</button>
          <button onClick={print} className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex items-center gap-1.5 bg-white"><Printer className="w-4 h-4" />Print</button>
          <button onClick={excel} className="px-3 py-2 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1.5"><Download className="w-4 h-4" />Excel</button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto no-scrollbar mb-3 bg-white border border-gray-200 rounded-lg p-1">
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => { setTab(id); setStatus(''); setMode(''); }} className={`px-3 py-2 text-sm font-medium rounded-md whitespace-nowrap ${tab === id ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{label}</button>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-500">From<br /><input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-xs text-gray-500">To<br /><input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {show.supplier && <label className="text-xs text-gray-500">Supplier<br /><select className={input} value={supplier} onChange={(e) => setSupplier(e.target.value)}><option value="">All suppliers</option>{suppliers.map((s) => <option key={s}>{s}</option>)}</select></label>}
        {show.batch && <label className="text-xs text-gray-500">Batch<br /><select className={input} value={batch} onChange={(e) => setBatch(e.target.value)}><option value="">All batches</option>{batches.map((b) => <option key={b}>{b}</option>)}</select></label>}
        {tab === 'bills' && <label className="text-xs text-gray-500">Status<br /><select className={input} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['Unpaid', 'Part paid', 'Paid', 'Overpaid'].map((s) => <option key={s}>{s}</option>)}</select></label>}
        {tab === 'payments' && <label className="text-xs text-gray-500">Mode<br /><select className={input} value={mode} onChange={(e) => setMode(e.target.value)}><option value="">All modes</option>{Array.from(new Set(pays.map((p) => p.mode).filter(Boolean))).sort().map((m) => <option key={m}>{m}</option>)}</select></label>}
        {tab === 'payments' && <label className="text-xs text-gray-500">Show<br /><select className={input} value={payGroup} onChange={(e) => setPayGroup(e.target.value as typeof payGroup)}><option value="detail">Every payment</option><option value="month">Total per month</option><option value="supplier">Total per supplier</option></select></label>}
        {tab === 'shipments' && <label className="text-xs text-gray-500">Status<br /><select className={input} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['Booked', 'Shipped', 'Arrived', 'Cleared'].map((s) => <option key={s}>{s}</option>)}</select></label>}
        {tab === 'shipments' && <label className="text-xs text-gray-500">Mode<br /><select className={input} value={mode} onChange={(e) => setMode(e.target.value)}><option value="">All</option><option>LCL</option><option>FCL</option></select></label>}
        {show.search && <label className="text-xs text-gray-500">Search<br /><input className={input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="bill, voucher, batch…" /></label>}
        {show.open && <label className="text-sm text-gray-700 flex items-center gap-1.5 pb-2"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />Only with balance</label>}
        {filterLine && <button onClick={clear} className="text-xs text-teal-700 flex items-center gap-1 pb-2"><X className="w-3.5 h-3.5" />Clear filters</button>}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-200 flex flex-wrap justify-between gap-2">
          <span className="font-semibold text-gray-900 text-sm">{report.title}</span>
          <span className="text-xs text-gray-500">{report.rows.length} rows{report.link ? ' · tap a row to see its bills' : ''}</span>
        </div>
        {loading ? <p className="p-6 text-sm text-gray-500">Loading…</p> : report.rows.length === 0 ? <p className="p-6 text-sm text-gray-500">Nothing matches these filters.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-[11px] uppercase text-gray-500">
                <tr>{report.head.map((h, i) => <th key={h} className={`px-3 py-2 font-semibold ${report.num[i] ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {report.rows.map((r, ri) => {
                  const go = report.link?.(ri) ?? null;
                  return (
                    <tr key={ri} onClick={go ?? undefined} className={go ? 'cursor-pointer hover:bg-teal-50' : 'hover:bg-gray-50'}>
                      {r.map((c, i) => <td key={i} className={`px-3 py-2 ${report.num[i] ? 'text-right tabular-nums' : ''} ${i === 0 && go ? 'text-teal-700 font-medium' : ''} ${report.head[i] === 'Balance' && String(c).startsWith('-') ? 'text-amber-700' : ''}`}>{c}</td>)}
                    </tr>
                  );
                })}
              </tbody>
              {report.total && (
                <tfoot className="bg-gray-50 border-t-2 border-gray-300 font-semibold">
                  <tr>{report.total.map((c, i) => <td key={i} className={`px-3 py-2 ${report.num[i] ? 'text-right tabular-nums' : ''}`}>{c}</td>)}</tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
      <p className="text-[11px] text-gray-400 mt-2">Bill totals = quantity received × unit price (RMB). Balance below zero means overpaid. Ages count from the bill date.</p>
    </div>
  );
}
