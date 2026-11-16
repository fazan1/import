import { useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Plus, X, RefreshCw, Trash2, PackagePlus, SlidersHorizontal, Printer } from 'lucide-react';
import { ngPrint } from '../lib/ngPrint';
import { landedCosts, pendingRefs } from '../lib/ngLanded';
import { supabase } from '../lib/supabase';
import { fetchAllPages } from '../lib/fetchAll';
import { moveToRecycleBin } from '../lib/recycleBin';

/* NIGERIA — step 2: Stock NG. Goods into stock (in), corrections (adjust); sales (out) come in step 3.
   Quantities are in the item's unit (pcs / kg / bag / ton). A proforma is per ton: "Load a proforma" takes tons per
   item and converts to the unit (pcs_per_ton, 1000 kg, 40 bags of 25 kg). Cost of an IN = quantity × item cost (editable). */

interface NgItem { id: string; name: string; specification: string | null; finish: string | null; unit: string; pcs_per_ton: number | null; cost_rmb: number; sell_naira?: number | null; is_active: boolean }
interface NgExp { amount: number; currency: string; rate: number | null; reference: string | null }
interface NgMove { id: string; item_id: string; kind: 'in' | 'out' | 'adjust'; entry_date: string; quantity: number; cost_rmb: number | null; sale_naira: number | null; rate: number | null; reference: string | null; note: string | null; created_at: string }

const KG_PER_BAG = 25;
const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500';
const n2 = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const showDate = (d: string) => { const [y, m, day] = d.slice(0, 10).split('-'); return `${day}/${m}/${y}`; };
const label = (i: NgItem) => [i.name, i.specification, i.finish].filter(Boolean).join(' ');
/** units in one ton for this item */
export const unitsPerTon = (i: NgItem) => (i.unit === 'ton' ? 1 : i.unit === 'kg' ? 1000 : i.unit === 'bag' ? 1000 / KG_PER_BAG : i.pcs_per_ton || 0);

