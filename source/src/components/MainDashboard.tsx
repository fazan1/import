import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { openingBal } from '../lib/book';
import { Globe, Store, Package, Receipt, DollarSign, TrendingUp, ShoppingCart, FileText, CreditCard, ClipboardList, Ship, FileStack, ClipboardCheck, ListChecks, FileSpreadsheet, RefreshCw, ArrowRight, Layers } from 'lucide-react';
import BatchGrowthChart from './BatchGrowthChart';
import SalesPipeline from './SalesPipeline';
import CustomerCollectionTracker from './CustomerCollectionTracker';

interface CNStats {
  total_pos: number;
  total_bills: number;
  total_packing_lists: number;
  pending_payments: number;
  total_landed_cost: number;
  total_profit: number;
}

interface SLStats {
  total_orders: number;
  total_invoices: number;
  total_payments: number;
  total_receivables: number;
  total_collected: number;
  total_sales: number;
}

interface MainDashboardProps {
  onNavigate: (view: string) => void;
}

export default function MainDashboard({ onNavigate }: MainDashboardProps) {
  const [cnStats, setCnStats] = useState<CNStats>({
    total_pos: 0,
    total_bills: 0,
    total_packing_lists: 0,
    pending_payments: 0,
    total_landed_cost: 0,
    total_profit: 0,
  });
  const [slStats, setSlStats] = useState<SLStats>({
    total_orders: 0,
    total_invoices: 0,
    total_payments: 0,
    total_receivables: 0,
    total_collected: 0,
    total_sales: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAllStats();
  }, []);

  async function loadAllStats() {
    setLoading(true);
    try {
      await Promise.all([loadCNStats(), loadSLStats()]);
    } catch {
      // Gracefully handle load failures
    } finally {
      setLoading(false);
    }
  }

  async function loadCNStats() {
    try {
      const [posResult, billsResult, plResult, costingResult] = await Promise.all([
        supabase.from('purchase_orders').select('id', { count: 'exact', head: true }),
        supabase.from('purchase_bills').select(`
          id,
          amount_paid,
          status,
          purchase_bill_items (
            quantity_received,
            unit_price_cny
          )
        `),
        supabase.from('pl_input').select('id', { count: 'exact', head: true }),
        supabase.from('costing_duty_sheet').select('total_landed_cost, total_profit, type'),
      ]);

      let pendingPayments = 0;
      if (billsResult.data) {
        billsResult.data.forEach((bill) => {
          if (bill.status !== 'paid') {
            const items = bill.purchase_bill_items as { quantity_received: number; unit_price_cny: number }[] | null;
            const billTotal = items?.reduce((sum, item) => sum + (item.quantity_received || 0) * (item.unit_price_cny || 0), 0) || 0;
            pendingPayments += billTotal - (bill.amount_paid || 0);
          }
        });
      }

      let totalLanded = 0;
      let totalProfit = 0;
      if (costingResult.data) {
        costingResult.data.forEach((item) => {
          totalLanded += item.total_landed_cost || 0;
          if (item.type === 'RESALE') {
            totalProfit += item.total_profit || 0;
          }
        });
      }

      setCnStats({
        total_pos: posResult.count || 0,
        total_bills: billsResult.data?.length || 0,
        total_packing_lists: plResult.count || 0,
        pending_payments: pendingPayments,
        total_landed_cost: totalLanded,
        total_profit: totalProfit,
      });
    } catch {
      // Keep default stats on error
    }
  }

  async function loadSLStats() {
    try {
      const [ordersResult, invoicesResult, paymentsResult, customersResult] = await Promise.all([
        supabase.from('busy_sales_orders').select('id', { count: 'exact', head: true }),
        supabase.from('busy_sales_invoices').select('total_amount, amount_paid, amount_due, status'),
        supabase.from('busy_sales_payments').select('amount, customer_name, sales_invoice_id'),
        supabase.from('customers').select('name, opening_balance'),
      ]);

      let totalReceivables = 0;
      let totalCollected = 0;
      let totalSales = 0;

      if (invoicesResult.data) {
        invoicesResult.data.forEach((invoice) => {
          if (invoice.status === 'draft') return;
          totalSales += invoice.total_amount || 0;
          if (invoice.status !== 'paid') {
            totalReceivables += invoice.amount_due || 0;
          }
        });
      }

      // On-account payments reduce opening balances (same rule as Customer Outstanding)
      const onAccount = new Map<string, number>();
      (paymentsResult.data || []).forEach((p) => {
        totalCollected += p.amount || 0;
        if (!p.sales_invoice_id) { const k = (p.customer_name || '').trim().toLowerCase(); onAccount.set(k, (onAccount.get(k) || 0) + (p.amount || 0)); }
      });
      const totalOpeningBalance = (customersResult.data || []).reduce((s, c) => s + (openingBal(c.opening_balance) - (onAccount.get((c.name || '').trim().toLowerCase()) || 0)), 0);

      setSlStats({
        total_orders: ordersResult.count || 0,
        total_invoices: invoicesResult.data?.length || 0,
        total_payments: paymentsResult.data?.length || 0,
        total_receivables: totalReceivables + totalOpeningBalance,
        total_collected: totalCollected,
        total_sales: totalSales,
      });
    } catch {
      // Keep default stats on error
    }
  }

  function formatCurrency(amount: number, currency = 'LKR') {
    if (currency === 'CNY') {
      return `¥${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
    return `Rs.${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }

  const cnQuickLinks = [
    { id: 'cn-dashboard', label: 'Dashboard', icon: Layers },
    { id: 'purchase-orders', label: 'Purchase Orders', icon: ClipboardList },
    { id: 'purchase-bills', label: 'Bills', icon: Receipt },
    { id: 'outstanding-payments', label: 'Outstanding Pay', icon: DollarSign },
    { id: 'shipment-history', label: 'Shipments', icon: Ship },
    { id: 'batch-invoice', label: 'Batch Invoice', icon: FileStack },
    { id: 'pl-input', label: 'PL Input', icon: ClipboardCheck },
    { id: 'packing-list', label: 'Packing List', icon: ListChecks },
    { id: 'costing-duty', label: 'Costing & Duty', icon: FileSpreadsheet },
  ];

  const slQuickLinks = [
    { id: 'sl-dashboard', label: 'Dashboard', icon: Layers },
    { id: 'customer-outstanding', label: 'Outstanding', icon: DollarSign },
    { id: 'busy-sales-orders', label: 'Sales Orders', icon: ShoppingCart },
    { id: 'busy-sales-invoices', label: 'Sales Invoice', icon: FileText },
    { id: 'busy-sales-payments', label: 'Sales Payment', icon: CreditCard },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-teal-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Business Overview</h1>
          <p className="text-sm text-gray-500 mt-1">Quick reference across both portals</p>
        </div>
        <button
          onClick={loadAllStats}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Business Growth Chart */}
      <BatchGrowthChart />

      {/* Two Portal Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* CN Portal Section */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* CN Header */}
          <div className="bg-gradient-to-r from-teal-600 to-teal-700 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                <Globe className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">CN Portal</h2>
                <p className="text-teal-100 text-xs">China Procurement</p>
              </div>
            </div>
            <button
              onClick={() => onNavigate('cn-dashboard')}
              className="flex items-center gap-1 text-sm text-teal-100 hover:text-white transition-colors"
            >
              Open Portal
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* CN Stats */}
          <div className="p-6">
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{cnStats.total_pos}</p>
                <p className="text-xs text-gray-500 mt-1">Purchase Orders</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{cnStats.total_bills}</p>
                <p className="text-xs text-gray-500 mt-1">Bills</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{cnStats.total_packing_lists}</p>
                <p className="text-xs text-gray-500 mt-1">Packing Lists</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
              <div className="flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-lg p-3">
                <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <DollarSign className="w-4 h-4 text-amber-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-amber-600 font-medium">Pending Pay</p>
                  <p className="text-sm font-bold text-amber-800 truncate">{formatCurrency(cnStats.pending_payments, 'CNY')}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-teal-50 border border-blue-100 rounded-lg p-3">
                <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <Package className="w-4 h-4 text-teal-700" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-teal-700 font-medium">Landed Cost</p>
                  <p className="text-sm font-bold text-teal-800 truncate">{formatCurrency(cnStats.total_landed_cost)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-green-50 border border-green-100 rounded-lg p-3">
                <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="w-4 h-4 text-green-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-green-600 font-medium">Profit</p>
                  <p className="text-sm font-bold text-green-800 truncate">{formatCurrency(cnStats.total_profit)}</p>
                </div>
              </div>
            </div>

            {/* CN Quick Links */}
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Quick Access</p>
              <div className="grid grid-cols-3 gap-2">
                {cnQuickLinks.map((link) => (
                  <button
                    key={link.id}
                    onClick={() => onNavigate(link.id)}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-teal-50 hover:text-teal-700 rounded-lg transition-colors border border-transparent hover:border-teal-200"
                  >
                    <link.icon className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{link.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* SL Portal Section */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* SL Header */}
          <div className="bg-gradient-to-r from-slate-700 to-slate-800 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                <Store className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">SL Portal</h2>
                <p className="text-slate-300 text-xs">Sales & Local</p>
              </div>
            </div>
            <button
              onClick={() => onNavigate('sl-dashboard')}
              className="flex items-center gap-1 text-sm text-slate-300 hover:text-white transition-colors"
            >
              Open Portal
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* SL Stats */}
          <div className="p-6">
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{slStats.total_orders}</p>
                <p className="text-xs text-gray-500 mt-1">Sales Orders</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{slStats.total_invoices}</p>
                <p className="text-xs text-gray-500 mt-1">Invoices</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{slStats.total_payments}</p>
                <p className="text-xs text-gray-500 mt-1">Payments</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
              <div className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-lg p-3">
                <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <DollarSign className="w-4 h-4 text-red-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-red-600 font-medium">Receivables</p>
                  <p className="text-sm font-bold text-red-800 truncate">{formatCurrency(slStats.total_receivables)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-green-50 border border-green-100 rounded-lg p-3">
                <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="w-4 h-4 text-green-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-green-600 font-medium">Collected</p>
                  <p className="text-sm font-bold text-green-800 truncate">{formatCurrency(slStats.total_collected)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-teal-50 border border-blue-100 rounded-lg p-3">
                <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <Receipt className="w-4 h-4 text-teal-700" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-teal-700 font-medium">Total Sales</p>
                  <p className="text-sm font-bold text-teal-800 truncate">{formatCurrency(slStats.total_sales)}</p>
                </div>
              </div>
            </div>

            {/* Sales Pipeline */}
            <div className="mb-6">
              <SalesPipeline />
            </div>

            {/* Customer Collection Tracker */}
            <div className="mb-6">
              <CustomerCollectionTracker />
            </div>

            {/* SL Quick Links */}
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Quick Access</p>
              <div className="grid grid-cols-3 gap-2">
                {slQuickLinks.map((link) => (
                  <button
                    key={link.id}
                    onClick={() => onNavigate(link.id)}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-slate-100 hover:text-slate-700 rounded-lg transition-colors border border-transparent hover:border-slate-200"
                  >
                    <link.icon className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{link.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
