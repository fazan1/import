import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { companyFor } from '../lib/company';
import { esc } from '../lib/html';
import { useAuth } from '../contexts/AuthContext';
import { Ship, Plus, Pencil, Trash2, X, RefreshCw, Container, Boxes, Printer, Banknote } from 'lucide-react';
import ShipmentCharges from './ShipmentCharges';
import type { ChargeShipment } from './ShipmentCharges';

type Mode = 'FCL' | 'LCL';
type Basis = 'CBM' | 'KG' | 'PCS';
type Status = 'Booked' | 'Shipped' | 'Arrived' | 'Cleared';

interface Shipment {
  id: string;
  shipment_no: string;
  mode: Mode;
  forwarder: string;
  rate_cbm: number;
  rate_kg: number;
  rate_pcs: number;
  default_basis: Basis;
  eta: string | null;
  status: Status;
  actual_charges: number;
  notes: string;
  created_at: string;
}

interface Bill {
  id: string;
  bill_number: string;
  cnv_invoice_number: string | null;
  bill_date: string;
  batch_number: string | null;
  supplier_name: string;
  total_cny: number;
}

interface BatchStats {
  cbm: number;
  kg: number;
  landed: number;
  sales: number;
  profit: number;
  items: number;
}

const STATUSES: Status[] = ['Booked', 'Shipped', 'Arrived', 'Cleared'];
const STATUS_STYLE: Record<Status, string> = {
  Booked: 'bg-gray-100 text-gray-700',
  Shipped: 'bg-teal-100 text-teal-800',
  Arrived: 'bg-amber-100 text-amber-800',
  Cleared: 'bg-green-100 text-green-800',
};

const emptyForm = {
  mode: 'LCL' as Mode,
  forwarder: '',
  default_basis: 'CBM' as Basis,
  rate_cbm: '',
  rate_kg: '',
  rate_pcs: '',
  eta: '',
  status: 'Booked' as Status,
  actual_charges: '',
  notes: '',
};

const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

