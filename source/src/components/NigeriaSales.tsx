import { useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingCart, Plus, X, RefreshCw, Trash2, Copy, Printer, Banknote } from 'lucide-react';
import { ngPrint } from '../lib/ngPrint';
import { supabase } from '../lib/supabase';
import { useNgLang } from '../lib/ngLang';
import { fetchAllPages } from '../lib/fetchAll';
import { moveToRecycleBin } from '../lib/recycleBin';
import { landedCosts, pendingRefs } from '../lib/ngLanded';

/* NIGERIA — step 4: Sales NG. The partner sells; each sale is an ng_stock OUT row (quantity, sale_naira, rate, reference =
   customer, note). Profit = sale ₦ − quantity × landed cost × rate, where landed cost = item China cost × (1 + shipment uplift)
   (uplift = expenses with a reference ÷ goods RMB of that reference; items are matched to the shipment of their last IN). */

interface NgItem { id: string; name: string; specification: string | null; finish: string | null; unit: string; pcs_per_ton: number | null; cost_rmb: number; sell_naira: number | null; is_active: boolean }
interface NgMove { id: string; item_id: string; kind: 'in' | 'out' | 'adjust'; entry_date: string; quantity: number; cost_rmb: number | null; sale_naira: number | null; rate: number | null; reference: string | null; note: string | null; created_at: string }
interface NgExpense { amount: number; currency: string; rate: number | null; reference: string | null; item_id?: string | null }
interface NgRemit { id: string; rec_date: string; amount_ngn: number; method: string | null; got_amount: number | null; got_currency: string | null; sale_id: string | null; reference: string | null; note: string | null }

