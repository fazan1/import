import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { DollarSign, Building2, Receipt, Calendar, Clock, ChevronDown, ChevronRight, Search, ListFilter as Filter, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, CreditCard, RefreshCw, X, List, Layers, Printer } from 'lucide-react';
import OutstandingPaymentsPrint from './OutstandingPaymentsPrint';

interface BillDetail {
  id: string;
  bill_number: string;
  cnv_invoice_number: string | null;
  bill_date: string;
  due_date: string | null;
  status: string;
  amount_paid: number;
  total_amount: number;
  pending_amount: number;
  exchange_rate?: number | null;
  batch_number: string | null;
  po_number: string | null;
}

interface SupplierPayment {
  supplier_id: string;
  supplier_name: string;
  total_pending: number;
  total_paid: number;
  bills_count: number;
  oldest_bill_date: string;
  bills: BillDetail[];
  overpayment: number;
}

interface Summary {
  total_pending: number;
  total_paid: number;
  total_overpaid: number;
  suppliers_count: number;
}

interface PaymentModal {
  billId: string;
  billNumber: string;
  supplierName: string;
  pendingAmount: number;
}

interface OutstandingPaymentsProps {
  initialSupplierId?: string;
  onRecordPayment?: (billId: string) => void;
}

const PAYMENT_MODES = ['CASH', 'Ali Pay', 'WeChat Pay', 'Bank Transfer', 'Credit Card', 'Other'];

