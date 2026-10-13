import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { openingBal as bookOpening } from '../lib/book';
import { Users, Clock, CircleCheck as CheckCircle, DollarSign, RefreshCw, ChevronDown, ChevronRight, CircleAlert as AlertCircle, FileText, Search, ListFilter as Filter } from 'lucide-react';

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

interface CustomerReceivable {
  customer_id: string;
  customer_name: string;
  total_invoiced: number;
  total_paid: number;
  total_pending: number;
  opening_balance: number;
  invoices: Invoice[];
  oldest_invoice_date: string;
  days_overdue: number;
}

interface Summary {
  total_receivables: number;
  total_overdue: number;
  total_customers: number;
  avg_days_outstanding: number;
}

export default function SLReceivables() {
  const [receivables, setReceivables] = useState<CustomerReceivable[]>([]);
  const [summary, setSummary] = useState<Summary>({
    total_receivables: 0,
    total_overdue: 0,
    total_customers: 0,
    avg_days_outstanding: 0,
  });
  const [loading, setLoading] = useState(true);
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'overdue' | 'pending'>('all');
  const [sortBy, setSortBy] = useState<'amount' | 'days' | 'name'>('amount');

  useEffect(() => {
    loadReceivables();
  }, []);

  async function loadReceivables() {
    setLoading(true);

    const { data: customers } = await supabase
      .from('customers')
      .select('id, name, opening_balance');

    const customerOpeningBalances = new Map<string, number>();
    const customerIdByName = new Map<string, string>();
    customers?.forEach((c) => {
      customerOpeningBalances.set(c.id, bookOpening(c.opening_balance));
      customerIdByName.set(c.name, c.id);
    });

    const { data: invoices } = await supabase
      .from('busy_sales_invoices')
      .select('id, invoice_number, invoice_date, due_date, customer_id, customer_name, total_amount, amount_paid, amount_due, status')
      .in('status', ['sent', 'partial', 'overdue'])
      .order('invoice_date', { ascending: true });

    const customerMap = new Map<string, CustomerReceivable>();
    const today = new Date();

    if (invoices) {
      invoices.forEach((invoice) => {
        const customerId = invoice.customer_id || invoice.customer_name;
        const dueDate = invoice.due_date ? new Date(invoice.due_date) : null;
        const daysOverdue = dueDate ? Math.max(0, Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))) : 0;

        const invoiceData: Invoice = {
          id: invoice.id,
          invoice_number: invoice.invoice_number,
          invoice_date: invoice.invoice_date,
          due_date: invoice.due_date,
          total_amount: invoice.total_amount || 0,
          amount_paid: invoice.amount_paid || 0,
          amount_due: invoice.amount_due || 0,
          status: invoice.status,
        };

        const existing = customerMap.get(customerId);
        const openingBal = invoice.customer_id ? (customerOpeningBalances.get(invoice.customer_id) || 0) : 0;

        if (existing) {
          existing.total_invoiced += invoice.total_amount || 0;
          existing.total_paid += invoice.amount_paid || 0;
          existing.total_pending += invoice.amount_due || 0;
          existing.invoices.push(invoiceData);
          if (invoice.invoice_date < existing.oldest_invoice_date) {
            existing.oldest_invoice_date = invoice.invoice_date;
          }
          if (daysOverdue > existing.days_overdue) {
            existing.days_overdue = daysOverdue;
          }
        } else {
          customerMap.set(customerId, {
            customer_id: invoice.customer_id || '',
            customer_name: invoice.customer_name,
            total_invoiced: invoice.total_amount || 0,
            total_paid: invoice.amount_paid || 0,
            total_pending: invoice.amount_due || 0,
            opening_balance: openingBal,
            invoices: [invoiceData],
            oldest_invoice_date: invoice.invoice_date,
            days_overdue: daysOverdue,
          });
        }
      });
    }

    customers?.forEach((c) => {
        const openingBal = bookOpening(c.opening_balance);
        if (openingBal > 0 && !customerMap.has(c.id)) {
          customerMap.set(c.id, {
            customer_id: c.id,
            customer_name: c.name,
            total_invoiced: 0,
            total_paid: 0,
            total_pending: 0,
            opening_balance: openingBal,
            invoices: [],
            oldest_invoice_date: new Date().toISOString(),
            days_overdue: 0,
          });
        }
      });

    const receivablesList = Array.from(customerMap.values()).filter((r) => (r.total_pending + r.opening_balance) > 0);

    let totalReceivables = 0;
    let totalOverdue = 0;
    let totalDaysOutstanding = 0;
    let invoiceCount = 0;

    receivablesList.forEach((r) => {
      totalReceivables += r.total_pending + r.opening_balance;
      r.invoices.forEach((inv) => {
        if (inv.status === 'overdue') {
          totalOverdue += inv.amount_due;
        }
        const invDate = new Date(inv.invoice_date);
        totalDaysOutstanding += Math.floor((today.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24));
        invoiceCount++;
      });
    });

    setSummary({
      total_receivables: totalReceivables,
      total_overdue: totalOverdue,
      total_customers: receivablesList.length,
      avg_days_outstanding: invoiceCount > 0 ? Math.round(totalDaysOutstanding / invoiceCount) : 0,
    });

    setReceivables(receivablesList);
    setLoading(false);
  }

  function toggleCustomer(customerId: string) {
    const newExpanded = new Set(expandedCustomers);
    if (newExpanded.has(customerId)) {
      newExpanded.delete(customerId);
    } else {
      newExpanded.add(customerId);
    }
    setExpandedCustomers(newExpanded);
  }

  function formatCurrency(amount: number) {
    return new Intl.NumberFormat('en-LK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ' LKR';
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  function getDaysAgo(dateStr: string) {
    const date = new Date(dateStr);
    const today = new Date();
    const diffDays = Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return '1 day';
    return `${diffDays} days`;
  }

  function getStatusColor(status: string) {
    switch (status.toLowerCase()) {
      case 'sent':
        return 'bg-amber-100 text-amber-700';
      case 'partial':
        return 'bg-teal-100 text-teal-700';
      case 'overdue':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  }

  function getAgingColor(days: number) {
    if (days === 0) return 'text-green-600';
    if (days <= 30) return 'text-amber-600';
    if (days <= 60) return 'text-orange-600';
    return 'text-red-600';
  }

  const filteredReceivables = receivables
    .filter((r) => {
      if (searchTerm && !r.customer_name.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }
      if (filterStatus === 'overdue' && r.days_overdue === 0) {
        return false;
      }
      if (filterStatus === 'pending' && r.days_overdue > 0) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'amount') return (b.total_pending + b.opening_balance) - (a.total_pending + a.opening_balance);
      if (sortBy === 'days') return b.days_overdue - a.days_overdue;
      return a.customer_name.localeCompare(b.customer_name);
    });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-teal-600"></div>
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
            <h2 className="text-2xl font-bold text-gray-900">Customer Receivables</h2>
            <p className="text-sm text-gray-500">Outstanding payments from customers in LKR</p>
          </div>
        </div>
        <button
          onClick={loadReceivables}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-50 rounded-lg">
              <DollarSign className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Receivables</p>
              <p className="text-xl font-bold text-amber-600">{formatCurrency(summary.total_receivables)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-50 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Overdue Amount</p>
              <p className="text-xl font-bold text-red-600">{formatCurrency(summary.total_overdue)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-50 rounded-lg">
              <Users className="w-5 h-5 text-teal-700" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Customers with Due</p>
              <p className="text-xl font-bold text-gray-900">{summary.total_customers}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-50 rounded-lg">
              <Clock className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Avg Days Outstanding</p>
              <p className="text-xl font-bold text-gray-900">{summary.avg_days_outstanding} days</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex flex-col md:flex-row md:items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search customers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as 'all' | 'overdue' | 'pending')}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="all">All Status</option>
                <option value="overdue">Overdue Only</option>
                <option value="pending">Pending Only</option>
              </select>
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'amount' | 'days' | 'name')}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            >
              <option value="amount">Sort by Amount</option>
              <option value="days">Sort by Days Overdue</option>
              <option value="name">Sort by Name</option>
            </select>
          </div>
        </div>

        {filteredReceivables.length === 0 ? (
          <div className="p-12 text-center">
            <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
            <p className="text-lg font-medium text-gray-900">No Outstanding Receivables</p>
            <p className="text-sm text-gray-500">All customer payments are up to date</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredReceivables.map((customer) => {
              const isExpanded = expandedCustomers.has(customer.customer_id || customer.customer_name);

              return (
                <div key={customer.customer_id || customer.customer_name}>
                  <button
                    onClick={() => toggleCustomer(customer.customer_id || customer.customer_name)}
                    className="w-full px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`p-2 rounded-lg ${customer.days_overdue > 0 ? 'bg-red-50' : 'bg-amber-50'}`}>
                          <Users className={`w-5 h-5 ${customer.days_overdue > 0 ? 'text-red-600' : 'text-amber-600'}`} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-gray-900">{customer.customer_name}</p>
                            {customer.days_overdue > 0 && (
                              <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded-full">
                                {customer.days_overdue} days overdue
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-500">
                            {customer.invoices.length} invoice{customer.invoices.length > 1 ? 's' : ''} - Oldest: {getDaysAgo(customer.oldest_invoice_date)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <p className="text-xs text-gray-500">Total Invoiced</p>
                          <p className="text-sm font-medium text-gray-700">{formatCurrency(customer.total_invoiced)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-green-600">Paid</p>
                          <p className="text-sm font-medium text-green-600">{formatCurrency(customer.total_paid)}</p>
                        </div>
                        {customer.opening_balance > 0 && (
                          <div className="text-right">
                            <p className="text-xs text-orange-600">Opening Bal</p>
                            <p className="text-sm font-medium text-orange-600">{formatCurrency(customer.opening_balance)}</p>
                          </div>
                        )}
                        <div className="text-right min-w-[140px]">
                          <p className="text-xs text-amber-600">Outstanding</p>
                          <p className={`text-lg font-bold ${customer.days_overdue > 0 ? 'text-red-600' : 'text-amber-600'}`}>
                            {formatCurrency(customer.total_pending + customer.opening_balance)}
                          </p>
                        </div>
                        {isExpanded ? (
                          <ChevronDown className="w-5 h-5 text-gray-400" />
                        ) : (
                          <ChevronRight className="w-5 h-5 text-gray-400" />
                        )}
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="bg-gray-50 border-t border-gray-100">
                      <div className="px-5 py-3">
                        <table className="w-full">
                          <thead>
                            <tr className="text-xs text-gray-500 uppercase">
                              <th className="text-left py-2 font-medium">Invoice #</th>
                              <th className="text-left py-2 font-medium">Invoice Date</th>
                              <th className="text-left py-2 font-medium">Due Date</th>
                              <th className="text-left py-2 font-medium">Status</th>
                              <th className="text-right py-2 font-medium">Total</th>
                              <th className="text-right py-2 font-medium">Paid</th>
                              <th className="text-right py-2 font-medium">Due</th>
                              <th className="text-right py-2 font-medium">Age</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {customer.invoices.map((invoice) => {
                              const invoiceDate = new Date(invoice.invoice_date);
                              const today = new Date();
                              const ageDays = Math.floor((today.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24));

                              return (
                                <tr key={invoice.id} className="text-sm">
                                  <td className="py-2">
                                    <div className="flex items-center gap-2">
                                      <FileText className="w-4 h-4 text-gray-400" />
                                      <span className="font-medium text-gray-900">{invoice.invoice_number}</span>
                                    </div>
                                  </td>
                                  <td className="py-2 text-gray-600">{formatDate(invoice.invoice_date)}</td>
                                  <td className="py-2 text-gray-600">
                                    {invoice.due_date ? formatDate(invoice.due_date) : '-'}
                                  </td>
                                  <td className="py-2">
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(invoice.status)}`}>
                                      {invoice.status}
                                    </span>
                                  </td>
                                  <td className="py-2 text-right text-gray-700">{formatCurrency(invoice.total_amount)}</td>
                                  <td className="py-2 text-right text-green-600">{formatCurrency(invoice.amount_paid)}</td>
                                  <td className="py-2 text-right font-medium text-amber-600">{formatCurrency(invoice.amount_due)}</td>
                                  <td className={`py-2 text-right font-medium ${getAgingColor(ageDays)}`}>
                                    {ageDays} days
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

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
            receivables.forEach((r) => {
              r.invoices.forEach((inv) => {
                const invDate = new Date(inv.invoice_date);
                const today = new Date();
                const days = Math.floor((today.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24));
                if (index === 0 && days <= 30) amount += inv.amount_due;
                else if (index === 1 && days > 30 && days <= 60) amount += inv.amount_due;
                else if (index === 2 && days > 60 && days <= 90) amount += inv.amount_due;
                else if (index === 3 && days > 90) amount += inv.amount_due;
              });
            });

            const percentage = summary.total_receivables > 0 ? (amount / summary.total_receivables) * 100 : 0;

            return (
              <div key={bucket.label} className="text-center">
                <div className="h-24 bg-gray-100 rounded-lg relative overflow-hidden mb-2">
                  <div
                    className={`absolute bottom-0 left-0 right-0 ${bucket.color} transition-all`}
                    style={{ height: `${Math.min(percentage, 100)}%` }}
                  ></div>
                </div>
                <p className="text-xs text-gray-500 mb-1">{bucket.label}</p>
                <p className="text-sm font-semibold text-gray-900">{formatCurrency(amount)}</p>
                <p className="text-xs text-gray-400">{percentage.toFixed(1)}%</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
