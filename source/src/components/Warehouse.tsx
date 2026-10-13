import React, { useEffect, useMemo, useState } from 'react';
import { Warehouse as WarehouseIcon, Plus, Printer, Trash2, Search, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, SlidersHorizontal, X, MapPin, Package, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Kind = 'in' | 'issue' | 'transfer' | 'adjust';
interface Location { id: string; name: string; is_active: boolean; }
interface Product { id: string; name: string; unit: string; min_qty: number; is_active: boolean; sell_price?: number | null; master_item_id?: string | null; avg_cost?: number | null; last_cost?: number | null; }
interface MasterItem { id: string; item_name: string; sku: string | null; unit: string; is_active?: boolean; sales_price?: number | null; }
interface Note { id: string; note_no: string; kind: Kind; note_date: string; from_location_id: string | null; to_location_id: string | null; issued_to: string | null; remarks: string | null; created_at: string; sales_invoice_id?: string | null; }
interface Line { id: string; note_id: string; product_id: string; qty: number; remark: string | null; line_no: number; }
interface Stock { product_id: string; location_id: string; qty: number; }
interface DraftLine { product_id: string; qty: string; remark: string; cost: string; }
type Quick = { mode: 'in' | 'issue' | 'set'; product: Product } | { mode: 'new'; name: string; unit?: string; masterId?: string; sellPrice?: number };

const KIND: Record<Kind, { label: string; verb: string; color: string; icon: typeof Plus }> = {
  in: { label: 'Stock In', verb: 'Received', color: 'bg-green-100 text-green-800', icon: ArrowDownToLine },
  issue: { label: 'Issue Note', verb: 'Issued', color: 'bg-red-100 text-red-800', icon: ArrowUpFromLine },
  transfer: { label: 'Transfer', verb: 'Transferred', color: 'bg-teal-100 text-teal-800', icon: ArrowLeftRight },
  adjust: { label: 'Adjustment', verb: 'Adjusted', color: 'bg-amber-100 text-amber-800', icon: SlidersHorizontal },
};
const COMPANY = { name: 'BLINE Traders (Pvt) Ltd', address: 'No. 73, Quarry Road, Colombo 12', phone: '077 717 7344 / 074 343 4772' };

const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm';
const fmtQ = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const fmtD = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export default function Warehouse() {
  const [tab, setTab] = useState<'stock' | 'notes' | 'products' | 'locations'>('stock');
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [master, setMaster] = useState<MasterItem[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [search, setSearch] = useState('');
  const [locFilter, setLocFilter] = useState<string>('all');
  const [newKind, setNewKind] = useState<Kind | null>(null);
  const [viewNote, setViewNote] = useState<Note | null>(null);
  const [movProduct, setMovProduct] = useState<Product | null>(null);
  const [quick, setQuick] = useState<Quick | null>(null);
  const [stockFilter, setStockFilter] = useState<'all' | 'in' | 'empty'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);
  async function load() {
    const [l, p, n, ln, s, mi] = await Promise.all([
      supabase.from('wh_locations').select('*').order('name'),
      supabase.from('wh_products').select('*').order('name'),
      supabase.from('wh_notes').select('*').order('note_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('wh_note_lines').select('*').order('line_no'),
      supabase.from('wh_stock').select('*'),
      supabase.from('items').select('id, item_name, sku, unit, is_active, sales_price').order('item_name'),
    ]);
    if (l.error || p.error || n.error) { alert('Warehouse tables not found — run warehouse-setup.sql in Supabase first.\n' + (l.error?.message ?? p.error?.message ?? n.error?.message)); setLoading(false); return; }
    setLocations(l.data ?? []); setProducts(p.data ?? []); setNotes((n.data ?? []) as Note[]); setLines((ln.data ?? []) as Line[]);
    setStock(((s.data ?? []) as Stock[]).map((x) => ({ ...x, qty: Number(x.qty) })));
    setMaster(((mi.data ?? []) as MasterItem[]).filter((m) => m.is_active !== false));
    setLoading(false);
  }

  const locName = (id: string | null) => locations.find((l) => l.id === id)?.name ?? '—';
  const prod = (id: string) => products.find((p) => p.id === id);
  const activeLocs = locations.filter((l) => l.is_active);
  const qtyAt = (pid: string, lid: string) => stock.find((s) => s.product_id === pid && s.location_id === lid)?.qty ?? 0;
  const total = (pid: string) => stock.filter((s) => s.product_id === pid && (locFilter === 'all' || s.location_id === locFilter)).reduce((t, s) => t + s.qty, 0);

  const q = search.trim().toLowerCase();
  const visibleProducts = products.filter((p) => p.is_active && (!q || p.name.toLowerCase().includes(q)));
  const lowCount = products.filter((p) => p.is_active && p.min_qty > 0 && total(p.id) < p.min_qty).length;

  function printPriceList() {
    const rows = products.filter((p) => p.is_active && (p.sell_price ?? 0) > 0 && total(p.id) > 0).sort((a, b) => a.name.localeCompare(b.name));
    if (!rows.length) { alert('No products in stock with a selling price yet. Add prices in Setup → Products.'); return; }
    const w = window.open('', '_blank'); if (!w) return;
    w.document.write(`<html><head><title>Price list</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px;color:#111}h1{font-size:18px;margin:0}h2{font-size:12px;color:#555;margin:2px 0 12px;font-weight:normal}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f3f4f6;font-size:11px;text-transform:uppercase}.r{text-align:right}.foot{font-size:10px;color:#666;margin-top:12px}</style></head><body>
      <h1>BLINE Traders (Pvt) Ltd — Price list</h1><h2>No. 73, Quarry Road, Colombo 12 · 0777 177 344 / 074 343 4772 · ${new Date().toLocaleDateString('en-GB')}</h2>
      <table><thead><tr><th>#</th><th>Item</th><th>Unit</th><th class="r">Price (Rs)</th><th class="r">In stock</th></tr></thead><tbody>
      ${rows.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${esc(p.unit || "")}</td><td class="r"><b>${fmtQ(p.sell_price ?? 0)}</b></td><td class="r">${fmtQ(total(p.id))}</td></tr>`).join('')}
      </tbody></table><p class="foot">Prices exclude delivery and may change without notice. Stock as at time of printing.</p>
      <script>window.print()</script></body></html>`);
    w.document.close();
  }

  async function importAllMaster() {
    if (!masterNotAdded.length) return;
    if (!confirm(`Add ${masterNotAdded.length} master items to the warehouse (with zero stock)?`)) return;
    const { error } = await supabase.from('wh_products').insert(masterNotAdded.map((m) => ({ name: m.item_name, unit: m.unit || 'PCS', master_item_id: m.id, sell_price: m.sales_price || 0 })));
    if (error) alert(error.message); else load();
  }

  // ---------- notes ----------
  async function deleteNote(n: Note) {
    if (!confirm(`Delete ${n.note_no}? Stock will be corrected back.`)) return;
    const { error } = await supabase.from('wh_notes').delete().eq('id', n.id);
    if (error) alert(error.message); else { setViewNote(null); load(); }
  }

  function printNote(n: Note) {
    const ls = lines.filter((l) => l.note_id === n.id);
    const k = KIND[n.kind];
    const rows = ls.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(prod(l.product_id)?.name ?? '')}</td><td class="r">${fmtQ(Number(l.qty))}</td><td>${esc(prod(l.product_id)?.unit ?? '')}</td><td>${esc(l.remark ?? '')}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${n.note_no}</title><style>
      body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;margin:24px}
      h1{font-size:22px;margin:0}.muted{color:#555}.hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}
      .box{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin-bottom:14px}.box b{display:inline-block;width:110px;color:#555;font-weight:normal}
      table{width:100%;border-collapse:collapse;margin-top:6px}th,td{border:1px solid #999;padding:6px 8px;text-align:left}th{background:#eee}.r{text-align:right}
      .sig{display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px;margin-top:60px}.sig div{border-top:1px solid #111;padding-top:6px;text-align:center;font-size:12px}
      @media print{body{margin:12mm}}
    </style></head><body>
      <div class="hdr"><div><h1>${esc(COMPANY.name)}</h1><div class="muted">${esc(COMPANY.address)} · ${esc(COMPANY.phone)}</div></div>
      <div style="text-align:right"><div style="font-size:18px;font-weight:bold">${k.label.toUpperCase()}</div><div style="font-size:16px">${n.note_no}</div><div class="muted">${fmtD(n.note_date)}</div></div></div>
      <div class="box">
        ${n.kind === 'in' ? `<div><b>Into</b>${esc(locName(n.to_location_id))}</div>` : ''}
        ${n.kind === 'issue' ? `<div><b>From</b>${esc(locName(n.from_location_id))}</div><div><b>Issued to</b>${esc(n.issued_to ?? '')}</div>` : ''}
        ${n.kind === 'transfer' ? `<div><b>From</b>${esc(locName(n.from_location_id))}</div><div><b>To</b>${esc(locName(n.to_location_id))}</div>` : ''}
        ${n.kind === 'adjust' ? `<div><b>Location</b>${esc(locName(n.from_location_id))}</div>` : ''}
        ${n.remarks ? `<div style="grid-column:1/-1"><b>Remarks</b>${esc(n.remarks)}</div>` : ''}
      </div>
      <table><thead><tr><th style="width:36px">#</th><th>Item</th><th class="r" style="width:90px">Qty</th><th style="width:60px">Unit</th><th>Remark</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><th></th><th>Total items: ${ls.length}</th><th class="r">${fmtQ(ls.reduce((t, l) => t + Number(l.qty), 0))}</th><th></th><th></th></tr></tfoot></table>
      <div class="sig"><div>Prepared by</div><div>Store keeper</div><div>Received by (name, sign, date)</div></div>
      <script>window.onload=function(){window.print()}</script></body></html>`;
    const w = window.open('', '_blank'); if (!w) { alert('Allow pop-ups to print'); return; }
    w.document.write(html); w.document.close();
  }

  if (loading) return <div className="p-6 text-gray-500">Loading…</div>;

  const inWh = new Set(products.map((p) => p.name.toLowerCase()));
  const masterHits = q ? master.filter((m) => !inWh.has(m.item_name.toLowerCase()) && (m.item_name.toLowerCase().includes(q) || (m.sku ?? '').toLowerCase().includes(q))).slice(0, 8) : [];
  const noMatch = q && !products.some((p) => p.name.toLowerCase() === q) && !master.some((m) => m.item_name.toLowerCase() === q);
  const masterNotAdded = master.filter((m) => !inWh.has(m.item_name.toLowerCase()));
  const isLow = (p: Product) => p.min_qty > 0 && total(p.id) < p.min_qty;
  const rank = (p: Product) => (isLow(p) ? 0 : total(p.id) > 0 ? 1 : total(p.id) < 0 ? 2 : 3); // low → in stock → negative → empty
  const sortedProducts = [...visibleProducts].filter((p) => stockFilter === 'all' || (stockFilter === 'in' ? total(p.id) > 0 : total(p.id) <= 0)).sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? total(b.id) - total(a.id) : 0) || a.name.localeCompare(b.name));
  const inStockCount = visibleProducts.filter((p) => total(p.id) > 0).length;
  const chip = (active: boolean) => `px-3 py-1.5 rounded-lg text-sm border ${active ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`;

  return (
    <div className="max-w-4xl">
      {/* header: two big actions */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><WarehouseIcon className="w-6 h-6 text-teal-600" />Warehouse</h2>
        <div className="flex gap-2">
          <button onClick={() => setNewKind('in')} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-white border border-gray-300 text-gray-800 hover:bg-gray-50"><ArrowDownToLine className="w-4 h-4" />Stock In</button>
          <button onClick={() => setNewKind('issue')} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-teal-600 text-white hover:bg-teal-700"><ArrowUpFromLine className="w-4 h-4" />Issue Note</button>
        </div>
      </div>

      {/* tabs */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button onClick={() => setTab('stock')} className={chip(tab === 'stock')}>Stock</button>
        <button onClick={() => setTab('notes')} className={chip(tab === 'notes')}>History {notes.length ? `(${notes.length})` : ''}</button>
        <button onClick={() => setTab('products')} className={chip(tab === 'products')}>Setup</button>
        <span className="flex-1" />
        <button onClick={() => setNewKind('transfer')} className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1"><ArrowLeftRight className="w-3.5 h-3.5" />Transfer</button>
        <button onClick={() => setNewKind('adjust')} className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1"><SlidersHorizontal className="w-3.5 h-3.5" />Adjust</button>
        <button onClick={printPriceList} className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1"><Printer className="w-3.5 h-3.5" />Price list</button>
      </div>

      {tab === 'stock' && (
        <div>
          <div className="relative mb-3"><Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" /><input className="w-full pl-10 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500" placeholder="Search or type a new product name…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          {activeLocs.length > 1 && (
            <div className="flex gap-2 mb-3 flex-wrap">
              <button onClick={() => setLocFilter('all')} className={chip(locFilter === 'all')}>All locations</button>
              {activeLocs.map((l) => <button key={l.id} onClick={() => setLocFilter(l.id)} className={chip(locFilter === l.id)}><MapPin className="w-3 h-3 inline mr-1" />{l.name}</button>)}
            </div>
          )}
          {(() => {
            const valued = visibleProducts.filter((p) => total(p.id) > 0);
            const totalValue = valued.reduce((t, p) => t + total(p.id) * (p.avg_cost ?? 0), 0);
            const noCost = valued.filter((p) => !p.avg_cost).length;
            return (
              <div className="mb-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="bg-white border border-gray-200 px-4 py-3 sm:col-span-2">
                  <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-gray-500">Total inventory value</div>
                  <div className="text-2xl font-bold text-gray-900 mt-1">Rs {fmtQ(Math.round(totalValue))}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">quantity in stock x average cost{locFilter !== 'all' ? ' - this location' : ''}</div>
                </div>
                <div className="bg-white border border-gray-200 px-4 py-3">
                  <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-gray-500">Items in stock</div>
                  <div className="text-2xl font-bold text-gray-900 mt-1">{valued.length}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">of {visibleProducts.length} products</div>
                </div>
                <div className="bg-white border border-gray-200 px-4 py-3">
                  <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-gray-500">Total quantity</div>
                  <div className="text-2xl font-bold text-gray-900 mt-1">{fmtQ(valued.reduce((t, p) => t + total(p.id), 0))}</div>
                  {noCost > 0 && <div className="text-[11px] text-amber-700 mt-0.5">{noCost} item{noCost > 1 ? 's' : ''} with no cost - not valued</div>}
                </div>
              </div>
            );
          })()}
          <div className="flex gap-2 mb-3 flex-wrap items-center">
            <button onClick={() => setStockFilter('all')} className={chip(stockFilter === 'all')}>All ({visibleProducts.length})</button>
            <button onClick={() => setStockFilter('in')} className={chip(stockFilter === 'in')}>In stock ({inStockCount})</button>
            <button onClick={() => setStockFilter('empty')} className={chip(stockFilter === 'empty')}>Empty ({visibleProducts.length - inStockCount})</button>
          </div>
          {lowCount > 0 && <div className="mb-3 flex items-center gap-2 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2"><AlertTriangle className="w-4 h-4" />{lowCount} product{lowCount > 1 ? 's' : ''} below minimum</div>}

          {masterHits.length > 0 && (
            <div className="mb-3 bg-white border border-teal-200 rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-teal-700 bg-teal-50">From master items — tap to add to warehouse</div>
              {masterHits.map((m) => (
                <button key={m.id} onClick={() => setQuick({ mode: 'new', name: m.item_name, unit: m.unit, masterId: m.id, sellPrice: m.sales_price || 0 })} className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-teal-50 border-t border-gray-100">
                  <Plus className="w-4 h-4 text-teal-600 shrink-0" /><span className="flex-1 truncate">{m.item_name}</span>{m.sku && <span className="text-xs text-gray-400">{m.sku}</span>}<span className="text-xs text-gray-500">{m.unit}</span>
                </button>
              ))}
            </div>
          )}
          {noMatch && <button onClick={() => setQuick({ mode: 'new', name: search.trim() })} className="w-full mb-3 flex items-center gap-2 px-4 py-3 bg-teal-50 border border-dashed border-teal-300 text-teal-800 rounded-lg text-sm font-medium hover:bg-teal-100"><Plus className="w-4 h-4" />Add "{search.trim()}" as a new product and put its quantity</button>}

          {products.length === 0 && !q ? (
            <div className="bg-white border border-dashed border-gray-300 rounded-lg p-8 text-center text-gray-500 text-sm">
              <Package className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              Type a product name in the box above — it will offer your master items — then put its quantity.
              {masterNotAdded.length > 0 && <div className="mt-3"><button onClick={() => importAllMaster()} className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm">Add all {masterNotAdded.length} master items</button></div>}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr><th className="text-left px-4 py-2">Product</th><th className="text-right px-3 py-2">Cost</th><th className="text-right px-3 py-2">Sell price</th>{activeLocs.length > 1 && locFilter === 'all' && activeLocs.map((l) => <th key={l.id} className="text-right px-3 py-2">{l.name}</th>)}<th className="text-right px-3 py-2">Qty</th><th className="text-right px-3 py-2">Value</th><th className="px-3 py-2 w-28"></th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedProducts.map((p, i) => {
                    const t = total(p.id); const low = p.min_qty > 0 && t < p.min_qty;
                    const firstEmpty = stockFilter === 'all' && t <= 0 && !low && (i === 0 || rank(sortedProducts[i - 1]) < rank(p));
                    return (
                      <React.Fragment key={p.id}>
                        {firstEmpty && <tr><td colSpan={7 + (activeLocs.length > 1 && locFilter === 'all' ? activeLocs.length : 0)} className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-gray-400 bg-gray-50">{t < 0 ? 'Negative' : 'Not in stock'}</td></tr>}
                        <tr className={`hover:bg-gray-50 ${low ? 'bg-amber-50/60' : ''}`}>
                          <td className="px-4 py-2"><button onClick={() => setMovProduct(p)} className="text-left font-medium text-gray-900 hover:text-teal-700">{p.name}</button>{low && <span className="ml-2 text-[10px] bg-amber-200 text-amber-900 px-1.5 rounded align-middle">LOW</span>}<div className="text-xs text-gray-400">{p.unit}{p.min_qty > 0 ? ` · min ${fmtQ(p.min_qty)}` : ''}</div></td>
                          <td className="px-3 py-2 text-right text-gray-600">{p.avg_cost ? fmtQ(p.avg_cost) : <span className="text-gray-300">—</span>}</td>
                          <td className="px-3 py-2 text-right">{p.sell_price ? fmtQ(p.sell_price) : <span className="text-gray-300">—</span>}</td>
                          {activeLocs.length > 1 && locFilter === 'all' && activeLocs.map((l) => <td key={l.id} className="px-3 py-2 text-right text-gray-600">{fmtQ(qtyAt(p.id, l.id))}</td>)}
                          <td className="px-3 py-2 text-right"><button onClick={() => setQuick({ mode: 'set', product: p })} title="Set exact count" className={`font-bold text-base ${t < 0 ? 'text-red-600' : t === 0 ? 'text-gray-300' : 'text-gray-900'}`}>{fmtQ(t)}</button></td>
                          <td className="px-3 py-2 text-right text-gray-700">{p.avg_cost && t > 0 ? fmtQ(Math.round(t * (p.avg_cost || 0))) : <span className="text-gray-300">—</span>}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <button onClick={() => setQuick({ mode: 'in', product: p })} className="w-8 h-8 rounded-lg border border-gray-300 text-green-700 hover:bg-green-50 font-bold" title="Add stock">+</button>
                            <button onClick={() => setQuick({ mode: 'issue', product: p })} className="w-8 h-8 rounded-lg border border-gray-300 text-red-700 hover:bg-red-50 font-bold ml-1" title="Issue / take out">−</button>
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
                <tfoot className="bg-gray-50 border-t-2 border-gray-200 text-sm">
                  <tr>
                    <td className="px-4 py-2 font-semibold text-gray-700">Total{stockFilter !== 'all' ? ' (filtered)' : ''}</td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                    {activeLocs.length > 1 && locFilter === 'all' && activeLocs.map((l) => <td key={l.id} className="px-3 py-2 text-right text-gray-600">{fmtQ(sortedProducts.reduce((t, p) => t + Math.max(0, qtyAt(p.id, l.id)), 0))}</td>)}
                    <td className="px-3 py-2 text-right font-semibold text-gray-900">{fmtQ(sortedProducts.reduce((t, p) => t + Math.max(0, total(p.id)), 0))}</td>
                    <td className="px-3 py-2 text-right font-bold text-gray-900">Rs {fmtQ(Math.round(sortedProducts.reduce((t, p) => t + Math.max(0, total(p.id)) * (p.avg_cost ?? 0), 0)))}</td>
                    <td className="px-3 py-2" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-3">Value = quantity in stock x average cost. + adds stock · − issues stock · tap the number to set an exact count · tap the name for history. Sales invoices from SL Portal deduct automatically (SI-… notes); purchases never add — use Stock In.</p>
        </div>
      )}

      {tab === 'notes' && (
        notes.length === 0 ? <Empty text="Nothing yet. Every + / − / Stock In / Issue you save shows here." /> : (
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {notes.map((n) => { const ls = lines.filter((l) => l.note_id === n.id); const K = KIND[n.kind]; return (
              <div key={n.id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50">
                <button onClick={() => setViewNote(n)} className="flex-1 text-left min-w-0">
                  <div className="flex items-center gap-2 flex-wrap"><span className={`text-xs px-2 py-0.5 rounded ${K.color}`}>{K.label}</span><span className="font-medium text-gray-900">{n.note_no}</span><span className="text-xs text-gray-500">{fmtD(n.note_date)}</span></div>
                  <p className="text-sm text-gray-600 truncate mt-0.5">
                    {ls.length === 1 ? `${prod(ls[0].product_id)?.name ?? ''} × ${fmtQ(Number(ls[0].qty))}` : `${ls.length} items, qty ${fmtQ(ls.reduce((t, l) => t + Number(l.qty), 0))}`}
                    {' · '}{n.kind === 'in' && `→ ${locName(n.to_location_id)}`}{n.kind === 'issue' && `${locName(n.from_location_id)} → ${n.issued_to ?? ''}`}{n.kind === 'transfer' && `${locName(n.from_location_id)} → ${locName(n.to_location_id)}`}{n.kind === 'adjust' && locName(n.from_location_id)}
                    {n.remarks ? ` · ${n.remarks}` : ''}
                  </p>
                </button>
                <button onClick={() => printNote(n)} className="p-1.5 text-gray-500 hover:text-teal-700" title="Print"><Printer className="w-4 h-4" /></button>
                {n.sales_invoice_id ? <span className="text-[10px] text-gray-400 px-1.5" title="Comes from a sales invoice — delete the invoice in SL Portal to reverse it">from invoice</span> : <button onClick={() => deleteNote(n)} className="p-1.5 text-gray-400 hover:text-red-600" title="Delete"><Trash2 className="w-4 h-4" /></button>}
              </div>
            ); })}
          </div>
        )
      )}

      {tab === 'products' && (
        <div className="space-y-6">
          <div><h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1"><MapPin className="w-4 h-4" />Locations</h3><LocationsTab locations={locations} onChange={load} inUse={(id) => stock.some((s) => s.location_id === id && s.qty !== 0)} /></div>
          <div><h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1"><Package className="w-4 h-4" />Products{masterNotAdded.length > 0 && <button onClick={() => importAllMaster()} className="ml-auto text-xs px-2 py-1 bg-teal-600 text-white rounded">Add all {masterNotAdded.length} master items</button>}</h3><ProductsTab products={products} onChange={load} total={total} /></div>
        </div>
      )}

      {newKind && <NoteForm kind={newKind} locations={activeLocs} products={products.filter((p) => p.is_active)} master={masterNotAdded} qtyAt={qtyAt} onClose={() => setNewKind(null)} onSaved={(n) => { setNewKind(null); load(); if (n.kind === 'issue') setTimeout(() => setViewNote(n), 300); }} />}

      {quick && <QuickQty quick={quick} locations={activeLocs} defaultLoc={locFilter !== 'all' ? locFilter : (activeLocs[0]?.id ?? '')} qtyAt={qtyAt} onClose={() => setQuick(null)} onSaved={() => { setQuick(null); setSearch(''); load(); }} />}

      {viewNote && (
        <Modal title={`${KIND[viewNote.kind].label} ${viewNote.note_no}`} onClose={() => setViewNote(null)} actions={<>
          <button onClick={() => printNote(viewNote)} className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm"><Printer className="w-4 h-4" />Print</button>
          {!viewNote.sales_invoice_id && <button onClick={() => deleteNote(viewNote)} className="px-3 py-1.5 border border-red-300 text-red-700 rounded-lg text-sm">Delete</button>}
        </>}>
          <div className="text-sm text-gray-600 space-y-1 mb-3">
            <div>{fmtD(viewNote.note_date)}</div>
            {viewNote.kind === 'in' && <div>Into <b>{locName(viewNote.to_location_id)}</b></div>}
            {viewNote.kind === 'issue' && <div>From <b>{locName(viewNote.from_location_id)}</b> · Issued to <b>{viewNote.issued_to}</b></div>}
            {viewNote.kind === 'transfer' && <div><b>{locName(viewNote.from_location_id)}</b> → <b>{locName(viewNote.to_location_id)}</b></div>}
            {viewNote.kind === 'adjust' && <div>At <b>{locName(viewNote.from_location_id)}</b></div>}
            {viewNote.remarks && <div className="italic">{viewNote.remarks}</div>}
          </div>
          <table className="w-full text-sm"><thead className="text-xs text-gray-500"><tr><th className="text-left py-1">Item</th><th className="text-right py-1">Qty</th><th className="text-left py-1 pl-3">Remark</th></tr></thead>
            <tbody>{lines.filter((l) => l.note_id === viewNote.id).map((l) => <tr key={l.id} className="border-t border-gray-100"><td className="py-1">{prod(l.product_id)?.name}</td><td className={`py-1 text-right font-medium ${Number(l.qty) < 0 ? 'text-red-600' : ''}`}>{fmtQ(Number(l.qty))} {prod(l.product_id)?.unit}</td><td className="py-1 pl-3 text-gray-500">{l.remark}</td></tr>)}</tbody></table>
        </Modal>
      )}

      {movProduct && (
        <Modal title={`${movProduct.name} — history`} onClose={() => setMovProduct(null)}>
          <Movements product={movProduct} notes={notes} lines={lines} locName={locName} onOpen={(n) => { setMovProduct(null); setViewNote(n); }} />
        </Modal>
      )}
    </div>
  );
}

// ---------- pieces ----------
function esc(s: string) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)); }
function Empty({ text }: { text: string }) { return <div className="bg-white border border-dashed border-gray-300 rounded-lg p-10 text-center text-gray-500 text-sm">{text}</div>; }
function Modal({ title, children, onClose, actions }: { title: string; children: React.ReactNode; onClose: () => void; actions?: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200"><h3 className="font-semibold text-gray-900">{title}</h3><div className="flex items-center gap-2">{actions}<button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button></div></div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function Movements({ product, notes, lines, locName, onOpen }: { product: Product; notes: Note[]; lines: Line[]; locName: (id: string | null) => string; onOpen: (n: Note) => void }) {
  const rows = useMemo(() => {
    const out: { n: Note; qty: number; where: string }[] = [];
    for (const l of lines.filter((x) => x.product_id === product.id)) {
      const n = notes.find((x) => x.id === l.note_id); if (!n) continue;
      const q = Number(l.qty);
      if (n.kind === 'in') out.push({ n, qty: q, where: locName(n.to_location_id) });
      else if (n.kind === 'issue') out.push({ n, qty: -q, where: `${locName(n.from_location_id)} → ${n.issued_to ?? ''}` });
      else if (n.kind === 'adjust') out.push({ n, qty: q, where: locName(n.from_location_id) });
      else { out.push({ n, qty: -q, where: locName(n.from_location_id) }); out.push({ n, qty: q, where: locName(n.to_location_id) }); }
    }
    out.sort((a, b) => a.n.note_date.localeCompare(b.n.note_date) || a.n.created_at.localeCompare(b.n.created_at));
    let bal = 0; return out.map((r) => ({ ...r, bal: (bal += r.qty) })).reverse();
  }, [product, notes, lines, locName]);
  if (rows.length === 0) return <p className="text-sm text-gray-500">No movements yet.</p>;
  return (
    <table className="w-full text-sm"><thead className="text-xs text-gray-500"><tr><th className="text-left py-1">Date</th><th className="text-left py-1">Note</th><th className="text-left py-1">Where</th><th className="text-right py-1">Qty</th><th className="text-right py-1">Balance</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-gray-100"><td className="py-1 whitespace-nowrap">{fmtD(r.n.note_date)}</td><td className="py-1"><button onClick={() => onOpen(r.n)} className="text-teal-700 hover:underline">{r.n.note_no}</button></td><td className="py-1 text-gray-600">{r.where}</td><td className={`py-1 text-right font-medium ${r.qty < 0 ? 'text-red-600' : 'text-green-700'}`}>{r.qty > 0 ? '+' : ''}{fmtQ(r.qty)}</td><td className="py-1 text-right">{fmtQ(r.bal)}</td></tr>)}</tbody></table>
  );
}

function ProductsTab({ products, onChange, total }: { products: Product[]; onChange: () => void; total: (id: string) => number }) {
  const [name, setName] = useState(''); const [unit, setUnit] = useState('PCS'); const [min, setMin] = useState('');
  const [edit, setEdit] = useState<Product | null>(null);
  const [price, setPrice] = useState('');
  async function syncMaster(p: Product, sell: number) { if (p.master_item_id && sell > 0) await supabase.from('items').update({ sales_price: sell }).eq('id', p.master_item_id); }
  async function add() { if (!name.trim()) return; const { error } = await supabase.from('wh_products').insert({ name: name.trim(), unit: unit.trim() || 'PCS', min_qty: Number(min) || 0, sell_price: Number(price) || 0 }); if (error) alert(error.message); else { setName(''); setMin(''); setPrice(''); onChange(); } }
  async function save() { if (!edit) return; const sell = Number(edit.sell_price) || 0; const cost = Number(edit.avg_cost) || 0; const { error } = await supabase.from('wh_products').update({ name: edit.name.trim(), unit: edit.unit.trim() || 'PCS', min_qty: Number(edit.min_qty) || 0, is_active: edit.is_active, sell_price: sell, avg_cost: cost, last_cost: cost }).eq('id', edit.id); if (error) alert(error.message); else { await syncMaster(edit, sell); if (edit.master_item_id && cost > 0) await supabase.from('items').update({ purchase_price: cost }).eq('id', edit.master_item_id); setEdit(null); onChange(); } }
  async function remove(p: Product) {
    if (total(p.id) !== 0) { alert(`${p.name} still has stock (${fmtQ(total(p.id))}). Adjust it to zero first, or just untick Active to hide it.`); return; }
    if (!confirm(`Delete ${p.name}? Only possible if it was never used in a note.`)) return;
    const { error } = await supabase.from('wh_products').delete().eq('id', p.id); if (error) alert('Cannot delete — it is used in notes. Untick Active instead.'); else onChange();
  }
  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3 flex gap-2 flex-wrap items-end">
        <div className="flex-1 min-w-[200px]"><label className="text-xs text-gray-500">Product name</label><input className={input} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="e.g. Cotton glove 7G white" /></div>
        <div className="w-24"><label className="text-xs text-gray-500">Unit</label><input className={input} value={unit} onChange={(e) => setUnit(e.target.value)} /></div>
        <div className="w-28"><label className="text-xs text-gray-500">Min qty (alert)</label><input className={input} value={min} onChange={(e) => setMin(e.target.value)} inputMode="numeric" placeholder="0" /></div>
        <div className="w-32"><label className="text-xs text-gray-500">Sell price (Rs)</label><input className={input} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0" /></div>
        <button onClick={add} className="px-3 py-2 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1"><Plus className="w-4 h-4" />Add</button>
      </div>
      {products.length === 0 ? <Empty text="No products yet." /> : (
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {products.map((p) => edit?.id === p.id ? (
            <div key={p.id} className="px-4 py-2 flex gap-2 items-center flex-wrap">
              <input className={`${input} flex-1 min-w-[160px]`} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              <input className={`${input} w-20`} value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} />
              <input className={`${input} w-24`} value={edit.min_qty} onChange={(e) => setEdit({ ...edit, min_qty: Number(e.target.value) })} />
              <input className={`${input} w-28`} value={edit.avg_cost ?? ''} onChange={(e) => setEdit({ ...edit, avg_cost: Number(e.target.value) })} placeholder="Cost Rs" title="Average cost per unit (Rs) — used for profit" />
              <input className={`${input} w-28`} value={edit.sell_price ?? ''} onChange={(e) => setEdit({ ...edit, sell_price: Number(e.target.value) })} placeholder="Sell Rs" title="Selling price (Rs) — also updates the master item" />
              <label className="text-sm flex items-center gap-1"><input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />Active</label>
              <button onClick={save} className="px-3 py-1.5 bg-teal-600 text-white rounded text-sm">Save</button><button onClick={() => setEdit(null)} className="px-3 py-1.5 border rounded text-sm">Cancel</button>
            </div>
          ) : (
            <div key={p.id} className={`px-4 py-2 flex items-center gap-3 ${p.is_active ? '' : 'opacity-50'}`}>
              <Package className="w-4 h-4 text-gray-400" /><span className="flex-1 font-medium text-gray-900">{p.name}</span><span className="text-xs text-gray-500">{p.unit}</span><span className="text-xs text-gray-500">min {fmtQ(p.min_qty)}</span><span className="text-xs text-gray-500 w-20 text-right">{p.avg_cost ? `cost ${fmtQ(p.avg_cost)}` : ''}</span><span className="text-xs text-teal-700 w-24 text-right">{p.sell_price ? `Rs ${fmtQ(p.sell_price)}` : <span className="text-gray-300">no price</span>}</span><span className="text-sm font-semibold w-20 text-right">{fmtQ(total(p.id))}</span>
              <button onClick={() => setEdit(p)} className="text-xs text-teal-700 hover:underline">Edit</button><button onClick={() => remove(p)} className="text-gray-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LocationsTab({ locations, onChange, inUse }: { locations: Location[]; onChange: () => void; inUse: (id: string) => boolean }) {
  const [name, setName] = useState('');
  async function add() { if (!name.trim()) return; const { error } = await supabase.from('wh_locations').insert({ name: name.trim() }); if (error) alert(error.message); else { setName(''); onChange(); } }
  async function toggle(l: Location) { if (l.is_active && inUse(l.id)) { alert('This location still holds stock. Transfer it out first.'); return; } await supabase.from('wh_locations').update({ is_active: !l.is_active }).eq('id', l.id); onChange(); }
  async function rename(l: Location) { const n = prompt('Location name', l.name); if (!n || n.trim() === l.name) return; await supabase.from('wh_locations').update({ name: n.trim() }).eq('id', l.id); onChange(); }
  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3 flex gap-2"><input className={input} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="e.g. Main Warehouse, Quarry Road shop, Factory store" /><button onClick={add} className="px-3 py-2 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1"><Plus className="w-4 h-4" />Add</button></div>
      <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
        {locations.map((l) => <div key={l.id} className={`px-4 py-2 flex items-center gap-3 ${l.is_active ? '' : 'opacity-50'}`}><MapPin className="w-4 h-4 text-gray-400" /><span className="flex-1 font-medium">{l.name}</span><button onClick={() => rename(l)} className="text-xs text-teal-700 hover:underline">Rename</button><button onClick={() => toggle(l)} className="text-xs text-gray-500 hover:underline">{l.is_active ? 'Deactivate' : 'Activate'}</button></div>)}
      </div>
    </div>
  );
}

function NoteForm({ kind, locations, products, master, qtyAt, onClose, onSaved }: { kind: Kind; locations: Location[]; products: Product[]; master: MasterItem[]; qtyAt: (p: string, l: string) => number; onClose: () => void; onSaved: (n: Note) => void }) {
  const K = KIND[kind];
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [from, setFrom] = useState(locations[0]?.id ?? '');
  const [to, setTo] = useState(kind === 'transfer' ? (locations[1]?.id ?? '') : (locations[0]?.id ?? ''));
  const [issuedTo, setIssuedTo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [rows, setRows] = useState<DraftLine[]>([{ product_id: '', qty: '', remark: '', cost: '' }, { product_id: '', qty: '', remark: '', cost: '' }, { product_id: '', qty: '', remark: '', cost: '' }]);
  const [saving, setSaving] = useState(false);
  const setRow = (i: number, patch: Partial<DraftLine>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const srcLoc = kind === 'in' ? to : from;

  async function save() {
    const valid = rows.filter((r) => r.product_id && Number(r.qty) !== 0 && !isNaN(Number(r.qty)));
    if (valid.length === 0) { alert('Add at least one item with a quantity'); return; }
    if (kind === 'issue' && !issuedTo.trim()) { alert('Who is this issued to?'); return; }
    if (kind === 'transfer' && from === to) { alert('From and To must be different'); return; }
    if (kind !== 'adjust' && valid.some((r) => Number(r.qty) < 0)) { alert('Quantity must be positive'); return; }
    if (kind === 'issue' || kind === 'transfer') {
      const short = valid.filter((r) => !r.product_id.startsWith('master:') && Number(r.qty) > qtyAt(r.product_id, from));
      if (short.length && !confirm(`Not enough stock for: ${short.map((r) => products.find((p) => p.id === r.product_id)?.name).join(', ')}.\nStock will go negative. Continue?`)) return;
    }
    setSaving(true);
    // master items picked that aren't warehouse products yet → create them now
    for (const r of valid) {
      if (r.product_id.startsWith('master:')) {
        const m = master.find((x) => 'master:' + x.id === r.product_id); if (!m) continue;
        const { data, error } = await supabase.from('wh_products').insert({ name: m.item_name, unit: m.unit || 'PCS', master_item_id: m.id }).select().single();
        if (error || !data) { alert(error?.message ?? 'Could not add product'); setSaving(false); return; }
        r.product_id = data.id;
      }
    }
    const { data: no, error: e0 } = await supabase.rpc('next_wh_note_no', { p_kind: kind });
    if (e0) { alert(e0.message); setSaving(false); return; }
    const { data: note, error: e1 } = await supabase.from('wh_notes').insert({
      note_no: no, kind, note_date: date,
      from_location_id: kind === 'in' ? null : from, to_location_id: kind === 'in' || kind === 'transfer' ? to : null,
      issued_to: kind === 'issue' ? issuedTo.trim() : null, remarks: remarks.trim() || null,
    }).select().single();
    if (e1 || !note) { alert(e1?.message ?? 'Save failed'); setSaving(false); return; }
    const { error: e2 } = await supabase.from('wh_note_lines').insert(valid.map((r, i) => ({ note_id: note.id, product_id: r.product_id, qty: Number(r.qty), remark: r.remark.trim() || null, line_no: i + 1, unit_cost: kind === 'in' ? (Number(r.cost) || products.find((p) => p.id === r.product_id)?.last_cost || null) : null })));
    if (e2) { await supabase.from('wh_notes').delete().eq('id', note.id); alert(e2.message); setSaving(false); return; }
    setSaving(false); onSaved(note as Note);
  }

  const sel = 'px-3 py-2 border border-gray-300 rounded-lg text-sm w-full';
  return (
    <Modal title={`New ${K.label}`} onClose={onClose} actions={<button onClick={save} disabled={saving} className="px-4 py-1.5 bg-teal-600 text-white rounded-lg text-sm disabled:opacity-50">{saving ? 'Saving…' : `Save ${K.label}`}</button>}>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
        <div><label className="text-xs text-gray-500">Date</label><input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        {kind === 'in' && <div><label className="text-xs text-gray-500">Into location</label><select className={sel} value={to} onChange={(e) => setTo(e.target.value)}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>}
        {kind !== 'in' && <div><label className="text-xs text-gray-500">{kind === 'adjust' ? 'Location' : 'From location'}</label><select className={sel} value={from} onChange={(e) => setFrom(e.target.value)}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>}
        {kind === 'transfer' && <div><label className="text-xs text-gray-500">To location</label><select className={sel} value={to} onChange={(e) => setTo(e.target.value)}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>}
        {kind === 'issue' && <div><label className="text-xs text-gray-500">Issued to (person / shop / vehicle)</label><input className={input} value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} placeholder="e.g. Fazan – Quarry Road shop" /></div>}
        <div className={kind === 'issue' || kind === 'transfer' ? '' : 'col-span-2 md:col-span-1'}><label className="text-xs text-gray-500">Remarks</label><input className={input} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={kind === 'adjust' ? 'e.g. stock count, damaged' : 'optional'} /></div>
      </div>
      {kind === 'adjust' && <p className="text-xs text-amber-700 mb-2">Use + to add, − to reduce (e.g. −5 for damaged).</p>}
      <table className="w-full text-sm">
        <thead className="text-xs text-gray-500"><tr><th className="text-left pb-1">Item</th><th className="text-right pb-1 w-20">In stock</th><th className="text-right pb-1 w-24">Qty</th>{kind === 'in' && <th className="text-right pb-1 w-28">Cost / unit Rs</th>}<th className="text-left pb-1 pl-2">Remark</th><th className="w-6"></th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="py-0.5 pr-1"><select className={sel} value={r.product_id} onChange={(e) => setRow(i, { product_id: e.target.value })}><option value="">— choose —</option><optgroup label="Warehouse">{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}</optgroup>{master.length > 0 && <optgroup label="Master items (not yet in warehouse)">{master.map((m) => <option key={m.id} value={'master:' + m.id}>{m.item_name} ({m.unit})</option>)}</optgroup>}</select></td>
              <td className="py-0.5 text-right text-gray-500">{r.product_id && !r.product_id.startsWith('master:') && srcLoc ? fmtQ(qtyAt(r.product_id, srcLoc)) : ''}</td>
              <td className="py-0.5 pr-1"><input className={`${input} text-right`} value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} inputMode="decimal" /></td>
              {kind === 'in' && <td className="py-0.5 pr-1"><input className={`${input} text-right`} value={r.cost} onChange={(e) => setRow(i, { cost: e.target.value })} inputMode="decimal" placeholder={String(products.find((p) => p.id === r.product_id)?.last_cost || '')} /></td>}
              <td className="py-0.5 pl-1"><input className={input} value={r.remark} onChange={(e) => setRow(i, { remark: e.target.value })} /></td>
              <td className="py-0.5 text-right"><button onClick={() => setRows((rs) => rs.length > 1 ? rs.filter((_, j) => j !== i) : rs)} className="text-gray-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => setRows((rs) => [...rs, { product_id: '', qty: '', remark: '', cost: '' }])} className="mt-2 text-sm text-teal-700 flex items-center gap-1"><Plus className="w-4 h-4" />Add line</button>
      {products.length === 0 && <p className="text-xs text-red-600 mt-2">No products yet — add them in the Products tab first.</p>}
    </Modal>
  );
}

// One product, one number. Creates the right note behind the scenes.
function QuickQty({ quick, locations, defaultLoc, qtyAt, onClose, onSaved }: { quick: Quick; locations: Location[]; defaultLoc: string; qtyAt: (p: string, l: string) => number; onClose: () => void; onSaved: () => void }) {
  const [qty, setQty] = useState('');
  const [loc, setLoc] = useState(defaultLoc);
  const [issuedTo, setIssuedTo] = useState('');
  const [note, setNote] = useState('');
  const [unit, setUnit] = useState(quick.mode === 'new' && quick.unit ? quick.unit : 'PCS');
  const [cost, setCost] = useState(() => (quick.mode !== 'new' && quick.mode !== 'set' && quick.product.last_cost ? String(quick.product.last_cost) : ''));
  const [saving, setSaving] = useState(false);
  const isNew = quick.mode === 'new';
  const product = isNew ? null : quick.product;
  const mode = quick.mode;
  const have = product && loc ? qtyAt(product.id, loc) : 0;
  const n = Number(qty);
  const title = mode === 'in' ? 'Add stock' : mode === 'issue' ? 'Issue / take out' : mode === 'set' ? 'Set exact count' : 'New product';
  const color = mode === 'issue' ? 'bg-red-600 hover:bg-red-700' : mode === 'set' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700';

  async function save() {
    if (!loc) { alert('Add a location first (Setup tab)'); return; }
    if (qty === '' || isNaN(n) || (mode !== 'set' && n <= 0)) { alert('Enter a quantity'); return; }
    if (mode === 'issue' && !issuedTo.trim()) { alert('Who is taking it? (name / shop / vehicle)'); return; }
    if (mode === 'issue' && n > have && !confirm(`Only ${fmtQ(have)} in stock here. Stock will go negative. Continue?`)) return;
    setSaving(true);
    let pid = product?.id ?? '';
    if (isNew) {
      const { data, error } = await supabase.from('wh_products').insert({ name: quick.name, unit: unit.trim() || 'PCS', master_item_id: quick.masterId ?? null, sell_price: quick.sellPrice ?? 0 }).select().single();
      if (error || !data) { alert(error?.message ?? 'Could not add product'); setSaving(false); return; }
      pid = data.id;
      if (n === 0) { setSaving(false); onSaved(); return; }
    }
    const kind: Kind = mode === 'issue' ? 'issue' : mode === 'set' ? 'adjust' : 'in';
    const lineQty = mode === 'set' ? n - have : n;
    if (mode === 'set' && lineQty === 0) { setSaving(false); onSaved(); return; }
    const { data: no, error: e0 } = await supabase.rpc('next_wh_note_no', { p_kind: kind });
    if (e0) { alert(e0.message); setSaving(false); return; }
    const { data: hdr, error: e1 } = await supabase.from('wh_notes').insert({
      note_no: no, kind, note_date: new Date().toISOString().slice(0, 10),
      from_location_id: kind === 'in' ? null : loc, to_location_id: kind === 'in' ? loc : null,
      issued_to: kind === 'issue' ? issuedTo.trim() : null,
      remarks: mode === 'set' ? `Count set to ${fmtQ(n)}${note ? ' — ' + note : ''}` : (note.trim() || (isNew ? 'Opening stock' : null)),
    }).select().single();
    if (e1 || !hdr) { alert(e1?.message ?? 'Save failed'); setSaving(false); return; }
    const { error: e2 } = await supabase.from('wh_note_lines').insert({ note_id: hdr.id, product_id: pid, qty: lineQty, line_no: 1, unit_cost: kind === 'in' && Number(cost) > 0 ? Number(cost) : null });
    if (e2) { await supabase.from('wh_notes').delete().eq('id', hdr.id); alert(e2.message); setSaving(false); return; }
    setSaving(false); onSaved();
  }

  const after = mode === 'in' ? have + (n || 0) : mode === 'issue' ? have - (n || 0) : mode === 'set' ? (qty === '' ? have : n) : (n || 0);
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl shadow-xl p-5">
        <div className="flex items-center justify-between mb-1"><h3 className="font-semibold text-gray-900">{title}</h3><button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button></div>
        <p className="text-lg font-medium text-gray-800 mb-3 truncate">{isNew ? quick.name : product!.name}{isNew && quick.masterId && <span className="ml-2 text-[10px] bg-teal-100 text-teal-800 px-1.5 py-0.5 rounded align-middle">master item</span>}</p>

        {isNew && <div className="mb-3"><label className="text-xs text-gray-500">Unit</label><input className={input} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="PCS, DOZ, BOX, KG" /></div>}

        <label className="text-xs text-gray-500">{mode === 'set' ? 'Counted quantity' : isNew ? 'Opening quantity' : 'Quantity'}</label>
        <input autoFocus type="number" inputMode="decimal" className="w-full text-2xl font-bold text-center py-2 border border-gray-300 rounded-lg focus:border-teal-500 focus:outline-none mb-3" value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="0" />

        {locations.length > 1 && (
          <div className="mb-3"><label className="text-xs text-gray-500">{mode === 'issue' ? 'From' : 'Location'}</label>
            <div className="flex gap-1 flex-wrap mt-1">{locations.map((l) => <button key={l.id} onClick={() => setLoc(l.id)} className={`px-3 py-1.5 rounded-lg text-sm border ${loc === l.id ? 'bg-teal-600 text-white border-teal-600' : 'bg-white border-gray-300'}`}>{l.name}</button>)}</div>
          </div>
        )}
        {(mode === 'in' || isNew) && <div className="mb-3"><label className="text-xs text-gray-500">Cost per unit (Rs) — what it cost you landed</label><input type="number" inputMode="decimal" className={input} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="optional, used for profit" /></div>}
        {mode === 'issue' && <div className="mb-3"><label className="text-xs text-gray-500">Issued to</label><input className={input} value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} placeholder="e.g. Fazan – Quarry Road shop" /></div>}
        {!isNew && <div className="mb-3"><label className="text-xs text-gray-500">Note (optional)</label><input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'set' ? 'e.g. stock count' : ''} /></div>}

        {!isNew && <div className="flex justify-between text-sm text-gray-600 mb-3 bg-gray-50 rounded-lg px-3 py-2"><span>Now: <b>{fmtQ(have)}</b></span><span>After: <b className={after < 0 ? 'text-red-600' : ''}>{fmtQ(after)}</b> {product!.unit}</span></div>}

        <button onClick={save} disabled={saving} className={`w-full py-3 rounded-lg text-white font-semibold text-base ${color} disabled:opacity-50`}>{saving ? 'Saving…' : mode === 'in' ? `Add ${qty || 0}` : mode === 'issue' ? `Issue ${qty || 0}` : mode === 'set' ? 'Set count' : 'Add product'}</button>
      </div>
    </div>
  );
}
