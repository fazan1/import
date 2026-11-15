import { useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingCart, Plus, X, RefreshCw, Trash2, Copy, Printer } from 'lucide-react';
import { ngPrint } from '../lib/ngPrint';
import { supabase } from '../lib/supabase';
import { fetchAllPages } from '../lib/fetchAll';
import { moveToRecycleBin } from '../lib/recycleBin';
import { expenseBoth } from './NigeriaExpenses';

/* NIGERIA — step 4: Sales NG. The partner sells; each sale is an ng_stock OUT row (quantity, sale_naira, rate, reference =
   customer, note). Profit = sale ₦ − quantity × landed cost × rate, where landed cost = item China cost × (1 + shipment uplift)
   (uplift = expenses with a reference ÷ goods RMB of that reference; items are matched to the shipment of their last IN). */

interface NgItem { id: string; name: string; specification: string | null; finish: string | null; unit: string; cost_rmb: number; sell_naira: number | null; is_active: boolean }
interface NgMove { id: string; item_id: string; kind: 'in' | 'out' | 'adjust'; entry_date: string; quantity: number; cost_rmb: number | null; sale_naira: number | null; rate: number | null; reference: string | null; note: string | null; created_at: string }
interface NgExpense { amount: number; currency: string; rate: number | null; reference: string | null }

