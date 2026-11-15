import { useEffect, useMemo, useRef, useState } from 'react';
import { Globe, Plus, Pencil, X, RefreshCw, Trash2, Printer } from 'lucide-react';
import { ngPrint } from '../lib/ngPrint';
import { supabase } from '../lib/supabase';
import { fetchAllPages } from '../lib/fetchAll';

/* NIGERIA business — step 1: Items NG (own items, nothing shared with the Sri Lanka Items master).
   Goods are bought in China per TON (price per ton RMB, pieces per ton) and sold in Nigeria per unit (pcs / kg / bag / ton).
   cost_rmb on the item = cost per UNIT in RMB, worked out from the ton price. Stock column = sum of ng_stock (step 2). */

interface NgItem {
  id: string; name: string; specification: string | null; finish: string | null; unit: string; pcs_per_ton: number | null;
  cost_rmb: number; sell_naira: number | null; is_active: boolean; note: string | null;
}
interface NgStock { id: string; item_id: string; kind: 'in' | 'out' | 'adjust'; quantity: number }

const UNITS = ['pcs', 'kg', 'bag', 'ton'] as const;
const KG_PER_BAG = 25;
const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500';
const n2 = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const n4 = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 }));

/** cost per unit from a price per ton */
export function costPerUnit(pricePerTon: number, unit: string, pcsPerTon: number | null): number | null {
  if (!pricePerTon) return null;
  if (unit === 'ton') return pricePerTon;
  if (unit === 'kg') return pricePerTon / 1000;
  if (unit === 'bag') return pricePerTon / (1000 / KG_PER_BAG);
  if (unit === 'pcs') return pcsPerTon && pcsPerTon > 0 ? pricePerTon / pcsPerTon : null;
  return null;
}