const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500';
const n2 = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const n0 = (v: number) => (isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const showDate = (d: string) => { const [y, m, day] = d.slice(0, 10).split('-'); return `${day}/${m}/${y}`; };
const monthName = (ym: string) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const label = (i: NgItem) => [i.name, i.specification, i.finish].filter(Boolean).join(' ');

export default function NigeriaSales() {
  const { t } = useNgLang();
  const [items, setItems] = useState<NgItem[]>([]);
  const [moves, setMoves] = useState<NgMove[]>([]);
  const [expenses, setExpenses] = useState<NgExpense[]>([]);
  const [defRate, setDefRate] = useState(0);
  const [pend, setPend] = useState<Set<string>>(new Set());
  const [remits, setRemits] = useState<NgRemit[]>([]);
  const [remitMissing, setRemitMissing] = useState(false);
  const [tab, setTab] = useState<'sales' | 'money'>('sales');
  const [rForm, setRForm] = useState<{ rec_date: string; amount: string; method: string; got_amount: string; got_currency: string; sale_id: string; reference: string; note: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [form, setForm] = useState<{ item_id: string; entry_date: string; qty: string; price: string; total: string; rate: string; customer: string; note: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  async function load() {
    setLoading(true);
    const [it, mv, ex, se, pu, rm] = await Promise.all([
      fetchAllPages<NgItem>(() => supabase.from('ng_items').select('id, name, specification, finish, unit, pcs_per_ton, cost_rmb, sell_naira, is_active').order('name').order('finish').order('specification')),
      fetchAllPages<NgMove>(() => supabase.from('ng_stock').select('*').order('entry_date', { ascending: false }).order('created_at', { ascending: false })),
      fetchAllPages<NgExpense>(() => supabase.from('ng_expenses').select('amount, currency, rate, reference, item_id')),
      supabase.from('ng_settings').select('value').eq('key', 'rate').maybeSingle(),
      fetchAllPages<{ number: string; received_at: string | null; status: string }>(() => supabase.from('ng_purchases').select('number, received_at, status')),
      fetchAllPages<NgRemit>(() => supabase.from('ng_remittances').select('*').order('rec_date', { ascending: false }).order('created_at', { ascending: false })),
    ]);
    setPend(pendingRefs(pu.data || []));
    if (rm.error) { setRemitMissing(/ng_remittances|does not exist|schema cache/i.test(rm.error)); setRemits([]); } else { setRemitMissing(false); setRemits((rm.data || []).map((r) => ({ ...r, amount_ngn: Number(r.amount_ngn) || 0, got_amount: r.got_amount == null ? null : Number(r.got_amount) }))); }
    if (it.error) alert('Could not load Items NG: ' + it.error);
    setItems((it.data || []).map((r) => ({ ...r, cost_rmb: Number(r.cost_rmb) || 0, pcs_per_ton: r.pcs_per_ton == null ? null : Number(r.pcs_per_ton), sell_naira: r.sell_naira == null ? null : Number(r.sell_naira) })));
    setMoves((mv.data || []).map((m) => ({ ...m, quantity: Number(m.quantity) || 0, cost_rmb: m.cost_rmb == null ? null : Number(m.cost_rmb), sale_naira: m.sale_naira == null ? null : Number(m.sale_naira), rate: m.rate == null ? null : Number(m.rate) })));
    setExpenses((ex.data || []).map((e) => ({ ...e, amount: Number(e.amount) || 0, rate: e.rate == null ? null : Number(e.rate) })));
    setDefRate(Number((se.data?.value as { naira_per_rmb?: number } | undefined)?.naira_per_rmb) || 0);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const landed = useMemo(() => landedCosts(items, moves, expenses, defRate, pend), [items, moves, expenses, defRate, pend]);
  const onHand = useMemo(() => { const m: Record<string, number> = {}; moves.forEach((x) => { m[x.item_id] = (m[x.item_id] || 0) + (x.kind === 'out' ? -x.quantity : x.quantity); }); return m; }, [moves]);
  const itemOf = (id: string) => items.find((i) => i.id === id);

  const sales = moves.filter((m) => m.kind === 'out');
  const months = useMemo(() => Array.from(new Set([...sales.map((s) => s.entry_date.slice(0, 7)), today().slice(0, 7)])).sort().reverse(), [sales]);
  const profitOf = (s: NgMove) => { const l = landed[s.item_id]; const r = s.rate || defRate || 0; const costNgn = l && r ? s.quantity * l.cost * r : NaN; return { costNgn, profitNgn: isFinite(costNgn) ? (s.sale_naira || 0) - costNgn : NaN, rate: r }; };
  // money from the partner matched to sales: amounts sent for a specific sale first, the rest to the oldest unpaid sales
  const paidOn = useMemo(() => {
    const m: Record<string, number> = {}; const asc = [...sales].sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at));
    remits.filter((r) => r.sale_id).forEach((r) => { m[r.sale_id!] = (m[r.sale_id!] || 0) + r.amount_ngn; });
    let pool = remits.filter((r) => !r.sale_id).reduce((t, r) => t + r.amount_ngn, 0);
    asc.forEach((x) => { const open = (x.sale_naira || 0) - (m[x.id] || 0); if (pool <= 0 || open <= 0) return; const use = Math.min(open, pool); m[x.id] = (m[x.id] || 0) + use; pool -= use; });
    return { m, unapplied: pool };
  }, [sales, remits]);
  const totRemit = remits.reduce((t, r) => t + r.amount_ngn, 0);
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
  function openRemit(saleId?: string) { const sl = saleId ? sales.find((x) => x.id === saleId) : undefined; const open = sl ? Math.max(0, (sl.sale_naira || 0) - (paidOn.m[sl.id] || 0)) : 0; setRForm({ rec_date: today(), amount: open ? String(Math.round(open * 100) / 100) : '', method: 'Bank', got_amount: '', got_currency: 'LKR', sale_id: saleId || '', reference: '', note: '' }); }
  async function saveRemit() {
    if (!rForm || savingRef.current) return;
    const amount = parseFloat(rForm.amount); if (!isFinite(amount) || amount <= 0) { alert('Type the amount in Naira.'); return; }
    savingRef.current = true; setSaving(true);
    const row = { rec_date: rForm.rec_date || today(), amount_ngn: amount, method: rForm.method || null, got_amount: parseFloat(rForm.got_amount) || null, got_currency: rForm.got_amount ? rForm.got_currency : null, sale_id: rForm.sale_id || null, reference: rForm.reference.trim() || null, note: rForm.note.trim() || null };
    const { error } = await supabase.from('ng_remittances').insert(row);
    savingRef.current = false; setSaving(false);
    if (error) { alert('Could not save: ' + (/ng_remittances|does not exist|schema cache/i.test(error.message) ? 'run nigeria-remittances.sql in Supabase once.' : error.message)); return; }
    setRForm(null); load();
  }
  async function removeRemit(r: NgRemit) {
    if (!confirm(`Delete the ₦${n2(r.amount_ngn)} received on ${showDate(r.rec_date)}?`)) return;
    const res = await moveToRecycleBin({ source_table: 'ng_remittances', source_id: r.id, record_data: r as unknown as Record<string, unknown>, display_name: `NG money from partner ₦${n2(r.amount_ngn)} ${showDate(r.rec_date)}`, portal: 'sl' });
    if (!res.success) { alert('Could not move it to the Recycle Bin: ' + (res.error || '')); return; }
    const { error } = await supabase.from('ng_remittances').delete().eq('id', r.id);
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

  if (loading) return <div className="p-8 text-center text-gray-500">{t('Loading…')}</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><ShoppingCart className="w-6 h-6 text-[#e8552a]" /> {t('Nigeria — Sales NG')}</h1>
          <p className="text-sm text-gray-500">What the partner sold. Each sale comes off stock; profit = sale − landed cost (China cost + the shipment's duty by weight) at the rate.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50"><RefreshCw className="w-4 h-4" /> {t('Refresh')}</button>
          <button onClick={printMonth} disabled={!mSales.length} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40"><Printer className="w-4 h-4" /> {t('Print / PDF')}</button>
          <button onClick={copySummary} disabled={!mSales.length} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40"><Copy className="w-4 h-4" /> {t('Copy summary')}</button>
          <button onClick={() => openRemit()} disabled={remitMissing} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-[#111] rounded-lg hover:opacity-90 disabled:opacity-40"><Banknote className="w-4 h-4" /> {t('Money from partner')}</button>
          <button onClick={openNew} disabled={!items.length} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#e8552a] rounded-lg hover:opacity-90 disabled:opacity-40"><Plus className="w-4 h-4" /> {t('New sale')}</button>
        </div>
      </div>

      {!defRate && <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-900">No default rate yet — save one in Expenses NG (Naira for 1 RMB), or type the rate on each sale.</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[['Sold', mTot.sale, `${mSales.length} sales · ${n0(mTot.qty)} pcs`], ['Cost of goods (landed)', mTot.cost, `at ₦${n2(rateOfMonth)} / RMB`], ['Profit', mTot.profit, mTot.sale ? `${((mTot.profit / mTot.sale) * 100).toFixed(0)}% of sales · ${n0(rateOfMonth ? mTot.profit / rateOfMonth : NaN)} RMB` : ''], ['Profit all time', allTot.profit, `on ₦${n0(allTot.sale)} sold`]].map(([l, v, s]) => (
          <div key={l as string} className="bg-white rounded-xl border border-gray-200 p-4"><div className="text-xs text-gray-500 uppercase tracking-wide">{l as string} · {l === 'Profit all time' ? 'all' : monthName(month).split(' ')[0]}</div><div className={`text-lg font-semibold ${(l as string).startsWith('Profit') ? ((v as number) >= 0 ? 'text-green-700' : 'text-red-600') : 'text-gray-900'}`}>₦{n0(v as number)}</div><div className="text-xs text-gray-500">{s as string}</div></div>
        ))}
      </div>

      {remitMissing && <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-900">To record money from the partner, run <b>nigeria-remittances.sql</b> in Supabase (MAIN project) once, then Refresh.</div>}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4"><div className="text-xs text-gray-500 uppercase tracking-wide">{t('Sold all time')}</div><div className="text-lg font-semibold font-mono">₦{n0(allTot.sale)}</div></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><div className="text-xs text-gray-500 uppercase tracking-wide">{t('Received from partner')}</div><div className="text-lg font-semibold font-mono text-green-700">₦{n0(totRemit)}</div><div className="text-xs text-gray-500">{remits.length} transfers{paidOn.unapplied > 0.5 ? ` · ₦${n0(paidOn.unapplied)} more than the sales` : ''}</div></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><div className="text-xs text-gray-500 uppercase tracking-wide">{t('Partner still holds')}</div><div className={`text-lg font-semibold font-mono ${allTot.sale - totRemit > 0.5 ? 'text-amber-700' : 'text-green-700'}`}>₦{n0(Math.max(0, allTot.sale - totRemit))}</div><div className="text-xs text-gray-500">{t('sales money not sent yet')}</div></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setTab('sales')} className={`px-3 py-1.5 rounded-full text-sm border ${tab === 'sales' ? 'bg-[#111] text-white border-[#111]' : 'bg-white border-gray-300 text-gray-700'}`}>{t('Sales')}</button>
        <button onClick={() => setTab('money')} className={`px-3 py-1.5 rounded-full text-sm border ${tab === 'money' ? 'bg-[#111] text-white border-[#111]' : 'bg-white border-gray-300 text-gray-700'}`}>Money from partner ({remits.length})</button>
        {tab === 'sales' && <select value={month} onChange={(e) => setMonth(e.target.value)} className="ml-auto px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white">{months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select>}
      </div>

      {tab === 'sales' && <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[920px]">
          <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase"><th className="text-left px-4 py-2">{t('Date')}</th><th className="text-left px-4 py-2">{t('Item')}</th><th className="text-left px-4 py-2">{t('Customer')}</th><th className="text-right px-4 py-2">{t('Qty')}</th><th className="text-right px-4 py-2">{t('₦ / pc')}</th><th className="text-right px-4 py-2">{t('Sold ₦')}</th><th className="text-right px-4 py-2">Cost / pc ₦<span className="block normal-case text-[10px]">China + duty</span></th><th className="text-right px-4 py-2">{t('Cost ₦')}</th><th className="text-right px-4 py-2">{t('Profit ₦')}</th><th className="text-right px-4 py-2">{t('Sent to us')}</th><th className="px-4 py-2"></th></tr></thead>
          <tbody>
            {mSales.length === 0 && <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-500">No sales in {monthName(month)} — press "New sale".</td></tr>}
            {mSales.map((s) => { const it = itemOf(s.item_id); const p = profitOf(s); return (
              <tr key={s.id} className="border-t border-gray-100">
                <td className="px-4 py-2 whitespace-nowrap">{showDate(s.entry_date)}</td>
                <td className="px-4 py-2">{it ? label(it) : s.item_id}{s.note ? <span className="block text-xs text-gray-400">{s.note}</span> : null}</td>
                <td className="px-4 py-2">{s.reference || ''}</td>
                <td className="px-4 py-2 text-right font-mono">{n2(s.quantity)}</td>
                <td className="px-4 py-2 text-right font-mono">{s.quantity ? n2((s.sale_naira || 0) / s.quantity) : ''}</td>
                <td className="px-4 py-2 text-right font-mono">{n2(s.sale_naira)}</td>
                <td className="px-4 py-2 text-right font-mono text-gray-600">{(() => { const l = landed[s.item_id]; const r = s.rate || defRate || 0; return l && r ? <>{n2(l.cost * r)}<span className="block text-[10px] text-gray-400">{n2((l.cost - l.perPiece) * r)} + {n2(l.perPiece * r)}</span></> : ''; })()}</td>
                <td className="px-4 py-2 text-right font-mono">{n2(p.costNgn)}</td>
                <td className={`px-4 py-2 text-right font-mono font-semibold ${p.profitNgn >= 0 ? 'text-green-700' : 'text-red-600'}`}>{n2(p.profitNgn)}</td>
                <td className="px-4 py-2 text-right">{(() => { const got = paidOn.m[s.id] || 0, tot = s.sale_naira || 0; const cls = got >= tot - 0.5 ? 'bg-green-100 text-green-800' : got > 0 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'; return <button onClick={() => openRemit(s.id)} className={`px-2 py-0.5 rounded-full text-xs ${cls}`} title="Record money from the partner for this sale">{got >= tot - 0.5 ? 'paid' : got > 0 ? `${n0(got)} of ${n0(tot)}` : 'not yet'}</button>; })()}</td>
                <td className="px-4 py-2 text-right"><button onClick={() => remove(s)} className="p-1 text-gray-400 hover:text-red-600" title="Delete (to Recycle Bin) — stock goes back"><Trash2 className="w-4 h-4" /></button></td>
              </tr>); })}
            {mSales.length > 0 && <tr className="border-t-2 border-gray-900 font-semibold"><td className="px-4 py-2" colSpan={3}>Total {monthName(month)}</td><td className="px-4 py-2 text-right font-mono">{n2(mTot.qty)}</td><td></td><td className="px-4 py-2 text-right font-mono">{n2(mTot.sale)}</td><td></td><td className="px-4 py-2 text-right font-mono">{n2(mTot.cost)}</td><td className={`px-4 py-2 text-right font-mono ${mTot.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{n2(mTot.profit)}</td><td></td><td></td></tr>}
          </tbody>
        </table>
      </div>}

      {tab === 'money' && <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase"><th className="text-left px-4 py-2">{t('Date')}</th><th className="text-right px-4 py-2">{t('Amount ₦')}</th><th className="text-left px-4 py-2">{t('How')}</th><th className="text-right px-4 py-2">{t('We got')}</th><th className="text-left px-4 py-2">{t('For sale')}</th><th className="text-left px-4 py-2">Ref / note</th><th className="px-4 py-2"></th></tr></thead>
          <tbody>
            {remits.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Nothing received from the partner yet — press "Money from partner".</td></tr>}
            {remits.map((r) => { const sl = r.sale_id ? sales.find((x) => x.id === r.sale_id) : undefined; const it = sl ? itemOf(sl.item_id) : undefined; return (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="px-4 py-2 whitespace-nowrap">{showDate(r.rec_date)}</td><td className="px-4 py-2 text-right font-mono font-semibold">{n2(r.amount_ngn)}</td><td className="px-4 py-2">{r.method || ''}</td>
                <td className="px-4 py-2 text-right font-mono">{r.got_amount ? `${r.got_currency || ''} ${n2(r.got_amount)}` : ''}{r.got_amount && r.amount_ngn ? <span className="block text-[10px] text-gray-400">₦{n2(r.amount_ngn / r.got_amount)} per {r.got_currency}</span> : null}</td>
                <td className="px-4 py-2">{sl ? `${showDate(sl.entry_date)} ${it ? label(it) : ''} ₦${n0(sl.sale_naira || 0)}` : <span className="text-gray-400">oldest sales first</span>}</td>
                <td className="px-4 py-2 text-gray-600">{[r.reference, r.note].filter(Boolean).join(' · ')}</td>
                <td className="px-4 py-2 text-right"><button onClick={() => removeRemit(r)} className="p-1 text-gray-400 hover:text-red-600" title="Delete (to Recycle Bin)"><Trash2 className="w-4 h-4" /></button></td>
              </tr>); })}
            {remits.length > 0 && <tr className="border-t-2 border-gray-900 font-semibold"><td className="px-4 py-2">{t('Total received')}</td><td className="px-4 py-2 text-right font-mono">{n2(totRemit)}</td><td colSpan={5}></td></tr>}
          </tbody>
        </table>
      </div>}

      {rForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setRForm(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full max-w-lg p-5">
            <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">{t('Money received from the partner')}</h3><button onClick={() => setRForm(null)} className="p-1 text-gray-400"><X className="w-5 h-5" /></button></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500">{t('Date received')}</label><input type="date" className={input} value={rForm.rec_date} onChange={(e) => setRForm({ ...rForm, rec_date: e.target.value })} /></div>
              <div><label className="text-xs text-gray-500">{t('Amount (₦ of sales money)')}</label><input type="number" inputMode="decimal" className={input} value={rForm.amount} onChange={(e) => setRForm({ ...rForm, amount: e.target.value })} autoFocus /></div>
              <div><label className="text-xs text-gray-500">{t('How it came')}</label><select className={input} value={rForm.method} onChange={(e) => setRForm({ ...rForm, method: e.target.value })}>{['Bank', 'USDT', 'Cash', 'Agent', 'Other'].map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
              <div><label className="text-xs text-gray-500">What we got (optional)</label><div className="flex gap-2"><input type="number" inputMode="decimal" className={input} value={rForm.got_amount} onChange={(e) => setRForm({ ...rForm, got_amount: e.target.value })} placeholder="amount" /><select className={input + ' w-24'} value={rForm.got_currency} onChange={(e) => setRForm({ ...rForm, got_currency: e.target.value })}>{['LKR', 'USD', 'RMB'].map((c) => <option key={c} value={c}>{c}</option>)}</select></div></div>
              <div className="col-span-2"><label className="text-xs text-gray-500">{t('For which sale (optional — otherwise the oldest unpaid sales first)')}</label><select className={input} value={rForm.sale_id} onChange={(e) => { const sl = sales.find((x) => x.id === e.target.value); const open = sl ? Math.max(0, (sl.sale_naira || 0) - (paidOn.m[sl.id] || 0)) : 0; setRForm({ ...rForm, sale_id: e.target.value, amount: sl ? String(Math.round(open * 100) / 100) : rForm.amount }); }}><option value="">{t('Oldest unpaid sales first')}</option>{[...sales].sort((a, b) => a.entry_date.localeCompare(b.entry_date)).map((x) => { const it = itemOf(x.item_id); const open = (x.sale_naira || 0) - (paidOn.m[x.id] || 0); return <option key={x.id} value={x.id}>{showDate(x.entry_date)} {it ? label(it) : ''} — ₦{n0(x.sale_naira || 0)}{open > 0.5 ? ` (₦${n0(open)} open)` : ' (paid)'}</option>; })}</select></div>
              <div><label className="text-xs text-gray-500">{t('Reference')}</label><input className={input} value={rForm.reference} onChange={(e) => setRForm({ ...rForm, reference: e.target.value })} placeholder="transfer no." /></div>
              <div><label className="text-xs text-gray-500">{t('Note')}</label><input className={input} value={rForm.note} onChange={(e) => setRForm({ ...rForm, note: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-2 mt-4"><button onClick={() => setRForm(null)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">{t('Cancel')}</button><button onClick={saveRemit} disabled={saving} className="px-4 py-2 bg-[#e8552a] text-white rounded-lg text-sm font-medium disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button></div>
          </div>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setForm(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">{t('New sale')}</h3><button onClick={() => setForm(null)} className="p-1 text-gray-400"><X className="w-5 h-5" /></button></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="text-xs text-gray-500">{t('Item')}</label><select className={input} value={form.item_id} onChange={(e) => { const i = itemOf(e.target.value); setForm(calc({ ...form, item_id: e.target.value, price: i?.sell_naira ? String(i.sell_naira) : '' })); }}>{items.filter((i) => i.is_active).map((i) => <option key={i.id} value={i.id}>{label(i)} — {n2(onHand[i.id] || 0)} {i.unit} in stock</option>)}</select></div>
              <div><label className="text-xs text-gray-500">{t('Date')}</label><input type="date" className={input} value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} /></div>
              <div><label className="text-xs text-gray-500">{t('Customer (optional)')}</label><input className={input} value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} /></div>
              <div><label className="text-xs text-gray-500">Quantity ({fItem?.unit || 'pcs'})</label><input type="number" inputMode="decimal" className={input} value={form.qty} onChange={(e) => setForm(calc({ ...form, qty: e.target.value }))} autoFocus /></div>
              <div><label className="text-xs text-gray-500">Selling price (₦ per {fItem?.unit || 'pc'})</label><input type="number" inputMode="decimal" className={input} value={form.price} onChange={(e) => setForm(calc({ ...form, price: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-500">{t('Total sold (₦)')}</label><input type="number" inputMode="decimal" className={input} value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value, price: isFinite(fQty) && fQty > 0 && e.target.value ? String(Math.round((parseFloat(e.target.value) / fQty) * 100) / 100) : form.price })} /></div>
              <div><label className="text-xs text-gray-500">{t('Rate — Naira for 1 RMB')}</label><input type="number" inputMode="decimal" className={input} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></div>
              <div className="col-span-2 text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 space-y-0.5">
                {fl && fItem ? (() => { const r = isFinite(fRate) && fRate > 0 ? fRate : (defRate || 0); const china = (fl.cost - fl.perPiece) * r, dutyN = fl.perPiece * r, landedN = fl.cost * r; return (<>
                  <div className="flex justify-between"><span className="text-gray-600">Product cost (China) per {fItem.unit}</span><span className="font-mono">₦{n2(china)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">+ duty & clearing per {fItem.unit}{fl.ref ? ` (${fl.ref}${fl.kgPerUnit ? `, ${(fl.kgPerUnit * 1000).toFixed(0)} g × ₦${(fl.perKg * r).toFixed(0)}/kg` : ''})` : ''}</span><span className="font-mono">₦{n2(dutyN)}</span></div>
                  <div className="flex justify-between border-t border-gray-200 pt-0.5 font-semibold"><span>= cost per {fItem.unit}</span><span className="font-mono">₦{n2(landedN)} <span className="text-xs text-gray-500 font-normal">({fl.cost.toLocaleString('en-US', { maximumFractionDigits: 4 })} RMB)</span></span></div>
                  {isFinite(fCost) && <div className="flex justify-between pt-1"><span className="text-gray-600">Cost of this sale ({n2(fQty)} × ₦{n2(landedN)})</span><span className="font-mono">₦{n0(fCost)}</span></div>}
                  {isFinite(fCost) && isFinite(fTotal) && <div className="flex justify-between font-semibold"><span>Profit of this sale</span><span className={`font-mono ${fTotal - fCost >= 0 ? 'text-green-700' : 'text-red-600'}`}>₦{n0(fTotal - fCost)}{fTotal ? <span className="text-xs text-gray-500 font-normal"> ({(((fTotal - fCost) / fTotal) * 100).toFixed(0)}% of sale)</span> : null}</span></div>}
                  {fl.pending ? <p className="text-[11px] text-amber-700">Goods of {fl.ref} are still arriving — duty is added to the cost once the whole order is received.</p> : !fl.perPiece && <p className="text-[11px] text-amber-700">No duty or expenses are entered for this item's shipment yet — enter them in Expenses NG.</p>}
                </>); })() : 'Pick an item'}
              </div>
              <div className="col-span-2"><label className="text-xs text-gray-500">{t('Note')}</label><input className={input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setForm(null)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">{t('Cancel')}</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 bg-[#e8552a] text-white rounded-lg text-sm font-medium disabled:opacity-50">{saving ? 'Saving…' : 'Save sale'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
