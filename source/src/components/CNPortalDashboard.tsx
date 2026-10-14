import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { RefreshCw, Ship, ClipboardList, Receipt, ClipboardCheck, AlertTriangle, DollarSign, TrendingUp, ChevronRight, Container } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell, ComposedChart, Line } from 'recharts';

interface Shipment { id: string; shipment_no: string; mode: string; forwarder: string; eta: string | null; status: string; actual_charges: number; rate_cbm: number; rate_kg: number; rate_pcs: number; default_basis: string; created_at: string; }
interface Bill { id: string; bill_number: string; cnv_invoice_number: string | null; bill_date: string; due_date: string | null; batch_number: string | null; status: string; amount_paid: number; exchange_rate: number; purchase_orders: { suppliers: { name: string } | null } | null; purchase_bill_items: { quantity_received: number; unit_price_cny: number }[]; }
interface PL { id: string; batch_number: string | null; expected: boolean; received: boolean; entered_in_register: boolean; }
interface PLI { batch_number: string | null; cbm: number; weight_kg: number; }
interface CostRow { batch_number: string | null; qty: number; cbm: number; weight_kg: number; unit_price_cny: number; unit_price_lkr: number; duty_per_unit: number; total_landed_cost: number; total_sales: number; selling_price: number; type: string; created_at: string; }
interface Pay { payment_date: string; amount: number; purchase_bill_id: string | null; }

interface Props { onNavigate?: (view: string, filter?: { status?: string; supplierId?: string }) => void; }

