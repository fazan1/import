import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Plus, X, RefreshCw, Trash2, Printer, PackageCheck, Building2, Pencil } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchAllPages } from '../lib/fetchAll';
import { moveToRecycleBin } from '../lib/recycleBin';
import { esc } from '../lib/html';
import { unitsPerTon } from './NigeriaStock';

/* NIGERIA — step 5A: Purchases NG. Own suppliers (ng_suppliers) and purchase orders / proformas (ng_purchases +
   ng_purchase_items, lines from Items NG, RMB). "Receive into stock" writes the lines as ng_stock IN rows with the order
   number as reference (once; received_at set). Payments to the supplier = step 5B (ng_payments). Separate from CN Portal. */

interface NgSupplier { id: string; name: string; contact: string | null; phone: string | null; note: string | null; is_active: boolean }
interface NgItem { id: string; name: string; specification: string | null; finish: string | null; unit: string; pcs_per_ton: number | null; cost_rmb: number; is_active: boolean }
interface NgPurchase { id: string; number: string; kind: 'po' | 'pi'; supplier_id: string | null; order_date: string; status: string; total_rmb: number; terms: string | null; note: string | null; received_at: string | null; created_at: string }
interface NgLine { id?: string; purchase_id?: string; item_id: string; quantity: number; tons: number | null; unit_price: number; amount_rmb: number; remark: string | null; sort_order: number }
interface NgPayment { purchase_id: string | null; supplier_id: string | null; amount_rmb: number }

const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500';
const n2 = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const n4 = (v: number) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const showDate = (d: string | null) => { if (!d) return '-'; const [y, m, day] = d.slice(0, 10).split('-'); return `${day}/${m}/${y}`; };
const label = (i: NgItem) => [i.name, i.specification, i.finish].filter(Boolean).join(' ');
const STATUS: Record<string, string> = { draft: 'bg-gray-100 text-gray-700', ordered: 'bg-amber-100 text-amber-800', paid: 'bg-teal-100 text-teal-800', received: 'bg-green-100 text-green-800', cancelled: 'bg-red-100 text-red-700' };

