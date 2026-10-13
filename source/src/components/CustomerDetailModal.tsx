import { useEffect, useState } from 'react';
import { X, User, Phone, Award, DollarSign, FileText, TrendingUp, CreditCard, Calendar, CircleCheck as CheckCircle2, Clock, CircleAlert as AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { openingBal } from '../lib/book';

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  total_amount: number;
  amount_paid: number;
  amount_due: number;
  status: string;
}

interface Payment {
  id: string;
  payment_number: string | null;
  payment_date: string;
  amount: number;
  payment_mode: string;
  reference_number: string | null;
  notes: string | null;
  sales_invoice_id: string | null;
}

interface CustomerDetail {
  id: string;
  name: string;
  phone: string | null;
  credit_score: number;
  credit_amount: number;
  credit_days: number;
  opening_balance: number;
}

interface CustomerDetailModalProps {
  customerId: string;
  customerName: string;
  onClose: () => void;
}

type Tab = 'invoices' | 'payments';

export default function CustomerDetailModal({ customerId, customerName, onClose }: CustomerDetailModalProps) {
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('invoices');

  useEffect(() => {
    loadCustomerData();
  }, [customerId, customerName]);

  async function loadCustomerData() {
    setLoading(true);

    const [
      { data: customerData },
      { data: invoiceData },
      { data: busyPayments },
      { data: legacyPayments },
    ] = await Promise.all([
      supabase
        .from('customers')
        .select('id, name, phone, credit_score, credit_amount, credit_days, opening_balance')
        .eq('id', customerId)
        .maybeSingle(),
      supabase
        .from('busy_sales_invoices')
        .select('id, invoice_number, invoice_date, due_date, total_amount, amount_paid, amount_due, status')
        .eq('customer_name', customerName)
        .order('invoice_date', { ascending: false }),
      supabase
        .from('busy_sales_payments')
        .select('id, payment_number, payment_date, amount, payment_mode, reference_number, notes, sales_invoice_id')
        .eq('customer_name', customerName)
        .order('payment_date', { ascending: false }),
      supabase
        .from('customer_payments')
        .select('id, payment_date, amount, payment_mode, reference_number, notes, sales_invoice_id')
        .eq('customer_name', customerName)
        .order('payment_date', { ascending: false }),
    ]);

    if (customerData) setCustomer(customerData);
    if (invoiceData) setInvoices(invoiceData);

    const merged: Payment[] = [
      ...((busyPayments as Payment[]) || []),
      ...((legacyPayments || []).map(p => ({ ...p, payment_number: null }))),
    ].sort((a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime());

    setPayments(merged);
    setLoading(false);
  }

  function formatCurrency(amount: number) {
    return 'LKR ' + new Intl.NumberFormat('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'paid': return { cls: 'bg-green-100 text-green-700', icon: <CheckCircle2 className="w-3 h-3" /> };
      case 'partial': return { cls: 'bg-amber-100 text-amber-700', icon: <Clock className="w-3 h-3" /> };
      case 'overdue': return { cls: 'bg-red-100 text-red-700', icon: <AlertCircle className="w-3 h-3" /> };
      default: return { cls: 'bg-teal-100 text-teal-700', icon: <FileText className="w-3 h-3" /> };
    }
  }

  function getPaymentModeBadge(mode: string) {
    switch (mode) {
      case 'cash': return 'bg-green-100 text-green-700';
      case 'cheque': return 'bg-teal-100 text-teal-700';
      case 'bank_transfer': return 'bg-cyan-100 text-cyan-700';
      case 'online': return 'bg-teal-100 text-teal-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  }

  function formatPaymentMode(mode: string) {
    const map: Record<string, string> = { cash: 'Cash', cheque: 'Cheque', bank_transfer: 'Bank Transfer', online: 'Online' };
    return map[mode] || mode;
  }

  function getCreditScoreColor(score: number) {
    if (score >= 75) return { bar: 'bg-green-500', text: 'text-green-700', label: 'Good Credit' };
    if (score >= 50) return { bar: 'bg-amber-500', text: 'text-amber-700', label: 'Fair Credit' };
    return { bar: 'bg-red-500', text: 'text-red-700', label: 'Cash Only' };
  }

  const totalSales = invoices.reduce((s, i) => s + Number(i.total_amount), 0);
  const totalDue = invoices.reduce((s, i) => s + Number(i.amount_due), 0) + openingBal(customer?.opening_balance);
  const totalPaid = invoices.reduce((s, i) => s + Number(i.amount_paid), 0);
  const scoreInfo = getCreditScoreColor(customer?.credit_score || 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-6 py-5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center">
              <User className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">{customerName}</h2>
              {customer?.phone && (
                <div className="flex items-center gap-1.5 text-slate-300 text-sm mt-0.5">
                  <Phone className="w-3.5 h-3.5" />
                  <span>{customer.phone}</span>
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-gray-200 border-t-slate-600"></div>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-5 bg-gray-50 border-b border-gray-200 flex-shrink-0">
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Award className="w-4 h-4 text-gray-500" />
                  <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Credit Score</span>
                </div>
                <p className={`text-2xl font-bold ${scoreInfo.text}`}>{customer?.credit_score || 0}</p>
                <p className={`text-xs font-medium mt-0.5 ${scoreInfo.text}`}>{scoreInfo.label}</p>
                <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full ${scoreInfo.bar} rounded-full`} style={{ width: `${Math.min(customer?.credit_score || 0, 100)}%` }} />
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-gray-500" />
                  <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total Sales</span>
                </div>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(totalSales)}</p>
                <p className="text-xs text-gray-500 mt-0.5">{invoices.length} invoice{invoices.length !== 1 ? 's' : ''}</p>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <CreditCard className="w-4 h-4 text-gray-500" />
                  <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total Paid</span>
                </div>
                <p className="text-xl font-bold text-green-600">{formatCurrency(totalPaid)}</p>
                <p className="text-xs text-gray-500 mt-0.5">{payments.length} payment{payments.length !== 1 ? 's' : ''}</p>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-4 h-4 text-gray-500" />
                  <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Outstanding</span>
                </div>
                <p className={`text-xl font-bold ${totalDue > 0 ? 'text-rose-600' : 'text-green-600'}`}>{formatCurrency(totalDue)}</p>
                {openingBal(customer?.opening_balance) > 0 && (
                  <p className="text-xs text-orange-500 mt-0.5">Incl. opening bal</p>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 px-6 flex-shrink-0">
              {([
                { id: 'invoices', label: 'Invoices', icon: FileText, count: invoices.length },
                { id: 'payments', label: 'Payment History', icon: CreditCard, count: payments.length },
              ] as { id: Tab; label: string; icon: typeof FileText; count: number }[]).map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                      activeTab === tab.id
                        ? 'border-slate-700 text-slate-900'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                    <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                      activeTab === tab.id ? 'bg-slate-700 text-white' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto">

              {/* Invoices tab */}
              {activeTab === 'invoices' && (
                invoices.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <FileText className="w-12 h-12 text-gray-300 mb-3" />
                    <p className="text-gray-500 font-medium">No invoices found</p>
                    <p className="text-sm text-gray-400">This customer has no recorded invoices</p>
                  </div>
                ) : (
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                      <tr>
                        {['Invoice #', 'Date', 'Due Date', 'Total', 'Paid', 'Due', 'Status'].map(h => (
                          <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {invoices.map((inv) => {
                        const badge = getStatusBadge(inv.status);
                        return (
                          <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-5 py-3.5">
                              <span className="font-semibold text-gray-900 text-sm">{inv.invoice_number}</span>
                            </td>
                            <td className="px-5 py-3.5 text-sm text-gray-600">{formatDate(inv.invoice_date)}</td>
                            <td className="px-5 py-3.5 text-sm text-gray-600">
                              {inv.due_date ? (
                                <div className="flex items-center gap-1">
                                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                                  {formatDate(inv.due_date)}
                                </div>
                              ) : '—'}
                            </td>
                            <td className="px-5 py-3.5 text-sm font-semibold text-gray-900">{formatCurrency(Number(inv.total_amount))}</td>
                            <td className="px-5 py-3.5 text-sm font-medium text-green-600">{formatCurrency(Number(inv.amount_paid))}</td>
                            <td className="px-5 py-3.5 text-sm">
                              <span className={`font-semibold ${Number(inv.amount_due) > 0 ? 'text-rose-600' : 'text-gray-400'}`}>
                                {formatCurrency(Number(inv.amount_due))}
                              </span>
                            </td>
                            <td className="px-5 py-3.5">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.cls}`}>
                                {badge.icon}
                                {inv.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                      <tr>
                        <td colSpan={3} className="px-5 py-3 text-sm font-semibold text-gray-700">Total</td>
                        <td className="px-5 py-3 text-sm font-bold text-gray-900">{formatCurrency(totalSales)}</td>
                        <td className="px-5 py-3 text-sm font-bold text-green-600">{formatCurrency(totalPaid)}</td>
                        <td className="px-5 py-3 text-sm font-bold text-rose-600">{formatCurrency(totalDue)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                )
              )}

              {/* Payments tab */}
              {activeTab === 'payments' && (
                payments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <CreditCard className="w-12 h-12 text-gray-300 mb-3" />
                    <p className="text-gray-500 font-medium">No payments recorded</p>
                    <p className="text-sm text-gray-400">No payments have been collected from this customer</p>
                  </div>
                ) : (
                  <>
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                        <tr>
                          {['Payment #', 'Date', 'Invoice', 'Mode', 'Reference', 'Amount'].map(h => (
                            <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {payments.map((pay) => (
                          <tr key={pay.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-5 py-3.5">
                              <span className="font-semibold text-gray-900 text-sm">{pay.payment_number || '—'}</span>
                            </td>
                            <td className="px-5 py-3.5 text-sm text-gray-600">{formatDate(pay.payment_date)}</td>
                            <td className="px-5 py-3.5 text-sm text-gray-600">
                              {invoices.find(i => i.id === pay.sales_invoice_id)?.invoice_number || '—'}
                            </td>
                            <td className="px-5 py-3.5">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getPaymentModeBadge(pay.payment_mode)}`}>
                                {formatPaymentMode(pay.payment_mode)}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-sm text-gray-500">{pay.reference_number || '—'}</td>
                            <td className="px-5 py-3.5">
                              <span className="text-sm font-bold text-green-600">{formatCurrency(Number(pay.amount))}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                        <tr>
                          <td colSpan={5} className="px-5 py-3 text-sm font-semibold text-gray-700">Total Received</td>
                          <td className="px-5 py-3 text-sm font-bold text-green-600">
                            {formatCurrency(payments.reduce((s, p) => s + Number(p.amount), 0))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>

                    {openingBal(customer?.opening_balance) > 0 && (
                      <div className="mx-5 my-4 p-4 bg-orange-50 border border-orange-200 rounded-xl">
                        <p className="text-sm text-orange-800">
                          <span className="font-semibold">Opening Balance:</span>{' '}
                          {formatCurrency(openingBal(customer!.opening_balance))} — this amount carries over from before the system was set up.
                        </p>
                      </div>
                    )}
                  </>
                )
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
