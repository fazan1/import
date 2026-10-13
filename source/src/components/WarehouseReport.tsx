import { useEffect, useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { selectByIds } from '../lib/fetchAll';
import { esc } from '../lib/html';

interface Prod { id: string; name: string; unit: string; master_item_id: string | null; avg_cost: number; sell_price: number; is_active: boolean; }
interface Note { id: string; kind: 'in' | 'issue' | 'transfer' | 'adjust'; note_date: string; sales_invoice_id: string | null; }
interface LineRow { note_id: string; product_id: string; qty: number; unit_cost: number | null; }
interface Inv { id: string; invoice_date: string; customer_name: string; status: string; }
interface InvLine { invoice_id: string; item_id: string | null; item_name: string; quantity: number; unit_price: number; cost_price: number; }
type View = 'profit' | 'value' | 'movement' | 'items';

const n0 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = (n: number) => (isFinite(n) ? `${n.toFixed(1)}%` : '—');
const ym = (d: string) => d.slice(0, 7);
const ml = (m: string) => new Date(m + '-01').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
const card = 'bg-white border border-gray-200 rounded-lg p-4';

export default function WarehouseReport({ startDate = '' }: { startDate?: string }) {
  const [prods, setProds] = useState<Prod[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [invoices, setInvoices] = useState<Inv[]>([]);
  const [invLines, setInvLines] = useState<InvLine[]>([]);
  const [view, setView] = useState<View>('profit');
  const [from, setFrom] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 5); const six = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; return startDate && startDate > six ? startDate : six; });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => {
    const [p, n, l, i] = await Promise.all([
      supabase.from('wh_products').select('id, name, unit, master_item_id, avg_cost, sell_price, is_active'),
      supabase.from('wh_notes').select('id, kind, note_date, sales_invoice_id'),
      supabase.from('wh_note_lines').select('note_id, product_id, qty, unit_cost'),
      supabase.from('busy_sales_invoices').select('id, invoice_date, customer_name, status'),
    ]);
    // only the lines of this book's invoices (reading every line of every book also stops at 1000 rows)
    const il = await selectByIds<Record<string, unknown>>('busy_sales_invoice_items', 'sales_invoice_id, item_id, item_name, quantity, unit_price, cost_price', 'sales_invoice_id', ((i.data ?? []) as { id: string }[]).map((x) => x.id));
    setProds(((p.data ?? []) as Prod[]).map((x) => ({ ...x, avg_cost: Number(x.avg_cost) || 0, sell_price: Number(x.sell_price) || 0 })));
    setNotes((n.data ?? []) as Note[]);
    setLines(((l.data ?? []) as LineRow[]).map((x) => ({ ...x, qty: Number(x.qty), unit_cost: x.unit_cost == null ? null : Number(x.unit_cost) })));
    setInvoices(((i.data ?? []) as Inv[]).filter((x) => x.status !== 'cancelled'));
    setInvLines(((il.data ?? []) as unknown as { sales_invoice_id: string; item_id: string | null; item_name: string; quantity: number; unit_price: number; cost_price: number }[]).map((x) => ({ invoice_id: x.sales_invoice_id, item_id: x.item_id, item_name: x.item_name, quantity: Number(x.quantity) || 0, unit_price: Number(x.unit_price) || 0, cost_price: Number(x.cost_price) || 0 })));
    setLoading(false);
  })(); }, []);

  // ---- helpers ----
  const noteById = useMemo(() => Object.fromEntries(notes.map((n) => [n.id, n])), [notes]);
  const prodById = useMemo(() => Object.fromEntries(prods.map((p) => [p.id, p])), [prods]);
  const prodByMaster = useMemo(() => Object.fromEntries(prods.filter((p) => p.master_item_id).map((p) => [p.master_item_id as string, p])), [prods]);
  const prodByName = useMemo(() => Object.fromEntries(prods.map((p) => [p.name.trim().toLowerCase(), p])), [prods]);
  const whProdFor = (l: InvLine) => (l.item_id && prodByMaster[l.item_id]) || prodByName[l.item_name.trim().toLowerCase()] || null;
  const inRange = (d: string) => d >= from && d <= to && (!startDate || d >= startDate);
  // signed qty per line for a location-agnostic view (in +, issue −, transfer 0 net, adjust ±)
  const signed = (l: LineRow) => { const n = noteById[l.note_id]; if (!n) return 0; return n.kind === 'in' ? l.qty : n.kind === 'issue' ? -l.qty : n.kind === 'adjust' ? l.qty : 0; };

  // 1. profit from warehouse sales
  const invById = useMemo(() => Object.fromEntries(invoices.map((i) => [i.id, i])), [invoices]);
  const sales = useMemo(() => invLines.map((l) => { const inv = invById[l.invoice_id]; const wp = whProdFor(l); if (!inv || !wp || !inRange(inv.invoice_date) || l.unit_price <= 0) return null; const rev = l.quantity * l.unit_price; const cost = l.quantity * (l.cost_price || wp.avg_cost); return { ...l, inv, wp, rev, cost, profit: rev - cost }; }).filter(Boolean) as (InvLine & { inv: Inv; wp: Prod; rev: number; cost: number; profit: number })[], [invLines, invById, prods, from, to, startDate]); // eslint-disable-line react-hooks/exhaustive-deps
  const byMonth = useMemo(() => { const m = new Map<string, { rev: number; cost: number; qty: number }>(); sales.forEach((s) => { const k = ym(s.inv.invoice_date); const g = m.get(k) ?? { rev: 0, cost: 0, qty: 0 }; g.rev += s.rev; g.cost += s.cost; g.qty += s.quantity; m.set(k, g); }); return Array.from(m.entries()).map(([k, g]) => ({ key: k, ...g, profit: g.rev - g.cost, margin: g.rev > 0 ? ((g.rev - g.cost) / g.rev) * 100 : NaN })).sort((a, b) => a.key.localeCompare(b.key)); }, [sales]);
  const tot = { rev: sales.reduce((t, s) => t + s.rev, 0), cost: sales.reduce((t, s) => t + s.cost, 0) };
  const maxProfit = Math.max(1, ...byMonth.map((m) => Math.abs(m.profit)));

  // 2. stock value at month ends (all time up to each month)
  const months = useMemo(() => { const set = new Set<string>(); notes.forEach((n) => { if (inRange(n.note_date)) set.add(ym(n.note_date)); }); byMonth.forEach((m) => set.add(m.key)); if (set.size === 0) set.add(ym(to)); return Array.from(set).sort(); }, [notes, byMonth, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const valueAt = (monthKey: string) => { const end = monthKey + '-31'; const q: Record<string, number> = {}; lines.forEach((l) => { const n = noteById[l.note_id]; if (!n || n.note_date > end) return; q[l.product_id] = (q[l.product_id] ?? 0) + signed(l); }); return Object.entries(q).reduce((t, [pid, qty]) => t + Math.max(0, qty) * (prodById[pid]?.avg_cost ?? 0), 0); };
  const valueSeries = months.map((m) => ({ key: m, value: valueAt(m) }));
  const maxValue = Math.max(1, ...valueSeries.map((v) => v.value));

  // 3. movement per item in range
  const movement = useMemo(() => prods.filter((p) => p.is_active).map((p) => { let open = 0, inn = 0, out = 0, adj = 0; lines.filter((l) => l.product_id === p.id).forEach((l) => { const n = noteById[l.note_id]; if (!n) return; const s = signed(l); if (n.note_date < from) open += s; else if (n.note_date <= to) { if (n.kind === 'in') inn += l.qty; else if (n.kind === 'issue') out += l.qty; else if (n.kind === 'adjust') adj += l.qty; } }); return { p, open, inn, out, adj, close: open + inn - out + adj }; }).sort((a, b) => b.out - a.out), [prods, lines, noteById, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  // 4. item profitability + days of stock
  const days = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1);
  const itemProfit = useMemo(() => { const m = new Map<string, { p: Prod; qty: number; rev: number; cost: number }>(); sales.forEach((s) => { const g = m.get(s.wp.id) ?? { p: s.wp, qty: 0, rev: 0, cost: 0 }; g.qty += s.quantity; g.rev += s.rev; g.cost += s.cost; m.set(s.wp.id, g); }); return Array.from(m.values()).map((g) => { const onHand = movement.find((x) => x.p.id === g.p.id)?.close ?? 0; const perDay = g.qty / days; return { ...g, profit: g.rev - g.cost, margin: g.rev > 0 ? ((g.rev - g.cost) / g.rev) * 100 : NaN, onHand, daysLeft: perDay > 0 ? onHand / perDay : Infinity }; }).sort((a, b) => b.profit - a.profit); }, [sales, movement, days]);

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    const sh = (n: string, d: Record<string, unknown>[]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d), n);
    sh('Profit by month', byMonth.map((m) => ({ Month: m.key, Qty: m.qty, Revenue: m.rev, Cost: m.cost, Profit: m.profit, 'Margin %': isFinite(m.margin) ? +m.margin.toFixed(1) : '' })));
    sh('Stock value', valueSeries.map((v) => ({ Month: v.key, 'Stock value': Math.round(v.value) })));
    sh('Movement', movement.map((r) => ({ Item: r.p.name, Unit: r.p.unit, Opening: r.open, In: r.inn, Out: r.out, Adjust: r.adj, Closing: r.close, 'Avg cost': r.p.avg_cost, Value: Math.round(Math.max(0, r.close) * r.p.avg_cost) })));
    sh('Item profit', itemProfit.map((r) => ({ Item: r.p.name, 'Qty sold': r.qty, Revenue: r.rev, Cost: r.cost, Profit: r.profit, 'Margin %': isFinite(r.margin) ? +r.margin.toFixed(1) : '', 'On hand': r.onHand, 'Days of stock': isFinite(r.daysLeft) ? Math.round(r.daysLeft) : '' })));
    XLSX.writeFile(wb, `warehouse-${from}-to-${to}.xlsx`);
  }
  function print() {
    const w = window.open('', '_blank'); if (!w) { alert('Allow pop-ups to print'); return; }
    const row = (c: (string | number)[]) => `<tr>${c.map((x, i) => `<td class="${i ? 'r' : ''}">${esc(x)}</td>`).join('')}</tr>`;
    const tbl = (t: string, h: string[], b: string) => `<h3>${t}</h3><table><thead><tr>${h.map((x, i) => `<th class="${i ? 'r' : ''}">${x}</th>`).join('')}</tr></thead><tbody>${b}</tbody></table>`;
    w.document.write(`<html><head><title>Warehouse report</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px;color:#111}h1{font-size:18px;margin:0}h2{font-size:13px;color:#555;margin:2px 0 12px;font-weight:normal}h3{font-size:13px;margin:14px 0 4px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:5px 6px;text-align:left}th{background:#f3f4f6;font-size:11px}.r{text-align:right}</style></head><body>
      <h1>Warehouse report</h1><h2>${esc(from)} to ${esc(to)} · printed ${new Date().toLocaleDateString('en-GB')}</h2>
      ${tbl('Profit from warehouse sales', ['Month', 'Qty', 'Revenue', 'Cost', 'Profit', 'Margin'], byMonth.map((m) => row([ml(m.key), n0(m.qty), n0(m.rev), n0(m.cost), n0(m.profit), pct(m.margin)])).join(''))}
      ${tbl('Stock value at month end', ['Month', 'Value Rs'], valueSeries.map((v) => row([ml(v.key), n0(v.value)])).join(''))}
      ${tbl('Movement', ['Item', 'Opening', 'In', 'Out', 'Adjust', 'Closing', 'Value Rs'], movement.map((r) => row([r.p.name, n0(r.open), n0(r.inn), n0(r.out), n0(r.adj), n0(r.close), n0(Math.max(0, r.close) * r.p.avg_cost)])).join(''))}
      ${tbl('Item profitability', ['Item', 'Qty sold', 'Revenue', 'Cost', 'Profit', 'Margin', 'On hand', 'Days left'], itemProfit.map((r) => row([r.p.name, n0(r.qty), n0(r.rev), n0(r.cost), n0(r.profit), pct(r.margin), n0(r.onHand), isFinite(r.daysLeft) ? Math.round(r.daysLeft) : '—'])).join(''))}
      <script>window.print()</script></body></html>`);
    w.document.close();
  }

  if (loading) return <div className="p-6 text-gray-500">Loading…</div>;
  const chip = (a: boolean) => `px-3 py-1.5 rounded-lg text-sm border ${a ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`;
  const Tbl = ({ head, children }: { head: string[]; children: React.ReactNode }) => <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg"><table className="w-full text-sm"><thead className="bg-gray-50 text-xs text-gray-500 uppercase"><tr>{head.map((h, i) => <th key={h} className={`px-3 py-2 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{children}</tbody></table></div>;
  const mcell = (m: number) => <td className={`px-3 py-2 text-right font-medium ${!isFinite(m) ? 'text-gray-400' : m < 10 ? 'text-red-600' : m < 20 ? 'text-amber-600' : 'text-green-700'}`}>{pct(m)}</td>;
  const latestValue = valueSeries.length ? valueSeries[valueSeries.length - 1].value : 0;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <div><label className="text-xs text-gray-500">From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label className="text-xs text-gray-500">To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div className="flex gap-1 ml-auto">
          <button onClick={print} className="flex items-center gap-1 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"><Printer className="w-4 h-4" />Print / PDF</button>
          <button onClick={exportExcel} className="flex items-center gap-1 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"><Download className="w-4 h-4" />Excel</button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className={card}><p className="text-xs text-gray-500">Warehouse sales</p><p className="text-xl font-bold">Rs {n0(tot.rev)}</p></div>
        <div className={card}><p className="text-xs text-gray-500">Cost of goods</p><p className="text-xl font-bold">Rs {n0(tot.cost)}</p></div>
        <div className={`${card} ${tot.rev - tot.cost >= 0 ? 'border-green-200' : 'border-red-200'}`}><p className="text-xs text-gray-500">Profit</p><p className={`text-xl font-bold ${tot.rev - tot.cost >= 0 ? 'text-green-700' : 'text-red-700'}`}>Rs {n0(tot.rev - tot.cost)}</p><p className="text-[11px] text-gray-500">margin {pct(tot.rev > 0 ? ((tot.rev - tot.cost) / tot.rev) * 100 : NaN)}</p></div>
        <div className={card}><p className="text-xs text-gray-500">Stock value now</p><p className="text-xl font-bold">Rs {n0(latestValue)}</p><p className="text-[11px] text-gray-500">qty × average cost</p></div>
      </div>
      <div className="flex gap-2 mb-3 flex-wrap">
        <button onClick={() => setView('profit')} className={chip(view === 'profit')}>Profit by month</button>
        <button onClick={() => setView('value')} className={chip(view === 'value')}>Stock value</button>
        <button onClick={() => setView('movement')} className={chip(view === 'movement')}>Movement</button>
        <button onClick={() => setView('items')} className={chip(view === 'items')}>Item profitability</button>
      </div>

      {view === 'profit' && (<>
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-3">
          <div className="flex items-end gap-2 h-32">{byMonth.map((m) => <div key={m.key} className="flex-1 flex flex-col items-center justify-end h-full"><div className="text-[10px] text-gray-600 mb-1">{n0(m.profit)}</div><div className={`w-full ${m.profit >= 0 ? 'bg-teal-600' : 'bg-red-500'}`} style={{ height: `${Math.max(2, (Math.abs(m.profit) / maxProfit) * 100)}%` }} /><div className="text-[10px] text-gray-500 mt-1">{ml(m.key)}</div></div>)}{byMonth.length === 0 && <p className="text-sm text-gray-500">No warehouse sales in this period.</p>}</div>
        </div>
        <Tbl head={['Month', 'Qty sold', 'Revenue', 'Cost', 'Profit', 'Margin']}>{byMonth.map((m) => <tr key={m.key}><td className="px-3 py-2 font-medium">{ml(m.key)}</td><td className="px-3 py-2 text-right">{n0(m.qty)}</td><td className="px-3 py-2 text-right">{n0(m.rev)}</td><td className="px-3 py-2 text-right">{n0(m.cost)}</td><td className={`px-3 py-2 text-right font-semibold ${m.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>{n0(m.profit)}</td>{mcell(m.margin)}</tr>)}</Tbl>
      </>)}
      {view === 'value' && (<>
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-3"><div className="flex items-end gap-2 h-32">{valueSeries.map((v) => <div key={v.key} className="flex-1 flex flex-col items-center justify-end h-full"><div className="text-[10px] text-gray-600 mb-1">{n0(v.value)}</div><div className="w-full bg-gray-800" style={{ height: `${Math.max(2, (v.value / maxValue) * 100)}%` }} /><div className="text-[10px] text-gray-500 mt-1">{ml(v.key)}</div></div>)}</div></div>
        <p className="text-xs text-gray-500">Value of goods on the shelf at the end of each month, at today's average cost. Rising while sales are flat = cash tied up in stock.</p>
      </>)}
      {view === 'movement' && <Tbl head={['Item', 'Opening', 'In', 'Out', 'Adjust', 'Closing', 'Avg cost', 'Value']}>{movement.map((r) => <tr key={r.p.id} className={r.out === 0 && r.close > 0 ? 'bg-amber-50/50' : ''}><td className="px-3 py-2 font-medium">{r.p.name}<span className="text-xs text-gray-400 ml-1">{r.p.unit}</span>{r.out === 0 && r.close > 0 && <span className="ml-2 text-[10px] bg-amber-200 text-amber-900 px-1.5 rounded">no movement</span>}</td><td className="px-3 py-2 text-right text-gray-500">{n0(r.open)}</td><td className="px-3 py-2 text-right text-green-700">{r.inn ? n0(r.inn) : ''}</td><td className="px-3 py-2 text-right text-red-700">{r.out ? n0(r.out) : ''}</td><td className="px-3 py-2 text-right text-gray-500">{r.adj ? n0(r.adj) : ''}</td><td className="px-3 py-2 text-right font-semibold">{n0(r.close)}</td><td className="px-3 py-2 text-right text-gray-500">{r.p.avg_cost ? n0(r.p.avg_cost) : '—'}</td><td className="px-3 py-2 text-right">{n0(Math.max(0, r.close) * r.p.avg_cost)}</td></tr>)}</Tbl>}
      {view === 'items' && <Tbl head={['Item', 'Qty sold', 'Revenue', 'Cost', 'Profit', 'Margin', 'On hand', 'Days of stock']}>{itemProfit.map((r) => <tr key={r.p.id}><td className="px-3 py-2 font-medium">{r.p.name}</td><td className="px-3 py-2 text-right">{n0(r.qty)}</td><td className="px-3 py-2 text-right">{n0(r.rev)}</td><td className="px-3 py-2 text-right">{n0(r.cost)}</td><td className={`px-3 py-2 text-right font-semibold ${r.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>{n0(r.profit)}</td>{mcell(r.margin)}<td className="px-3 py-2 text-right">{n0(r.onHand)}</td><td className={`px-3 py-2 text-right ${isFinite(r.daysLeft) && r.daysLeft < 14 ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>{isFinite(r.daysLeft) ? Math.round(r.daysLeft) : '—'}</td></tr>)}{itemProfit.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-500">No warehouse items sold in this period.</td></tr>}</Tbl>}
      <p className="text-xs text-gray-400 mt-2">Only invoice lines for items that exist in the Warehouse are counted here. Cost = the cost saved on the invoice line (warehouse average at the time). Days of stock = on hand ÷ average daily sales in this period.</p>
    </div>
  );
}