const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500';
const n2 = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const n0 = (v: number) => (isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const showDate = (d: string) => { const [y, m, day] = d.slice(0, 10).split('-'); return `${day}/${m}/${y}`; };
const monthName = (ym: string) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const label = (i: NgItem) => [i.name, i.specification, i.finish].filter(Boolean).join(' ');

export default function NigeriaSales() {
  const [items, setItems] = useState<NgItem[]>([]);
  const [moves, setMoves] = useState<NgMove[]>([]);
  const [expenses, setExpenses] = useState<NgExpense[]>([]);
  const [defRate, setDefRate] = useState(0);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [form, setForm] = useState<{ item_id: string; entry_date: string; qty: string; price: string; total: string; rate: string; customer: string; note: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  async function load() {
    setLoading(true);
    const [it, mv, ex, se] = await Promise.all([
      fetchAllPages<NgItem>(() => supabase.from('ng_items').select('id, name, specification, finish, unit, cost_rmb, sell_naira, is_active').order('name').order('finish').order('specification')),
      fetchAllPages<NgMove>(() => supabase.from('ng_stock').select('*').order('entry_date', { ascending: false }).order('created_at', { ascending: false })),
      fetchAllPages<NgExpense>(() => supabase.from('ng_expenses').select('amount, currency, rate, reference')),
      supabase.from('ng_settings').select('value').eq('key', 'rate').maybeSingle(),
    ]);
    if (it.error) alert('Could not load Items NG: ' + it.error);
    setItems((it.data || []).map((r) => ({ ...r, cost_rmb: Number(r.cost_rmb) || 0, sell_naira: r.sell_naira == null ? null : Number(r.sell_naira) })));
    setMoves((mv.data || []).map((m) => ({ ...m, quantity: Number(m.quantity) || 0, cost_rmb: m.cost_rmb == null ? null : Number(m.cost_rmb), sale_naira: m.sale_naira == null ? null : Number(m.sale_naira), rate: m.rate == null ? null : Number(m.rate) })));
    setExpenses((ex.data || []).map((e) => ({ ...e, amount: Number(e.amount) || 0, rate: e.rate == null ? null : Number(e.rate) })));
    setDefRate(Number((se.data?.value as { naira_per_rmb?: number } | undefined)?.naira_per_rmb) || 0);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  /* landed cost per item: China cost × (1 + uplift of the shipment of its last IN) */
  const landed = useMemo(() => {
    const goodsByRef: Record<string, number> = {}, exByRef: Record<string, number> = {};
    moves.filter((m) => m.kind === 'in' && m.reference).forEach((m) => { goodsByRef[m.reference!] = (goodsByRef[m.reference!] || 0) + (m.cost_rmb || 0); });
    expenses.filter((e) => e.reference).forEach((e) => { const b = expenseBoth(e, defRate); if (isFinite(b.rmb)) exByRef[e.reference!] = (exByRef[e.reference!] || 0) + b.rmb; });
    const out: Record<string, { cost: number; uplift: number; ref: string | null }> = {};
    items.forEach((i) => {
      const lastIn = moves.find((m) => m.item_id === i.id && m.kind === 'in'); // moves are newest first
      const ref = lastIn?.reference || null; const uplift = ref && goodsByRef[ref] > 0 ? (exByRef[ref] || 0) / goodsByRef[ref] : 0;
      out[i.id] = { cost: i.cost_rmb * (1 + uplift), uplift, ref };
    });
    return out;
  }, [items, moves, expenses, defRate]);
  const onHand = useMemo(() => { const m: Record<string, number> = {}; moves.forEach((x) => { m[x.item_id] = (m[x.item_id] || 0) + (x.kind === 'out' ? -x.quantity : x.quantity); }); return m; }, [moves]);
  const itemOf = (id: string) => items.find((i) => i.id === id);

  const sales = moves.filter((m) => m.kind === 'out');
  const months = useMemo(() => Array.from(new Set([...sales.map((s) => s.entry_date.slice(0, 7)), today().slice(0, 7)])).sort().reverse(), [sales]);
  const profitOf = (s: NgMove) => { const l = landed[s.item_id]; const r = s.rate || defRate || 0; const costNgn = l && r ? s.quantity * l.cost * r : NaN; return { costNgn, profitNgn: isFinite(costNgn) ? (s.sale_naira || 0) - costNgn : NaN, rate: r }; };
  const mSales = sales.filter((s) => s.entry_date.startsWith(month));
  const tot = (xs: NgMove[]) => xs.reduce((t, s) => { const p = profitOf(s); return { sale: t.sale + (s.sale_naira || 0), cost: t.cost + (isFinite(p.costNgn) ? p.costNgn : 0), profit: t.profit + (isFinite(p.profitNgn) ? p.profitNgn : 0), qty: t.qty + s.quantity }; }, { sale: 0, cost: 0, profit: 0, qty: 0 });
  const mTot = tot(mSales), allTot = tot(sales);
  const rateOfMonth = mSales.length ? mSales.reduce((t, s) => t + (s.rate || defRate || 0), 0) / mSales.length : defRate;

  function openNew() { const i = items.find((x) => x.is_active); setForm({ item_id: i?.id || '', entry_date: today(), qty: '', price: i?.sell_naira ? String(i.sell_naira) : '', total: '', rate: defRate ? String(defRate) : '', customer: '', note: '' }); }
  const fItem = form ? itemOf(form.item_id) : undefined;
  const fl = fItem ? landed[fItem.id] : undefined;
  const calc = (f: typeof form) => { if (!f) return f; const q = parseFloat(f.qty), p = parseFloat(f.price); return { ...f, total: isFinite(q) && isFinite(p) ? String(Math.round(q * p * 100) / 100) : f.total }; };
  const fQty = form ? parseFloat(form.qty) : NaN, fTotal = form ? parseFloat(form.total) : NaN, fRate = form ? parseFloat(form.rate) : NaN;
  const fCost = fl && isFinite(fQty) && isFinite(fRate) ? fQty * fl.cost * fRate : NaN;

  async function save() {
    if (!form || savingRef.current) return;
    const it = itemOf(form.item_id); if (!it) { alert('Pick the item.'); return; }
    const qty = parseFloat(form.qty); if (!isFinite(qty) || qty <= 0) { alert('Type the quantity sold.'); return; }
    const total = parseFloat(form.total); if (!isFinite(total) || total < 0) { alert('Type the selling price or the total.'); return; }
    const rate = parseFloat(form.rate); if (!isFinite(rate) || rate <= 0) { alert('Type the rate (Naira per 1 RMB), or save a default rate in Expenses NG.'); return; }
    if (qty > (onHand[it.id] || 0) + 0.0001 && !confirm(`Only ${n2(onHand[it.id] || 0)} ${it.unit} of ${label(it)} in stock — sell ${n2(qty)} anyway? Stock will go negative.`)) return;
    savingRef.current = true; setSaving(true);
    const { error } = await supabase.from('ng_stock').insert({ item_id: it.id, kind: 'out', entry_date: form.entry_date || today(), quantity: qty, sale_naira: total, rate, reference: form.customer.trim() || null, note: form.note.trim() || null });
    savingRef.current = false; setSaving(false);
    if (error) { alert('Could not save the sale: ' + error.message); return; }
    if (form.price && it.sell_naira !== parseFloat(form.price)) await supabase.from('ng_items').update({ sell_naira: parseFloat(form.price), updated_at: new Date().toISOString() }).eq('id', it.id);
    setForm(null); load();
  }
  async function remove(s: NgMove) {
    const it = itemOf(s.item_id);
    if (!confirm(`Delete the sale of ${n2(s.quantity)} ${it?.unit || ''} ${it ? label(it) : ''} for ₦${n2(s.sale_naira)} on ${showDate(s.entry_date)}? Stock goes back.`)) return;
    const res = await moveToRecycleBin({ source_table: 'ng_stock', source_id: s.id, record_data: s as unknown as Record<string, unknown>, display_name: `NG sale ${it ? label(it) : s.item_id} ${n2(s.quantity)} ₦${n2(s.sale_naira)} ${showDate(s.entry_date)}`, portal: 'sl' });
    if (!res.success) { alert('Could not move it to the Recycle Bin: ' + (res.error || '')); return; }
    const { error } = await supabase.from('ng_stock').delete().eq('id', s.id);
    if (error) alert('Could not delete: ' + error.message);
    load();
  }
  async function copySummary() {
    const L = [`*NG SALES — ${monthName(month).toUpperCase()}*`, `Sold: ₦${n0(mTot.sale)} (${mSales.length} sales, ${n0(mTot.qty)} pcs)`, `Cost (landed, at ₦${n2(rateOfMonth)}/RMB): ₦${n0(mTot.cost)}`, `Profit: ₦${n0(mTot.profit)} = ${n0(rateOfMonth ? mTot.profit / rateOfMonth : NaN)} RMB${mTot.sale ? ` (${((mTot.profit / mTot.sale) * 100).toFixed(0)}% of sales)` : ''}`, '', '*By item*'];
    const byItem: Record<string, { qty: number; sale: number; profit: number }> = {};
    mSales.forEach((s) => { const r = (byItem[s.item_id] ||= { qty: 0, sale: 0, profit: 0 }); r.qty += s.quantity; r.sale += s.sale_naira || 0; const p = profitOf(s); r.profit += isFinite(p.profitNgn) ? p.profitNgn : 0; });
    Object.entries(byItem).forEach(([id, r]) => { const it = itemOf(id); L.push(`${it ? label(it) : id}: ${n0(r.qty)} pcs, ₦${n0(r.sale)}, profit ₦${n0(r.profit)}`); });
    L.push('', '*Stock left*'); items.filter((i) => i.is_active && (onHand[i.id] || 0) !== 0).forEach((i) => L.push(`${label(i)}: ${n0(onHand[i.id] || 0)} ${i.unit}`));
    const t = L.join('\n');
    try { await navigator.clipboard.writeText(t); alert('Summary copied — paste it into WhatsApp.'); } catch { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); alert('Summary copied — paste it into WhatsApp.'); }
  }

  function printMonth() {
    ngPrint(`Sales NG — ${monthName(month)}`, `Sold ₦${n0(mTot.sale)} · cost of goods (landed) ₦${n0(mTot.cost)} · profit ₦${n0(mTot.profit)}${mTot.sale ? ` (${((mTot.profit / mTot.sale) * 100).toFixed(0)}% of sales)` : ''} · rate ₦${n2(rateOfMonth)} / RMB`, [{
      head: ['Date', 'Item', 'Customer', 'Qty', '₦ / pc', 'Sold ₦', 'Cost ₦', 'Profit ₦'], right: [3, 4, 5, 6, 7],
      rows: mSales.map((s) => { const it = itemOf(s.item_id); const p = profitOf(s); return [showDate(s.entry_date), (it ? label(it) : s.item_id) + (s.note ? ` — ${s.note}` : ''), s.reference || '', n2(s.quantity), s.quantity ? n2((s.sale_naira || 0) / s.quantity) : '', n2(s.sale_naira), n2(p.costNgn), n2(p.profitNgn)]; }),
      total: ['Total', '', '', n2(mTot.qty), '', n2(mTot.sale), n2(mTot.cost), n2(mTot.profit)],
    }, {
      title: 'Stock left', head: ['Item', 'On hand'], right: [1],
      rows: items.filter((i) => i.is_active && (onHand[i.id] || 0) !== 0).map((i) => [label(i), `${n0(onHand[i.id] || 0)} ${i.unit}`]),
    }], 'Profit = sale − quantity × landed cost (China cost + duty & expenses of the shipment) × rate.');
  }

  if (loading) return <div className="p-8 text-center text-gray-500">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><ShoppingCart className="w-6 h-6 text-[#e8552a]" /> Nigeria — Sales NG</h1>
          <p className="text-sm text-gray-500">What the partner sold. Each sale comes off stock; profit = sale − landed cost (China cost + duty & expenses of its shipment) at the rate.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50"><RefreshCw className="w-4 h-4" /> Refresh</button>
          <button onClick={printMonth} disabled={!mSales.length} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40"><Printer className="w-4 h-4" /> Print / PDF</button>
          <button onClick={copySummary} disabled={!mSales.length} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40"><Copy className="w-4 h-4" /> Copy summary</button>
          <button onClick={openNew} disabled={!items.length} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#e8552a] rounded-lg hover:opacity-90 disabled:opacity-40"><Plus className="w-4 h-4" /> New sale</button>
        </div>
      </div>

      {!defRate && <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-900">No default rate yet — save one in Expenses NG (Naira for 1 RMB), or type the rate on each sale.</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[['Sold', mTot.sale, `${mSales.length} sales · ${n0(mTot.qty)} pcs`], ['Cost of goods (landed)', mTot.cost, `at ₦${n2(rateOfMonth)} / RMB`], ['Profit', mTot.profit, mTot.sale ? `${((mTot.profit / mTot.sale) * 100).toFixed(0)}% of sales · ${n0(rateOfMonth ? mTot.profit / rateOfMonth : NaN)} RMB` : ''], ['Profit all time', allTot.profit, `on ₦${n0(allTot.sale)} sold`]].map(([l, v, s]) => (
          <div key={l as string} className="bg-white rounded-xl border border-gray-200 p-4"><div className="text-xs text-gray-500 uppercase tracking-wide">{l as string} · {l === 'Profit all time' ? 'all' : monthName(month).split(' ')[0]}</div><div className={`text-lg font-semibold ${(l as string).startsWith('Profit') ? ((v as number) >= 0 ? 'text-green-700' : 'text-red-600') : 'text-gray-900'}`}>₦{n0(v as number)}</div><div className="text-xs text-gray-500">{s as string}</div></div>
        ))}
      </div>

      <div className="flex items-center gap-2"><select value={month} onChange={(e) => setMonth(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white">{months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select></div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase"><th className="text-left px-4 py-2">Date</th><th className="text-left px-4 py-2">Item</th><th className="text-left px-4 py-2">Customer</th><th className="text-right px-4 py-2">Qty</th><th className="text-right px-4 py-2">₦ / pc</th><th className="text-right px-4 py-2">Sold ₦</th><th className="text-right px-4 py-2">Cost ₦</th><th className="text-right px-4 py-2">Profit ₦</th><th className="px-4 py-2"></th></tr></thead>
          <tbody>
            {mSales.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">No sales in {monthName(month)} — press "New sale".</td></tr>}
            {mSales.map((s) => { const it = itemOf(s.item_id); const p = profitOf(s); return (
              <tr key={s.id} className="border-t border-gray-100">
                <td className="px-4 py-2 whitespace-nowrap">{showDate(s.entry_date)}</td>
                <td className="px-4 py-2">{it ? label(it) : s.item_id}{s.note ? <span className="block text-xs text-gray-400">{s.note}</span> : null}</td>
                <td className="px-4 py-2">{s.reference || ''}</td>
                <td className="px-4 py-2 text-right font-mono">{n2(s.quantity)}</td>
                <td className="px-4 py-2 text-right font-mono">{s.quantity ? n2((s.sale_naira || 0) / s.quantity) : ''}</td>
                <td className="px-4 py-2 text-right font-mono">{n2(s.sale_naira)}</td>
                <td className="px-4 py-2 text-right font-mono">{n2(p.costNgn)}</td>
                <td className={`px-4 py-2 text-right font-mono font-semibold ${p.profitNgn >= 0 ? 'text-green-700' : 'text-red-600'}`}>{n2(p.profitNgn)}</td>
                <td className="px-4 py-2 text-right"><button onClick={() => remove(s)} className="p-1 text-gray-400 hover:text-red-600" title="Delete (to Recycle Bin) — stock goes back"><Trash2 className="w-4 h-4" /></button></td>
              </tr>); })}
            {mSales.length > 0 && <tr className="border-t-2 border-gray-900 font-semibold"><td className="px-4 py-2" colSpan={3}>Total {monthName(month)}</td><td className="px-4 py-2 text-right font-mono">{n2(mTot.qty)}</td><td></td><td className="px-4 py-2 text-right font-mono">{n2(mTot.sale)}</td><td className="px-4 py-2 text-right font-mono">{n2(mTot.cost)}</td><td className={`px-4 py-2 text-right font-mono ${mTot.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{n2(mTot.profit)}</td><td></td></tr>}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setForm(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">New sale</h3><button onClick={() => setForm(null)} className="p-1 text-gray-400"><X className="w-5 h-5" /></button></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="text-xs text-gray-500">Item</label><select className={input} value={form.item_id} onChange={(e) => { const i = itemOf(e.target.value); setForm(calc({ ...form, item_id: e.target.value, price: i?.sell_naira ? String(i.sell_naira) : '' })); }}>{items.filter((i) => i.is_active).map((i) => <option key={i.id} value={i.id}>{label(i)} — {n2(onHand[i.id] || 0)} {i.unit} in stock</option>)}</select></div>
              <div><label className="text-xs text-gray-500">Date</label><input type="date" className={input} value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} /></div>
              <div><label className="text-xs text-gray-500">Customer (optional)</label><input className={input} value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} /></div>
              <div><label className="text-xs text-gray-500">Quantity ({fItem?.unit || 'pcs'})</label><input type="number" inputMode="decimal" className={input} value={form.qty} onChange={(e) => setForm(calc({ ...form, qty: e.target.value }))} autoFocus /></div>
              <div><label className="text-xs text-gray-500">Selling price (₦ per {fItem?.unit || 'pc'})</label><input type="number" inputMode="decimal" className={input} value={form.price} onChange={(e) => setForm(calc({ ...form, price: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-500">Total sold (₦)</label><input type="number" inputMode="decimal" className={input} value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value, price: isFinite(fQty) && fQty > 0 && e.target.value ? String(Math.round((parseFloat(e.target.value) / fQty) * 100) / 100) : form.price })} /></div>
              <div><label className="text-xs text-gray-500">Rate — Naira for 1 RMB</label><input type="number" inputMode="decimal" className={input} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></div>
              <div className="col-span-2 text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                {fl ? <>Landed cost {fl.cost.toLocaleString('en-US', { maximumFractionDigits: 4 })} RMB per {fItem?.unit}{fl.uplift ? ` (China cost + ${(fl.uplift * 100).toFixed(1)}% ${fl.ref})` : ' (no duty / expenses on its shipment yet)'}{isFinite(fCost) ? <> · cost of this sale <b>₦{n0(fCost)}</b> · profit <b className={fTotal - fCost >= 0 ? 'text-green-700' : 'text-red-600'}>₦{n0(fTotal - fCost)}</b></> : null}</> : 'Pick an item'}
              </div>
              <div className="col-span-2"><label className="text-xs text-gray-500">Note</label><input className={input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setForm(null)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 bg-[#e8552a] text-white rounded-lg text-sm font-medium disabled:opacity-50">{saving ? 'Saving…' : 'Save sale'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
