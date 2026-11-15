import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, RefreshCw, Copy, Printer } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchAllPages } from '../lib/fetchAll';
import { expenseBoth } from './NigeriaExpenses';
import { landedCosts } from '../lib/ngLanded';
import { ngPrint } from '../lib/ngPrint';

/* NIGERIA — Profit NG: the plain answer. TOTAL PROFIT at the top, then every sale with its own profit, then what each
   partner can pull out. Profit of a sale = sale ₦ − quantity × landed cost × rate (same rule as Sales NG / Overview). */

interface NgItem { id: string; name: string; specification: string | null; finish: string | null; unit: string; cost_rmb: number; is_active: boolean }
interface NgMove { id: string; item_id: string; kind: 'in' | 'out' | 'adjust'; entry_date: string; quantity: number; cost_rmb: number | null; sale_naira: number | null; rate: number | null; reference: string | null; note: string | null }
interface NgExpense { entry_date: string; category: string; amount: number; currency: string; rate: number | null; reference: string | null; item_id?: string | null }

const n0 = (v: number) => (isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—');
const n2 = (v: number) => (isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—');
const showDate = (d: string) => { const [y, m, day] = d.slice(0, 10).split('-'); return `${day}/${m}/${y}`; };
const monthName = (ym: string) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const label = (i: NgItem) => [i.name, i.specification, i.finish].filter(Boolean).join(' ');

export default function NigeriaProfit() {
  const [items, setItems] = useState<NgItem[]>([]);
  const [moves, setMoves] = useState<NgMove[]>([]);
  const [expenses, setExpenses] = useState<NgExpense[]>([]);
  const [rate, setRate] = useState(0);
  const [share, setShare] = useState(0);
  const [shareBox, setShareBox] = useState('');
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState('all');

  async function load() {
    setLoading(true);
    const [it, mv, ex, se, sp] = await Promise.all([
      fetchAllPages<NgItem>(() => supabase.from('ng_items').select('id, name, specification, finish, unit, cost_rmb, is_active').order('name')),
      fetchAllPages<NgMove>(() => supabase.from('ng_stock').select('id, item_id, kind, entry_date, quantity, cost_rmb, sale_naira, rate, reference, note').order('entry_date', { ascending: false }).order('created_at', { ascending: false })),
      fetchAllPages<NgExpense>(() => supabase.from('ng_expenses').select('entry_date, category, amount, currency, rate, reference, item_id')),
      supabase.from('ng_settings').select('value').eq('key', 'rate').maybeSingle(),
      supabase.from('ng_settings').select('value').eq('key', 'partner').maybeSingle(),
    ]);
    setItems((it.data || []).map((r) => ({ ...r, cost_rmb: Number(r.cost_rmb) || 0 })));
    setMoves((mv.data || []).map((m) => ({ ...m, quantity: Number(m.quantity) || 0, cost_rmb: m.cost_rmb == null ? null : Number(m.cost_rmb), sale_naira: m.sale_naira == null ? null : Number(m.sale_naira), rate: m.rate == null ? null : Number(m.rate) })));
    setExpenses((ex.data || []).map((e) => ({ ...e, amount: Number(e.amount) || 0, rate: e.rate == null ? null : Number(e.rate) })));
    setRate(Number((se.data?.value as { naira_per_rmb?: number } | undefined)?.naira_per_rmb) || 0);
    const sh = Number((sp.data?.value as { share_pct?: number } | undefined)?.share_pct) || 0; setShare(sh); setShareBox(sh ? String(sh) : '');
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const D = useMemo(() => {
    const L = landedCosts(items, moves, expenses, rate);
    const itemOf = (id: string) => items.find((i) => i.id === id);
    const all = moves.filter((m) => m.kind === 'out').map((s) => { const r = s.rate || rate; const lc = L[s.item_id]?.cost ?? itemOf(s.item_id)?.cost_rmb ?? 0; const cost = r ? s.quantity * lc * r : NaN; const sale = s.sale_naira || 0; return { s, it: itemOf(s.item_id), sale, cost, profit: isFinite(cost) ? sale - cost : NaN, pct: isFinite(cost) && sale ? ((sale - cost) / sale) * 100 : NaN }; });
    const months = Array.from(new Set(all.map((x) => x.s.entry_date.slice(0, 7)))).sort().reverse();
    const shown = month === 'all' ? all : all.filter((x) => x.s.entry_date.startsWith(month));
    const sum = (xs: typeof all) => xs.reduce((t, x) => ({ sale: t.sale + x.sale, cost: t.cost + (isFinite(x.cost) ? x.cost : 0), profit: t.profit + (isFinite(x.profit) ? x.profit : 0), qty: t.qty + x.s.quantity }), { sale: 0, cost: 0, profit: 0, qty: 0 });
    const tot = sum(all), shownTot = sum(shown);
    const sumCat = (c: string) => expenses.filter((e) => e.category === c).reduce((t, e) => { const b = expenseBoth(e, rate); return t + (isFinite(b.ngn) ? b.ngn : 0); }, 0);
    const general = expenses.filter((e) => !e.reference && e.category !== 'Partner payout' && e.category !== 'Owner withdrawal').reduce((t, e) => { const b = expenseBoth(e, rate); return t + (isFinite(b.ngn) ? b.ngn : 0); }, 0);
    const partnerOut = sumCat('Partner payout'), ownerOut = sumCat('Owner withdrawal');
    const distributable = tot.profit - general; const partnerShare = distributable * (share / 100), ownerShare = distributable - partnerShare;
    const byItem: Record<string, { it: NgItem | undefined; qty: number; sale: number; profit: number }> = {};
    all.forEach((x) => { const r = (byItem[x.s.item_id] ||= { it: x.it, qty: 0, sale: 0, profit: 0 }); r.qty += x.s.quantity; r.sale += x.sale; r.profit += isFinite(x.profit) ? x.profit : 0; });
    return { all, shown, months, tot, shownTot, general, partnerOut, ownerOut, distributable, partnerShare, ownerShare, byItem: Object.values(byItem).sort((a, b) => b.profit - a.profit) };
  }, [items, moves, expenses, rate, share, month]);

  async function saveShare() {
    const v = parseFloat(shareBox); if (!isFinite(v) || v < 0 || v > 100) { alert("Type the partner's share of the profit as a percentage, e.g. 50."); return; }
    const { error } = await supabase.from('ng_settings').upsert({ key: 'partner', value: { share_pct: v }, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) { alert('Could not save: ' + error.message); return; }
    setShare(v); alert(`Saved: partner ${v}%, owner ${100 - v}%.`);
  }
  const text = () => [
    `*NG PROFIT — ${month === 'all' ? 'ALL TIME' : monthName(month).toUpperCase()}*`,
    `Total profit: ₦${n0(D.shownTot.profit)}${rate ? ` = ${n0(D.shownTot.profit / rate)} RMB` : ''} on ₦${n0(D.shownTot.sale)} sold (${D.shown.length} sales)`,
    '',
    '*Each sale*',
    ...D.shown.map((x) => `${showDate(x.s.entry_date)} ${x.it ? label(x.it) : ''} ${n0(x.s.quantity)} pcs: sold ₦${n0(x.sale)}, profit ₦${n0(x.profit)}`),
    '',
    '*Pull out*',
    `Profit made so far after running costs: ₦${n0(D.distributable)}`,
    share ? `Partner ${share}%: ₦${n0(D.partnerShare)} − pulled out ₦${n0(D.partnerOut)} = ₦${n0(D.partnerShare - D.partnerOut)}` : 'share % not set',
    share ? `Owner ${100 - share}%: ₦${n0(D.ownerShare)} − pulled out ₦${n0(D.ownerOut)} = ₦${n0(D.ownerShare - D.ownerOut)}` : '',
  ].join('\n');
  async function copy() { const t = text(); try { await navigator.clipboard.writeText(t); alert('Copied — paste it into WhatsApp.'); } catch { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); alert('Copied — paste it into WhatsApp.'); } }
  function print() {
    ngPrint(`Profit NG — ${month === 'all' ? 'all time' : monthName(month)}`, `Total profit ₦${n0(D.shownTot.profit)} on ₦${n0(D.shownTot.sale)} sold · ${D.shown.length} sales · rate ₦${rate || '—'} / RMB`, [
      { title: 'Each sale', head: ['Date', 'Item', 'Customer', 'Qty', 'Sold ₦', 'Cost ₦', 'Profit ₦', '%'], right: [3, 4, 5, 6, 7], rows: D.shown.map((x) => [showDate(x.s.entry_date), x.it ? label(x.it) : '', x.s.reference || '', n0(x.s.quantity), n0(x.sale), n0(x.cost), n0(x.profit), isFinite(x.pct) ? `${x.pct.toFixed(0)}%` : '']), total: ['Total', '', '', n0(D.shownTot.qty), n0(D.shownTot.sale), n0(D.shownTot.cost), n0(D.shownTot.profit), D.shownTot.sale ? `${((D.shownTot.profit / D.shownTot.sale) * 100).toFixed(0)}%` : ''] },
      { title: 'By item (all time)', head: ['Item', 'Pcs sold', 'Sold ₦', 'Profit ₦'], right: [1, 2, 3], rows: D.byItem.map((r) => [r.it ? label(r.it) : '', n0(r.qty), n0(r.sale), n0(r.profit)]) },
      { title: 'Pull out', head: ['', 'Share ₦', 'Pulled out ₦', 'Can pull out ₦'], right: [1, 2, 3], rows: [[`Partner (${share}%)`, n0(D.partnerShare), n0(D.partnerOut), n0(D.partnerShare - D.partnerOut)], [`Owner (${100 - share}%)`, n0(D.ownerShare), n0(D.ownerOut), n0(D.ownerShare - D.ownerOut)]], total: ['Profit made so far after running costs', n0(D.distributable), n0(D.partnerOut + D.ownerOut), n0(D.distributable - D.partnerOut - D.ownerOut)] },
    ]);
  }

  if (loading) return <div className="p-8 text-center text-gray-500">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><TrendingUp className="w-6 h-6 text-[#e8552a]" /> Nigeria — Profit NG</h1>
          <p className="text-sm text-gray-500">Total profit, the profit of every sale, and what each partner can pull out.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={month} onChange={(e) => setMonth(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"><option value="all">All time</option>{D.months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select>
          <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50"><RefreshCw className="w-4 h-4" /> Refresh</button>
          <button onClick={print} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50"><Printer className="w-4 h-4" /> Print / PDF</button>
          <button onClick={copy} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-[#111] rounded-lg hover:opacity-90"><Copy className="w-4 h-4" /> Copy summary</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="text-xs text-gray-500 uppercase tracking-wide">Total profit — {month === 'all' ? 'all time' : monthName(month)}</div>
        <div className={`text-4xl font-bold font-mono mt-1 ${D.shownTot.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>₦{n0(D.shownTot.profit)}</div>
        <div className="text-sm text-gray-500 mt-1">{rate ? `${n0(D.shownTot.profit / rate)} RMB · ` : ''}on ₦{n0(D.shownTot.sale)} sold in {D.shown.length} sales · {D.shownTot.sale ? `${((D.shownTot.profit / D.shownTot.sale) * 100).toFixed(0)}% of sales` : ''}</div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <div className="px-4 py-2 border-b border-gray-200 text-xs font-semibold text-gray-800 uppercase tracking-wide">Each sale</div>
        <table className="w-full text-sm min-w-[760px]">
          <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase"><th className="text-left px-4 py-2">Date</th><th className="text-left px-4 py-2">Item</th><th className="text-left px-4 py-2">Customer</th><th className="text-right px-4 py-2">Qty</th><th className="text-right px-4 py-2">Sold ₦</th><th className="text-right px-4 py-2">Cost ₦</th><th className="text-right px-4 py-2">Profit ₦</th><th className="text-right px-4 py-2">%</th></tr></thead>
          <tbody>
            {D.shown.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No sales yet.</td></tr>}
            {D.shown.map((x) => <tr key={x.s.id} className="border-t border-gray-100"><td className="px-4 py-2 whitespace-nowrap">{showDate(x.s.entry_date)}</td><td className="px-4 py-2">{x.it ? label(x.it) : ''}{x.s.note ? <span className="block text-xs text-gray-400">{x.s.note}</span> : null}</td><td className="px-4 py-2">{x.s.reference || ''}</td><td className="px-4 py-2 text-right font-mono">{n2(x.s.quantity)}</td><td className="px-4 py-2 text-right font-mono">{n0(x.sale)}</td><td className="px-4 py-2 text-right font-mono">{n0(x.cost)}</td><td className={`px-4 py-2 text-right font-mono font-semibold ${x.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{n0(x.profit)}</td><td className="px-4 py-2 text-right font-mono text-gray-500">{isFinite(x.pct) ? `${x.pct.toFixed(0)}%` : ''}</td></tr>)}
            {D.shown.length > 0 && <tr className="border-t-2 border-gray-900 font-semibold"><td className="px-4 py-2" colSpan={3}>Total</td><td className="px-4 py-2 text-right font-mono">{n2(D.shownTot.qty)}</td><td className="px-4 py-2 text-right font-mono">{n0(D.shownTot.sale)}</td><td className="px-4 py-2 text-right font-mono">{n0(D.shownTot.cost)}</td><td className={`px-4 py-2 text-right font-mono ${D.shownTot.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{n0(D.shownTot.profit)}</td><td className="px-4 py-2 text-right font-mono text-gray-500">{D.shownTot.sale ? `${((D.shownTot.profit / D.shownTot.sale) * 100).toFixed(0)}%` : ''}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <div className="px-4 py-2 border-b border-gray-200 text-xs font-semibold text-gray-800 uppercase tracking-wide">By item — all time</div>
        <table className="w-full text-sm min-w-[520px]">
          <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase"><th className="text-left px-4 py-2">Item</th><th className="text-right px-4 py-2">Pcs sold</th><th className="text-right px-4 py-2">Sold ₦</th><th className="text-right px-4 py-2">Profit ₦</th></tr></thead>
          <tbody>{D.byItem.map((r, k) => <tr key={k} className="border-t border-gray-100"><td className="px-4 py-2">{r.it ? label(r.it) : ''}</td><td className="px-4 py-2 text-right font-mono">{n0(r.qty)}</td><td className="px-4 py-2 text-right font-mono">{n0(r.sale)}</td><td className={`px-4 py-2 text-right font-mono font-semibold ${r.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{n0(r.profit)}</td></tr>)}</tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wide mb-2">Pull out — what each partner can take</h3>
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div><label className="text-xs text-gray-500">Partner's share (%) — owner gets the rest</label><input type="number" inputMode="decimal" className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm" value={shareBox} onChange={(e) => setShareBox(e.target.value)} placeholder="50" /></div>
          <button onClick={saveShare} className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50">Save share</button>
          <p className="text-xs text-gray-500">Pull-outs are entered in Expenses NG (General): "Partner payout" for the partner, "Owner withdrawal" for you.</p>
        </div>
        <div className="text-sm space-y-1 max-w-lg mb-3">
          <div className="flex justify-between"><span className="text-gray-600">Total profit on sales, all time</span><span className="font-mono">₦{n0(D.tot.profit)}</span></div>
          <div className="flex justify-between"><span className="text-gray-600">− running costs (rent, salary, bank…)</span><span className="font-mono">₦{n0(D.general)}</span></div>
          <div className="flex justify-between border-t border-gray-200 pt-1 font-semibold"><span>= profit to share</span><span className={`font-mono ${D.distributable >= 0 ? 'text-green-700' : 'text-red-600'}`}>₦{n0(D.distributable)}</span></div>
        </div>
        <table className="w-full text-sm max-w-2xl">
          <thead><tr className="text-xs text-gray-500 uppercase"><th className="text-left py-1"></th><th className="text-right py-1">Share</th><th className="text-right py-1">Pulled out</th><th className="text-right py-1">Can pull out now</th></tr></thead>
          <tbody>
            <tr className="border-t border-gray-100"><td className="py-1.5">Partner ({share}%)</td><td className="py-1.5 text-right font-mono">₦{n0(D.partnerShare)}</td><td className="py-1.5 text-right font-mono">₦{n0(D.partnerOut)}</td><td className={`py-1.5 text-right font-mono font-semibold ${D.partnerShare - D.partnerOut >= 0 ? 'text-green-700' : 'text-red-600'}`}>₦{n0(D.partnerShare - D.partnerOut)}</td></tr>
            <tr className="border-t border-gray-100"><td className="py-1.5">Owner ({100 - share}%)</td><td className="py-1.5 text-right font-mono">₦{n0(D.ownerShare)}</td><td className="py-1.5 text-right font-mono">₦{n0(D.ownerOut)}</td><td className={`py-1.5 text-right font-mono font-semibold ${D.ownerShare - D.ownerOut >= 0 ? 'text-green-700' : 'text-red-600'}`}>₦{n0(D.ownerShare - D.ownerOut)}</td></tr>
          </tbody>
        </table>
        <p className="text-xs text-gray-500 mt-2">Pull out only money that customers have really paid and after the Chinese supplier is paid. Profit on goods still in stock is not counted here — it comes when they are sold.</p>
      </div>
    </div>
  );
}
