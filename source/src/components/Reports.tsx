import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase, APP_MODE } from '../lib/supabase';
import { fetchAllPages } from '../lib/fetchAll';
import { BarChart3, Download, RefreshCw } from 'lucide-react';

type Tab = 'shipments' | 'items' | 'suppliers' | 'receipts' | 'profit' | 'warehouse';
import ProfitReport from './ProfitReport';
import WarehouseReport from './WarehouseReport';

interface CostRow {
  id: string;
  batch_number: string | null;
  description: string;
  qty: number;
  unit: string;
  cbm: number;
  weight_kg: number;
  unit_price_cny: number;
  cny_rate: number;
  unit_price_lkr: number;
  type: string;
  duty_basis: string;
  duty_rate: number;
  duty_per_unit: number;
  landed_cost_per_unit: number;
  selling_price: number;
  total_landed_cost: number;
  total_sales: number;
  total_profit: number;
  created_at: string;
}

interface ShipmentRow {
  shipment_no: string;
  mode: string;
  forwarder: string;
  eta: string | null;
  status: string;
  actual_charges: number;
  created_at: string;
}

interface BillRow {
  id: string;
  bill_number: string;
  cnv_invoice_number: string | null;
  bill_date: string;
  batch_number: string | null;
  exchange_rate: number;
  amount_paid: number;
  purchase_orders: { suppliers: { name: string } | { name: string }[] | null } | { suppliers: { name: string } | null }[] | null;
  purchase_bill_items: { quantity_received: number; unit_price_cny: number }[] | null;
}

interface ReceiptRow {
  id: string;
  payment_number: string | null;
  payment_date: string;
  customer_name: string;
  amount: number;
  payment_mode: string;
  reference_number: string | null;
  cheque_number: string | null;
  bank_name: string | null;
  notes: string | null;
  cheque_status: string | null;
  busy_sales_invoices: { invoice_number: string } | { invoice_number: string }[] | null;
}

const n0 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const n2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n3 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
// yyyy-mm-dd -> dd/mm/yyyy (yyyy-mm -> mm/yyyy) for the screen; sorting/filters keep the ISO string
const dmy = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const pct = (n: number) => `${n.toFixed(1)}%`;
const ymOf = (d: string) => (d || '').slice(0, 7);

