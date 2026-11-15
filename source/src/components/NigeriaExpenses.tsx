import { useEffect, useMemo, useRef, useState } from 'react';
import { Receipt, Plus, X, RefreshCw, Trash2, Pencil, Printer } from 'lucide-react';
import { ngPrint } from '../lib/ngPrint';
import { supabase } from '../lib/supabase';
import { fetchAllPages } from '../lib/fetchAll';
import { moveToRecycleBin } from '../lib/recycleBin';

/* NIGERIA — step 3: Expenses & duty NG. Every cost in Nigeria (duty, freight, clearing, transport, rent...) in Naira or RMB.
   Entries carrying a shipment reference (PI-001) are SPREAD over that shipment's goods: landed cost = goods RMB + expenses RMB.
   Default Naira-per-RMB rate lives in ng_settings key 'rate' ({naira_per_rmb}); each entry keeps the rate used. */

interface NgExpense { id: string; entry_date: string; category: string; description: string | null; amount: number; currency: 'NGN' | 'RMB'; rate: number | null; reference: string | null; note: string | null; created_at: string; item_id?: string | null; per_unit?: number | null; units?: number | null }
interface NgIn { item_id: string; kind: string; quantity: number; cost_rmb: number | null; reference: string | null }
interface NgPurchaseRef { number: string; total_rmb: number; order_date: string; status: string; supplier_id: string | null }

export const NG_CATEGORIES = ['Customs duty', 'Shipping / freight', 'Clearing agent', 'Port / terminal', 'Transport', 'Rent', 'Salary', 'Bank charges', 'Partner payout', 'Owner withdrawal', 'Other'];
const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500';
const n2 = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const showDate = (d: string) => { const [y, m, day] = d.slice(0, 10).split('-'); return `${day}/${m}/${y}`; };
const monthName = (ym: string) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

/** amount of an expense in RMB and in Naira at its rate (falls back to the default rate) */
export function expenseBoth(e: { amount: number; currency: string; rate: number | null }, defRate: number) {
  const r = e.rate || defRate || 0;
  if (e.currency === 'RMB') return { rmb: e.amount, ngn: r ? e.amount * r : NaN };
  return { ngn: e.amount, rmb: r ? e.amount / r : NaN };
}

