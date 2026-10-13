import { useEffect, useMemo, useState } from 'react';
import { Download, Wand2, AlertTriangle, TrendingUp, TrendingDown, Package, Printer } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { custKey } from '../lib/receivables';
import { selectByIds, fetchAllPages } from '../lib/fetchAll';
import { esc } from '../lib/html';
import { companyFor } from '../lib/company';

interface Inv { id: string; invoice_number: string; invoice_date: string; customer_id: string | null; customer_name: string; total_amount: number; amount_paid: number; status: string; }
interface Line { id: string; invoice_id: string; item_id: string | null; item_name: string; quantity: number; unit_price: number; cost_price: number; }
interface Item { id: string; item_name: string; purchase_price: number; }
type View = 'month' | 'customer' | 'item' | 'transfers';

const n0 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = (n: number) => (isFinite(n) ? `${n.toFixed(1)}%` : '—');
const ym = (d: string) => (d || '').slice(0, 7);
const monthLabel = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
const dmy = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const card = 'bg-white border border-gray-200 rounded-xl p-4';

export default function ProfitReport({ startDate = '' }: { startDate?: string }) {
  const [invoices, setInvoices] = useState<Inv[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [view, setView] = useState<View>('month');
  const [from, setFrom] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 5); const six = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; return startDate && startDate > six ? startDate : six; });
  useEffect(() => { if (startDate && from < startDate) setFrom(startDate); }, [startDate]); // eslint-disable-line react-hooks/exhaustive-deps
  const [to, setTo] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  const [filling, setFilling] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);
  async function load() {
    // every page (Supabase stops at 1000 rows per call); invoices are filtered to the current book automatically
    const [i, it] = await Promise.all([
      fetchAllPages<Inv>(() => supabase.from('busy_sales_invoices').select('id, invoice_number, invoice_date, customer_id, customer_name, total_amount, amount_paid, status').order('id')),
      fetchAllPages<Item>(() => supabase.from('items').select('id, item_name, purchase_price').order('id')),
    ]);
    // only the lines of this book's invoices (all lines of all books would also stop at 1000 rows)
    const l = await selectByIds<Line>('busy_sales_invoice_items', 'id, invoice_id, item_id, item_name, quantity, unit_price, cost_price', 'invoice_id', ((i.data ?? []) as Inv[]).map((x) => x.id));
    if (i.error || l.error) alert('Could not load all sales for the report: ' + (i.error || l.error));
    setInvoices(((i.data ?? []) as Inv[]).filter((x) => x.status !== 'cancelled' && x.status !== 'draft'));
    setLines(((l.data ?? []) as Line[]).map((x) => ({ ...x, quantity: Number(x.quantity) || 0, unit_price: Number(x.unit_price) || 0, cost_price: Number(x.cost_price) || 0 })));
    setItems((it.data ?? []) as Item[]);
    setLoading(false);
  }

  // ---- derived ----
  const invById = useMemo(() => Object.fromEntries(invoices.map((i) => [i.id, i])), [invoices]);
  const inRange = (d: string) => d >= from && d <= to && (!startDate || d >= startDate);
  const rows = useMemo(() => lines.map((l) => { const inv = invById[l.invoice_id]; if (!inv || !inRange(inv.invoice_date)) return null;
    const sale = l.unit_price > 0; const rev = l.quantity * l.unit_price; const cost = l.quantity * l.cost_price;
    return { ...l, inv, sale, rev, cost, profit: rev - cost, noCost: sale && l.cost_price <= 0 }; }).filter(Boolean) as (Line & { inv: Inv; sale: boolean; rev: number; cost: number; profit: number; noCost: boolean })[], [lines, invById, from, to, startDate]); // eslint-disable-line react-hooks/exhaustive-deps
  const sales = rows.filter((r) => r.sale);
  const transfers = rows.filter((r) => !r.sale && r.quantity > 0);
  const tot = { rev: sales.reduce((t, r) => t + r.rev, 0), cost: sales.reduce((t, r) => t + r.cost, 0), noCost: sales.filter((r) => r.noCost).length };
  const tot_profit = tot.rev - tot.cost;
  const invIds = new Set(sales.map((r) => r.invoice_id));
  const collected = invoices.filter((i) => invIds.has(i.id)).reduce((t, i) => t + (Number(i.amount_paid) || 0), 0);
  const invoiced = invoices.filter((i) => invIds.has(i.id)).reduce((t, i) => t + (Number(i.total_amount) || 0), 0);

  function group<K extends string>(key: (r: typeof sales[number]) => K) {
    const m = new Map<K, { rev: number; cost: number; qty: number; n: Set<string>; noCost: number }>();
    for (const r of sales) { const k = key(r); const g = m.get(k) ?? { rev: 0, cost: 0, qty: 0, n: new Set<string>(), noCost: 0 }; g.rev += r.rev; g.cost += r.cost; g.qty += r.quantity; g.n.add(r.invoice_id); if (r.noCost) g.noCost++; m.set(k, g); }
    return Array.from(m.entries()).map(([k, g]) => ({ key: k, ...g, profit: g.rev - g.cost, margin: g.rev > 0 ? ((g.rev - g.cost) / g.rev) * 100 : NaN, invoices: g.n.size }));
  }
  const byMonth = group((r) => ym(r.inv.invoice_date)).sort((a, b) => a.key.localeCompare(b.key));
  // one row per customer even if the name was typed with different spaces / capitals
  const nameOf = new Map<string, string>(); invoices.forEach((i) => { const k = custKey(i.customer_name); if (!nameOf.has(k)) nameOf.set(k, (i.customer_name || '').trim()); });
  const byCustomer = group((r) => nameOf.get(custKey(r.inv.customer_name)) ?? r.inv.customer_name).sort((a, b) => b.profit - a.profit);
  const byItem = group((r) => r.item_name).sort((a, b) => b.profit - a.profit);
  const transByItem = (() => { const m = new Map<string, { qty: number; cost: number; months: Set<string> }>(); for (const r of transfers) { const g = m.get(r.item_name) ?? { qty: 0, cost: 0, months: new Set() }; g.qty += r.quantity; g.cost += r.cost; g.months.add(ym(r.inv.invoice_date)); m.set(r.item_name, g); } return Array.from(m.entries()).map(([k, g]) => ({ key: k, ...g })).sort((a, b) => b.cost - a.cost); })();
  const transTotal = transfers.reduce((t, r) => t + r.cost, 0);

  // insights
  const lastTwo = byMonth.slice(-2);
  const trend = lastTwo.length === 2 ? lastTwo[1].profit - lastTwo[0].profit : null;
  const worstItems = byItem.filter((i) => i.rev > 0 && i.margin < 10).slice(-5);
  const bestCustomer = byCustomer[0];

  async function fillMissing() {
    const blank = lines.filter((l) => l.cost_price <= 0 && l.unit_price > 0);
    if (!blank.length) { alert('No sale lines without cost.'); return; }
    const byId = Object.fromEntries(items.map((i) => [i.id, i])); const byName = Object.fromEntries(items.map((i) => [i.item_name.trim().toLowerCase(), i]));
    const updates = blank.map((l) => { const it = (l.item_id && byId[l.item_id]) || byName[l.item_name.trim().toLowerCase()]; return it && it.purchase_price > 0 ? { id: l.id, cost_price: it.purchase_price } : null; }).filter(Boolean) as { id: string; cost_price: number }[];
    if (!updates.length) { alert(`${blank.length} lines have no cost, but none of their items has a Purchase Price in master Items. Set purchase prices first.`); return; }
    if (!confirm(`Put today's Purchase Price on ${updates.length} invoice lines that have no cost? (${blank.length - updates.length} lines have no matching master item and will stay blank.)`)) return;
    setFilling(true);
    for (const u of updates) await supabase.from('busy_sales_invoice_items').update({ cost_price: u.cost_price }).eq('id', u.id);
    setFilling(false); load();
  }

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    const sheet = (name: string, data: Record<string, unknown>[]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), name);
    sheet('By month', byMonth.map((g) => ({ Month: g.key, Invoices: g.invoices, Revenue: g.rev, 'Cost of goods': g.cost, 'Gross profit': g.profit, 'Margin %': isFinite(g.margin) ? +g.margin.toFixed(1) : '', 'Lines without cost': g.noCost })));
    sheet('By customer', byCustomer.map((g) => ({ Customer: g.key, Invoices: g.invoices, Revenue: g.rev, 'Cost of goods': g.cost, 'Gross profit': g.profit, 'Margin %': isFinite(g.margin) ? +g.margin.toFixed(1) : '' })));
    sheet('By item', byItem.map((g) => ({ Item: g.key, Qty: g.qty, Revenue: g.rev, 'Cost of goods': g.cost, 'Gross profit': g.profit, 'Margin %': isFinite(g.margin) ? +g.margin.toFixed(1) : '', 'Lines without cost': g.noCost })));
    sheet('Transferred to shop', transByItem.map((g) => ({ Item: g.key, Qty: g.qty, 'Cost value': g.cost })));
    sheet('Lines', sales.map((r) => ({ Date: r.inv.invoice_date, Invoice: r.inv.invoice_number, Customer: r.inv.customer_name, Item: r.item_name, Qty: r.quantity, Price: r.unit_price, Cost: r.cost_price, Revenue: r.rev, Profit: r.profit })));
    XLSX.writeFile(wb, `profit-${from}-to-${to}.xlsx`);
  }

  function print() {
    const row = (cells: (string | number)[], cls = '') => `<tr class="${cls}">${cells.map((c, i) => `<td class="${i === 0 ? '' : 'r'}">${c}</td>`).join('')}</tr>`;
    const m = (x: number) => (!isFinite(x) ? '—' : `<span class="${x < 10 ? 'red' : x < 20 ? 'amb' : 'grn'}">${pct(x)}</span>`);
    const tbl = (title: string, head: string[], body: string) => `<h3>${title}</h3><table><thead><tr>${head.map((h, i) => `<th class="${i === 0 ? '' : 'r'}">${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
    const w = window.open('', '_blank'); if (!w) { alert('Allow pop-ups to print'); return; }
    w.document.write(`<html><head><title>Gross profit report</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px;color:#111}h1{font-size:18px;margin:0}h2{font-size:13px;margin:2px 0 14px;color:#555;font-weight:normal}.tiles{display:flex;gap:10px;margin-bottom:14px}.tile{flex:1;border:1px solid #ddd;border-radius:8px;padding:10px}.tile small{color:#666;display:block;font-size:10px}.tile b{font-size:16px}.box{background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;margin-bottom:14px}.box p{margin:3px 0}h3{font-size:13px;margin:14px 0 4px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:5px 6px;text-align:left}th{background:#f3f4f6;font-size:11px}.r{text-align:right}.red{color:#b91c1c}.amb{color:#b45309}.grn{color:#15803d}.foot{font-size:10px;color:#666;margin-top:10px}</style></head><body>
      <h1>${esc(companyFor().name)} — Gross profit report</h1><h2>${esc(dmy(from))} to ${esc(dmy(to))} · printed ${new Date().toLocaleDateString('en-GB')}</h2>
      <div class="tiles"><div class="tile"><small>Revenue</small><b>Rs ${n0(tot.rev)}</b><small>${invIds.size} invoices · collected Rs ${n0(collected)}</small></div><div class="tile"><small>Cost of goods</small><b>Rs ${n0(tot.cost)}</b></div><div class="tile"><small>Gross profit</small><b class="${tot_profit >= 0 ? 'grn' : 'red'}">Rs ${n0(tot_profit)}</b><small>margin ${pct(tot.rev > 0 ? (tot_profit / tot.rev) * 100 : NaN)}</small></div><div class="tile"><small>Lines without cost</small><b class="${tot.noCost ? 'amb' : ''}">${tot.noCost}</b></div></div>
      ${(trend !== null || bestCustomer || worstItems.length || transTotal > 0) ? `<div class="box"><p><b>What the numbers say</b></p>${trend !== null ? `<p>${trend >= 0 ? '▲' : '▼'} ${monthLabel(lastTwo[1].key)} profit is Rs ${n0(Math.abs(trend))} ${trend >= 0 ? 'more' : 'less'} than ${monthLabel(lastTwo[0].key)} (margin ${pct(lastTwo[0].margin)} → ${pct(lastTwo[1].margin)}).</p>` : ''}${bestCustomer ? `<p>Most profitable customer: <b>${esc(bestCustomer.key)}</b> — Rs ${n0(bestCustomer.profit)} on Rs ${n0(bestCustomer.rev)} (${pct(bestCustomer.margin)}).</p>` : ''}${worstItems.length ? `<p>⚠ Thin margin (under 10%): ${worstItems.map((i) => `${esc(i.key)} ${pct(i.margin)}`).join(', ')}.</p>` : ''}${transTotal > 0 ? `<p>Goods moved to shop at zero price: Rs ${n0(transTotal)} at cost (not counted as sales).</p>` : ''}</div>` : ''}
      ${tbl('By month', ['Month', 'Invoices', 'Revenue', 'Cost', 'Gross profit', 'Margin', 'No cost'], byMonth.map((g) => row([monthLabel(g.key), g.invoices, n0(g.rev), n0(g.cost), n0(g.profit), m(g.margin), g.noCost || ''])).join(''))}
      ${tbl('By customer', ['Customer', 'Invoices', 'Revenue', 'Cost', 'Gross profit', 'Margin'], byCustomer.map((g) => row([esc(g.key), g.invoices, n0(g.rev), n0(g.cost), n0(g.profit), m(g.margin)])).join(''))}
      ${tbl('By item', ['Item', 'Qty', 'Revenue', 'Cost', 'Gross profit', 'Margin'], byItem.map((g) => row([esc(g.key), n0(g.qty), n0(g.rev), n0(g.cost), n0(g.profit), m(g.margin)])).join(''))}
      ${transByItem.length ? tbl('Transferred to shop (zero price)', ['Item', 'Qty', 'Cost value'], transByItem.map((g) => row([esc(g.key), n0(g.qty), n0(g.cost)])).join('')) : ''}
      <p class="foot">Gross profit = (selling price − cost) × qty. Cost = master item Purchase Price at time of invoicing. Lines with price 0 are shop transfers, not sales. Expenses not included.</p>
      <script>window.print()</script></body></html>`);
    w.document.close();
  }

  if (loading) return <div className="p-6 text-gray-500">Loading…</div>;
  const chip = (a: boolean) => `px-3 py-1.5 rounded-full text-sm border ${a ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`;
  const Tbl = ({ head, children }: { head: string[]; children: React.ReactNode }) => (
    <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl"><table className="w-full text-sm"><thead className="bg-gray-50 text-xs text-gray-500 uppercase"><tr>{head.map((h, i) => <th key={h} className={`px-3 py-2 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{children}</tbody></table></div>
  );
  const marginCell = (m: number) => <td className={`px-3 py-2 text-right font-medium ${!isFinite(m) ? 'text-gray-400' : m < 10 ? 'text-red-600' : m < 20 ? 'text-amber-600' : 'text-green-700'}`}>{pct(m)}</td>;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <div><label className="text-xs text-gray-500">From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label className="text-xs text-gray-500">To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div className="flex gap-1 ml-auto">
          <button onClick={fillMissing} disabled={filling} className="flex items-center gap-1 px-3 py-2 text-sm border border-amber-300 text-amber-800 bg-amber-50 rounded-lg hover:bg-amber-100 disabled:opacity-50" title="Put the master Purchase Price on invoice lines that have no cost"><Wand2 className="w-4 h-4" />{filling ? 'Filling…' : 'Fill missing costs'}</button>
          <button onClick={print} className="flex items-center gap-1 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"><Printer className="w-4 h-4" />Print / PDF</button>
          <button onClick={exportExcel} className="flex items-center gap-1 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"><Download className="w-4 h-4" />Excel</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className={card}><p className="text-xs text-gray-500">Revenue</p><p className="text-xl font-bold text-gray-900">Rs {n0(tot.rev)}</p><p className="text-[11px] text-gray-500">{invIds.size} invoices · collected Rs {n0(collected)} ({invoiced > 0 ? pct((collected / invoiced) * 100) : '—'})</p></div>
        <div className={card}><p className="text-xs text-gray-500">Cost of goods</p><p className="text-xl font-bold text-gray-900">Rs {n0(tot.cost)}</p><p className="text-[11px] text-gray-500">from master purchase price</p></div>
        <div className={`${card} ${tot_profit >= 0 ? 'border-green-200' : 'border-red-200'}`}><p className="text-xs text-gray-500">Gross profit</p><p className={`text-xl font-bold ${tot_profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>Rs {n0(tot_profit)}</p><p className="text-[11px] text-gray-500">margin {pct(tot.rev > 0 ? (tot_profit / tot.rev) * 100 : NaN)}</p></div>
        <div className={`${card} ${tot.noCost > 0 ? 'border-amber-300 bg-amber-50/40' : ''}`}><p className="text-xs text-gray-500">Lines without cost</p><p className={`text-xl font-bold ${tot.noCost > 0 ? 'text-amber-700' : 'text-gray-900'}`}>{tot.noCost}</p><p className="text-[11px] text-gray-500">{tot.noCost > 0 ? 'profit is overstated — fill costs' : 'all sale lines costed'}</p></div>
      </div>

      {(trend !== null || bestCustomer || worstItems.length > 0 || transTotal > 0) && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4 text-sm space-y-1">
          <p className="font-semibold text-slate-800 mb-1">What the numbers say</p>
          {trend !== null && <p className="flex items-center gap-2">{trend >= 0 ? <TrendingUp className="w-4 h-4 text-green-600" /> : <TrendingDown className="w-4 h-4 text-red-600" />}{monthLabel(lastTwo[1].key)} profit is Rs {n0(Math.abs(trend))} {trend >= 0 ? 'more' : 'less'} than {monthLabel(lastTwo[0].key)} (margin {pct(lastTwo[0].margin)} → {pct(lastTwo[1].margin)}).</p>}
          {bestCustomer && <p>Most profitable customer: <b>{bestCustomer.key}</b> — Rs {n0(bestCustomer.profit)} on Rs {n0(bestCustomer.rev)} ({pct(bestCustomer.margin)}).</p>}
          {worstItems.length > 0 && <p className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" /><span>Thin margin (under 10%): {worstItems.map((i) => `${i.key} ${pct(i.margin)}`).join(', ')} — check selling price or cost.</span></p>}
          {transTotal > 0 && <p className="flex items-center gap-2"><Package className="w-4 h-4 text-gray-500" />Goods moved to shop at zero price: Rs {n0(transTotal)} at cost (not counted as sales).</p>}
        </div>
      )}

      <div className="flex gap-2 mb-3 flex-wrap">
        <button onClick={() => setView('month')} className={chip(view === 'month')}>By month</button>
        <button onClick={() => setView('customer')} className={chip(view === 'customer')}>By customer</button>
        <button onClick={() => setView('item')} className={chip(view === 'item')}>By item</button>
        <button onClick={() => setView('transfers')} className={chip(view === 'transfers')}>Transferred to shop ({transByItem.length})</button>
      </div>

      {view === 'month' && <Tbl head={['Month', 'Invoices', 'Revenue', 'Cost', 'Gross profit', 'Margin', 'No cost']}>{byMonth.map((g) => <tr key={g.key}><td className="px-3 py-2 font-medium">{monthLabel(g.key)}</td><td className="px-3 py-2 text-right">{g.invoices}</td><td className="px-3 py-2 text-right">{n0(g.rev)}</td><td className="px-3 py-2 text-right">{n0(g.cost)}</td><td className={`px-3 py-2 text-right font-semibold ${g.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>{n0(g.profit)}</td>{marginCell(g.margin)}<td className="px-3 py-2 text-right">{g.noCost ? <span className="text-amber-700">{g.noCost}</span> : ''}</td></tr>)}{byMonth.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-500">No sales in this period.</td></tr>}</Tbl>}
      {view === 'customer' && <Tbl head={['Customer', 'Invoices', 'Revenue', 'Cost', 'Gross profit', 'Margin']}>{byCustomer.map((g) => <tr key={g.key}><td className="px-3 py-2 font-medium">{g.key}</td><td className="px-3 py-2 text-right">{g.invoices}</td><td className="px-3 py-2 text-right">{n0(g.rev)}</td><td className="px-3 py-2 text-right">{n0(g.cost)}</td><td className={`px-3 py-2 text-right font-semibold ${g.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>{n0(g.profit)}</td>{marginCell(g.margin)}</tr>)}{byCustomer.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">No sales in this period.</td></tr>}</Tbl>}
      {view === 'item' && <Tbl head={['Item', 'Qty', 'Revenue', 'Cost', 'Gross profit', 'Margin', 'No cost']}>{byItem.map((g) => <tr key={g.key}><td className="px-3 py-2 font-medium">{g.key}</td><td className="px-3 py-2 text-right">{n0(g.qty)}</td><td className="px-3 py-2 text-right">{n0(g.rev)}</td><td className="px-3 py-2 text-right">{n0(g.cost)}</td><td className={`px-3 py-2 text-right font-semibold ${g.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>{n0(g.profit)}</td>{marginCell(g.margin)}<td className="px-3 py-2 text-right">{g.noCost ? <span className="text-amber-700">{g.noCost}</span> : ''}</td></tr>)}{byItem.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-500">No sales in this period.</td></tr>}</Tbl>}
      {view === 'transfers' && <Tbl head={['Item', 'Qty', 'Cost value', 'Months']}>{transByItem.map((g) => <tr key={g.key}><td className="px-3 py-2 font-medium">{g.key}</td><td className="px-3 py-2 text-right">{n0(g.qty)}</td><td className="px-3 py-2 text-right">{n0(g.cost)}</td><td className="px-3 py-2 text-right text-gray-500">{Array.from(g.months).sort().map(monthLabel).join(', ')}</td></tr>)}{transByItem.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-500">No zero-price lines in this period.</td></tr>}</Tbl>}
      <p className="text-xs text-gray-400 mt-2">{startDate ? `Invoices before ${startDate} are ignored (Report starts from). ` : ''}Gross profit = (selling price − cost) × qty. Cost comes from the master item's Purchase Price at the time of invoicing. Lines with price 0 are shop transfers, not sales. Expenses are not included.</p>
    </div>
  );
}