export default function Reports() {
  const [tab, setTab] = useState<Tab>(APP_MODE === 'shop' ? 'suppliers' : 'shipments');
  const [loading, setLoading] = useState(true);
  const [costRows, setCostRows] = useState<CostRow[]>([]);
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [bills, setBills] = useState<BillRow[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);

  const [startDate, setStartDate] = useState(() => localStorage.getItem('reports-start-date') || '');
  const [onlyShipping, setOnlyShipping] = useState(() => localStorage.getItem('reports-only-shipping') !== '0');
  const [fromRaw, setFrom] = useState('');
  const [to, setTo] = useState('');
  const from = fromRaw && startDate ? (fromRaw > startDate ? fromRaw : startDate) : fromRaw || startDate;
  const saveStart = (d: string) => { setStartDate(d); localStorage.setItem('reports-start-date', d); };
  const saveOnly = (v: boolean) => { setOnlyShipping(v); localStorage.setItem('reports-only-shipping', v ? '1' : '0'); };
  const [modeFilter, setModeFilter] = useState<'all' | 'FCL' | 'LCL' | 'other'>('all');
  const [itemQuery, setItemQuery] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [receiptCustomer, setReceiptCustomer] = useState('');
  const [receiptMode, setReceiptMode] = useState('');
  const [receiptGroup, setReceiptGroup] = useState<'detail' | 'day' | 'month' | 'customer'>('detail');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    // every page (Supabase stops at 1000 rows per call); the book filter is added automatically
    const [c, s, b, r] = await Promise.all([
      fetchAllPages<CostRow>(() => supabase.from('costing_duty_sheet').select('*').order('id')),
      fetchAllPages<ShipmentRow>(() => supabase.from('shipments').select('shipment_no, mode, forwarder, eta, status, actual_charges, created_at').order('id')),
      fetchAllPages<BillRow>(() => supabase.from('purchase_bills').select('id, bill_number, cnv_invoice_number, bill_date, batch_number, exchange_rate, amount_paid, purchase_orders(suppliers(name)), purchase_bill_items(quantity_received, unit_price_cny)').order('id')),
      fetchAllPages<ReceiptRow>(() => supabase.from('busy_sales_payments').select('id, payment_number, payment_date, customer_name, amount, payment_mode, reference_number, cheque_number, bank_name, notes, cheque_status, busy_sales_invoices(invoice_number)').order('id')),
    ]);
    const err = c.error || s.error || b.error || r.error;
    if (err) alert('Could not load all report data: ' + err);
    setCostRows(c.data);
    setShipments(s.data);
    setBills(b.data);
    // returned cheques are not money received (same rule as Payments / receivables)
    setReceipts(r.data.filter((x) => x.cheque_status !== 'returned').sort((x, y) => (y.payment_date || '').localeCompare(x.payment_date || '')));
    setLoading(false);
  }

  const shipmentByNo = useMemo(() => Object.fromEntries(shipments.map((s) => [s.shipment_no, s])), [shipments]);

  // ---------- 1. Shipment profitability ----------
  const shipmentReport = useMemo(() => {
    const groups: Record<string, CostRow[]> = {};
    for (const r of costRows) {
      const k = r.batch_number || '(no batch)';
      (groups[k] ||= []).push(r);
    }
    const rows = Object.entries(groups).map(([batch, rs]) => {
      const sh = shipmentByNo[batch];
      const date = rs.reduce((m, r) => (r.created_at < m ? r.created_at : m), rs[0].created_at).slice(0, 10);
      const productCost = rs.reduce((s, r) => s + r.unit_price_lkr * r.qty, 0);
      const estCharges = rs.reduce((s, r) => s + r.duty_per_unit * r.qty, 0);
      const charges = sh && sh.actual_charges > 0 ? sh.actual_charges : estCharges;
      const landed = rs.reduce((s, r) => s + r.total_landed_cost, 0);
      const sales = rs.filter((r) => r.type === 'RESALE').reduce((s, r) => s + r.total_sales, 0);
      const factory = rs.filter((r) => r.type === 'FACTORY').reduce((s, r) => s + r.total_landed_cost, 0);
      const cbm = rs.reduce((s, r) => s + (r.cbm || 0), 0);
      const kg = rs.reduce((s, r) => s + (r.weight_kg || 0), 0);
      const investment = productCost + charges;
      // not costed yet = no selling prices (and no factory goods) or no product cost in Costing: the charges alone are not a loss
      const costed = productCost > 0 && (sales > 0 || factory > 0);
      const profit = costed ? sales + factory - investment : 0;
      const margin = costed && sales > 0 ? (profit / sales) * 100 : 0;
      const mode = sh ? sh.mode : batch.toUpperCase().startsWith('LCL') ? 'LCL' : batch.toUpperCase().startsWith('FCL') ? 'FCL' : 'other';
      return {
        batch, mode, forwarder: sh?.forwarder || '', status: sh?.status || '', date,
        items: rs.length, cbm, kg, productCost, charges, chargesActual: !!(sh && sh.actual_charges > 0),
        landed, sales, factory, profit, margin, costed, costPerCbm: cbm > 0 ? charges / cbm : 0,
      };
    });
    return rows
      .filter((r) => (!from || r.date >= from) && (!to || r.date <= to) && (!onlyShipping || !!shipmentByNo[r.batch]))
      .filter((r) => modeFilter === 'all' || r.mode === modeFilter)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [costRows, shipmentByNo, from, to, modeFilter, onlyShipping]);

  const shipmentTotals = useMemo(() => {
    const sum = (key: keyof (typeof shipmentReport)[number], rows = shipmentReport) =>
      rows.reduce((s, r) => s + (r[key] as number), 0);
    const byMode = (m: string) => shipmentReport.filter((r) => r.mode === m);
    const mk = (rows: typeof shipmentReport) => {
      const costedRows = rows.filter((r) => r.costed);   // profit / margin only over shipments that are costed
      return {
        n: rows.length, nCosted: costedRows.length, cbm: sum('cbm', rows), charges: sum('charges', rows), landed: sum('landed', rows),
        sales: sum('sales', rows), factory: sum('factory', rows), profit: sum('profit', costedRows),
        costPerCbm: sum('cbm', rows) > 0 ? sum('charges', rows) / sum('cbm', rows) : 0,
        margin: sum('sales', costedRows) > 0 ? (sum('profit', costedRows) / sum('sales', costedRows)) * 100 : 0,
      };
    };
    return { all: mk(shipmentReport), lcl: mk(byMode('LCL')), fcl: mk(byMode('FCL')) };
  }, [shipmentReport]);

  // ---------- 2. Landed cost by item ----------
  const itemReport = useMemo(() => {
    const q = itemQuery.trim().toLowerCase();
    const rows = costRows
      .filter((r) => !q || (r.description || '').toLowerCase().includes(q))
      .filter((r) => (!from || r.created_at.slice(0, 10) >= from) && (!to || r.created_at.slice(0, 10) <= to))
      .map((r) => ({
        item: r.description, batch: r.batch_number || '', date: r.created_at.slice(0, 10),
        qty: r.qty, unit: r.unit, cny: r.unit_price_cny, rate: r.cny_rate, lkr: r.unit_price_lkr,
        duty: r.duty_per_unit, landed: r.landed_cost_per_unit, selling: r.selling_price,
        margin: r.selling_price > 0 ? ((r.selling_price - r.landed_cost_per_unit) / r.selling_price) * 100 : 0,
        type: r.type,
      }))
      .sort((a, b) => a.item.localeCompare(b.item) || b.date.localeCompare(a.date));
    return rows;
  }, [costRows, itemQuery, from, to]);

  const itemNames = useMemo(() => Array.from(new Set(costRows.map((r) => r.description).filter(Boolean))).sort(), [costRows]);

  // ---------- 3. Purchases by supplier ----------
  const supplierReport = useMemo(() => {
    type Agg = { supplier: string; month: string; bills: number; cny: number; lkr: number; paid: number; batches: Set<string> };
    const agg: Record<string, Agg> = {};
    for (const b of bills) {
      const po = Array.isArray(b.purchase_orders) ? b.purchase_orders[0] : b.purchase_orders;
      const sup = po ? (Array.isArray(po.suppliers) ? po.suppliers[0] : po.suppliers) : null;
      const supplier = sup?.name || '—';
      const month = ymOf(b.bill_date);
      if ((from && b.bill_date < from) || (to && b.bill_date > to)) continue;
      if (supplierFilter && supplier !== supplierFilter) continue;
      const cny = (b.purchase_bill_items || []).reduce((s, i) => s + (i.quantity_received || 0) * (i.unit_price_cny || 0), 0);
      const k = `${supplier}|${month}`;
      const a = (agg[k] ||= { supplier, month, bills: 0, cny: 0, lkr: 0, paid: 0, batches: new Set() });
      a.bills += 1;
      a.cny += cny;
      a.lkr += cny * (b.exchange_rate || 0);
      a.paid += b.amount_paid || 0;
      if (b.batch_number) a.batches.add(b.batch_number);
    }
    return Object.values(agg)
      .map((a) => ({ ...a, shipments: a.batches.size, unpaid: a.cny - a.paid }))
      .sort((a, b) => a.supplier.localeCompare(b.supplier) || b.month.localeCompare(a.month));
  }, [bills, from, to, supplierFilter]);

  const supplierNames = useMemo(() => {
    const s = new Set<string>();
    for (const b of bills) {
      const po = Array.isArray(b.purchase_orders) ? b.purchase_orders[0] : b.purchase_orders;
      const sup = po ? (Array.isArray(po.suppliers) ? po.suppliers[0] : po.suppliers) : null;
      if (sup?.name) s.add(sup.name);
    }
    return Array.from(s).sort();
  }, [bills]);

  // ---------- 4. Receipts (LKR money received) ----------
  const modeLabel = (m: string) => (m === 'cheque' ? 'Cheque' : m === 'cash' ? 'Cash' : m === 'bank_transfer' || m === 'bank' ? 'Bank transfer' : m ? m.charAt(0).toUpperCase() + m.slice(1) : '—');
  const invOf = (r: ReceiptRow) => { const i = Array.isArray(r.busy_sales_invoices) ? r.busy_sales_invoices[0] : r.busy_sales_invoices; return i?.invoice_number || 'On account'; };

  const receiptRows = useMemo(() => receipts.filter((r) =>
    (!from || r.payment_date >= from) && (!to || r.payment_date <= to)
    && (!receiptCustomer || r.customer_name === receiptCustomer)
    && (!receiptMode || r.payment_mode === receiptMode)
  ), [receipts, from, to, receiptCustomer, receiptMode]);

  const receiptTotals = useMemo(() => {
    const t = { total: 0, cash: 0, cheque: 0, bank: 0, other: 0, n: receiptRows.length };
    for (const r of receiptRows) {
      t.total += r.amount;
      if (r.payment_mode === 'cash') t.cash += r.amount;
      else if (r.payment_mode === 'cheque') t.cheque += r.amount;
      else if (r.payment_mode === 'bank_transfer' || r.payment_mode === 'bank') t.bank += r.amount;
      else t.other += r.amount;
    }
    return t;
  }, [receiptRows]);

  const receiptGrouped = useMemo(() => {
    if (receiptGroup === 'detail') return [];
    const keyOf = (r: ReceiptRow) => receiptGroup === 'day' ? r.payment_date : receiptGroup === 'month' ? ymOf(r.payment_date) : r.customer_name;
    const agg: Record<string, { key: string; n: number; cash: number; cheque: number; bank: number; other: number; total: number }> = {};
    for (const r of receiptRows) {
      const k = keyOf(r);
      const a = (agg[k] ||= { key: k, n: 0, cash: 0, cheque: 0, bank: 0, other: 0, total: 0 });
      a.n += 1; a.total += r.amount;
      if (r.payment_mode === 'cash') a.cash += r.amount;
      else if (r.payment_mode === 'cheque') a.cheque += r.amount;
      else if (r.payment_mode === 'bank_transfer' || r.payment_mode === 'bank') a.bank += r.amount;
      else a.other += r.amount;
    }
    return Object.values(agg).sort((a, b) => receiptGroup === 'customer' ? b.total - a.total : b.key.localeCompare(a.key));
  }, [receiptRows, receiptGroup]);

  const receiptCustomers = useMemo(() => Array.from(new Set(receipts.map((r) => r.customer_name).filter(Boolean))).sort(), [receipts]);

  // ---------- export ----------
  function exportExcel() {
    const wb = XLSX.utils.book_new();
    let data: Record<string, unknown>[] = [];
    let name = '';
    if (tab === 'shipments') {
      name = 'Shipment profitability';
      data = shipmentReport.map((r) => ({
        Shipment: r.batch, Type: r.mode, Forwarder: r.forwarder, Status: r.status, Date: r.date, Items: r.items,
        CBM: +r.cbm.toFixed(3), Kg: +r.kg.toFixed(1), 'Product cost LKR': +r.productCost.toFixed(2),
        'Shipment charges LKR': +r.charges.toFixed(2), 'Charges source': r.chargesActual ? 'Actual' : 'Estimate',
        'Landed total LKR': +r.landed.toFixed(2), 'Resale sales LKR': +r.sales.toFixed(2), 'To factory LKR': +r.factory.toFixed(2),
        'Profit LKR': r.costed ? +r.profit.toFixed(2) : 'not costed', 'Margin %': r.costed ? +r.margin.toFixed(1) : '', 'Charges per CBM': +r.costPerCbm.toFixed(0),
      }));
    } else if (tab === 'items') {
      name = 'Landed cost by item';
      data = itemReport.map((r) => ({
        Item: r.item, Shipment: r.batch, Date: r.date, Qty: r.qty, Unit: r.unit, 'CNY price': r.cny, 'CNY rate': r.rate,
        'Unit LKR': +r.lkr.toFixed(2), 'Duty/unit': +r.duty.toFixed(2), 'Landed/unit': +r.landed.toFixed(2),
        'Selling price': r.selling, 'Margin %': +r.margin.toFixed(1), Type: r.type,
      }));
    } else if (tab === 'receipts') {
      name = 'Receipts LKR';
      data = receiptGroup === 'detail'
        ? receiptRows.map((r) => ({
            Date: r.payment_date, 'Receipt no': r.payment_number || '', Customer: r.customer_name, Invoice: invOf(r),
            Mode: modeLabel(r.payment_mode), 'Cheque no': r.cheque_number || '', Bank: r.bank_name || '', Reference: r.reference_number || '',
            'Amount LKR': +r.amount.toFixed(2), Notes: r.notes || '',
          }))
        : receiptGrouped.map((g) => ({
            [receiptGroup === 'customer' ? 'Customer' : receiptGroup === 'day' ? 'Date' : 'Month']: g.key, Receipts: g.n,
            'Cash LKR': +g.cash.toFixed(2), 'Cheque LKR': +g.cheque.toFixed(2), 'Bank LKR': +g.bank.toFixed(2), 'Other LKR': +g.other.toFixed(2), 'Total LKR': +g.total.toFixed(2),
          }));
    } else {
      name = 'Purchases by supplier';
      data = supplierReport.map((r) => ({
        Supplier: r.supplier, Month: r.month, Bills: r.bills, Shipments: r.shipments, 'Value CNY': +r.cny.toFixed(2),
        'Value LKR': +r.lkr.toFixed(2), 'Paid CNY': +r.paid.toFixed(2), 'Unpaid CNY': +r.unpaid.toFixed(2),
      }));
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.length ? data : [{}]), name.slice(0, 31));
    XLSX.writeFile(wb, `${name.replace(/ /g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-teal-600"></div>
      </div>
    );
  }

  const tabBtn = (id: Tab, label: string) => (
    <button
      onClick={() => setTab(id)}
      className={`px-4 py-2 text-sm font-medium rounded-lg ${tab === id ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
    >
      {label}
    </button>
  );

  const totalsBox = (label: string, t: typeof shipmentTotals.all, tone: string) => (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <div className="text-xs font-semibold uppercase text-gray-600 mb-1">{label} · {t.n} shipment{t.n === 1 ? '' : 's'}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
        <span className="text-gray-600">CBM</span><span className="text-right">{n3(t.cbm)}</span>
        <span className="text-gray-600">Charges / CBM</span><span className="text-right">{n0(t.costPerCbm)}</span>
        <span className="text-gray-600">Landed</span><span className="text-right">{n0(t.landed)}</span>
        <span className="text-gray-600">Charges</span><span className="text-right">{n0(t.charges)}</span>
        <span className="text-gray-600">Resale sales</span><span className="text-right">{n0(t.sales)}</span>
        <span className="text-gray-600 font-medium">Profit</span>
        {t.nCosted === 0
          ? <span className="text-right text-gray-500">not costed yet</span>
          : <span className={`text-right font-semibold ${t.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{n0(t.profit)} ({pct(t.margin)}){t.nCosted < t.n ? <span className="block text-xs font-normal text-gray-500">{t.nCosted} of {t.n} costed</span> : null}</span>}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><BarChart3 className="w-6 h-6 text-teal-600" /> Reports</h2>
          <p className="text-sm text-gray-500">Worked out from Costing, Shipping and Bills. Nothing to enter here.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={exportExcel} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 rounded-lg text-sm font-medium">
            <Download className="w-4 h-4" /> Export Excel
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {APP_MODE !== 'shop' && tabBtn('shipments', 'Shipment profitability')}
        {APP_MODE !== 'shop' && tabBtn('items', 'Landed cost by item')}
        {tabBtn('suppliers', 'Purchases by supplier')}
        {APP_MODE !== 'shop' && tabBtn('receipts', 'Receipts (LKR)')}
        {APP_MODE !== 'shop' && tabBtn('profit', 'Profit')}
        {APP_MODE !== 'shop' && tabBtn('warehouse', 'Warehouse')}
        <span className="ml-auto flex items-center gap-2 text-xs text-gray-600">
          <span title="Everything before this date is hidden in all report tabs">Reports start from</span>
          <input type="date" value={startDate} onChange={(e) => saveStart(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs" />
          {startDate && <button onClick={() => saveStart('')} className="text-gray-400 hover:text-gray-700" title="Show all history">×</button>}
          <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={onlyShipping} onChange={(e) => saveOnly(e.target.checked)} />Only LCL/FCL shipments</label>
        </span>
        <div className="flex-1" />
        <label className="text-xs text-gray-600">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ml-1 px-2 py-1 text-sm border border-gray-300 rounded" /></label>
        <label className="text-xs text-gray-600">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ml-1 px-2 py-1 text-sm border border-gray-300 rounded" /></label>
        {tab === 'shipments' && (
          <select value={modeFilter} onChange={(e) => setModeFilter(e.target.value as typeof modeFilter)} className="px-2 py-1 text-sm border border-gray-300 rounded">
            <option value="all">All types</option><option value="LCL">Loose cargo</option><option value="FCL">Container</option><option value="other">Old batches</option>
          </select>
        )}
        {tab === 'items' && (
          <input list="report-items" value={itemQuery} onChange={(e) => setItemQuery(e.target.value)} placeholder="Item name…" className="px-2 py-1 text-sm border border-gray-300 rounded w-56" />
        )}
        {tab === 'items' && <datalist id="report-items">{itemNames.map((n) => <option key={n} value={n} />)}</datalist>}
        {tab === 'receipts' && (
          <>
            <select value={receiptGroup} onChange={(e) => setReceiptGroup(e.target.value as typeof receiptGroup)} className="px-2 py-1 text-sm border border-gray-300 rounded">
              <option value="detail">Each receipt</option><option value="day">By day</option><option value="month">By month</option><option value="customer">By customer</option>
            </select>
            <select value={receiptMode} onChange={(e) => setReceiptMode(e.target.value)} className="px-2 py-1 text-sm border border-gray-300 rounded">
              <option value="">All modes</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="bank_transfer">Bank transfer</option><option value="online">Online</option>
            </select>
            <select value={receiptCustomer} onChange={(e) => setReceiptCustomer(e.target.value)} className="px-2 py-1 text-sm border border-gray-300 rounded max-w-[14rem]">
              <option value="">All customers</option>{receiptCustomers.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </>
        )}
        {tab === 'suppliers' && (
          <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className="px-2 py-1 text-sm border border-gray-300 rounded">
            <option value="">All suppliers</option>{supplierNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
      </div>
      {tab === 'profit' && <ProfitReport startDate={startDate} />}
      {tab === 'warehouse' && <WarehouseReport startDate={startDate} />}

      {tab === 'shipments' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {totalsBox('All', shipmentTotals.all, 'bg-gray-50 border-gray-200')}
            {totalsBox('Loose cargo', shipmentTotals.lcl, 'bg-amber-50 border-amber-200')}
            {totalsBox('Container', shipmentTotals.fcl, 'bg-teal-50 border-teal-200')}
          </div>
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Shipment</th><th className="text-left px-3 py-2">Type</th><th className="text-left px-3 py-2">Date</th>
                  <th className="text-right px-3 py-2">Items</th><th className="text-right px-3 py-2">CBM</th>
                  <th className="text-right px-3 py-2">Product cost</th><th className="text-right px-3 py-2">Charges</th><th className="text-right px-3 py-2">/CBM</th>
                  <th className="text-right px-3 py-2">Landed</th><th className="text-right px-3 py-2">Resale sales</th><th className="text-right px-3 py-2">To factory</th>
                  <th className="text-right px-3 py-2">Profit</th><th className="text-right px-3 py-2">Margin</th><th className="text-left px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shipmentReport.length === 0 && <tr><td colSpan={14} className="px-3 py-6 text-center text-gray-500">No costing data in this range.</td></tr>}
                {shipmentReport.map((r) => (
                  <tr key={r.batch} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium">{r.batch}</td>
                    <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded-full ${r.mode === 'LCL' ? 'bg-amber-100 text-amber-800' : r.mode === 'FCL' ? 'bg-teal-100 text-teal-800' : 'bg-gray-100 text-gray-600'}`}>{r.mode === 'LCL' ? 'Loose' : r.mode === 'FCL' ? 'Container' : 'Batch'}</span></td>
                    <td className="px-3 py-2 text-gray-600">{dmy(r.date)}</td>
                    <td className="px-3 py-2 text-right">{r.items}</td>
                    <td className="px-3 py-2 text-right">{n3(r.cbm)}</td>
                    <td className="px-3 py-2 text-right">{n0(r.productCost)}</td>
                    <td className="px-3 py-2 text-right" title={r.chargesActual ? 'Actual charges from Shipping' : 'Estimate from costing rows'}>{n0(r.charges)}<span className="text-xs text-gray-400 ml-1">{r.chargesActual ? 'act' : 'est'}</span></td>
                    <td className="px-3 py-2 text-right text-gray-600">{r.cbm > 0 ? n0(r.costPerCbm) : '—'}</td>
                    <td className="px-3 py-2 text-right">{n0(r.landed)}</td>
                    <td className="px-3 py-2 text-right">{n0(r.sales)}</td>
                    <td className="px-3 py-2 text-right text-purple-700">{r.factory ? n0(r.factory) : '—'}</td>
                    {r.costed
                      ? <td className={`px-3 py-2 text-right font-semibold ${r.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{n0(r.profit)}</td>
                      : <td className="px-3 py-2 text-right text-gray-500" title={r.productCost > 0 ? 'No selling prices in Costing yet' : 'No product cost in Costing yet (CNY price / rate missing)'}>not costed</td>}
                    <td className="px-3 py-2 text-right">{r.costed && r.sales > 0 ? pct(r.margin) : '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{r.status || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">Charges: "act" = actual charges entered in Shipping; "est" = sum of the duty column in Costing. Profit = resale sales + factory goods at landed cost − (product cost + charges). "Not costed" = Costing has no selling prices or no product cost for that shipment yet, so its charges are not counted as a loss.</p>
        </>
      )}

      {tab === 'items' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">Item</th><th className="text-left px-3 py-2">Shipment</th><th className="text-left px-3 py-2">Date</th>
                <th className="text-right px-3 py-2">Qty</th><th className="text-right px-3 py-2">CNY</th><th className="text-right px-3 py-2">Rate</th>
                <th className="text-right px-3 py-2">Unit LKR</th><th className="text-right px-3 py-2">Duty</th><th className="text-right px-3 py-2">Landed</th>
                <th className="text-right px-3 py-2">Selling</th><th className="text-right px-3 py-2">Margin</th><th className="text-left px-3 py-2">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {itemReport.length === 0 && <tr><td colSpan={12} className="px-3 py-6 text-center text-gray-500">No rows match.</td></tr>}
              {itemReport.map((r, i) => {
                const prev = itemReport[i + 1];
                const trend = prev && prev.item === r.item && prev.landed > 0 ? ((r.landed - prev.landed) / prev.landed) * 100 : null;
                return (
                  <tr key={`${r.item}-${r.batch}-${i}`} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium">{r.item}</td>
                    <td className="px-3 py-2 text-gray-600">{r.batch}</td>
                    <td className="px-3 py-2 text-gray-600">{dmy(r.date)}</td>
                    <td className="px-3 py-2 text-right">{n0(r.qty)} {r.unit}</td>
                    <td className="px-3 py-2 text-right">{n2(r.cny || 0)}</td>
                    <td className="px-3 py-2 text-right">{n2(r.rate || 0)}</td>
                    <td className="px-3 py-2 text-right">{n2(r.lkr)}</td>
                    <td className="px-3 py-2 text-right">{n2(r.duty)}</td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {n2(r.landed)}
                      {trend !== null && <span className={`text-xs ml-1 ${trend > 0 ? 'text-red-600' : 'text-green-700'}`}>{trend > 0 ? '▲' : '▼'}{Math.abs(trend).toFixed(0)}%</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{r.selling ? n2(r.selling) : '—'}</td>
                    <td className={`px-3 py-2 text-right ${r.margin < 0 ? 'text-red-600' : ''}`}>{r.selling ? pct(r.margin) : '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{r.type}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'suppliers' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">Supplier</th><th className="text-left px-3 py-2">Month</th>
                <th className="text-right px-3 py-2">Bills</th><th className="text-right px-3 py-2">Shipments</th>
                <th className="text-right px-3 py-2">Value CNY</th><th className="text-right px-3 py-2">Value LKR</th>
                <th className="text-right px-3 py-2">Paid CNY</th><th className="text-right px-3 py-2">Unpaid CNY</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {supplierReport.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">No bills in this range.</td></tr>}
              {supplierReport.map((r) => (
                <tr key={`${r.supplier}-${r.month}`} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium">{r.supplier}</td>
                  <td className="px-3 py-2 text-gray-600">{dmy(r.month)}</td>
                  <td className="px-3 py-2 text-right">{r.bills}</td>
                  <td className="px-3 py-2 text-right">{r.shipments}</td>
                  <td className="px-3 py-2 text-right">{n2(r.cny)}</td>
                  <td className="px-3 py-2 text-right">{r.lkr ? n0(r.lkr) : '—'}</td>
                  <td className="px-3 py-2 text-right">{n2(r.paid)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${r.unpaid > 0.005 ? 'text-red-600' : 'text-green-700'}`}>{n2(r.unpaid)}</td>
                </tr>
              ))}
            </tbody>
            {supplierReport.length > 0 && (
              <tfoot className="bg-gray-50 font-semibold">
                <tr>
                  <td className="px-3 py-2" colSpan={2}>Total</td>
                  <td className="px-3 py-2 text-right">{supplierReport.reduce((s, r) => s + r.bills, 0)}</td>
                  <td className="px-3 py-2 text-right"></td>
                  <td className="px-3 py-2 text-right">{n2(supplierReport.reduce((s, r) => s + r.cny, 0))}</td>
                  <td className="px-3 py-2 text-right">{n0(supplierReport.reduce((s, r) => s + r.lkr, 0))}</td>
                  <td className="px-3 py-2 text-right">{n2(supplierReport.reduce((s, r) => s + r.paid, 0))}</td>
                  <td className="px-3 py-2 text-right">{n2(supplierReport.reduce((s, r) => s + r.unpaid, 0))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {tab === 'receipts' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[['Total received', receiptTotals.total, 'bg-teal-50 border-teal-200 text-teal-800'], ['Cash', receiptTotals.cash, 'bg-green-50 border-green-200 text-green-800'],
              ['Cheque', receiptTotals.cheque, 'bg-amber-50 border-amber-200 text-amber-800'], ['Bank transfer', receiptTotals.bank, 'bg-teal-50 border-blue-200 text-teal-800'],
              ['Other', receiptTotals.other, 'bg-gray-50 border-gray-200 text-gray-800']].map(([l, v, tone]) => (
              <div key={l as string} className={`rounded-lg border p-3 ${tone}`}>
                <div className="text-xs font-semibold uppercase mb-1">{l as string}</div>
                <div className="text-lg font-bold">{n0(v as number)}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500">{receiptTotals.n} receipt{receiptTotals.n === 1 ? '' : 's'} in this range. Cheques count as received on the date recorded; returned cheques are left out.</p>
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            {receiptGroup === 'detail' ? (
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                  <tr>
                    <th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Receipt</th><th className="text-left px-3 py-2">Customer</th>
                    <th className="text-left px-3 py-2">Invoice</th><th className="text-left px-3 py-2">Mode</th><th className="text-left px-3 py-2">Cheque / Ref</th>
                    <th className="text-right px-3 py-2">Amount LKR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {receiptRows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">No receipts in this range.</td></tr>}
                  {receiptRows.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-600">{dmy(r.payment_date)}</td>
                      <td className="px-3 py-2 text-gray-600">{r.payment_number || '—'}</td>
                      <td className="px-3 py-2 font-medium">{r.customer_name}</td>
                      <td className={`px-3 py-2 ${invOf(r) === 'On account' ? 'text-purple-700' : 'text-gray-600'}`}>{invOf(r)}</td>
                      <td className="px-3 py-2">{modeLabel(r.payment_mode)}</td>
                      <td className="px-3 py-2 text-gray-600">{[r.cheque_number, r.bank_name, r.reference_number].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold">{n0(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                {receiptRows.length > 0 && (
                  <tfoot className="bg-gray-50 font-semibold"><tr><td className="px-3 py-2" colSpan={6}>Total</td><td className="px-3 py-2 text-right">{n0(receiptTotals.total)}</td></tr></tfoot>
                )}
              </table>
            ) : (
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                  <tr>
                    <th className="text-left px-3 py-2">{receiptGroup === 'customer' ? 'Customer' : receiptGroup === 'day' ? 'Date' : 'Month'}</th>
                    <th className="text-right px-3 py-2">Receipts</th><th className="text-right px-3 py-2">Cash</th><th className="text-right px-3 py-2">Cheque</th>
                    <th className="text-right px-3 py-2">Bank</th><th className="text-right px-3 py-2">Other</th><th className="text-right px-3 py-2">Total LKR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {receiptGrouped.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">No receipts in this range.</td></tr>}
                  {receiptGrouped.map((g) => (
                    <tr key={g.key} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium">{receiptGroup === 'customer' ? g.key : dmy(g.key)}</td>
                      <td className="px-3 py-2 text-right">{g.n}</td>
                      <td className="px-3 py-2 text-right">{g.cash ? n0(g.cash) : '—'}</td>
                      <td className="px-3 py-2 text-right">{g.cheque ? n0(g.cheque) : '—'}</td>
                      <td className="px-3 py-2 text-right">{g.bank ? n0(g.bank) : '—'}</td>
                      <td className="px-3 py-2 text-right">{g.other ? n0(g.other) : '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold">{n0(g.total)}</td>
                    </tr>
                  ))}
                </tbody>
                {receiptGrouped.length > 0 && (
                  <tfoot className="bg-gray-50 font-semibold"><tr>
                    <td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right">{receiptTotals.n}</td>
                    <td className="px-3 py-2 text-right">{n0(receiptTotals.cash)}</td><td className="px-3 py-2 text-right">{n0(receiptTotals.cheque)}</td>
                    <td className="px-3 py-2 text-right">{n0(receiptTotals.bank)}</td><td className="px-3 py-2 text-right">{n0(receiptTotals.other)}</td>
                    <td className="px-3 py-2 text-right">{n0(receiptTotals.total)}</td>
                  </tr></tfoot>
                )}
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