export default function NigeriaStock() {
  const [items, setItems] = useState<NgItem[]>([]);
  const [moves, setMoves] = useState<NgMove[]>([]);
  const [exps, setExps] = useState<NgExp[]>([]);
  const [rate, setRate] = useState(0);
  const [pend, setPend] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [tab, setTab] = useState<'stock' | 'moves'>('stock');
  const [form, setForm] = useState<{ kind: 'in' | 'adjust'; item_id: string; entry_date: string; tons: string; qty: string; cost: string; reference: string; note: string } | null>(null);
  const [proforma, setProforma] = useState<{ reference: string; entry_date: string; tons: Record<string, string> } | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  async function load() {
    setLoading(true);
    const [it, mv, ex, se, pu] = await Promise.all([
      fetchAllPages<NgItem>(() => supabase.from('ng_items').select('id, name, specification, finish, unit, pcs_per_ton, cost_rmb, sell_naira, is_active').order('name').order('finish').order('specification')),
      fetchAllPages<NgMove>(() => supabase.from('ng_stock').select('*').order('entry_date', { ascending: false }).order('created_at', { ascending: false })),
      fetchAllPages<NgExp>(() => supabase.from('ng_expenses').select('amount, currency, rate, reference')),
      supabase.from('ng_settings').select('value').eq('key', 'rate').maybeSingle(),
      fetchAllPages<{ number: string; received_at: string | null; status: string }>(() => supabase.from('ng_purchases').select('number, received_at, status')),
    ]);
    setExps((ex.data || []).map((e) => ({ ...e, amount: Number(e.amount) || 0, rate: e.rate == null ? null : Number(e.rate) })));
    setRate(Number((se.data?.value as { naira_per_rmb?: number } | undefined)?.naira_per_rmb) || 0);
    setPend(pendingRefs(pu.data || []));
    if (it.error) { if (/ng_items|does not exist|schema cache/i.test(it.error)) setSetupNeeded(true); else alert('Could not load Items NG: ' + it.error); }
    else setSetupNeeded(false);
    setItems((it.data || []).map((r) => ({ ...r, cost_rmb: Number(r.cost_rmb) || 0, pcs_per_ton: r.pcs_per_ton == null ? null : Number(r.pcs_per_ton), sell_naira: r.sell_naira == null ? null : Number(r.sell_naira) })));
    if (mv.error && !it.error) alert('Could not load stock movements: ' + mv.error);
    setMoves((mv.data || []).map((m) => ({ ...m, quantity: Number(m.quantity) || 0, cost_rmb: m.cost_rmb == null ? null : Number(m.cost_rmb), sale_naira: m.sale_naira == null ? null : Number(m.sale_naira), rate: m.rate == null ? null : Number(m.rate) })));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const byItem = useMemo(() => {
    const m: Record<string, { qty: number; inQty: number; inCost: number; outQty: number; adjQty: number }> = {};
    moves.forEach((x) => {
      const r = (m[x.item_id] ||= { qty: 0, inQty: 0, inCost: 0, outQty: 0, adjQty: 0 });
      if (x.kind === 'in') { r.qty += x.quantity; r.inQty += x.quantity; r.inCost += x.cost_rmb || 0; }
      else if (x.kind === 'out') { r.qty -= x.quantity; r.outQty += x.quantity; }
      else { r.qty += x.quantity; r.adjQty += x.quantity; }
    });
    return m;
  }, [moves]);
  const itemOf = (id: string) => items.find((i) => i.id === id);
  const landed = useMemo(() => landedCosts(items, moves, exps, rate, pend), [items, moves, exps, rate, pend]);
  const rows = items.filter((i) => i.is_active || byItem[i.id]).map((i) => { const s = byItem[i.id] || { qty: 0, inQty: 0, inCost: 0, outQty: 0, adjQty: 0 }; const avg = s.inQty > 0 ? s.inCost / s.inQty : i.cost_rmb; const lc = landed[i.id]?.cost ?? avg; const q = Math.max(0, s.qty); return { i, ...s, avg, value: s.qty * avg, landedRmb: lc, landedNgn: lc * rate, costNgn: q * lc * rate, sellNgn: i.sell_naira ? q * i.sell_naira : NaN, pending: !!landed[i.id]?.pending }; });
  const totValue = rows.reduce((t, r) => t + r.value, 0);
  const totCostNgn = rows.reduce((t, r) => t + (isFinite(r.costNgn) ? r.costNgn : 0), 0);
  const totSellNgn = rows.reduce((t, r) => t + (isFinite(r.sellNgn) ? r.sellNgn : 0), 0);
  const noPrice = rows.filter((r) => r.qty > 0 && !r.i.sell_naira).length;

  function openIn(kind: 'in' | 'adjust') { setForm({ kind, item_id: items[0]?.id || '', entry_date: today(), tons: '', qty: '', cost: '', reference: '', note: '' }); }
  const fItem = form ? itemOf(form.item_id) : undefined;
  function setTons(t: string) { if (!form || !fItem) return; const q = parseFloat(t); const upt = unitsPerTon(fItem); const qty = isFinite(q) && upt ? Math.round(q * upt) : ''; setForm({ ...form, tons: t, qty: qty === '' ? '' : String(qty), cost: qty === '' ? '' : String(Math.round(qty * fItem.cost_rmb * 100) / 100) }); }
  function setQty(v: string) { if (!form || !fItem) return; const q = parseFloat(v); setForm({ ...form, qty: v, tons: '', cost: form.kind === 'in' && isFinite(q) ? String(Math.round(q * fItem.cost_rmb * 100) / 100) : form.cost }); }

  async function saveForm() {
    if (!form || savingRef.current) return;
    const it = itemOf(form.item_id); if (!it) { alert('Pick the item.'); return; }
    const qty = parseFloat(form.qty); if (!isFinite(qty) || qty === 0) { alert('Type the quantity.'); return; }
    if (form.kind === 'in' && qty < 0) { alert('Stock in must be a positive quantity. Use Adjust for a minus.'); return; }
    const cost = form.kind === 'in' ? (parseFloat(form.cost) || 0) : null;
    savingRef.current = true; setSaving(true);
    const { error } = await supabase.from('ng_stock').insert({ item_id: it.id, kind: form.kind, entry_date: form.entry_date || today(), quantity: qty, cost_rmb: cost, reference: form.reference.trim() || null, note: form.note.trim() || null });
    savingRef.current = false; setSaving(false);
    if (error) { alert('Could not save: ' + error.message); return; }
    setForm(null); load();
  }

  async function saveProforma() {
    if (!proforma || savingRef.current) return;
    const lines = items.filter((i) => i.is_active).map((i) => ({ i, tons: parseFloat(proforma.tons[i.id] || '') })).filter((x) => isFinite(x.tons) && x.tons > 0);
    if (!lines.length) { alert('Type the tons for at least one item.'); return; }
    const bad = lines.find((x) => !unitsPerTon(x.i)); if (bad) { alert(`${label(bad.i)} has no pieces per ton — edit the item first.`); return; }
    const inserts = lines.map((x) => { const qty = Math.round(x.tons * unitsPerTon(x.i)); return { item_id: x.i.id, kind: 'in', entry_date: proforma.entry_date || today(), quantity: qty, cost_rmb: Math.round(qty * x.i.cost_rmb * 100) / 100, reference: proforma.reference.trim() || null, note: `${x.tons} ton${x.tons === 1 ? '' : 's'} from proforma` }; });
    const totalTons = lines.reduce((t, x) => t + x.tons, 0), totalCost = inserts.reduce((t, x) => t + x.cost_rmb, 0);
    if (!confirm(`Put ${lines.length} items into stock — ${n2(totalTons)} tons, ${n2(totalCost)} RMB at the item costs?`)) return;
    savingRef.current = true; setSaving(true);
    const { error } = await supabase.from('ng_stock').insert(inserts);
    savingRef.current = false; setSaving(false);
    if (error) { alert('Could not save: ' + error.message); return; }
    setProforma(null); setTab('stock'); load();
  }

  async function remove(m: NgMove) {
    const it = itemOf(m.item_id);
    if (!confirm(`Delete this ${m.kind} of ${n2(m.quantity)} ${it?.unit || ''} ${it ? label(it) : ''} on ${showDate(m.entry_date)}?`)) return;
    const res = await moveToRecycleBin({ source_table: 'ng_stock', source_id: m.id, record_data: m as unknown as Record<string, unknown>, display_name: `NG stock ${m.kind} ${it ? label(it) : m.item_id} ${n2(m.quantity)} ${showDate(m.entry_date)}`, portal: 'cn' });
    if (!res.success) { alert('Could not move it to the Recycle Bin: ' + (res.error || '')); return; }
    const { error } = await supabase.from('ng_stock').delete().eq('id', m.id);
    if (error) alert('Could not delete: ' + error.message);
    load();
  }

  function printPage() {
    if (tab === 'stock') ngPrint('Stock NG — on hand', `${rows.length} items · value at average cost in RMB`, [{
      head: ['Item', 'On hand', 'Landed ₦ / unit', 'Value at cost ₦', 'Sell ₦ / unit', 'Value at selling ₦'], right: [1, 2, 3, 4, 5],
      rows: rows.map((r) => [label(r.i), `${n2(r.qty)} ${r.i.unit}`, rate ? n2(r.landedNgn) : '', rate ? n2(r.costNgn) : '', r.i.sell_naira ? n2(r.i.sell_naira) : '', isFinite(r.sellNgn) ? n2(r.sellNgn) : '']),
      total: ['Total', '', '', n2(totCostNgn), '', n2(totSellNgn)],
    }], `Profit in the stock if all sold at the selling price: ₦${n2(totSellNgn - totCostNgn)}`);
    else ngPrint('Stock NG — movements', `${moves.length} movements, newest first`, [{
      head: ['Date', 'Type', 'Item', 'Quantity', 'Cost RMB', 'Sale ₦', 'Reference / note'], right: [3, 4, 5],
      rows: moves.map((m) => { const it = itemOf(m.item_id); return [showDate(m.entry_date), m.kind === 'in' ? 'In' : m.kind === 'out' ? 'Sold' : 'Adjust', it ? label(it) : m.item_id, `${n2(m.quantity)} ${it?.unit || ''}`, m.cost_rmb != null ? n2(m.cost_rmb) : '', m.sale_naira != null ? n2(m.sale_naira) : '', [m.reference, m.note].filter(Boolean).join(' · ')]; }),
    }]);
  }

  if (loading) return <div className="p-8 text-center text-gray-500">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Boxes className="w-6 h-6 text-[#e8552a]" /> Nigeria — Stock NG</h1>
          <p className="text-sm text-gray-500">What is in Nigeria, in each item's unit. Value at cost in RMB (average of what was paid).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50"><RefreshCw className="w-4 h-4" /> Refresh</button>
          <button onClick={printPage} disabled={!items.length} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40"><Printer className="w-4 h-4" /> Print / PDF</button>
          <button onClick={() => openIn('adjust')} disabled={setupNeeded || !items.length} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40"><SlidersHorizontal className="w-4 h-4" /> Adjust</button>
          <button onClick={() => setProforma({ reference: '', entry_date: today(), tons: {} })} disabled={setupNeeded || !items.length} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40"><PackagePlus className="w-4 h-4" /> Load a proforma</button>
          <button onClick={() => openIn('in')} disabled={setupNeeded || !items.length} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#e8552a] rounded-lg hover:opacity-90 disabled:opacity-40"><Plus className="w-4 h-4" /> Stock in</button>
        </div>
      </div>

      {setupNeeded && <div className="p-4 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-900">One-time setup needed: run <b>nigeria-setup.sql</b> in Supabase (MAIN project), then Refresh.</div>}
      {!setupNeeded && items.length === 0 && <div className="p-4 rounded-lg border border-gray-200 bg-white text-sm text-gray-600">No items yet — add them in Items NG first.</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4"><div className="text-xs text-gray-500 uppercase tracking-wide">Stock at China cost</div><div className="text-lg font-semibold font-mono">{n2(totValue)} RMB</div><div className="text-xs text-gray-500">{rate ? `₦${n2(totValue * rate)}` : 'save the rate in Expenses NG'}</div></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><div className="text-xs text-gray-500 uppercase tracking-wide">Stock at landed cost</div><div className="text-lg font-semibold font-mono">₦{n2(totCostNgn)}</div><div className="text-xs text-gray-500">China cost + duty by weight</div></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><div className="text-xs text-gray-500 uppercase tracking-wide">Stock at selling price</div><div className="text-lg font-semibold font-mono">₦{n2(totSellNgn)}</div><div className="text-xs text-gray-500">{noPrice ? `${noPrice} item${noPrice === 1 ? '' : 's'} without a selling price` : 'all items priced'}</div></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><div className="text-xs text-gray-500 uppercase tracking-wide">Profit in the stock</div><div className={`text-lg font-semibold font-mono ${totSellNgn - totCostNgn >= 0 ? 'text-green-700' : 'text-red-600'}`}>₦{n2(totSellNgn - totCostNgn)}</div><div className="text-xs text-gray-500">if all sold at the selling price</div></div>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setTab('stock')} className={`px-3 py-1.5 rounded-full text-sm border ${tab === 'stock' ? 'bg-[#111] text-white border-[#111]' : 'bg-white border-gray-300 text-gray-700'}`}>Stock on hand</button>
        <button onClick={() => setTab('moves')} className={`px-3 py-1.5 rounded-full text-sm border ${tab === 'moves' ? 'bg-[#111] text-white border-[#111]' : 'bg-white border-gray-300 text-gray-700'}`}>Movements ({moves.length})</button>
      </div>

      {tab === 'stock' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[1040px]">
            <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase">
              <th className="text-left px-4 py-2">Item</th><th className="text-right px-4 py-2">In</th><th className="text-right px-4 py-2">Sold</th><th className="text-right px-4 py-2">Adjust</th>
              <th className="text-right px-4 py-2">On hand</th><th className="text-right px-4 py-2">Cost (RMB)</th><th className="text-right px-4 py-2">Landed ₦ / unit</th><th className="text-right px-4 py-2">Value at cost ₦</th><th className="text-right px-4 py-2">Sell ₦ / unit</th><th className="text-right px-4 py-2">Value at selling ₦</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.i.id} className="border-t border-gray-100">
                  <td className="px-4 py-2 font-medium">{label(r.i)} <span className="text-xs text-gray-400">{r.i.unit}</span></td>
                  <td className="px-4 py-2 text-right font-mono">{n2(r.inQty)}</td>
                  <td className="px-4 py-2 text-right font-mono">{n2(r.outQty)}</td>
                  <td className="px-4 py-2 text-right font-mono">{r.adjQty ? n2(r.adjQty) : ''}</td>
                  <td className={`px-4 py-2 text-right font-mono font-semibold ${r.qty < 0 ? 'text-red-600' : ''}`}>{n2(r.qty)}</td>
                  <td className="px-4 py-2 text-right font-mono">{r.avg.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                  <td className="px-4 py-2 text-right font-mono">{rate ? n2(r.landedNgn) : '—'}{r.pending ? <span className="block text-[10px] text-amber-700">duty not yet</span> : null}</td>
                  <td className="px-4 py-2 text-right font-mono">{rate ? n2(r.costNgn) : '—'}</td>
                  <td className="px-4 py-2 text-right font-mono">{r.i.sell_naira ? n2(r.i.sell_naira) : <span className="text-gray-400">—</span>}</td>
                  <td className="px-4 py-2 text-right font-mono">{isFinite(r.sellNgn) ? n2(r.sellNgn) : ''}</td>
                </tr>
              ))}
              {rows.length > 0 && <tr className="border-t-2 border-gray-900 font-semibold"><td className="px-4 py-2" colSpan={5}>Total</td><td className="px-4 py-2 text-right font-mono">{n2(totValue)} RMB</td><td></td><td className="px-4 py-2 text-right font-mono">{n2(totCostNgn)}</td><td></td><td className="px-4 py-2 text-right font-mono">{n2(totSellNgn)}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'moves' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase">
              <th className="text-left px-4 py-2">Date</th><th className="text-left px-4 py-2">Type</th><th className="text-left px-4 py-2">Item</th><th className="text-right px-4 py-2">Quantity</th>
              <th className="text-right px-4 py-2">Cost RMB</th><th className="text-right px-4 py-2">Sale ₦</th><th className="text-left px-4 py-2">Reference / note</th><th className="px-4 py-2"></th>
            </tr></thead>
            <tbody>
              {moves.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No movements yet — press "Load a proforma" or "Stock in".</td></tr>}
              {moves.map((m) => { const it = itemOf(m.item_id); return (
                <tr key={m.id} className="border-t border-gray-100">
                  <td className="px-4 py-2 whitespace-nowrap">{showDate(m.entry_date)}</td>
                  <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs ${m.kind === 'in' ? 'bg-green-100 text-green-800' : m.kind === 'out' ? 'bg-gray-100 text-gray-800' : 'bg-amber-100 text-amber-800'}`}>{m.kind === 'in' ? 'In' : m.kind === 'out' ? 'Sold' : 'Adjust'}</span></td>
                  <td className="px-4 py-2">{it ? label(it) : m.item_id}</td>
                  <td className="px-4 py-2 text-right font-mono">{n2(m.quantity)} <span className="text-xs text-gray-400">{it?.unit}</span></td>
                  <td className="px-4 py-2 text-right font-mono">{m.cost_rmb != null ? n2(m.cost_rmb) : ''}</td>
                  <td className="px-4 py-2 text-right font-mono">{m.sale_naira != null ? n2(m.sale_naira) : ''}</td>
                  <td className="px-4 py-2 text-gray-600">{[m.reference, m.note].filter(Boolean).join(' · ')}</td>
                  <td className="px-4 py-2 text-right"><button onClick={() => remove(m)} className="p-1 text-gray-400 hover:text-red-600" title="Delete (to Recycle Bin)"><Trash2 className="w-4 h-4" /></button></td>
                </tr>); })}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setForm(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">{form.kind === 'in' ? 'Stock in' : 'Adjust stock'}</h3><button onClick={() => setForm(null)} className="p-1 text-gray-400"><X className="w-5 h-5" /></button></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="text-xs text-gray-500">Item</label><select className={input} value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value, qty: '', tons: '', cost: '' })}>{items.filter((i) => i.is_active).map((i) => <option key={i.id} value={i.id}>{label(i)} ({i.unit})</option>)}</select></div>
              <div><label className="text-xs text-gray-500">Date</label><input type="date" className={input} value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} /></div>
              <div><label className="text-xs text-gray-500">Reference (proforma / invoice)</label><input className={input} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></div>
              {form.kind === 'in' && fItem && unitsPerTon(fItem) > 0 && <div><label className="text-xs text-gray-500">Tons</label><input type="number" inputMode="decimal" className={input} value={form.tons} onChange={(e) => setTons(e.target.value)} placeholder="1" /><p className="text-[11px] text-gray-500 mt-1">1 ton = {n2(unitsPerTon(fItem))} {fItem.unit}</p></div>}
              <div><label className="text-xs text-gray-500">Quantity ({fItem?.unit || 'unit'}){form.kind === 'adjust' ? ' — minus to reduce' : ''}</label><input type="number" inputMode="decimal" className={input} value={form.qty} onChange={(e) => setQty(e.target.value)} /></div>
              {form.kind === 'in' && <div><label className="text-xs text-gray-500">Total cost (RMB)</label><input type="number" inputMode="decimal" className={input} value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /><p className="text-[11px] text-gray-500 mt-1">{fItem ? `item cost ${fItem.cost_rmb.toLocaleString('en-US', { maximumFractionDigits: 4 })} RMB per ${fItem.unit}` : ''}</p></div>}
              <div className="col-span-2"><label className="text-xs text-gray-500">Note{form.kind === 'adjust' ? ' — reason' : ''}</label><input className={input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setForm(null)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button>
              <button onClick={saveForm} disabled={saving} className="px-4 py-2 bg-[#e8552a] text-white rounded-lg text-sm font-medium disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {proforma && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setProforma(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">Load a proforma into stock</h3><button onClick={() => setProforma(null)} className="p-1 text-gray-400"><X className="w-5 h-5" /></button></div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div><label className="text-xs text-gray-500">Proforma / shipment reference</label><input className={input} value={proforma.reference} onChange={(e) => setProforma({ ...proforma, reference: e.target.value })} placeholder="PI-001" /></div>
              <div><label className="text-xs text-gray-500">Date (arrival in Nigeria)</label><input type="date" className={input} value={proforma.entry_date} onChange={(e) => setProforma({ ...proforma, entry_date: e.target.value })} /></div>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-500 uppercase"><th className="text-left py-1">Item</th><th className="text-right py-1">Tons</th><th className="text-right py-1">= quantity</th><th className="text-right py-1">Cost RMB</th></tr></thead>
              <tbody>
                {items.filter((i) => i.is_active).map((i) => { const t = parseFloat(proforma.tons[i.id] || ''); const q = isFinite(t) && t > 0 ? Math.round(t * unitsPerTon(i)) : 0; return (
                  <tr key={i.id} className="border-t border-gray-100">
                    <td className="py-1.5">{label(i)} <span className="text-xs text-gray-400">{i.unit}</span></td>
                    <td className="py-1.5 text-right"><input type="number" inputMode="decimal" className="w-24 px-2 py-1 border border-gray-300 rounded-lg text-sm text-right" value={proforma.tons[i.id] || ''} onChange={(e) => setProforma({ ...proforma, tons: { ...proforma.tons, [i.id]: e.target.value } })} placeholder="0" /></td>
                    <td className="py-1.5 text-right font-mono">{q ? n2(q) : ''}</td>
                    <td className="py-1.5 text-right font-mono">{q ? n2(q * i.cost_rmb) : ''}</td>
                  </tr>); })}
              </tbody>
            </table>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setProforma(null)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button>
              <button onClick={saveProforma} disabled={saving} className="px-4 py-2 bg-[#e8552a] text-white rounded-lg text-sm font-medium disabled:opacity-50">{saving ? 'Saving…' : 'Put into stock'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