export default function NigeriaPurchases() {
  const [suppliers, setSuppliers] = useState<NgSupplier[]>([]);
  const [items, setItems] = useState<NgItem[]>([]);
  const [purchases, setPurchases] = useState<NgPurchase[]>([]);
  const [lines, setLines] = useState<NgLine[]>([]);
  const [payments, setPayments] = useState<NgPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [tab, setTab] = useState<'orders' | 'suppliers'>('orders');
  const [supForm, setSupForm] = useState<Partial<NgSupplier> | null>(null);
  const [edit, setEdit] = useState<{ p: Partial<NgPurchase>; lines: { item_id: string; tons: string; qty: string; price: string; remark: string }[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  async function load() {
    setLoading(true);
    const [su, it, pu, li, pa] = await Promise.all([
      fetchAllPages<NgSupplier>(() => supabase.from('ng_suppliers').select('*').order('name')),
      fetchAllPages<NgItem>(() => supabase.from('ng_items').select('id, name, specification, finish, unit, pcs_per_ton, cost_rmb, is_active').order('name').order('finish').order('specification')),
      fetchAllPages<NgPurchase>(() => supabase.from('ng_purchases').select('*').order('order_date', { ascending: false }).order('number', { ascending: false })),
      fetchAllPages<NgLine>(() => supabase.from('ng_purchase_items').select('*').order('sort_order')),
      fetchAllPages<NgPayment>(() => supabase.from('ng_payments').select('purchase_id, supplier_id, amount_rmb')),
    ]);
    if (su.error) { if (/ng_suppliers|does not exist|schema cache/i.test(su.error)) setSetupNeeded(true); else alert('Could not load: ' + su.error); } else setSetupNeeded(false);
    setSuppliers(su.data || []);
    setItems((it.data || []).map((r) => ({ ...r, cost_rmb: Number(r.cost_rmb) || 0, pcs_per_ton: r.pcs_per_ton == null ? null : Number(r.pcs_per_ton) })));
    setPurchases((pu.data || []).map((p) => ({ ...p, total_rmb: Number(p.total_rmb) || 0 })));
    setLines((li.data || []).map((l) => ({ ...l, quantity: Number(l.quantity) || 0, tons: l.tons == null ? null : Number(l.tons), unit_price: Number(l.unit_price) || 0, amount_rmb: Number(l.amount_rmb) || 0 })));
    setPayments((pa.data || []).map((x) => ({ ...x, amount_rmb: Number(x.amount_rmb) || 0 })));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const itemOf = (id: string) => items.find((i) => i.id === id);
  const supOf = (id: string | null) => suppliers.find((s) => s.id === id);
  const paidOf = (p: NgPurchase) => payments.filter((x) => x.purchase_id === p.id).reduce((t, x) => t + x.amount_rmb, 0);
  const nextNumber = useMemo(() => { const n = purchases.reduce((m, p) => { const k = parseInt((p.number.match(/(\d+)$/) || ['', '0'])[1], 10); return isNaN(k) ? m : Math.max(m, k); }, 0); return `NG-PO-${String(n + 1).padStart(3, '0')}`; }, [purchases]);

  /* ---- suppliers ---- */
  async function saveSupplier() {
    if (!supForm || savingRef.current) return;
    const name = (supForm.name || '').trim(); if (!name) { alert('Type the supplier name.'); return; }
    savingRef.current = true; setSaving(true);
    const row = { name, contact: (supForm.contact || '').trim() || null, phone: (supForm.phone || '').trim() || null, note: (supForm.note || '').trim() || null, is_active: supForm.is_active !== false };
    const { error } = supForm.id ? await supabase.from('ng_suppliers').update(row).eq('id', supForm.id) : await supabase.from('ng_suppliers').insert(row);
    savingRef.current = false; setSaving(false);
    if (error) { alert('Could not save: ' + error.message); return; }
    setSupForm(null); load();
  }

  /* ---- orders ---- */
  function newOrder() { setEdit({ p: { number: nextNumber, kind: 'pi', supplier_id: suppliers[0]?.id || null, order_date: today(), status: 'ordered', terms: '', note: '' }, lines: [{ item_id: items.find((i) => i.is_active)?.id || '', tons: '', qty: '', price: '', remark: '' }] }); }
  function openOrder(p: NgPurchase) { setEdit({ p: { ...p }, lines: lines.filter((l) => l.purchase_id === p.id).map((l) => ({ item_id: l.item_id, tons: l.tons != null ? String(l.tons) : '', qty: String(l.quantity), price: String(l.unit_price), remark: l.remark || '' })) }); }
  const setLine = (k: number, patch: Partial<{ item_id: string; tons: string; qty: string; price: string; remark: string }>) => { if (!edit) return; const L = edit.lines.map((l, i) => (i === k ? { ...l, ...patch } : l)); setEdit({ ...edit, lines: L }); };
  function lineTons(k: number, t: string) { if (!edit) return; const l = edit.lines[k]; const it = itemOf(l.item_id); const q = parseFloat(t); const upt = it ? unitsPerTon(it) : 0; setLine(k, { tons: t, qty: isFinite(q) && upt ? String(Math.round(q * upt)) : l.qty, price: l.price || (it ? String(it.cost_rmb) : '') }); }
  function lineItem(k: number, id: string) { const it = itemOf(id); setLine(k, { item_id: id, price: it ? String(it.cost_rmb) : '' }); }
  const amountOf = (l: { qty: string; price: string }) => (parseFloat(l.qty) || 0) * (parseFloat(l.price) || 0);
  const editTotal = edit ? edit.lines.reduce((t, l) => t + amountOf(l), 0) : 0;
  const editTons = edit ? edit.lines.reduce((t, l) => t + (parseFloat(l.tons) || 0), 0) : 0;

  async function saveOrder() {
    if (!edit || savingRef.current) return;
    const p = edit.p; const number = (p.number || '').trim(); if (!number) { alert('Type the order number.'); return; }
    const good = edit.lines.filter((l) => l.item_id && parseFloat(l.qty) > 0);
    if (!good.length) { alert('Add at least one line with a quantity.'); return; }
    if (good.some((l) => !(parseFloat(l.price) >= 0))) { alert('Every line needs a price.'); return; }
    savingRef.current = true; setSaving(true);
    const head = { number, kind: p.kind || 'pi', supplier_id: p.supplier_id || null, order_date: p.order_date || today(), status: p.status || 'ordered', total_rmb: Math.round(good.reduce((t, l) => t + amountOf(l), 0) * 100) / 100, terms: (p.terms || '').trim() || null, note: (p.note || '').trim() || null, updated_at: new Date().toISOString() };
    let id = p.id;
    if (id) { const { error } = await supabase.from('ng_purchases').update(head).eq('id', id); if (error) { savingRef.current = false; setSaving(false); alert('Could not save: ' + error.message); return; } }
    else { const { data, error } = await supabase.from('ng_purchases').insert(head).select('id').single(); if (error || !data) { savingRef.current = false; setSaving(false); alert('Could not save: ' + (error?.message || '')); return; } id = data.id; }
    const rows = good.map((l, k) => ({ purchase_id: id, item_id: l.item_id, quantity: parseFloat(l.qty), tons: parseFloat(l.tons) || null, unit_price: parseFloat(l.price), amount_rmb: Math.round(amountOf(l) * 100) / 100, remark: l.remark.trim() || null, sort_order: k }));
    const old = lines.filter((l) => l.purchase_id === id);
    const del = await supabase.from('ng_purchase_items').delete().eq('purchase_id', id);
    if (del.error) { savingRef.current = false; setSaving(false); alert('Could not replace the lines: ' + del.error.message); return; }
    const ins = await supabase.from('ng_purchase_items').insert(rows);
    if (ins.error) { if (old.length) await supabase.from('ng_purchase_items').insert(old.map((l) => ({ purchase_id: id, item_id: l.item_id, quantity: l.quantity, tons: l.tons, unit_price: l.unit_price, amount_rmb: l.amount_rmb, remark: l.remark, sort_order: l.sort_order }))); savingRef.current = false; setSaving(false); alert('Could not save the lines: ' + ins.error.message); return; }
    savingRef.current = false; setSaving(false);
    setEdit(null); load();
  }
  async function setStatus(p: NgPurchase, status: string) {
    const { error } = await supabase.from('ng_purchases').update({ status, updated_at: new Date().toISOString() }).eq('id', p.id);
    if (error) alert('Could not save: ' + error.message); else load();
  }
  async function receive(p: NgPurchase) {
    if (p.received_at) { alert(`${p.number} was already received into stock on ${showDate(p.received_at)}.`); return; }
    const ls = lines.filter((l) => l.purchase_id === p.id); if (!ls.length) { alert('This order has no lines.'); return; }
    const d = prompt(`Receive ${p.number} into Stock NG — ${ls.length} lines, ${n2(ls.reduce((t, l) => t + l.quantity, 0))} pcs, ${n2(p.total_rmb)} RMB.\n\nDate the goods arrived in Nigeria (YYYY-MM-DD):`, today());
    if (!d) return; if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { alert('Type the date as YYYY-MM-DD.'); return; }
    const rows = ls.map((l) => ({ item_id: l.item_id, kind: 'in', entry_date: d, quantity: l.quantity, cost_rmb: l.amount_rmb, reference: p.number, note: `${p.kind.toUpperCase()} ${p.number}${l.tons ? ` — ${l.tons} ton` : ''}` }));
    const { error } = await supabase.from('ng_stock').insert(rows);
    if (error) { alert('Could not put the goods into stock: ' + error.message); return; }
    await supabase.from('ng_purchases').update({ received_at: d, status: 'received', updated_at: new Date().toISOString() }).eq('id', p.id);
    alert(`${p.number} is in Stock NG (reference ${p.number}). Put its duty and freight into Expenses NG with the same reference.`);
    load();
  }
  async function removeOrder(p: NgPurchase) {
    if (p.received_at) { alert('This order is already in stock — cancel it instead (status), or delete the stock entries in Stock NG first.'); return; }
    if (!confirm(`Delete ${p.number} (${n2(p.total_rmb)} RMB)?`)) return;
    const res = await moveToRecycleBin({ source_table: 'ng_purchases', source_id: p.id, record_data: { ...p, lines: lines.filter((l) => l.purchase_id === p.id) } as unknown as Record<string, unknown>, display_name: `NG purchase ${p.number} ${n2(p.total_rmb)} RMB`, portal: 'cn' });
    if (!res.success) { alert('Could not move it to the Recycle Bin: ' + (res.error || '')); return; }
    const { error } = await supabase.from('ng_purchases').delete().eq('id', p.id);
    if (error) alert('Could not delete: ' + error.message);
    load();
  }
  function printOrder(p: NgPurchase) {
    const w = window.open('', '_blank', 'width=860,height=900'); if (!w) { alert('Allow pop-ups to print.'); return; }
    const s = supOf(p.supplier_id); const ls = lines.filter((l) => l.purchase_id === p.id);
    const rows = ls.map((l, k) => { const it = itemOf(l.item_id); return `<tr><td>${k + 1}</td><td>${esc(it ? it.name : '')}</td><td>${esc(it?.specification || '')}</td><td>${esc(it?.finish || '')}</td><td class="r">${l.tons ? n2(l.tons) : ''}</td><td class="r">${n2(l.quantity)}</td><td class="r">${n4(l.unit_price)}</td><td class="r">${n2(l.amount_rmb)}</td><td>${esc(l.remark || '')}</td></tr>`; }).join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"><title>${esc(p.number)}</title><style>
      body{font-family:'IBM Plex Sans',Arial,sans-serif;color:#111;margin:0;padding:28px;font-size:13px}h1{font-size:22px;margin:0;letter-spacing:1px}.sub{color:#555;font-size:12px}
      .head{display:flex;justify-content:space-between;margin:18px 0 14px;border-bottom:2px solid #111;padding-bottom:12px}.lab{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#777}
      table{width:100%;border-collapse:collapse;font-size:12px}th{background:#111;color:#fff;text-align:left;padding:7px;font-weight:600;font-size:11px}td{padding:7px;border-bottom:1px solid #e5e5e5;vertical-align:top}.r,th.r{text-align:right;font-family:'IBM Plex Mono',monospace}
      tr.tot td{font-weight:700;border-top:2px solid #111;border-bottom:0}.box{margin-top:18px;border:1px solid #ccc;border-radius:8px;padding:10px 14px;font-size:12px}.foot{margin-top:28px;font-size:11px;color:#777;display:flex;justify-content:space-between}@media print{body{padding:0}}</style></head><body>
      <h1>${p.kind === 'pi' ? 'PROFORMA INVOICE' : 'PURCHASE ORDER'}</h1><div class="sub">NG — Nigeria business · ${esc(p.number)} · Currency RMB (CNY)</div>
      <div class="head"><div><div class="lab">Supplier</div><div style="font-size:15px;font-weight:700">${esc(s?.name || '-')}</div><div class="sub">${esc([s?.contact, s?.phone].filter(Boolean).join(' · '))}</div></div><div style="text-align:right"><div class="lab">Order details</div><div>Date: ${showDate(p.order_date)}</div><div>Status: ${esc(p.status)}</div></div></div>
      <table><thead><tr><th>#</th><th>Product</th><th>Specification</th><th>Finish</th><th class="r">Tons</th><th class="r">Qty (pcs)</th><th class="r">Unit price (RMB)</th><th class="r">Amount (RMB)</th><th>Remark</th></tr></thead>
      <tbody>${rows}<tr class="tot"><td colspan="4">Total</td><td class="r">${ls.some((l) => l.tons) ? n2(ls.reduce((t, l) => t + (l.tons || 0), 0)) : ''}</td><td class="r">${n2(ls.reduce((t, l) => t + l.quantity, 0))}</td><td></td><td class="r">${n2(p.total_rmb)}</td><td></td></tr></tbody></table>
      ${p.terms ? `<div class="box">${esc(p.terms)}</div>` : ''}${p.note ? `<div class="box">${esc(p.note)}</div>` : ''}
      <div class="foot"><div>Generated ${new Date().toLocaleDateString('en-GB')}</div><div>Total Chinese RMB only</div></div>
      <script>window.onload=function(){setTimeout(function(){window.print();},300);}</script></body></html>`);
    w.document.close();
  }

  if (loading) return <div className="p-8 text-center text-gray-500">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FileText className="w-6 h-6 text-[#e8552a]" /> Nigeria — Purchases NG</h1>
          <p className="text-sm text-gray-500">Orders and proformas to the Chinese suppliers, in RMB, from Items NG. "Receive" puts an order into Stock NG in one press.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50"><RefreshCw className="w-4 h-4" /> Refresh</button>
          <button onClick={() => setSupForm({ name: '', contact: '', phone: '', note: '', is_active: true })} disabled={setupNeeded} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40"><Building2 className="w-4 h-4" /> New supplier</button>
          <button onClick={newOrder} disabled={setupNeeded || !items.length} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#e8552a] rounded-lg hover:opacity-90 disabled:opacity-40"><Plus className="w-4 h-4" /> New order / PI</button>
        </div>
      </div>

      {setupNeeded && <div className="p-4 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-900">One-time setup needed: run <b>nigeria-purchases.sql</b> in Supabase (MAIN project), then Refresh.</div>}
      {!setupNeeded && suppliers.length === 0 && <div className="p-4 rounded-lg border border-gray-200 bg-white text-sm text-gray-600">Start with "New supplier" — the Chinese factory you buy from.</div>}

      <div className="flex gap-2">
        <button onClick={() => setTab('orders')} className={`px-3 py-1.5 rounded-full text-sm border ${tab === 'orders' ? 'bg-[#111] text-white border-[#111]' : 'bg-white border-gray-300 text-gray-700'}`}>Orders ({purchases.length})</button>
        <button onClick={() => setTab('suppliers')} className={`px-3 py-1.5 rounded-full text-sm border ${tab === 'suppliers' ? 'bg-[#111] text-white border-[#111]' : 'bg-white border-gray-300 text-gray-700'}`}>Suppliers NG ({suppliers.length})</button>
      </div>

      {tab === 'orders' && (
        <div className="space-y-3">
          {purchases.length === 0 && <div className="p-8 text-center text-gray-500 bg-white rounded-xl border border-gray-200">No orders yet.</div>}
          {purchases.map((p) => { const ls = lines.filter((l) => l.purchase_id === p.id); const paid = paidOf(p); return (
            <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-gray-900">{p.number} <span className="text-xs font-normal text-gray-500 uppercase">{p.kind}</span> — {supOf(p.supplier_id)?.name || '-'}</div>
                  <div className="text-xs text-gray-500">{showDate(p.order_date)} · {ls.length} lines · {n2(ls.reduce((t, l) => t + l.quantity, 0))} pcs{ls.some((l) => l.tons) ? ` · ${n2(ls.reduce((t, l) => t + (l.tons || 0), 0))} tons` : ''}{p.received_at ? ` · in stock ${showDate(p.received_at)}` : ''}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold font-mono">{n2(p.total_rmb)} <span className="text-xs text-gray-500">RMB</span></div>
                  <div className="text-xs text-gray-500">paid {n2(paid)} · to pay <b className={p.total_rmb - paid > 0.5 ? 'text-amber-700' : 'text-green-700'}>{n2(Math.max(0, p.total_rmb - paid))}</b></div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={p.status} onChange={(e) => setStatus(p, e.target.value)} className={`px-2 py-1 rounded-full text-xs border-0 ${STATUS[p.status] || ''}`}>{['draft', 'ordered', 'paid', 'received', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
                <button onClick={() => openOrder(p)} className="flex items-center gap-1 px-2.5 py-1 text-xs border border-gray-300 rounded-lg bg-white hover:bg-gray-50"><Pencil className="w-3.5 h-3.5" /> Edit</button>
                <button onClick={() => printOrder(p)} className="flex items-center gap-1 px-2.5 py-1 text-xs border border-gray-300 rounded-lg bg-white hover:bg-gray-50"><Printer className="w-3.5 h-3.5" /> Print</button>
                <button onClick={() => receive(p)} disabled={!!p.received_at || p.status === 'cancelled'} className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-[#111] rounded-lg hover:opacity-90 disabled:opacity-40"><PackageCheck className="w-3.5 h-3.5" /> {p.received_at ? 'Received' : 'Receive into stock'}</button>
                <button onClick={() => removeOrder(p)} className="ml-auto p-1 text-gray-400 hover:text-red-600" title="Delete (to Recycle Bin)"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>); })}
        </div>
      )}

      {tab === 'suppliers' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase"><th className="text-left px-4 py-2">Supplier</th><th className="text-left px-4 py-2">Contact</th><th className="text-left px-4 py-2">Phone</th><th className="text-right px-4 py-2">Ordered (RMB)</th><th className="text-right px-4 py-2">Paid</th><th className="text-right px-4 py-2">To pay</th><th className="px-4 py-2"></th></tr></thead>
            <tbody>
              {suppliers.map((s) => { const ord = purchases.filter((p) => p.supplier_id === s.id && p.status !== 'cancelled' && p.status !== 'draft').reduce((t, p) => t + p.total_rmb, 0); const paid = payments.filter((x) => x.supplier_id === s.id).reduce((t, x) => t + x.amount_rmb, 0); return (
                <tr key={s.id} className={`border-t border-gray-100 ${s.is_active ? '' : 'opacity-50'}`}>
                  <td className="px-4 py-2 font-medium">{s.name}{s.note ? <span className="block text-xs text-gray-400">{s.note}</span> : null}</td><td className="px-4 py-2">{s.contact || ''}</td><td className="px-4 py-2">{s.phone || ''}</td>
                  <td className="px-4 py-2 text-right font-mono">{n2(ord)}</td><td className="px-4 py-2 text-right font-mono">{n2(paid)}</td><td className={`px-4 py-2 text-right font-mono font-semibold ${ord - paid > 0.5 ? 'text-amber-700' : 'text-green-700'}`}>{n2(Math.max(0, ord - paid))}</td>
                  <td className="px-4 py-2 text-right"><button onClick={() => setSupForm({ ...s })} className="p-1 text-gray-400 hover:text-gray-800" title="Edit"><Pencil className="w-4 h-4" /></button></td>
                </tr>); })}
            </tbody>
          </table>
        </div>
      )}

      {supForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setSupForm(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">{supForm.id ? 'Edit supplier' : 'New supplier NG'}</h3><button onClick={() => setSupForm(null)} className="p-1 text-gray-400"><X className="w-5 h-5" /></button></div>
            <div className="space-y-3">
              <div><label className="text-xs text-gray-500">Name</label><input className={input} value={supForm.name || ''} onChange={(e) => setSupForm({ ...supForm, name: e.target.value })} placeholder="Anchor Bolt" autoFocus /></div>
              <div className="grid grid-cols-2 gap-3"><div><label className="text-xs text-gray-500">Contact person</label><input className={input} value={supForm.contact || ''} onChange={(e) => setSupForm({ ...supForm, contact: e.target.value })} /></div><div><label className="text-xs text-gray-500">Phone / WeChat</label><input className={input} value={supForm.phone || ''} onChange={(e) => setSupForm({ ...supForm, phone: e.target.value })} /></div></div>
              <div><label className="text-xs text-gray-500">Note</label><input className={input} value={supForm.note || ''} onChange={(e) => setSupForm({ ...supForm, note: e.target.value })} placeholder="Deliver to Guangzhou warehouse" /></div>
              {supForm.id && <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={supForm.is_active !== false} onChange={(e) => setSupForm({ ...supForm, is_active: e.target.checked })} /> Active</label>}
            </div>
            <div className="flex justify-end gap-2 mt-4"><button onClick={() => setSupForm(null)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button><button onClick={saveSupplier} disabled={saving} className="px-4 py-2 bg-[#e8552a] text-white rounded-lg text-sm font-medium disabled:opacity-50">Save</button></div>
          </div>
        </div>
      )}

      {edit && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setEdit(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full max-w-4xl max-h-[92vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">{edit.p.id ? `Edit ${edit.p.number}` : 'New order / proforma'}</h3><button onClick={() => setEdit(null)} className="p-1 text-gray-400"><X className="w-5 h-5" /></button></div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <div><label className="text-xs text-gray-500">Number</label><input className={input} value={edit.p.number || ''} onChange={(e) => setEdit({ ...edit, p: { ...edit.p, number: e.target.value } })} /></div>
              <div><label className="text-xs text-gray-500">Type</label><select className={input} value={edit.p.kind || 'pi'} onChange={(e) => setEdit({ ...edit, p: { ...edit.p, kind: e.target.value as 'po' | 'pi' } })}><option value="pi">Proforma invoice (PI)</option><option value="po">Purchase order (PO)</option></select></div>
              <div><label className="text-xs text-gray-500">Supplier</label><select className={input} value={edit.p.supplier_id || ''} onChange={(e) => setEdit({ ...edit, p: { ...edit.p, supplier_id: e.target.value || null } })}><option value="">—</option>{suppliers.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label className="text-xs text-gray-500">Date</label><input type="date" className={input} value={edit.p.order_date || ''} onChange={(e) => setEdit({ ...edit, p: { ...edit.p, order_date: e.target.value } })} /></div>
            </div>
            <div className="overflow-x-auto"><table className="w-full text-sm min-w-[720px]">
              <thead><tr className="text-xs text-gray-500 uppercase"><th className="text-left py-1">Item (Items NG)</th><th className="text-right py-1 w-20">Tons</th><th className="text-right py-1 w-28">Qty (pcs)</th><th className="text-right py-1 w-28">RMB / pc</th><th className="text-right py-1 w-28">Amount</th><th className="text-left py-1 w-28">Remark</th><th className="w-8"></th></tr></thead>
              <tbody>
                {edit.lines.map((l, k) => { const it = itemOf(l.item_id); return (
                  <tr key={k} className="border-t border-gray-100">
                    <td className="py-1 pr-2"><select className={input} value={l.item_id} onChange={(e) => lineItem(k, e.target.value)}>{items.filter((i) => i.is_active || i.id === l.item_id).map((i) => <option key={i.id} value={i.id}>{label(i)}</option>)}</select></td>
                    <td className="py-1 pr-2"><input type="number" inputMode="decimal" className={input + ' text-right'} value={l.tons} onChange={(e) => lineTons(k, e.target.value)} disabled={!it || !unitsPerTon(it)} /></td>
                    <td className="py-1 pr-2"><input type="number" inputMode="decimal" className={input + ' text-right'} value={l.qty} onChange={(e) => setLine(k, { qty: e.target.value, tons: '' })} /></td>
                    <td className="py-1 pr-2"><input type="number" inputMode="decimal" step="0.0001" className={input + ' text-right'} value={l.price} onChange={(e) => setLine(k, { price: e.target.value })} /></td>
                    <td className="py-1 pr-2 text-right font-mono">{n2(amountOf(l))}</td>
                    <td className="py-1 pr-2"><input className={input} value={l.remark} onChange={(e) => setLine(k, { remark: e.target.value })} placeholder="ZP" /></td>
                    <td className="py-1"><button onClick={() => setEdit({ ...edit, lines: edit.lines.filter((_, i) => i !== k) })} className="p-1 text-gray-400 hover:text-red-600"><X className="w-4 h-4" /></button></td>
                  </tr>); })}
              </tbody>
              <tfoot><tr className="border-t-2 border-gray-900 font-semibold"><td className="py-2">Total</td><td className="py-2 text-right font-mono">{editTons ? n2(editTons) : ''}</td><td className="py-2 text-right font-mono">{n2(edit.lines.reduce((t, l) => t + (parseFloat(l.qty) || 0), 0))}</td><td></td><td className="py-2 text-right font-mono">{n2(editTotal)} RMB</td><td colSpan={2}></td></tr></tfoot>
            </table></div>
            <button onClick={() => setEdit({ ...edit, lines: [...edit.lines, { item_id: items.find((i) => i.is_active)?.id || '', tons: '', qty: '', price: '', remark: '' }] })} className="mt-2 px-3 py-1.5 text-xs border border-gray-300 rounded-lg bg-white hover:bg-gray-50">+ Add line</button>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <div><label className="text-xs text-gray-500">Terms (packing, price term, delivery)</label><input className={input} value={edit.p.terms || ''} onChange={(e) => setEdit({ ...edit, p: { ...edit.p, terms: e.target.value } })} placeholder="25 kg 2-layer PP woven bag · Deliver to Guangzhou warehouse" /></div>
              <div><label className="text-xs text-gray-500">Note</label><input className={input} value={edit.p.note || ''} onChange={(e) => setEdit({ ...edit, p: { ...edit.p, note: e.target.value } })} /></div>
            </div>
            <div className="flex justify-end gap-2 mt-4"><button onClick={() => setEdit(null)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button><button onClick={saveOrder} disabled={saving} className="px-4 py-2 bg-[#e8552a] text-white rounded-lg text-sm font-medium disabled:opacity-50">{saving ? 'Saving…' : 'Save order'}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