export default function NigeriaExpenses() {
  const [rows, setRows] = useState<NgExpense[]>([]);
  const [ins, setIns] = useState<NgIn[]>([]);
  const [bills, setBills] = useState<NgPurchaseRef[]>([]);
  const [supNames, setSupNames] = useState<Record<string, string>>({});
  const [defRate, setDefRate] = useState<number>(0);
  const [rateBox, setRateBox] = useState('');
  const [loading, setLoading] = useState(true);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [tab, setTab] = useState<'list' | 'ship'>('list');
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [form, setForm] = useState<Partial<NgExpense> & { amount_s?: string; rate_s?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  async function load() {
    setLoading(true);
    const [ex, st, se, pu, su] = await Promise.all([
      fetchAllPages<NgExpense>(() => supabase.from('ng_expenses').select('*').order('entry_date', { ascending: false }).order('created_at', { ascending: false })),
      fetchAllPages<NgIn>(() => supabase.from('ng_stock').select('item_id, kind, quantity, cost_rmb, reference').eq('kind', 'in')),
      supabase.from('ng_settings').select('value').eq('key', 'rate').maybeSingle(),
      fetchAllPages<NgPurchaseRef>(() => supabase.from('ng_purchases').select('number, total_rmb, order_date, status, supplier_id').order('order_date', { ascending: false })),
      fetchAllPages<{ id: string; name: string }>(() => supabase.from('ng_suppliers').select('id, name')),
    ]);
    setBills((pu.data || []).map((b) => ({ ...b, total_rmb: Number(b.total_rmb) || 0 })));
    setSupNames(Object.fromEntries((su.data || []).map((x) => [x.id, x.name])));
    if (ex.error) { if (/ng_expenses|does not exist|schema cache/i.test(ex.error)) setSetupNeeded(true); else alert('Could not load expenses: ' + ex.error); }
    else setSetupNeeded(false);
    setRows((ex.data || []).map((r) => ({ ...r, amount: Number(r.amount) || 0, rate: r.rate == null ? null : Number(r.rate), per_unit: r.per_unit == null ? null : Number(r.per_unit), units: r.units == null ? null : Number(r.units) })));
    setIns((st.data || []).map((r) => ({ ...r, quantity: Number(r.quantity) || 0, cost_rmb: r.cost_rmb == null ? null : Number(r.cost_rmb) })));
    const v = (se.data?.value as { naira_per_rmb?: number } | undefined)?.naira_per_rmb; const r = Number(v) || 0; setDefRate(r); setRateBox(r ? String(r) : '');
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function saveRate() {
    const r = parseFloat(rateBox); if (!isFinite(r) || r <= 0) { alert('Type the rate: how many Naira for 1 RMB (for example 210).'); return; }
    const { error } = await supabase.from('ng_settings').upsert({ key: 'rate', value: { naira_per_rmb: r }, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) { alert('Could not save the rate: ' + error.message); return; }
    setDefRate(r); alert(`Default rate saved: 1 RMB = ₦${r}. New entries use it unless you type another rate.`);
  }

  const months = useMemo(() => Array.from(new Set([...rows.map((r) => r.entry_date.slice(0, 7)), today().slice(0, 7)])).sort().reverse(), [rows]);
  const mRows = rows.filter((r) => r.entry_date.startsWith(month));
  const sum = (xs: NgExpense[]) => xs.reduce((t, e) => { const b = expenseBoth(e, defRate); return { ngn: t.ngn + (isFinite(b.ngn) ? b.ngn : 0), rmb: t.rmb + (isFinite(b.rmb) ? b.rmb : 0) }; }, { ngn: 0, rmb: 0 });
  const mTot = sum(mRows), allTot = sum(rows);
  const byCat = NG_CATEGORIES.map((c) => ({ c, ...sum(mRows.filter((r) => r.category === c)) })).filter((x) => x.ngn > 0 || x.rmb > 0);
  const refs = useMemo(() => Array.from(new Set([...bills.map((b) => b.number), ...ins.map((i) => i.reference || ''), ...rows.map((r) => r.reference || '')].filter(Boolean))).sort(), [ins, rows, bills]);
  const shipments = refs.map((ref) => {
    const goods = ins.filter((i) => i.reference === ref); const goodsRmb = goods.reduce((t, i) => t + (i.cost_rmb || 0), 0); const pcs = goods.reduce((t, i) => t + i.quantity, 0);
    const ex = sum(rows.filter((r) => r.reference === ref));
    const bill = bills.find((b) => b.number === ref); const base = goodsRmb || bill?.total_rmb || 0;
    return { ref, who: bill ? supNames[bill.supplier_id || ''] || '' : '', goodsRmb: base, inStock: goodsRmb > 0, pcs, exRmb: ex.rmb, exNgn: ex.ngn, landed: base + ex.rmb, uplift: base > 0 ? (ex.rmb / base) * 100 : NaN, perPcNgn: pcs > 0 ? ex.ngn / pcs : NaN, perPcRmb: pcs > 0 ? ex.rmb / pcs : NaN };
  });

  function openNew() { setForm({ entry_date: today(), category: 'Customs duty', description: '', amount_s: '', currency: 'NGN', rate_s: defRate ? String(defRate) : '', reference: refs[0] || '', note: '' }); }
  function openEdit(e: NgExpense) { setForm({ ...e, amount_s: String(e.amount), rate_s: e.rate ? String(e.rate) : (defRate ? String(defRate) : '') }); }
  async function save() {
    if (!form || savingRef.current) return;
    const amount = parseFloat(form.amount_s || ''); if (!isFinite(amount) || amount <= 0) { alert('Type the amount.'); return; }
    const rate = parseFloat(form.rate_s || ''); if (!isFinite(rate) || rate <= 0) { alert('Type the rate (Naira per 1 RMB), or save a default rate at the top first.'); return; }
    savingRef.current = true; setSaving(true);
    const row = { entry_date: form.entry_date || today(), category: form.category || 'Other', description: (form.description || '').trim() || null, amount, currency: form.currency || 'NGN', rate, reference: (form.reference || '').trim() || null, note: (form.note || '').trim() || null };
    const { error } = form.id ? await supabase.from('ng_expenses').update(row).eq('id', form.id) : await supabase.from('ng_expenses').insert(row);
    savingRef.current = false; setSaving(false);
    if (error) { alert('Could not save: ' + error.message); return; }
    setForm(null); load();
  }
  async function remove(e: NgExpense) {
    if (!confirm(`Delete ${e.category} ${e.currency === 'RMB' ? 'RMB ' : '₦'}${n2(e.amount)} on ${showDate(e.entry_date)}?`)) return;
    const res = await moveToRecycleBin({ source_table: 'ng_expenses', source_id: e.id, record_data: e as unknown as Record<string, unknown>, display_name: `NG expense ${e.category} ${e.currency} ${n2(e.amount)} ${showDate(e.entry_date)}`, portal: 'cn' });
    if (!res.success) { alert('Could not move it to the Recycle Bin: ' + (res.error || '')); return; }
    const { error } = await supabase.from('ng_expenses').delete().eq('id', e.id);
    if (error) alert('Could not delete: ' + error.message);
    load();
  }
  const fAmt = form ? parseFloat(form.amount_s || '') : NaN, fRate = form ? parseFloat(form.rate_s || '') : NaN;
  function printPage() {
    if (tab === 'list') ngPrint(`Expenses NG — ${monthName(month)}`, `Total ₦${n2(mTot.ngn)} = ${n2(mTot.rmb)} RMB · default rate ₦${defRate || '—'} / RMB`, [{
      head: ['Date', 'Type', 'Description', 'Bill / shipment', 'Amount', '= ₦', '= RMB'], right: [4, 5, 6],
      rows: mRows.map((e) => { const b = expenseBoth(e, defRate); return [showDate(e.entry_date), e.category, [e.description, e.note].filter(Boolean).join(' · '), e.reference || 'general', `${e.currency === 'RMB' ? 'RMB ' : '₦'}${n2(e.amount)}`, n2(b.ngn), n2(b.rmb)]; }),
      total: ['Total', '', '', '', '', n2(mTot.ngn), n2(mTot.rmb)],
    }]);
    else ngPrint('Expenses NG — landed cost by shipment', `default rate ₦${defRate || '—'} / RMB`, [{
      head: ['Shipment', 'Supplier', 'Pieces in', 'Goods (RMB)', 'Duty & expenses (₦)', '= RMB', 'Landed (RMB)', 'Duty ₦ / piece'], right: [2, 3, 4, 5, 6, 7],
      rows: shipments.map((s) => [s.ref + (s.inStock ? '' : ' (not in stock yet)'), s.who, s.pcs ? n2(s.pcs) : '', n2(s.goodsRmb), n2(s.exNgn), n2(s.exRmb), n2(s.landed), isFinite(s.perPcNgn) ? s.perPcNgn.toFixed(2) : '']),
    }], "Duty per piece = the shipment's duty & expenses ÷ its pieces. Landed cost of a piece = China cost + duty per piece.");
  }

  if (loading) return <div className="p-8 text-center text-gray-500">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Receipt className="w-6 h-6 text-[#e8552a]" /> Nigeria — Expenses & duty NG</h1>
          <p className="text-sm text-gray-500">Duty, freight, clearing and running costs in Naira or RMB. Costs with a shipment reference are divided equally over every piece of that shipment.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50"><RefreshCw className="w-4 h-4" /> Refresh</button>
          <button onClick={printPage} disabled={setupNeeded} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40"><Printer className="w-4 h-4" /> Print / PDF</button>
          <button onClick={openNew} disabled={setupNeeded} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#e8552a] rounded-lg hover:opacity-90 disabled:opacity-40"><Plus className="w-4 h-4" /> New expense</button>
        </div>
      </div>

      {setupNeeded && <div className="p-4 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-900">One-time setup needed: run <b>nigeria-expenses.sql</b> in Supabase (MAIN project), then Refresh.</div>}

      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-end gap-3">
        <div><label className="text-xs text-gray-500">Default rate — Naira for 1 RMB</label><input type="number" inputMode="decimal" className={input + ' w-40'} value={rateBox} onChange={(e) => setRateBox(e.target.value)} placeholder="210" /></div>
        <button onClick={saveRate} className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50">Save rate</button>
        <p className="text-xs text-gray-500">{defRate ? `1 RMB = ₦${defRate} · ₦1,000,000 = ${n2(1000000 / defRate)} RMB` : 'No rate yet — type it once; every entry and the overview use it.'}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4"><div className="text-xs text-gray-500 uppercase tracking-wide">{monthName(month)}</div><div className="text-lg font-semibold">₦{n2(mTot.ngn)}</div><div className="text-xs text-gray-500">{n2(mTot.rmb)} RMB</div></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><div className="text-xs text-gray-500 uppercase tracking-wide">All time</div><div className="text-lg font-semibold">₦{n2(allTot.ngn)}</div><div className="text-xs text-gray-500">{n2(allTot.rmb)} RMB</div></div>
        {byCat.slice(0, 2).map((x) => <div key={x.c} className="bg-white rounded-xl border border-gray-200 p-4"><div className="text-xs text-gray-500 uppercase tracking-wide">{x.c} · {monthName(month).split(' ')[0]}</div><div className="text-lg font-semibold">₦{n2(x.ngn)}</div><div className="text-xs text-gray-500">{n2(x.rmb)} RMB</div></div>)}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setTab('list')} className={`px-3 py-1.5 rounded-full text-sm border ${tab === 'list' ? 'bg-[#111] text-white border-[#111]' : 'bg-white border-gray-300 text-gray-700'}`}>Entries</button>
        <button onClick={() => setTab('ship')} className={`px-3 py-1.5 rounded-full text-sm border ${tab === 'ship' ? 'bg-[#111] text-white border-[#111]' : 'bg-white border-gray-300 text-gray-700'}`}>Landed cost by shipment</button>
        {tab === 'list' && <select value={month} onChange={(e) => setMonth(e.target.value)} className="ml-auto px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white">{months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select>}
      </div>

      {tab === 'list' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase"><th className="text-left px-4 py-2">Date</th><th className="text-left px-4 py-2">Type</th><th className="text-left px-4 py-2">Description</th><th className="text-left px-4 py-2">Shipment</th><th className="text-right px-4 py-2">Amount</th><th className="text-right px-4 py-2">= ₦</th><th className="text-right px-4 py-2">= RMB</th><th className="px-4 py-2"></th></tr></thead>
            <tbody>
              {mRows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No expenses in {monthName(month)}.</td></tr>}
              {mRows.map((e) => { const b = expenseBoth(e, defRate); return (
                <tr key={e.id} className="border-t border-gray-100">
                  <td className="px-4 py-2 whitespace-nowrap">{showDate(e.entry_date)}</td>
                  <td className="px-4 py-2">{e.category}</td>
                  <td className="px-4 py-2 text-gray-700">{[e.description, e.note].filter(Boolean).join(' · ')}</td>
                  <td className="px-4 py-2">{e.reference || <span className="text-gray-400">general</span>}</td>
                  <td className="px-4 py-2 text-right font-mono">{e.currency === 'RMB' ? 'RMB ' : '₦'}{n2(e.amount)}</td>
                  <td className="px-4 py-2 text-right font-mono">{n2(b.ngn)}</td>
                  <td className="px-4 py-2 text-right font-mono">{n2(b.rmb)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap"><button onClick={() => openEdit(e)} className="p-1 text-gray-400 hover:text-gray-800" title="Edit"><Pencil className="w-4 h-4" /></button><button onClick={() => remove(e)} className="p-1 text-gray-400 hover:text-red-600" title="Delete (to Recycle Bin)"><Trash2 className="w-4 h-4" /></button></td>
                </tr>); })}
              {mRows.length > 0 && <tr className="border-t-2 border-gray-900 font-semibold"><td className="px-4 py-2" colSpan={5}>Total {monthName(month)}</td><td className="px-4 py-2 text-right font-mono">{n2(mTot.ngn)}</td><td className="px-4 py-2 text-right font-mono">{n2(mTot.rmb)}</td><td></td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'ship' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase"><th className="text-left px-4 py-2">Shipment</th><th className="text-right px-4 py-2">Pieces in</th><th className="text-right px-4 py-2">Goods (RMB)</th><th className="text-right px-4 py-2">Duty & expenses (₦)</th><th className="text-right px-4 py-2">= RMB</th><th className="text-right px-4 py-2">Landed (RMB)</th><th className="text-right px-4 py-2">Duty per piece</th></tr></thead>
            <tbody>
              {shipments.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No shipment references yet. Put stock in with a reference (PI-001) and give expenses the same reference.</td></tr>}
              {shipments.map((s) => (
                <tr key={s.ref} className="border-t border-gray-100">
                  <td className="px-4 py-2 font-medium">{s.ref}{s.who ? <span className="block text-xs text-gray-400">{s.who}</span> : null}{!s.inStock && <span className="block text-[11px] text-amber-700">not received into stock yet</span>}</td>
                  <td className="px-4 py-2 text-right font-mono">{s.pcs ? n2(s.pcs) : ''}</td>
                  <td className="px-4 py-2 text-right font-mono">{n2(s.goodsRmb)}</td>
                  <td className="px-4 py-2 text-right font-mono">{n2(s.exNgn)}</td>
                  <td className="px-4 py-2 text-right font-mono">{n2(s.exRmb)}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">{n2(s.landed)}</td>
                  <td className="px-4 py-2 text-right font-mono">{isFinite(s.perPcNgn) ? `₦${s.perPcNgn.toFixed(2)}` : '—'}{isFinite(s.perPcRmb) ? <span className="block text-[11px] text-gray-400">{s.perPcRmb.toFixed(4)} RMB</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-gray-500">Duty per piece = the shipment's duty & expenses ÷ its pieces — every piece carries the same amount. Landed cost of a piece = its China cost + duty per piece. Sales profit, Stock and Overview use it.</p>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setForm(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">{form.id ? 'Edit expense' : 'New expense'}</h3><button onClick={() => setForm(null)} className="p-1 text-gray-400"><X className="w-5 h-5" /></button></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500">Date</label><input type="date" className={input} value={form.entry_date || ''} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} /></div>
              <div><label className="text-xs text-gray-500">Type</label><select className={input} value={form.category || 'Other'} onChange={(e) => setForm({ ...form, category: e.target.value })}>{NG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
              <div className="col-span-2"><label className="text-xs text-gray-500">Description</label><input className={input} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Customs duty Lagos port, 10 tons" /></div>
              <div><label className="text-xs text-gray-500">Amount</label><input type="number" inputMode="decimal" className={input} value={form.amount_s || ''} onChange={(e) => setForm({ ...form, amount_s: e.target.value })} autoFocus /></div>
              <div><label className="text-xs text-gray-500">Currency</label><select className={input} value={form.currency || 'NGN'} onChange={(e) => setForm({ ...form, currency: e.target.value as 'NGN' | 'RMB' })}><option value="NGN">Naira (₦)</option><option value="RMB">RMB</option></select></div>
              <div><label className="text-xs text-gray-500">Rate — Naira for 1 RMB</label><input type="number" inputMode="decimal" className={input} value={form.rate_s || ''} onChange={(e) => setForm({ ...form, rate_s: e.target.value })} /><p className="text-[11px] text-gray-500 mt-1">{isFinite(fAmt) && isFinite(fRate) && fRate > 0 ? (form.currency === 'RMB' ? `= ₦${n2(fAmt * fRate)}` : `= ${n2(fAmt / fRate)} RMB`) : ''}</p></div>
              <div><label className="text-xs text-gray-500">For which bill / shipment</label><select className={input} value={form.reference || ''} onChange={(e) => setForm({ ...form, reference: e.target.value })}>
                <option value="">General (not for one shipment)</option>
                {bills.map((b) => <option key={b.number} value={b.number}>{b.number} — {supNames[b.supplier_id || ''] || ''} {n2(b.total_rmb)} RMB</option>)}
                {refs.filter((r) => !bills.some((b) => b.number === r)).map((r) => <option key={r} value={r}>{r}</option>)}
                {form.reference && !refs.includes(form.reference) && !bills.some((b) => b.number === form.reference) && <option value={form.reference}>{form.reference}</option>}
              </select></div>
              <div className="col-span-2"><label className="text-xs text-gray-500">Note</label><input className={input} value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setForm(null)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 bg-[#e8552a] text-white rounded-lg text-sm font-medium disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