export default function NigeriaTrade() {
  const [items, setItems] = useState<NgItem[]>([]);
  const [stock, setStock] = useState<NgStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Partial<NgItem> & { price_per_ton?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  async function load() {
    setLoading(true);
    const [it, st] = await Promise.all([
      fetchAllPages<NgItem>(() => supabase.from('ng_items').select('*').order('name').order('specification')),
      fetchAllPages<NgStock>(() => supabase.from('ng_stock').select('id, item_id, kind, quantity').order('entry_date')),
    ]);
    if (it.error) {
      if (/ng_items|does not exist|schema cache/i.test(it.error)) setSetupNeeded(true); else alert('Could not load Items NG: ' + it.error);
      setItems([]);
    } else { setSetupNeeded(false); setItems(it.data.map((r) => ({ ...r, cost_rmb: Number(r.cost_rmb) || 0, pcs_per_ton: r.pcs_per_ton == null ? null : Number(r.pcs_per_ton), sell_naira: r.sell_naira == null ? null : Number(r.sell_naira) }))); }
    setStock(st.error ? [] : st.data.map((r) => ({ ...r, quantity: Number(r.quantity) || 0 })));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const onHand = useMemo(() => {
    const m: Record<string, number> = {};
    stock.forEach((s) => { m[s.item_id] = (m[s.item_id] || 0) + (s.kind === 'out' ? -s.quantity : s.quantity); });
    return m;
  }, [stock]);

  const shown = items.filter((i) => (showInactive || i.is_active) && (!q || [i.name, i.specification, i.finish].join(' ').toLowerCase().includes(q.toLowerCase())));

  function openNew() { setEdit({ name: '', specification: '', finish: '', unit: 'pcs', pcs_per_ton: null, cost_rmb: 0, sell_naira: null, is_active: true, note: '', price_per_ton: '' }); }
  function openEdit(i: NgItem) {
    const ppt = i.unit === 'ton' ? i.cost_rmb : i.unit === 'kg' ? i.cost_rmb * 1000 : i.unit === 'bag' ? i.cost_rmb * (1000 / KG_PER_BAG) : i.pcs_per_ton ? i.cost_rmb * i.pcs_per_ton : 0;
    setEdit({ ...i, price_per_ton: ppt ? String(Math.round(ppt * 100) / 100) : '' });
  }
  const derivedCost = edit ? costPerUnit(parseFloat(edit.price_per_ton || '') || 0, edit.unit || 'pcs', edit.pcs_per_ton ?? null) : null;

  async function save() {
    if (!edit || savingRef.current) return;
    const name = (edit.name || '').trim();
    if (!name) { alert('Type the product name.'); return; }
    const cost = derivedCost != null ? derivedCost : Number(edit.cost_rmb) || 0;
    if (edit.unit === 'pcs' && !(edit.pcs_per_ton && edit.pcs_per_ton > 0) && parseFloat(edit.price_per_ton || '')) { alert('For an item sold per piece, type the pieces per ton so the cost per piece can be worked out.'); return; }
    const dup = items.find((i) => i.id !== edit.id && i.name.trim().toLowerCase() === name.toLowerCase() && (i.specification || '').trim().toLowerCase() === (edit.specification || '').trim().toLowerCase() && (i.finish || '').trim().toLowerCase() === (edit.finish || '').trim().toLowerCase());
    if (dup) { alert(`"${name} ${edit.specification || ''} ${edit.finish || ''}" already exists in Items NG.`); return; }
    savingRef.current = true; setSaving(true);
    const row = { name, specification: (edit.specification || '').trim() || null, finish: (edit.finish || '').trim().toUpperCase() || null, unit: edit.unit || 'pcs', pcs_per_ton: edit.pcs_per_ton || null, cost_rmb: Math.round(cost * 10000) / 10000, sell_naira: edit.sell_naira || null, is_active: edit.is_active !== false, note: (edit.note || '').trim() || null, updated_at: new Date().toISOString() };
    const { error } = edit.id ? await supabase.from('ng_items').update(row).eq('id', edit.id) : await supabase.from('ng_items').insert(row);
    savingRef.current = false; setSaving(false);
    if (error) { alert('Could not save: ' + error.message); return; }
    setEdit(null); load();
  }
  async function toggleActive(i: NgItem) {
    if (!i.is_active || confirm(`Hide "${i.name} ${i.specification || ''}" from the list? Its stock history stays. You can show it again with "Show hidden".`)) {
      const { error } = await supabase.from('ng_items').update({ is_active: !i.is_active, updated_at: new Date().toISOString() }).eq('id', i.id);
      if (error) alert('Could not save: ' + error.message); else load();
    }
  }

  async function remove(i: NgItem) {
    const moves = stock.filter((s) => s.item_id === i.id).length;
    if (moves > 0) { alert(`"${i.name} ${i.specification || ''}" has ${moves} stock movement${moves === 1 ? '' : 's'} and cannot be deleted. Use "hide" instead — the history stays.`); return; }
    if (!confirm(`Delete "${i.name} ${i.specification || ''} ${i.finish || ''}" from Items NG?`)) return;
    const { error } = await supabase.from('ng_items').delete().eq('id', i.id);
    if (error) { alert('Could not delete: ' + (/foreign key|violates/i.test(error.message) ? 'this item has stock movements — hide it instead.' : error.message)); return; }
    load();
  }

  function printList() {
    ngPrint('Items NG', `${shown.length} items · cost per unit in RMB · stock in each item's unit`, [{
      head: ['Product', 'Specification', 'Finish', 'Unit', 'Pcs / ton', 'Cost / unit (RMB)', 'Selling price (₦)', 'Stock'], right: [4, 5, 6, 7],
      rows: shown.map((i) => [i.name, i.specification || '', i.finish || '', i.unit, n2(i.pcs_per_ton), n4(i.cost_rmb), n2(i.sell_naira), `${n2(onHand[i.id] || 0)} ${i.unit}`]),
    }]);
  }

  if (loading) return <div className="p-8 text-center text-gray-500">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Globe className="w-6 h-6 text-[#e8552a]" /> Nigeria — Items NG</h1>
          <p className="text-sm text-gray-500">Goods bought in China per ton, sold in Nigeria per unit. Separate from the Sri Lanka Items.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50"><RefreshCw className="w-4 h-4" /> Refresh</button>
          <button onClick={printList} disabled={!items.length} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40"><Printer className="w-4 h-4" /> Print / PDF</button>
          <button onClick={openNew} disabled={setupNeeded} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#e8552a] rounded-lg hover:opacity-90 disabled:opacity-40"><Plus className="w-4 h-4" /> New item</button>
        </div>
      </div>

      {setupNeeded && <div className="p-4 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-900">One-time setup needed: run <b>nigeria-setup.sql</b> in Supabase (MAIN project), then Refresh.</div>}

      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, specification, finish" className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white w-72 max-w-full" />
        <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show hidden</label>
        <span className="text-xs text-gray-500">{shown.length} of {items.length} items</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase">
            <th className="text-left px-4 py-2">Product</th><th className="text-left px-4 py-2">Specification</th><th className="text-left px-4 py-2">Finish</th>
            <th className="text-left px-4 py-2">Unit</th><th className="text-right px-4 py-2">Pcs / ton</th><th className="text-right px-4 py-2">Cost / unit (RMB)</th>
            <th className="text-right px-4 py-2">Selling price (₦)</th><th className="text-right px-4 py-2">Stock</th><th className="px-4 py-2"></th>
          </tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">{items.length === 0 ? 'No items yet — press "New item" and type the first line of the proforma.' : 'Nothing matches.'}</td></tr>}
            {shown.map((i) => (
              <tr key={i.id} className={`border-t border-gray-100 ${i.is_active ? '' : 'opacity-50'}`}>
                <td className="px-4 py-2 font-medium">{i.name}</td>
                <td className="px-4 py-2">{i.specification || '-'}</td>
                <td className="px-4 py-2">{i.finish || '-'}</td>
                <td className="px-4 py-2">{i.unit}</td>
                <td className="px-4 py-2 text-right">{n2(i.pcs_per_ton)}</td>
                <td className="px-4 py-2 text-right font-mono">{n4(i.cost_rmb)}</td>
                <td className="px-4 py-2 text-right font-mono">{n2(i.sell_naira)}</td>
                <td className={`px-4 py-2 text-right font-mono ${(onHand[i.id] || 0) < 0 ? 'text-red-600' : ''}`}>{n2(onHand[i.id] || 0)} <span className="text-xs text-gray-400">{i.unit}</span></td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button onClick={() => openEdit(i)} className="p-1 text-gray-400 hover:text-gray-800" title="Edit"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => toggleActive(i)} className="p-1 text-gray-400 hover:text-gray-800 text-xs" title={i.is_active ? 'Hide' : 'Show again'}>{i.is_active ? 'hide' : 'show'}</button>
                  <button onClick={() => remove(i)} className="p-1 text-gray-400 hover:text-red-600" title="Delete (only when it has no stock movements)"><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">Next steps (not built yet): Stock in from the proforma, Sales by the partner, Overview with profit in RMB and Naira.</p>

      {edit && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setEdit(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">{edit.id ? 'Edit item' : 'New item NG'}</h3><button onClick={() => setEdit(null)} className="p-1 text-gray-400"><X className="w-5 h-5" /></button></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="text-xs text-gray-500">Product</label><input className={input} value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Hex Bolt + Nut" autoFocus /></div>
              <div><label className="text-xs text-gray-500">Specification</label><input className={input} value={edit.specification || ''} onChange={(e) => setEdit({ ...edit, specification: e.target.value })} placeholder="M12x30" /></div>
              <div><label className="text-xs text-gray-500">Finish</label><input className={input} value={edit.finish || ''} onChange={(e) => setEdit({ ...edit, finish: e.target.value })} placeholder="ZP / HDG" /></div>
              <div><label className="text-xs text-gray-500">Unit (counted in)</label><select className={input} value={edit.unit || 'pcs'} onChange={(e) => setEdit({ ...edit, unit: e.target.value })}>{UNITS.map((u) => <option key={u} value={u}>{u === 'bag' ? `bag (${KG_PER_BAG} kg)` : u}</option>)}</select></div>
              <div><label className="text-xs text-gray-500">Pieces per ton</label><input type="number" inputMode="decimal" className={input} value={edit.pcs_per_ton ?? ''} onChange={(e) => setEdit({ ...edit, pcs_per_ton: e.target.value === '' ? null : Number(e.target.value) })} placeholder="19600" /></div>
              <div><label className="text-xs text-gray-500">Selling price (₦ per {edit.unit || 'pcs'})</label><input type="number" inputMode="decimal" className={input} value={edit.sell_naira ?? ''} onChange={(e) => setEdit({ ...edit, sell_naira: e.target.value === '' ? null : Number(e.target.value) })} /></div>
              <div><label className="text-xs text-gray-500">Price per ton (RMB) — from the proforma</label><input type="number" inputMode="decimal" className={input} value={edit.price_per_ton || ''} onChange={(e) => setEdit({ ...edit, price_per_ton: e.target.value })} placeholder="5270" /></div>
              <div><label className="text-xs text-gray-500">Cost per {edit.unit || 'pcs'} (RMB)</label><input type="number" inputMode="decimal" className={input} value={derivedCost != null ? String(Math.round(derivedCost * 10000) / 10000) : (edit.cost_rmb || '')} onChange={(e) => setEdit({ ...edit, cost_rmb: Number(e.target.value) || 0, price_per_ton: '' })} /><p className="text-[11px] text-gray-500 mt-1">{derivedCost != null ? 'worked out from the ton price' : 'or type it directly'}</p></div>
              <div className="col-span-2"><label className="text-xs text-gray-500">Note</label><input className={input} value={edit.note || ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} placeholder="25 kg 2-layer PP woven bag" /></div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEdit(null)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 bg-[#e8552a] text-white rounded-lg text-sm font-medium disabled:opacity-50">{saving ? 'Saving…' : 'Save item'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