export default function Shipping() {
  const { user } = useAuth();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [stats, setStats] = useState<Record<string, BatchStats>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Shipment | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [previewNo, setPreviewNo] = useState('');
  const [pickedBills, setPickedBills] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [charging, setCharging] = useState<ChargeShipment | null>(null);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    setError('');
    const [sRes, bRes, plRes, cRes] = await Promise.all([
      supabase.from('shipments').select('*').order('created_at', { ascending: false }),
      supabase.from('purchase_bills').select('id, bill_number, cnv_invoice_number, bill_date, batch_number, purchase_orders(suppliers(name)), purchase_bill_items(quantity_received, unit_price_cny)'),
      supabase.from('packing_list_items').select('batch_number, cbm, weight_kg'),
      supabase.from('costing_duty_sheet').select('batch_number, total_landed_cost, total_sales, total_profit, type, landed_cost_per_unit, qty'),
    ]);
    if (sRes.error) setError(sRes.error.message);
    setShipments((sRes.data || []) as Shipment[]);

    type RawBill = {
      id: string; bill_number: string; cnv_invoice_number: string | null; bill_date: string; batch_number: string | null;
      purchase_orders: { suppliers: { name: string } | { name: string }[] | null } | { suppliers: { name: string } | null }[] | null;
      purchase_bill_items: { quantity_received: number; unit_price_cny: number }[] | null;
    };
    const rawBills = (bRes.data || []) as unknown as RawBill[];
    setBills(rawBills.map((b) => {
      const po = Array.isArray(b.purchase_orders) ? b.purchase_orders[0] : b.purchase_orders;
      const sup = po ? (Array.isArray(po.suppliers) ? po.suppliers[0] : po.suppliers) : null;
      return {
        id: b.id,
        bill_number: b.bill_number,
        cnv_invoice_number: b.cnv_invoice_number,
        bill_date: b.bill_date,
        batch_number: b.batch_number,
        supplier_name: sup?.name || '—',
        total_cny: (b.purchase_bill_items || []).reduce((s, i) => s + (i.quantity_received || 0) * (i.unit_price_cny || 0), 0),
      };
    }).sort((a, b) => (b.bill_date || '').localeCompare(a.bill_date || '')));

    const st: Record<string, BatchStats> = {};
    const get = (k: string) => (st[k] ||= { cbm: 0, kg: 0, landed: 0, sales: 0, profit: 0, items: 0 });
    for (const r of (plRes.data || []) as { batch_number: string | null; cbm: number; weight_kg: number }[]) {
      if (!r.batch_number) continue;
      const s = get(r.batch_number);
      s.cbm += r.cbm || 0;
      s.kg += r.weight_kg || 0;
    }
    for (const r of (cRes.data || []) as { batch_number: string | null; total_landed_cost: number; total_sales: number; total_profit: number; type: string; landed_cost_per_unit: number; qty: number }[]) {
      if (!r.batch_number) continue;
      const s = get(r.batch_number);
      s.landed += r.total_landed_cost || 0;
      s.items += 1;
      if (r.type === 'RESALE') {
        s.sales += r.total_sales || 0;
        s.profit += r.total_profit || 0;
      }
    }
    setStats(st);
    setLoading(false);
  }

  async function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setPickedBills(new Set());
    setPreviewNo('');
    setShowForm(true);
    const { data } = await supabase.rpc('next_shipment_no', { p_mode: 'LCL' });
    if (data) setPreviewNo(data as string);
  }

  async function changeMode(mode: Mode) {
    setForm((f) => ({ ...f, mode }));
    if (!editing) {
      const { data } = await supabase.rpc('next_shipment_no', { p_mode: mode });
      if (data) setPreviewNo(data as string);
    }
  }

  function openEdit(s: Shipment) {
    setEditing(s);
    setForm({
      mode: s.mode,
      forwarder: s.forwarder || '',
      default_basis: s.default_basis,
      rate_cbm: s.rate_cbm ? String(s.rate_cbm) : '',
      rate_kg: s.rate_kg ? String(s.rate_kg) : '',
      rate_pcs: s.rate_pcs ? String(s.rate_pcs) : '',
      eta: s.eta || '',
      status: s.status,
      actual_charges: s.actual_charges ? String(s.actual_charges) : '',
      notes: s.notes || '',
    });
    setPreviewNo(s.shipment_no);
    setPickedBills(new Set(bills.filter((b) => b.batch_number === s.shipment_no).map((b) => b.id)));
    setShowForm(true);
  }

  async function save() {
    if (!user) return;
    setSaving(true);
    setError('');
    try {
      let shipmentNo = editing?.shipment_no || previewNo;
      if (!editing && !shipmentNo) {
        const { data } = await supabase.rpc('next_shipment_no', { p_mode: form.mode });
        shipmentNo = data as string;
      }
      const payload = {
        user_id: user.id,
        shipment_no: shipmentNo,
        mode: form.mode,
        forwarder: form.forwarder.trim(),
        default_basis: form.default_basis,
        rate_cbm: parseFloat(form.rate_cbm) || 0,
        rate_kg: parseFloat(form.rate_kg) || 0,
        rate_pcs: parseFloat(form.rate_pcs) || 0,
        eta: form.eta || null,
        status: form.status,
        actual_charges: parseFloat(form.actual_charges) || 0,
        notes: form.notes,
      };
      const res = editing
        ? await supabase.from('shipments').update(payload).eq('id', editing.id)
        : await supabase.from('shipments').insert(payload);
      if (res.error) throw new Error(res.error.message);

      // Link / unlink bills. The batch number flows down to PL input and packing list items.
      const wasIn = new Set(bills.filter((b) => b.batch_number === shipmentNo).map((b) => b.id));
      const toAdd = [...pickedBills].filter((id) => !wasIn.has(id));
      const toRemove = [...wasIn].filter((id) => !pickedBills.has(id));
      if (toAdd.length) await setBillsBatch(toAdd, shipmentNo);
      if (toRemove.length) await setBillsBatch(toRemove, null);

      setShowForm(false);
      await loadAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function setBillsBatch(billIds: string[], batch: string | null) {
    const r1 = await supabase.from('purchase_bills').update({ batch_number: batch }).in('id', billIds);
    if (r1.error) throw new Error(r1.error.message);
    const { data: pls } = await supabase.from('pl_input').select('id').in('purchase_bill_id', billIds);
    const plIds = (pls || []).map((p) => p.id);
    if (plIds.length) {
      await supabase.from('pl_input').update({ batch_number: batch || '' }).in('id', plIds);
      await supabase.from('packing_list_items').update({ batch_number: batch }).in('pl_input_id', plIds);
    }
  }

  async function updateStatus(s: Shipment, status: Status) {
    const { error } = await supabase.from('shipments').update({ status }).eq('id', s.id);
    if (error) { setError(error.message); return; }
    setShipments((prev) => prev.map((x) => (x.id === s.id ? { ...x, status } : x)));
  }

  // Shipment summary → new window → browser Print / Save as PDF
  async function printShipment(s: Shipment) {
    const linked = bills.filter((b) => b.batch_number === s.shipment_no);
    const { data: items } = await supabase
      .from('packing_list_items')
      .select('packing_list_no, item_name, quantity, unit, no_of_pkgs, weight_kg, cbm')
      .eq('batch_number', s.shipment_no)
      .order('packing_list_no', { ascending: true });
    const { data: cost } = await supabase
      .from('costing_duty_sheet')
      .select('description, qty, unit_price_cny, cny_rate, duty_per_unit, landed_cost_per_unit, total_landed_cost, type')
      .eq('batch_number', s.shipment_no);
    const w = window.open('', '_blank', 'width=900,height=1000');
    if (!w) { alert('Pop-up blocked — allow pop-ups for this site to print.'); return; }
    const rows = (items || []) as { packing_list_no: string; item_name: string; quantity: number; unit: string; no_of_pkgs: number; weight_kg: number; cbm: number }[];
    const crow = (cost || []) as { description: string; qty: number; unit_price_cny: number; cny_rate: number; duty_per_unit: number; landed_cost_per_unit: number; total_landed_cost: number; type: string }[];
    const n = (v: number, d = 2) => (Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
    const d = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');
    // packages are entered once per PL number (its first row), same as the Packing List screen
    const firstOfPl = (r: { packing_list_no: string }, i: number) => rows.findIndex((x) => x.packing_list_no === r.packing_list_no) === i;
    const tCbm = rows.reduce((a, r) => a + (Number(r.cbm) || 0), 0), tKg = rows.reduce((a, r) => a + (Number(r.weight_kg) || 0), 0), tPk = rows.reduce((a, r, i) => a + (firstOfPl(r, i) ? Number(r.no_of_pkgs) || 0 : 0), 0);
    const tCny = linked.reduce((a, b) => a + b.total_cny, 0);
    const tLanded = crow.reduce((a, r) => a + (Number(r.total_landed_cost) || 0), 0);
    const tCharges = crow.reduce((a, r) => a + (Number(r.duty_per_unit) || 0) * (Number(r.qty) || 0), 0);
    const basisRate = s.default_basis === 'KG' ? `LKR ${n(s.rate_kg, 0)} / kg` : s.default_basis === 'PCS' ? `LKR ${n(s.rate_pcs, 0)} / pc` : `LKR ${n(s.rate_cbm, 0)} / CBM`;
    w.document.write(`<!doctype html><html><head><title>${esc(s.shipment_no)}</title><style>
      body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:28px;font-size:12px} h1{font-size:20px;margin:0} h2{font-size:14px;margin:22px 0 6px;border-bottom:2px solid #0d9488;padding-bottom:3px;color:#0f766e}
      .sub{color:#555;font-size:11px} .head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
      .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px} .box{border:1px solid #ddd;border-radius:6px;padding:8px} .box .l{font-size:10px;color:#666;text-transform:uppercase} .box .v{font-size:14px;font-weight:700;margin-top:2px}
      table{width:100%;border-collapse:collapse;font-size:11.5px} th,td{padding:5px 7px;border-bottom:1px solid #e5e5e5;text-align:left} th{background:#f3f4f6;font-weight:600} .r{text-align:right} tfoot td{font-weight:700;border-top:2px solid #333}
      .badge{display:inline-block;padding:2px 8px;border-radius:10px;background:#e6fffa;color:#0f766e;font-weight:600;font-size:11px} .note{margin-top:18px;color:#555;font-size:11px} @media print{body{padding:0}}
    </style></head><body>
      <div class="head"><div><h1>${esc(companyFor((s as { book?: string | null }).book).name)}</h1><div class="sub">${esc(companyFor((s as { book?: string | null }).book).address)}</div></div>
      <div style="text-align:right"><div style="font-size:16px;font-weight:700">${esc(s.shipment_no)}</div><div class="sub">${s.mode === 'LCL' ? 'Loose cargo (LCL)' : 'Container (FCL)'} · <span class="badge">${esc(s.status)}</span></div><div class="sub">Printed ${new Date().toLocaleDateString('en-GB')}</div></div></div>
      <div class="grid">
        <div class="box"><div class="l">Forwarder</div><div class="v">${esc(s.forwarder || '—')}</div></div>
        <div class="box"><div class="l">ETD</div><div class="v">${d(s.eta)}</div></div>
        <div class="box"><div class="l">Rate</div><div class="v">${basisRate}</div></div>
        <div class="box"><div class="l">Charges</div><div class="v">${s.actual_charges > 0 ? `LKR ${n(s.actual_charges, 0)}` : tCharges > 0 ? `LKR ${n(tCharges, 0)} (on items)` : '—'}</div></div>
        <div class="box"><div class="l">Bills</div><div class="v">${linked.length}</div></div>
        <div class="box"><div class="l">Goods value</div><div class="v">¥${n(tCny, 0)}</div></div>
        <div class="box"><div class="l">Volume / weight</div><div class="v">${n(tCbm, 3)} CBM · ${n(tKg, 1)} kg</div></div>
        <div class="box"><div class="l">Landed cost</div><div class="v">${tLanded > 0 ? `LKR ${n(tLanded, 0)}` : '—'}</div></div>
      </div>
      <h2>Bills in this shipment</h2>
      <table><thead><tr><th>Bill</th><th>Supplier</th><th>Date</th><th class="r">Value CNY</th></tr></thead>
      <tbody>${linked.map((b) => `<tr><td>${esc(b.cnv_invoice_number || b.bill_number)}</td><td>${esc(b.supplier_name)}</td><td>${d(b.bill_date)}</td><td class="r">${n(b.total_cny)}</td></tr>`).join('') || '<tr><td colspan="4">No bills linked</td></tr>'}</tbody>
      <tfoot><tr><td colspan="3">Total</td><td class="r">${n(tCny)}</td></tr></tfoot></table>
      <h2>Packing list</h2>
      <table><thead><tr><th>PL</th><th>Item</th><th class="r">Qty</th><th>Unit</th><th class="r">Pkgs</th><th class="r">Kg</th><th class="r">CBM</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr><td>${esc(r.packing_list_no)}</td><td>${esc(r.item_name)}</td><td class="r">${n(r.quantity, 0)}</td><td>${esc(r.unit || '')}</td><td class="r">${firstOfPl(r, i) ? n(r.no_of_pkgs, 0) : ''}</td><td class="r">${n(r.weight_kg, 1)}</td><td class="r">${n(r.cbm, 3)}</td></tr>`).join('') || '<tr><td colspan="7">No packing list rows yet</td></tr>'}</tbody>
      <tfoot><tr><td colspan="4">Total</td><td class="r">${n(tPk, 0)}</td><td class="r">${n(tKg, 1)}</td><td class="r">${n(tCbm, 3)}</td></tr></tfoot></table>
      ${crow.length > 0 ? `<h2>Landed cost</h2>
      <table><thead><tr><th>Item</th><th>Type</th><th class="r">Qty</th><th class="r">CNY</th><th class="r">Rate</th><th class="r">Charges/unit</th><th class="r">Landed/unit</th><th class="r">Total landed</th></tr></thead>
      <tbody>${crow.map((r) => `<tr><td>${esc(r.description)}</td><td>${esc(r.type)}</td><td class="r">${n(r.qty, 0)}</td><td class="r">${n(r.unit_price_cny)}</td><td class="r">${n(r.cny_rate)}</td><td class="r">${n(r.duty_per_unit)}</td><td class="r">${n(r.landed_cost_per_unit)}</td><td class="r">${n(r.total_landed_cost, 0)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="7">Total</td><td class="r">${n(tLanded, 0)}</td></tr></tfoot></table>` : ''}
      ${s.notes ? `<div class="note"><b>Notes:</b> ${esc(s.notes)}</div>` : ''}
      <script>window.onload=function(){window.print()}</script>
    </body></html>`);
    w.document.close();
  }

  async function remove(s: Shipment) {
    const linked = bills.filter((b) => b.batch_number === s.shipment_no);
    const msg = linked.length
      ? `Delete shipment ${s.shipment_no}? Its ${linked.length} bill(s) will be unlinked (not deleted) and their packing lists will lose the batch number.`
      : `Delete shipment ${s.shipment_no}?`;
    if (!confirm(msg)) return;
    setSaving(true);
    try {
      if (linked.length) await setBillsBatch(linked.map((b) => b.id), null);
      const { error } = await supabase.from('shipments').delete().eq('id', s.id);
      if (error) throw new Error(error.message);
      await loadAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const shipmentNos = useMemo(() => new Set(shipments.map((s) => s.shipment_no)), [shipments]);
  const availableBills = useMemo(
    () => bills.filter((b) => !b.batch_number || !shipmentNos.has(b.batch_number) || (editing && b.batch_number === editing.shipment_no)),
    [bills, editing, shipmentNos]
  );

  const rateLabel = (s: Shipment) => {
    const parts: string[] = [];
    if (s.rate_cbm) parts.push(`${fmt(s.rate_cbm)}/CBM`);
    if (s.rate_kg) parts.push(`${fmt(s.rate_kg)}/kg`);
    if (s.rate_pcs) parts.push(`${fmt(s.rate_pcs)}/pc`);
    return parts.join(' · ') || '—';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-teal-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Shipping</h2>
          <p className="text-sm text-gray-500">Containers and loose-cargo drops. Each shipment's number is the batch used by PL Input and Costing.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadAll} className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={openNew} className="flex items-center space-x-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-medium">
            <Plus className="w-4 h-4" />
            <span>New shipment</span>
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2">{error}</div>}

      {shipments.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-500">
          <Ship className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          No shipments yet. Create one, tick the bills going in it, and the batch number is set for you.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Shipment</th>
                <th className="text-left px-3 py-3">Forwarder</th>
                <th className="text-right px-3 py-3">Bills</th>
                <th className="text-right px-3 py-3">CBM</th>
                <th className="text-right px-3 py-3">Kg</th>
                <th className="text-left px-3 py-3">Rate (LKR)</th>
                <th className="text-right px-3 py-3">Landed LKR</th>
                <th className="text-right px-3 py-3">Resale profit</th>
                <th className="text-left px-3 py-3">Status</th>
                <th className="text-left px-3 py-3">ETD</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shipments.map((s) => {
                const st = stats[s.shipment_no];
                const linked = bills.filter((b) => b.batch_number === s.shipment_no);
                const open = expanded === s.id;
                return (
                  <>
                    <tr key={s.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setExpanded(open ? null : s.id)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {s.mode === 'FCL' ? <Container className="w-4 h-4 text-teal-600" /> : <Boxes className="w-4 h-4 text-amber-600" />}
                          <div>
                            <div className="font-semibold text-gray-900">{s.shipment_no}</div>
                            <div className="text-xs text-gray-500">{s.mode === 'FCL' ? 'Container' : 'Loose cargo'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-gray-700">{s.forwarder || '—'}</td>
                      <td className="px-3 py-3 text-right">{linked.length}</td>
                      <td className="px-3 py-3 text-right">{st ? fmt(st.cbm, 2) : '—'}</td>
                      <td className="px-3 py-3 text-right">{st ? fmt(st.kg) : '—'}</td>
                      <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{rateLabel(s)}</td>
                      <td className="px-3 py-3 text-right">{st && st.items ? fmt(st.landed) : '—'}</td>
                      <td className={`px-3 py-3 text-right font-medium ${st && st.sales ? (st.profit >= 0 ? 'text-green-700' : 'text-red-600') : 'text-gray-400'}`}>
                        {st && st.sales ? fmt(st.profit) : '—'}
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={s.status}
                          onChange={(e) => updateStatus(s, e.target.value as Status)}
                          className={`text-xs font-medium rounded-full px-2 py-1 border-0 ${STATUS_STYLE[s.status]}`}
                        >
                          {STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{s.eta ? new Date(s.eta).toLocaleDateString('en-GB') : '—'}</td>
                      <td className="px-3 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setCharging(s as unknown as ChargeShipment)} className="px-2 py-1 mr-1 text-xs font-semibold border border-teal-600 text-teal-700 rounded hover:bg-teal-50 inline-flex items-center gap-1" title="Shipping charges per bill and the agent's account"><Banknote className="w-3.5 h-3.5" />Charges</button>
                        <button onClick={() => printShipment(s)} className="p-1.5 text-gray-500 hover:text-teal-700" title="Print / Save as PDF"><Printer className="w-4 h-4" /></button>
                        <button onClick={() => openEdit(s)} className="p-1.5 text-gray-500 hover:text-teal-700" title="Edit"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => remove(s)} className="p-1.5 text-gray-500 hover:text-red-600" title="Delete"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                    {open && (
                      <tr key={`${s.id}-x`} className="bg-gray-50">
                        <td colSpan={11} className="px-6 py-3">
                          {linked.length === 0 ? (
                            <p className="text-sm text-gray-500">No bills linked yet — click Edit and tick the bills going in this shipment.</p>
                          ) : (
                            <table className="text-xs w-full max-w-3xl">
                              <thead><tr className="text-gray-500"><th className="text-left py-1">Bill</th><th className="text-left py-1">Supplier</th><th className="text-left py-1">Date</th><th className="text-right py-1">Value CNY</th></tr></thead>
                              <tbody>
                                {linked.map((b) => (
                                  <tr key={b.id} className="border-t border-gray-200">
                                    <td className="py-1 font-medium">{b.cnv_invoice_number || b.bill_number}</td>
                                    <td className="py-1">{b.supplier_name}</td>
                                    <td className="py-1">{b.bill_date ? new Date(b.bill_date).toLocaleDateString('en-GB') : ''}</td>
                                    <td className="py-1 text-right">{fmt(b.total_cny, 2)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          {s.actual_charges > 0 && (
                            <p className="text-xs text-gray-600 mt-2">Actual shipment charges: LKR {fmt(s.actual_charges, 2)}</p>
                          )}
                          {s.notes && <p className="text-xs text-gray-600 mt-1">{s.notes}</p>}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={() => !saving && setShowForm(false)}>
          <div className="bg-white sm:rounded-xl shadow-xl w-full max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">{editing ? `Edit ${editing.shipment_no}` : 'New shipment'}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4 flex-1 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                  <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                    {(['LCL', 'FCL'] as Mode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        disabled={!!editing}
                        onClick={() => changeMode(m)}
                        className={`flex-1 px-3 py-2 text-sm font-medium ${form.mode === m ? 'bg-teal-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'} disabled:opacity-70`}
                      >
                        {m === 'LCL' ? 'Loose cargo' : 'Container'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Shipment no.</label>
                  <div className="px-3 py-2 bg-gray-100 rounded-lg text-sm font-mono text-gray-800">{previewNo || '…'}</div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Forwarder / consolidator</label>
                  <input value={form.forwarder} onChange={(e) => setForm({ ...form, forwarder: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" placeholder="e.g. Guangzhou Cargo Co." />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">ETD (departure date)</label>
                  <input type="date" value={form.eta} onChange={(e) => setForm({ ...form, eta: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
              </div>

              <div className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-600">Charge rates (LKR) — pre-filled into Costing for this batch</span>
                  <label className="text-xs text-gray-600 flex items-center gap-1">
                    Default basis
                    <select value={form.default_basis} onChange={(e) => setForm({ ...form, default_basis: e.target.value as Basis })} className="text-xs border border-gray-300 rounded px-1 py-0.5">
                      <option value="CBM">CBM</option><option value="KG">KG</option><option value="PCS">PCS</option>
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div><label className="block text-[11px] text-gray-500 mb-1">Per CBM</label><input type="number" value={form.rate_cbm} onChange={(e) => setForm({ ...form, rate_cbm: e.target.value })} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded" placeholder="85000" /></div>
                  <div><label className="block text-[11px] text-gray-500 mb-1">Per kg</label><input type="number" value={form.rate_kg} onChange={(e) => setForm({ ...form, rate_kg: e.target.value })} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded" placeholder="350" /></div>
                  <div><label className="block text-[11px] text-gray-500 mb-1">Per piece</label><input type="number" value={form.rate_pcs} onChange={(e) => setForm({ ...form, rate_pcs: e.target.value })} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded" placeholder="0" /></div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Status })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg">
                    {STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Actual shipment charges (LKR, when invoiced)</label>
                  <input type="number" value={form.actual_charges} onChange={(e) => setForm({ ...form, actual_charges: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" placeholder="Freight + clearing + duty + transport" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Bills in this shipment</label>
                {availableBills.length === 0 ? (
                  <p className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg p-3">No bills to add. Bills already in another shipment don't appear here — create a bill first under Bills.</p>
                ) : (
                  <div className="border border-gray-200 rounded-lg max-h-56 overflow-y-auto divide-y divide-gray-100">
                    {availableBills.map((b) => (
                      <label key={b.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pickedBills.has(b.id)}
                          onChange={(e) => setPickedBills((prev) => { const n = new Set(prev); if (e.target.checked) n.add(b.id); else n.delete(b.id); return n; })}
                        />
                        <span className="font-medium sm:w-28">{b.cnv_invoice_number || b.bill_number}</span>
                        {b.batch_number && !shipmentNos.has(b.batch_number) && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">old batch {b.batch_number}</span>}
                        <span className="flex-1 text-gray-700 truncate">{b.supplier_name}</span>
                        <span className="text-xs text-gray-500">{b.bill_date ? new Date(b.bill_date).toLocaleDateString('en-GB') : ''}</span>
                        <span className="text-xs text-gray-700 sm:w-24 text-right ml-auto">¥{fmt(b.total_cny, 0)}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200 bg-white sm:rounded-b-xl">
              <button onClick={() => setShowForm(false)} disabled={saving} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Create shipment'}
              </button>
            </div>
          </div>
        </div>
      )}
      {charging && <ShipmentCharges shipment={charging} onClose={() => setCharging(null)} onSaved={loadAll} />}
    </div>
  );
}