const n0 = (v: number) => Math.round(v).toLocaleString();
const rs = (v: number) => `Rs.${n0(v)}`;
const cny = (v: number) => `¥${n0(v)}`;
const ym = (d: string | null | undefined) => (d || '').slice(0, 7);   // a record with no date must not crash the dashboard
const monthLabel = (k: string) => new Date(k + '-01').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
const lastMonths = (n: number) => { const out: string[] = []; const d = new Date(); for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`); } return out; };
const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : `${v}`);

export default function CNPortalDashboard({ onNavigate, embedded = false }: Props & { embedded?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [pls, setPls] = useState<PL[]>([]);
  const [plItems, setPlItems] = useState<PLI[]>([]);
  const [cost, setCost] = useState<CostRow[]>([]);
  const [pays, setPays] = useState<Pay[]>([]);
  const [poCount, setPoCount] = useState(0);
  const [openPoCount, setOpenPoCount] = useState(0);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [s, b, p, pi, c, py, po, poOpen] = await Promise.all([
      supabase.from('shipments').select('id, shipment_no, mode, forwarder, eta, status, actual_charges, rate_cbm, rate_kg, rate_pcs, default_basis, created_at').order('created_at', { ascending: false }),
      supabase.from('purchase_bills').select('id, bill_number, cnv_invoice_number, bill_date, due_date, batch_number, status, amount_paid, exchange_rate, purchase_orders(suppliers(name)), purchase_bill_items(quantity_received, unit_price_cny)'),
      supabase.from('pl_input').select('id, batch_number, expected, received, entered_in_register'),
      supabase.from('packing_list_items').select('batch_number, cbm, weight_kg'),
      supabase.from('costing_duty_sheet').select('batch_number, qty, cbm, weight_kg, unit_price_cny, unit_price_lkr, duty_per_unit, total_landed_cost, total_sales, selling_price, type, created_at'),
      supabase.from('purchase_payments').select('payment_date, amount, purchase_bill_id'),
      supabase.from('purchase_orders').select('id', { count: 'exact', head: true }),
      supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).in('status', ['pending', 'confirmed']),
    ]);
    setShipments((s.data || []) as Shipment[]);
    setBills((b.data || []) as unknown as Bill[]);
    setPls((p.data || []) as PL[]);
    setPlItems((pi.data || []) as PLI[]);
    setCost((c.data || []) as CostRow[]);
    setPays((py.data || []) as Pay[]);
    setPoCount(po.count || 0);
    setOpenPoCount(poOpen.count || 0);
    setLoading(false);
  }

  const billTotal = (b: Bill) => (b.purchase_bill_items || []).reduce((s, i) => s + (i.quantity_received || 0) * (i.unit_price_cny || 0), 0);
  const supplierOf = (b: Bill) => b.purchase_orders?.suppliers?.name || 'Unknown';
  const shipNos = useMemo(() => new Set(shipments.map((s) => s.shipment_no)), [shipments]);
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const lastRate = useMemo(() => { const r = [...cost].sort((a, b) => b.created_at.localeCompare(a.created_at)).find((c) => c.unit_price_cny > 0 && c.unit_price_lkr > 0); return r ? r.unit_price_lkr / r.unit_price_cny : 0; }, [cost]);

  // ---- per shipment ----
  const perShipment = useMemo(() => {
    const plAgg: Record<string, { cbm: number; kg: number }> = {};
    for (const r of plItems) if (r.batch_number) { const a = (plAgg[r.batch_number] ||= { cbm: 0, kg: 0 }); a.cbm += Number(r.cbm) || 0; a.kg += Number(r.weight_kg) || 0; }
    const costAgg: Record<string, CostRow[]> = {};
    for (const r of cost) if (r.batch_number) (costAgg[r.batch_number] ||= []).push(r);
    return shipments.map((sh) => {
      const bs = bills.filter((b) => b.batch_number === sh.shipment_no);
      const rows = costAgg[sh.shipment_no] || [];
      const pl = plAgg[sh.shipment_no] || { cbm: 0, kg: 0 };
      const cbm = pl.cbm || rows.reduce((s, r) => s + r.cbm, 0);
      const kg = pl.kg || rows.reduce((s, r) => s + r.weight_kg, 0);
      const productCny = bs.reduce((s, b) => s + billTotal(b), 0);
      const productCost = rows.reduce((s, r) => s + r.unit_price_lkr * r.qty, 0);
      const estCharges = rows.reduce((s, r) => s + r.duty_per_unit * r.qty, 0);
      const rateEst = sh.default_basis === 'KG' ? kg * sh.rate_kg : sh.default_basis === 'PCS' ? rows.reduce((s, r) => s + r.qty, 0) * sh.rate_pcs : cbm * sh.rate_cbm;
      const charges = sh.actual_charges > 0 ? sh.actual_charges : estCharges > 0 ? estCharges : rateEst;
      const landed = rows.reduce((s, r) => s + r.total_landed_cost, 0);
      const sales = rows.filter((r) => r.type === 'RESALE').reduce((s, r) => s + r.total_sales, 0);
      const factory = rows.filter((r) => r.type === 'FACTORY').reduce((s, r) => s + r.total_landed_cost, 0);
      const profit = sales + factory - (productCost + charges);
      const margin = sales > 0 ? (profit / sales) * 100 : 0;
      const missing = rows.filter((r) => !r.unit_price_cny || !r.cbm || (r.type === 'RESALE' && !r.selling_price)).length;
      const daysSinceEtd = sh.eta ? Math.floor((Date.now() - new Date(sh.eta).getTime()) / 86400000) : null;
      const unpaidCny = bs.reduce((s, b) => s + Math.max(0, billTotal(b) - (b.amount_paid || 0)), 0);
      return { sh, bills: bs.length, cbm, kg, productCny, productCost, charges, chargesActual: sh.actual_charges > 0, landed, sales, factory, profit, margin, rows: rows.length, missing, daysSinceEtd, unpaidCny, costPerCbm: cbm > 0 ? charges / cbm : 0 };
    });
  }, [shipments, bills, plItems, cost]); // eslint-disable-line react-hooks/exhaustive-deps

  const inProgress = perShipment.filter((p) => p.sh.status !== 'Cleared');
  const cleared = perShipment.filter((p) => p.sh.status === 'Cleared');
  const lastShipments = [...perShipment].filter((p) => p.rows > 0).sort((a, b) => a.sh.created_at.localeCompare(b.sh.created_at)).slice(-6);
  const incomplete = perShipment.filter((p) => p.missing > 0);

  // ---- KPIs ----
  const billsNotShipped = bills.filter((b) => !b.batch_number || !shipNos.has(b.batch_number));
  const plsPending = pls.filter((p) => !p.received);
  const unpaidBills = bills.filter((b) => b.status !== 'paid' && billTotal(b) - (b.amount_paid || 0) > 0.5);
  const payableCny = unpaidBills.reduce((s, b) => s + billTotal(b) - (b.amount_paid || 0), 0);
  const overdueBills = unpaidBills.filter((b) => b.due_date && b.due_date < today);
  const overdueCny = overdueBills.reduce((s, b) => s + billTotal(b) - (b.amount_paid || 0), 0);
  const paidThisMonth = pays.filter((p) => ym(p.payment_date) === thisMonth).reduce((s, p) => s + p.amount, 0);
  const boughtThisMonth = bills.filter((b) => ym(b.bill_date) === thisMonth).reduce((s, b) => s + billTotal(b), 0);
  const landedThisMonth = cost.filter((c) => ym(c.created_at) === thisMonth).reduce((s, c) => s + c.total_landed_cost, 0);

  // ---- charts ----
  const months = lastMonths(6);
  const monthly = months.map((m) => ({
    month: monthLabel(m),
    Purchased: Math.round(bills.filter((b) => ym(b.bill_date) === m).reduce((s, b) => s + billTotal(b), 0)),
    Paid: Math.round(pays.filter((p) => ym(p.payment_date) === m).reduce((s, p) => s + p.amount, 0)),
  }));
  const profitChart = lastShipments.map((p) => ({ name: p.sh.shipment_no, Profit: Math.round(p.profit), Charges: Math.round(p.charges), 'Product cost': Math.round(p.productCost) }));
  const cbmChart = lastShipments.map((p) => ({ name: p.sh.shipment_no, 'Charges / CBM': Math.round(p.costPerCbm), CBM: +p.cbm.toFixed(2) }));
  const supplierAgg = useMemo(() => {
    const cutoff = months[0];
    const m: Record<string, { name: string; value: number; unpaid: number }> = {};
    for (const b of bills) { if (ym(b.bill_date) < cutoff) continue; const a = (m[supplierOf(b)] ||= { name: supplierOf(b), value: 0, unpaid: 0 }); a.value += billTotal(b); a.unpaid += b.status !== 'paid' ? Math.max(0, billTotal(b) - (b.amount_paid || 0)) : 0; }
    return Object.values(m).sort((a, b) => b.value - a.value).slice(0, 8).map((x) => ({ ...x, value: Math.round(x.value), unpaid: Math.round(x.unpaid) }));
  }, [bills]); // eslint-disable-line react-hooks/exhaustive-deps
  const supplierDue = useMemo(() => {
    const m: Record<string, { name: string; due: number; overdue: number; bills: number }> = {};
    for (const b of unpaidBills) { const a = (m[supplierOf(b)] ||= { name: supplierOf(b), due: 0, overdue: 0, bills: 0 }); const d = billTotal(b) - (b.amount_paid || 0); a.due += d; a.bills += 1; if (b.due_date && b.due_date < today) a.overdue += d; }
    return Object.values(m).sort((a, b) => b.due - a.due);
  }, [bills]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusTone: Record<string, string> = { Booked: 'bg-gray-100 text-gray-700', Shipped: 'bg-teal-100 text-teal-800', Arrived: 'bg-amber-100 text-amber-800', Cleared: 'bg-green-100 text-green-800' };
  const card = 'bg-white rounded-xl border border-gray-200 p-4';
  const go = (v: string) => onNavigate?.(v);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" /></div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          {!embedded && <h2 className="text-2xl font-bold text-gray-900">CN Portal Dashboard</h2>}
          <p className="text-sm text-gray-500">Loose cargo pipeline, supplier payables and shipment profit</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"><RefreshCw className="w-4 h-4" />Refresh</button>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {[
          { label: 'Shipments in progress', value: String(inProgress.length), sub: `${cleared.length} cleared`, icon: Ship, tone: 'text-teal-600 bg-teal-50', view: 'shipping' },
          { label: 'Open POs', value: `${openPoCount}`, sub: `of ${poCount} total`, icon: ClipboardList, tone: 'text-teal-700 bg-teal-50', view: 'purchase-orders' },
          { label: 'Bills not in a shipment', value: String(billsNotShipped.length), sub: `${bills.length} bills total`, icon: Receipt, tone: 'text-indigo-600 bg-indigo-50', view: 'shipping' },
          { label: 'Packing lists awaited', value: String(plsPending.length), sub: `${pls.length - plsPending.length} received`, icon: ClipboardCheck, tone: 'text-cyan-600 bg-cyan-50', view: 'pl-input' },
          { label: 'Payable to suppliers', value: cny(payableCny), sub: overdueCny > 0 ? `${cny(overdueCny)} overdue` : `≈ ${rs(payableCny * lastRate)}`, icon: DollarSign, tone: overdueCny > 0 ? 'text-red-600 bg-red-50' : 'text-amber-600 bg-amber-50', view: 'outstanding-payments' },
          { label: 'Bought this month', value: cny(boughtThisMonth), sub: `paid ${cny(paidThisMonth)} · landed ${rs(landedThisMonth)}`, icon: TrendingUp, tone: 'text-emerald-600 bg-emerald-50', view: 'reports' },
        ].map((k) => (
          <button key={k.label} onClick={() => go(k.view)} className={`${card} text-left hover:shadow-md transition-shadow`}>
            <div className="flex items-center justify-between mb-2"><span className={`p-2 rounded-lg ${k.tone}`}><k.icon className="w-4 h-4" /></span><ChevronRight className="w-4 h-4 text-gray-300" /></div>
            <p className="text-xs text-gray-500">{k.label}</p>
            <p className="text-lg font-bold text-gray-900 truncate">{k.value}</p>
            <p className="text-[11px] text-gray-500 truncate">{k.sub}</p>
          </button>
        ))}
      </div>

      {incomplete.length > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-amber-800">Costing incomplete:</span>{' '}
            {incomplete.map((p) => `${p.sh.shipment_no} (${p.missing} row${p.missing > 1 ? 's' : ''})`).join(', ')} — rows missing CNY price, CBM or selling price. Profit figures for these shipments are not reliable yet.
            <button onClick={() => go('costing-duty')} className="ml-2 text-amber-800 underline">Open Costing</button>
          </div>
        </div>
      )}

      {/* Shipments in progress */}
      <div className={card}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Container className="w-5 h-5 text-teal-600" />Shipments in progress</h3>
          <button onClick={() => go('shipping')} className="text-sm text-teal-700 hover:underline">All shipments →</button>
        </div>
        {inProgress.length === 0 ? <p className="text-sm text-gray-500">No open shipments. Create one under Shipping when the next loose cargo is booked.</p> : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {inProgress.map((p) => (
              <button key={p.sh.id} onClick={() => go('shipping')} className="text-left border border-gray-200 rounded-lg p-3 hover:bg-gray-50">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono font-semibold text-gray-900">{p.sh.shipment_no}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusTone[p.sh.status] || ''}`}>{p.sh.status}</span>
                </div>
                <p className="text-xs text-gray-500 mb-2">{p.sh.mode === 'LCL' ? 'Loose cargo' : 'Container'}{p.sh.forwarder ? ` · ${p.sh.forwarder}` : ''}{p.sh.eta ? ` · ETD ${new Date(p.sh.eta).toLocaleDateString('en-GB')}` : ''}{p.daysSinceEtd !== null && p.daysSinceEtd >= 0 ? ` · ${p.daysSinceEtd}d ago` : ''}</p>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><p className="text-gray-400">Bills</p><p className="font-semibold">{p.bills}</p></div>
                  <div><p className="text-gray-400">CBM / kg</p><p className="font-semibold">{p.cbm.toFixed(2)} / {n0(p.kg)}</p></div>
                  <div><p className="text-gray-400">Goods CNY</p><p className="font-semibold">{cny(p.productCny)}</p></div>
                  <div><p className="text-gray-400">Charges {p.chargesActual ? '(act)' : '(est)'}</p><p className="font-semibold">{rs(p.charges)}</p></div>
                  <div><p className="text-gray-400">Landed</p><p className="font-semibold">{rs(p.landed)}</p></div>
                  <div><p className="text-gray-400">Unpaid</p><p className={`font-semibold ${p.unpaidCny > 0 ? 'text-amber-700' : 'text-green-700'}`}>{cny(p.unpaidCny)}</p></div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Charts row 1 */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-1">Purchases vs payments (CNY, last 6 months)</h3>
          <p className="text-xs text-gray-500 mb-3">Bills raised each month against money actually sent to suppliers</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthly} margin={{ left: 0, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} width={44} />
              <Tooltip formatter={(v) => cny(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Purchased" fill="#e8552a" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Paid" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-1">Profit by shipment (LKR)</h3>
          <p className="text-xs text-gray-500 mb-3">Resale profit after product cost and shipment charges; factory goods at landed cost</p>
          {profitChart.length === 0 ? <p className="text-sm text-gray-500 py-16 text-center">No costed shipments yet.</p> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={profitChart} margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} width={44} />
                <Tooltip formatter={(v) => rs(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Product cost" stackId="a" fill="#94a3b8" />
                <Bar dataKey="Charges" stackId="a" fill="#fbbf24" />
                <Bar dataKey="Profit" radius={[4, 4, 0, 0]}>{profitChart.map((d, i) => <Cell key={i} fill={d.Profit >= 0 ? '#10b981' : '#ef4444'} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-1">Shipment charges per CBM (LKR)</h3>
          <p className="text-xs text-gray-500 mb-3">Is the consolidator getting cheaper or dearer? Bars = CBM shipped</p>
          {cbmChart.length === 0 ? <p className="text-sm text-gray-500 py-16 text-center">No data yet.</p> : (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={cbmChart} margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="l" tickFormatter={compact} tick={{ fontSize: 11 }} width={44} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} width={36} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="r" dataKey="CBM" fill="#ccfbf1" radius={[4, 4, 0, 0]} />
                <Line yAxisId="l" type="monotone" dataKey="Charges / CBM" stroke="#e8552a" strokeWidth={2} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-1">Purchases by supplier (CNY, last 6 months)</h3>
          <p className="text-xs text-gray-500 mb-3">Grey = still unpaid</p>
          {supplierAgg.length === 0 ? <p className="text-sm text-gray-500 py-16 text-center">No bills in this period.</p> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={supplierAgg} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={compact} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                <Tooltip formatter={(v) => cny(Number(v))} />
                <Bar dataKey="value" name="Purchased" fill="#e8552a" radius={[0, 4, 4, 0]} />
                <Bar dataKey="unpaid" name="Unpaid" fill="#cbd5e1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Supplier payments due + last shipments table */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Supplier payments due</h3>
            <button onClick={() => go('outstanding-payments')} className="text-sm text-teal-700 hover:underline">Details →</button>
          </div>
          {supplierDue.length === 0 ? <p className="text-sm text-gray-500">All bills paid.</p> : (
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase"><tr><th className="text-left py-1">Supplier</th><th className="text-right py-1">Bills</th><th className="text-right py-1">Due CNY</th><th className="text-right py-1">Overdue</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {supplierDue.map((s) => (
                  <tr key={s.name}>
                    <td className="py-1.5 font-medium">{s.name}</td><td className="py-1.5 text-right">{s.bills}</td>
                    <td className="py-1.5 text-right font-semibold">{cny(s.due)}</td>
                    <td className={`py-1.5 text-right ${s.overdue > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>{s.overdue > 0 ? cny(s.overdue) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="font-semibold border-t"><tr><td className="py-1.5">Total</td><td className="py-1.5 text-right">{unpaidBills.length}</td><td className="py-1.5 text-right">{cny(payableCny)}</td><td className="py-1.5 text-right text-red-600">{overdueCny > 0 ? cny(overdueCny) : '—'}</td></tr></tfoot>
            </table>
          )}
        </div>
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Last shipments</h3>
            <button onClick={() => go('reports')} className="text-sm text-teal-700 hover:underline">Full report →</button>
          </div>
          {lastShipments.length === 0 ? <p className="text-sm text-gray-500">Nothing costed yet.</p> : (
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase"><tr><th className="text-left py-1">Shipment</th><th className="text-right py-1">CBM</th><th className="text-right py-1">Landed</th><th className="text-right py-1">Profit</th><th className="text-right py-1">Margin</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {[...lastShipments].reverse().map((p) => (
                  <tr key={p.sh.id}>
                    <td className="py-1.5 font-mono">{p.sh.shipment_no}{p.missing > 0 && <span title="Costing incomplete" className="ml-1 text-amber-500">⚠</span>}</td>
                    <td className="py-1.5 text-right">{p.cbm.toFixed(2)}</td>
                    <td className="py-1.5 text-right">{rs(p.landed)}</td>
                    <td className={`py-1.5 text-right font-semibold ${p.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{rs(p.profit)}</td>
                    <td className="py-1.5 text-right">{p.sales > 0 ? `${p.margin.toFixed(1)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