export default function OutstandingPayments({ initialSupplierId, onRecordPayment }: OutstandingPaymentsProps) {
  const [suppliers, setSuppliers] = useState<SupplierPayment[]>([]);
  const [, setSummary] = useState<Summary>({ total_pending: 0, total_paid: 0, total_overpaid: 0, suppliers_count: 0 });
  const [loading, setLoading] = useState(true);
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [showPrintView, setShowPrintView] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'partial' | 'overpaid'>('all');
  const [batchFilter, setBatchFilter] = useState('');
  const [sortBy, setSortBy] = useState<'amount' | 'name' | 'age'>('amount');
  const [viewMode, setViewMode] = useState<'grouped' | 'flat'>('flat');
  const [availableBatches, setAvailableBatches] = useState<string[]>([]);
  const [paymentModal, setPaymentModal] = useState<PaymentModal | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    voucher_number: '',
    payment_date: new Date().toISOString().split('T')[0],
    payment_mode: 'CASH',
    amount: '',
    narration: '',
    rate_lkr: '',
    funded_by: 'investor',
  });
  const [savingPayment, setSavingPayment] = useState(false);
  const [lastRate, setLastRate] = useState('');
  useEffect(() => { supabase.from('purchase_payments').select('rate_lkr').not('rate_lkr', 'is', null).order('payment_date', { ascending: false }).order('created_at', { ascending: false }).limit(1).then(({ data }) => { if (data && data[0]?.rate_lkr) setLastRate(String(data[0].rate_lkr)); }); }, []);

  useEffect(() => {
    loadOutstandingPayments();
  }, []);

  useEffect(() => {
    if (initialSupplierId && suppliers.length > 0) {
      setExpandedSuppliers(new Set([initialSupplierId]));
    }
  }, [initialSupplierId, suppliers]);

  async function loadOutstandingPayments() {
    setLoading(true);

    const { data: bills } = await supabase
      .from('purchase_bills')
      .select(`
        id,
        bill_number,
        cnv_invoice_number,
        bill_date,
        due_date,
        status,
        amount_paid,
        exchange_rate,
        batch_number,
        purchase_order_id,
        purchase_bill_items (
          quantity_received,
          unit_price_cny
        ),
        purchase_orders (
          id,
          supplier_id,
          suppliers (
            id,
            name
          )
        )
      `)
      .order('bill_date', { ascending: false });

    if (bills) {
      const supplierMap = new Map<string, SupplierPayment>();
      const batchSet = new Set<string>();
      let totalPending = 0;
      let totalPaid = 0;
      let totalOverpaid = 0;

      bills.forEach((bill) => {
        const po = bill.purchase_orders as unknown as {
          id: string;
          supplier_id: string;
          suppliers: { id: string; name: string };
        } | null;
        const supplier = po?.suppliers;
        if (!supplier) return;

        if (bill.batch_number) batchSet.add(bill.batch_number);

        const items = bill.purchase_bill_items as { quantity_received: number; unit_price_cny: number }[] | null;
        const billTotal = items?.reduce((sum, item) => sum + (item.quantity_received || 0) * (item.unit_price_cny || 0), 0) || 0;
        const amountPaid = bill.amount_paid || 0;
        const pendingAmount = billTotal - amountPaid;

        const billDetail: BillDetail = {
          id: bill.id,
          bill_number: bill.bill_number || (bill.cnv_invoice_number ? `${bill.cnv_invoice_number}${bill.batch_number ? ' / B' + bill.batch_number : ''}` : 'Unbilled'),
          cnv_invoice_number: bill.cnv_invoice_number || null,
          bill_date: bill.bill_date,
          due_date: bill.due_date,
          status: bill.status,
          amount_paid: amountPaid,
          total_amount: billTotal,
          pending_amount: pendingAmount,
          exchange_rate: bill.exchange_rate,
          batch_number: bill.batch_number,
          po_number: po?.id ? `PO-${po.id.slice(0, 8)}` : null,
        };

        const existing = supplierMap.get(supplier.id);
        if (existing) {
          existing.total_pending += Math.max(0, pendingAmount);
          existing.total_paid += amountPaid;
          existing.bills_count += 1;
          if (pendingAmount < 0) existing.overpayment += Math.abs(pendingAmount);
          if (bill.bill_date < existing.oldest_bill_date) existing.oldest_bill_date = bill.bill_date;
          existing.bills.push(billDetail);
        } else {
          supplierMap.set(supplier.id, {
            supplier_id: supplier.id,
            supplier_name: supplier.name,
            total_pending: Math.max(0, pendingAmount),
            total_paid: amountPaid,
            bills_count: 1,
            oldest_bill_date: bill.bill_date,
            overpayment: pendingAmount < 0 ? Math.abs(pendingAmount) : 0,
            bills: [billDetail],
          });
        }

        totalPaid += amountPaid;
        if (pendingAmount > 0) totalPending += pendingAmount;
        else if (pendingAmount < 0) totalOverpaid += Math.abs(pendingAmount);
      });

      const supplierList = Array.from(supplierMap.values());
      setSuppliers(supplierList);
      setAvailableBatches([...batchSet].sort());
      setSummary({
        total_pending: totalPending,
        total_paid: totalPaid,
        total_overpaid: totalOverpaid,
        suppliers_count: supplierList.filter(s => s.total_pending > 0).length,
      });
    }

    setLoading(false);
  }

  function openPaymentModal(bill: BillDetail, supplierName: string) {
    setPaymentModal({
      billId: bill.id,
      billNumber: bill.bill_number,
      supplierName,
      pendingAmount: bill.pending_amount,
    });
    setPaymentForm({
      voucher_number: '',
      payment_date: new Date().toISOString().split('T')[0],
      payment_mode: 'CASH',
      amount: String(bill.pending_amount.toFixed(2)),
      narration: '',
      rate_lkr: lastRate || (bill.exchange_rate && bill.exchange_rate > 1 ? String(bill.exchange_rate) : ''),
      funded_by: 'investor',
    });
  }

  async function handlePaymentSubmit() {
    if (!paymentModal || !paymentForm.amount || parseFloat(paymentForm.amount) <= 0) return;
    setSavingPayment(true);

    const { data: payment, error } = await supabase
      .from('purchase_payments')
      .insert({
        purchase_bill_id: paymentModal.billId,
        voucher_number: paymentForm.voucher_number.trim() || null,
        payment_date: paymentForm.payment_date,
        payment_mode: paymentForm.payment_mode,
        amount: parseFloat(paymentForm.amount),
        account_name: paymentModal.supplierName,
        narration: paymentForm.narration.trim() || null,
        rate_lkr: parseFloat(paymentForm.rate_lkr) || null,
        funded_by: paymentForm.funded_by,
      })
      .select()
      .single();

    if (!error && payment) {
      const { data: allPayments } = await supabase
        .from('purchase_payments')
        .select('amount')
        .eq('purchase_bill_id', paymentModal.billId);

      const totalPaid = allPayments?.reduce((s, p) => s + p.amount, 0) || 0;

      const { data: billItems } = await supabase
        .from('purchase_bill_items')
        .select('quantity_received, unit_price_cny')
        .eq('purchase_bill_id', paymentModal.billId);

      const billTotal = billItems?.reduce((s, i) => s + i.quantity_received * i.unit_price_cny, 0) || 0;
      const newStatus = totalPaid >= billTotal ? 'paid' : totalPaid > 0 ? 'partial' : 'pending';

      await supabase
        .from('purchase_bills')
        .update({ amount_paid: totalPaid, status: newStatus })
        .eq('id', paymentModal.billId);

      setPaymentModal(null);
      loadOutstandingPayments();
    } else {
      alert('Payment was NOT saved: ' + (error?.message ?? 'unknown error'));
    }

    setSavingPayment(false);
  }

  function toggleSupplier(supplierId: string) {
    const next = new Set(expandedSuppliers);
    if (next.has(supplierId)) next.delete(supplierId);
    else next.add(supplierId);
    setExpandedSuppliers(next);
  }

  function formatCurrency(amount: number, currency = 'CNY') {
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + ' ' + currency;
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function getDaysOverdue(dueDate: string | null): number | null {
    if (!dueDate) return null;
    const diff = new Date().getTime() - new Date(dueDate).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  function getAgeDays(dateStr: string): number {
    return Math.floor((new Date().getTime() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  }

  function getAgingColor(days: number) {
    if (days <= 30) return 'text-green-600';
    if (days <= 60) return 'text-amber-600';
    if (days <= 90) return 'text-orange-600';
    return 'text-red-600';
  }

  function getStatusBadge(status: string, pendingAmount: number) {
    if (pendingAmount < 0) return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-700">
        <AlertTriangle className="w-3 h-3" />Overpaid
      </span>
    );
    switch (status) {
      case 'paid': return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
          <CheckCircle className="w-3 h-3" />Paid
        </span>
      );
      case 'partial': return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
          <Clock className="w-3 h-3" />Partial
        </span>
      );
      default: return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
          <Clock className="w-3 h-3" />Pending
        </span>
      );
    }
  }

  const filteredSuppliers = suppliers.map(supplier => {
    const searchLower = searchTerm.toLowerCase().trim();
    const supplierMatches = !searchLower || supplier.supplier_name.toLowerCase().includes(searchLower);

    const filteredBills = supplier.bills.filter(bill => {
      if (batchFilter && bill.batch_number !== batchFilter) return false;
      const billMatchesSearch = !searchLower || supplierMatches ||
        (bill.bill_number || '').toLowerCase().includes(searchLower) ||
        (bill.cnv_invoice_number || '').toLowerCase().includes(searchLower) ||
        (bill.batch_number || '').toLowerCase().includes(searchLower);
      if (!billMatchesSearch) return false;
      if (statusFilter === 'overpaid') return bill.pending_amount < 0;
      if (statusFilter === 'pending') return bill.pending_amount > 0;
      if (statusFilter === 'partial') return bill.status === 'partial';
      return true;
    });

    if (filteredBills.length === 0) return null;
    return {
      ...supplier,
      bills: filteredBills,
      bills_count: filteredBills.length,
      total_pending: filteredBills.reduce((sum, b) => sum + Math.max(0, b.pending_amount), 0),
      total_paid: filteredBills.reduce((sum, b) => sum + b.amount_paid, 0),
      overpayment: filteredBills.reduce((sum, b) => sum + (b.pending_amount < 0 ? Math.abs(b.pending_amount) : 0), 0),
    };
  }).filter((s): s is SupplierPayment => s !== null)
    .sort((a, b) => {
      if (sortBy === 'name') return a.supplier_name.localeCompare(b.supplier_name);
      if (sortBy === 'age') return new Date(a.oldest_bill_date).getTime() - new Date(b.oldest_bill_date).getTime();
      return b.total_pending - a.total_pending;
    });

  const filteredSummary = {
    total_pending: filteredSuppliers.reduce((s, sup) => s + sup.total_pending, 0),
    total_paid: filteredSuppliers.reduce((s, sup) => s + sup.total_paid, 0),
    total_overpaid: filteredSuppliers.reduce((s, sup) => s + sup.overpayment, 0),
    suppliers_count: filteredSuppliers.filter(s => s.total_pending > 0).length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-amber-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl">
            <DollarSign className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Outstanding Payments</h2>
            <p className="text-sm text-gray-500">Track and manage supplier payments in CNY</p>
          </div>
        </div>
        <button
          onClick={loadOutstandingPayments}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
        <button
          onClick={() => setShowPrintView(true)}
          disabled={filteredSuppliers.length === 0}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <Printer className="w-4 h-4" />
          Print / PDF
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-50 rounded-lg">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Pending</p>
              <p className="text-xl font-bold text-amber-600">{formatCurrency(filteredSummary.total_pending)}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-50 rounded-lg">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Paid</p>
              <p className="text-xl font-bold text-green-600">{formatCurrency(filteredSummary.total_paid)}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-50 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-teal-700" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Overpaid</p>
              <p className="text-xl font-bold text-teal-700">{formatCurrency(filteredSummary.total_overpaid)}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-50 rounded-lg">
              <Building2 className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Suppliers with Due</p>
              <p className="text-xl font-bold text-gray-900">{filteredSummary.suppliers_count}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search suppliers, bill numbers, CNV invoice..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
            />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <select
                value={batchFilter}
                onChange={(e) => setBatchFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
              >
                <option value="">All Batches</option>
                {availableBatches.map(b => <option key={b} value={b}>Batch {b}</option>)}
              </select>
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
            >
              <option value="all">All Status</option>
              <option value="pending">With Pending</option>
              <option value="partial">Partial Payments</option>
              <option value="overpaid">Overpaid</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
            >
              <option value="amount">Sort by Amount</option>
              <option value="age">Sort by Age</option>
              <option value="name">Sort by Name</option>
            </select>
            <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('flat')}
                className={`px-3 py-2 flex items-center gap-1.5 text-sm font-medium transition-colors ${viewMode === 'flat' ? 'bg-amber-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                title="All bills in one table"
              >
                <List className="w-4 h-4" />
                <span className="hidden sm:inline">All Bills</span>
              </button>
              <button
                onClick={() => setViewMode('grouped')}
                className={`px-3 py-2 flex items-center gap-1.5 text-sm font-medium transition-colors ${viewMode === 'grouped' ? 'bg-amber-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                title="Grouped by supplier"
              >
                <Layers className="w-4 h-4" />
                <span className="hidden sm:inline">By Supplier</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bill Views */}
      {filteredSuppliers.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
          <p className="text-lg font-medium text-gray-900">No Outstanding Payments</p>
          <p className="text-sm text-gray-500">All supplier payments are up to date</p>
        </div>
      ) : viewMode === 'flat' ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Bill #</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">CNV Inv #</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Batch</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Due</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Paid</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Pending</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Age</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSuppliers.flatMap((supplier) =>
                  supplier.bills.map((bill) => {
                    const daysOverdue = getDaysOverdue(bill.due_date);
                    const isOverdue = daysOverdue !== null && daysOverdue > 0 && bill.pending_amount > 0;
                    const ageDays = getAgeDays(bill.bill_date);

                    return (
                      <tr key={bill.id} className={`hover:bg-gray-50 transition-colors ${isOverdue ? 'bg-red-50' : ''}`}>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-gray-900">{supplier.supplier_name}</span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => onRecordPayment?.(bill.id)}
                            className="flex items-center gap-2 hover:text-amber-700 group"
                            title="Open bill"
                          >
                            <Receipt className="w-4 h-4 text-gray-400 group-hover:text-amber-600" />
                            <span className="font-medium text-gray-900 group-hover:text-amber-700 underline underline-offset-2 decoration-dotted text-sm">{bill.bill_number}</span>
                          </button>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{bill.cnv_invoice_number || '-'}</td>
                        <td className="px-4 py-3">
                          {bill.batch_number ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                              B{bill.batch_number}
                            </span>
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{formatDate(bill.bill_date)}</td>
                        <td className="px-4 py-3">
                          {bill.due_date ? (
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-gray-400" />
                              <span className={`text-sm ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                                {formatDate(bill.due_date)}
                              </span>
                              {isOverdue && <span className="text-xs text-red-600 ml-1">({daysOverdue}d)</span>}
                            </div>
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">{getStatusBadge(bill.status, bill.pending_amount)}</td>
                        <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">{formatCurrency(bill.total_amount)}</td>
                        <td className="px-4 py-3 text-right text-sm text-green-600">{formatCurrency(bill.amount_paid)}</td>
                        <td className={`px-4 py-3 text-right text-sm font-semibold ${
                          bill.pending_amount < 0 ? 'text-teal-700' :
                          bill.pending_amount > 0 ? 'text-amber-600' : 'text-green-600'
                        }`}>
                          {bill.pending_amount < 0 ? '-' : ''}{formatCurrency(Math.abs(bill.pending_amount))}
                        </td>
                        <td className={`px-4 py-3 text-right text-sm font-medium ${getAgingColor(ageDays)}`}>
                          {ageDays}d
                        </td>
                        <td className="px-4 py-3 text-center">
                          {bill.pending_amount > 0 ? (
                            <button
                              onClick={() => openPaymentModal(bill, supplier.supplier_name)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-100 rounded-lg hover:bg-amber-200 transition-colors"
                            >
                              <CreditCard className="w-3 h-3" />
                              Pay
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot className="bg-gray-50 border-t border-gray-200">
                <tr className="font-semibold">
                  <td colSpan={7} className="px-4 py-3 text-sm text-gray-700">
                    Grand Total ({filteredSuppliers.reduce((s, sup) => s + sup.bills.length, 0)} bills)
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-900">
                    {formatCurrency(filteredSuppliers.reduce((s, sup) => s + sup.bills.reduce((bs, b) => bs + b.total_amount, 0), 0))}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-green-600">{formatCurrency(filteredSummary.total_paid)}</td>
                  <td className="px-4 py-3 text-right text-sm text-amber-600">{formatCurrency(filteredSummary.total_pending)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredSuppliers.map((supplier) => {
            const isExpanded = expandedSuppliers.has(supplier.supplier_id);
            const oldestAgeDays = getAgeDays(supplier.oldest_bill_date);

            return (
              <div key={supplier.supplier_id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <button
                  onClick={() => toggleSupplier(supplier.supplier_id)}
                  className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-lg ${supplier.total_pending > 0 ? 'bg-amber-50' : 'bg-green-50'}`}>
                      <Building2 className={`w-5 h-5 ${supplier.total_pending > 0 ? 'text-amber-600' : 'text-green-600'}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-900">{supplier.supplier_name}</p>
                        {oldestAgeDays > 60 && supplier.total_pending > 0 && (
                          <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded-full">
                            {oldestAgeDays}d old
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">
                        {supplier.bills_count} bill{supplier.bills_count > 1 ? 's' : ''} · Oldest: {formatDate(supplier.oldest_bill_date)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Total Amount</p>
                      <p className="text-sm font-semibold text-gray-700">{formatCurrency(supplier.bills.reduce((s, b) => s + b.total_amount, 0))}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-green-600">Paid</p>
                      <p className="text-sm font-semibold text-green-600">{formatCurrency(supplier.total_paid)}</p>
                    </div>
                    {supplier.overpayment > 0 && (
                      <div className="text-right">
                        <p className="text-xs text-teal-700 font-medium">Overpaid</p>
                        <p className="text-sm font-bold text-teal-700">{formatCurrency(supplier.overpayment)}</p>
                      </div>
                    )}
                    <div className="text-right min-w-[120px]">
                      <p className="text-xs text-amber-600">Pending</p>
                      <p className="text-lg font-bold text-amber-600">{formatCurrency(supplier.total_pending)}</p>
                    </div>
                    {isExpanded ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-200">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Bill #</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">CNV Inv #</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Batch</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Due</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Paid</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Pending</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Age</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {supplier.bills.map((bill) => {
                            const daysOverdue = getDaysOverdue(bill.due_date);
                            const isOverdue = daysOverdue !== null && daysOverdue > 0 && bill.pending_amount > 0;
                            const ageDays = getAgeDays(bill.bill_date);

                            return (
                              <tr key={bill.id} className={`hover:bg-gray-50 transition-colors ${isOverdue ? 'bg-red-50' : ''}`}>
                                <td className="px-4 py-3">
                                  <button
                                    onClick={() => onRecordPayment?.(bill.id)}
                                    className="flex items-center gap-2 hover:text-amber-700 group"
                                    title="Open bill"
                                  >
                                    <Receipt className="w-4 h-4 text-gray-400 group-hover:text-amber-600" />
                                    <span className="font-medium text-gray-900 group-hover:text-amber-700 underline underline-offset-2 decoration-dotted">{bill.bill_number}</span>
                                  </button>
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-600">{bill.cnv_invoice_number || '-'}</td>
                                <td className="px-4 py-3 text-sm text-gray-600">{bill.batch_number || '-'}</td>
                                <td className="px-4 py-3 text-sm text-gray-600">{formatDate(bill.bill_date)}</td>
                                <td className="px-4 py-3">
                                  {bill.due_date ? (
                                    <div className="flex items-center gap-1">
                                      <Calendar className="w-3 h-3 text-gray-400" />
                                      <span className={`text-sm ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                                        {formatDate(bill.due_date)}
                                      </span>
                                      {isOverdue && <span className="text-xs text-red-600 ml-1">({daysOverdue}d late)</span>}
                                    </div>
                                  ) : (
                                    <span className="text-sm text-gray-400">-</span>
                                  )}
                                </td>
                                <td className="px-4 py-3">{getStatusBadge(bill.status, bill.pending_amount)}</td>
                                <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">{formatCurrency(bill.total_amount)}</td>
                                <td className="px-4 py-3 text-right text-sm text-green-600">{formatCurrency(bill.amount_paid)}</td>
                                <td className={`px-4 py-3 text-right text-sm font-semibold ${
                                  bill.pending_amount < 0 ? 'text-teal-700' :
                                  bill.pending_amount > 0 ? 'text-amber-600' : 'text-green-600'
                                }`}>
                                  {bill.pending_amount < 0 ? '-' : ''}{formatCurrency(Math.abs(bill.pending_amount))}
                                </td>
                                <td className={`px-4 py-3 text-right text-sm font-medium ${getAgingColor(ageDays)}`}>
                                  {ageDays}d
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {bill.pending_amount > 0 ? (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openPaymentModal(bill, supplier.supplier_name); }}
                                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-100 rounded-lg hover:bg-amber-200 transition-colors"
                                    >
                                      <CreditCard className="w-3 h-3" />
                                      Pay
                                    </button>
                                  ) : (
                                    <span className="text-xs text-gray-400">-</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="bg-gray-50 border-t border-gray-200">
                          <tr className="font-semibold">
                            <td colSpan={6} className="px-4 py-3 text-sm text-gray-700">Supplier Total</td>
                            <td className="px-4 py-3 text-right text-sm text-gray-900">
                              {formatCurrency(supplier.bills.reduce((s, b) => s + b.total_amount, 0))}
                            </td>
                            <td className="px-4 py-3 text-right text-sm text-green-600">{formatCurrency(supplier.total_paid)}</td>
                            <td className="px-4 py-3 text-right text-sm text-amber-600">{formatCurrency(supplier.total_pending)}</td>
                            <td colSpan={2}></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Aging Summary */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Aging Summary</h3>
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Current (0-30 days)', color: 'bg-green-500' },
            { label: '31-60 days', color: 'bg-amber-500' },
            { label: '61-90 days', color: 'bg-orange-500' },
            { label: '90+ days', color: 'bg-red-500' },
          ].map((bucket, index) => {
            let amount = 0;
            filteredSuppliers.forEach((s) => {
              s.bills.forEach((bill) => {
                if (bill.pending_amount <= 0) return;
                const days = getAgeDays(bill.bill_date);
                if (index === 0 && days <= 30) amount += bill.pending_amount;
                else if (index === 1 && days > 30 && days <= 60) amount += bill.pending_amount;
                else if (index === 2 && days > 60 && days <= 90) amount += bill.pending_amount;
                else if (index === 3 && days > 90) amount += bill.pending_amount;
              });
            });
            const percentage = filteredSummary.total_pending > 0 ? (amount / filteredSummary.total_pending) * 100 : 0;

            return (
              <div key={bucket.label} className="text-center">
                <div className="h-24 bg-gray-100 rounded-lg relative overflow-hidden mb-2">
                  <div
                    className={`absolute bottom-0 left-0 right-0 ${bucket.color} transition-all`}
                    style={{ height: `${Math.min(percentage, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mb-1">{bucket.label}</p>
                <p className="text-sm font-semibold text-gray-900">{formatCurrency(amount)}</p>
                <p className="text-xs text-gray-400">{percentage.toFixed(1)}%</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Payment Modal */}
      {paymentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Record Payment</h3>
                <p className="text-sm text-gray-500">{paymentModal.supplierName} — {paymentModal.billNumber}</p>
              </div>
              <button onClick={() => setPaymentModal(null)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-amber-700 font-medium">Pending Amount</span>
                <span className="text-lg font-bold text-amber-700">{formatCurrency(paymentModal.pendingAmount)}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Voucher No.</label>
                  <input
                    type="text"
                    value={paymentForm.voucher_number}
                    onChange={(e) => setPaymentForm({ ...paymentForm, voucher_number: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                    placeholder="CA-035"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={paymentForm.payment_date}
                    onChange={(e) => setPaymentForm({ ...paymentForm, payment_date: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Payment Mode</label>
                  <select
                    value={paymentForm.payment_mode}
                    onChange={(e) => setPaymentForm({ ...paymentForm, payment_mode: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  >
                    {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Amount (CNY)</label>
                  <input
                    type="number"
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Rate (Rs per ¥)</label>
                  <input type="number" step="0.01" value={paymentForm.rate_lkr} onChange={(e) => setPaymentForm({ ...paymentForm, rate_lkr: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500" placeholder="e.g. 45.80" />
                  <p className="text-[11px] text-gray-500 mt-1">= Rs {((parseFloat(paymentForm.amount) || 0) * (parseFloat(paymentForm.rate_lkr) || 0)).toLocaleString('en-LK', { maximumFractionDigits: 0 })}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Paid by</label>
                  <select value={paymentForm.funded_by} onChange={(e) => setPaymentForm({ ...paymentForm, funded_by: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg">
                    <option value="investor">Investor (goes to ledger)</option>
                    <option value="own">Own funds</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Narration</label>
                <input
                  type="text"
                  value={paymentForm.narration}
                  onChange={(e) => setPaymentForm({ ...paymentForm, narration: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  placeholder="Optional note..."
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
              <button
                onClick={() => setPaymentModal(null)}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePaymentSubmit}
                disabled={savingPayment || !paymentForm.amount || parseFloat(paymentForm.amount) <= 0}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <CreditCard className="w-4 h-4" />
                {savingPayment ? 'Saving...' : 'Record Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showPrintView && (
        <OutstandingPaymentsPrint
          suppliers={filteredSuppliers}
          batchFilter={batchFilter || undefined}
          onClose={() => setShowPrintView(false)}
        />
      )}
    </div>
  );
}
