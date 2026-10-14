import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { esc } from '../lib/html';
import { openingBal } from '../lib/book';
import { companyFor } from '../lib/company';
import { custKey, onAccountByCustomer, netOpening } from '../lib/receivables';
import { fetchAllPages } from '../lib/fetchAll';
import { Users, DollarSign, RefreshCw, ChevronDown, ChevronRight, Search, ListFilter as Filter, FileText, Phone, Calendar, CreditCard, Printer } from 'lucide-react';
import CustomerDetailModal from './CustomerDetailModal';
import CollectPaymentModal from './CollectPaymentModal';

interface Invoice {
  id: string;
  voucher_no: string;
  date: string;
  total_amount: number;
  total_paid: number;
  sell_due: number;
  payment_status: string;
  invoice_id: string;
}

interface CustomerOutstandingData {
  customer_id: string | null;
  customer_name: string;
  phone: string | null;
  total_sales: number;
  total_paid: number;
  total_due: number;
  opening_balance: number;
  opening_balance_gross: number;
  on_account_paid: number;
  pending_cheques: number;
  aging: { current: number; d31: number; d61: number; d90: number };
  invoices: Invoice[];
  oldest_unpaid_date: string | null;
  days_outstanding: number;
}

interface Summary {
  total_outstanding: number;
  total_customers: number;
  avg_days_outstanding: number;
  total_opening_balance: number;
}

export default function CustomerOutstanding() {
  const [customers, setCustomers] = useState<CustomerOutstandingData[]>([]);
  const [summary, setSummary] = useState<Summary>({
    total_outstanding: 0,
    total_customers: 0,
    avg_days_outstanding: 0,
    total_opening_balance: 0,
  });
  const [loading, setLoading] = useState(true);
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'amount' | 'days' | 'name'>('amount');
  const [selectedCustomer, setSelectedCustomer] = useState<{ id: string; name: string } | null>(null);
  const [paymentCustomer, setPaymentCustomer] = useState<CustomerOutstandingData | null>(null);

  useEffect(() => {
    loadOutstanding();
  }, []);

  async function loadOutstanding() {
    setLoading(true);

    // fetchAllPages: no 1000-row cut-off (current book only, applied automatically)
    const [{ data: customerData }, { data: invoiceRows }, { data: payments }] = await Promise.all([
      fetchAllPages<{ id: string; name: string; phone: string | null; opening_balance: number | null }>(() =>
        supabase.from('customers').select('id, name, phone, opening_balance').order('id')),
      fetchAllPages<{ id: string; invoice_number: string; invoice_date: string; customer_name: string; customer_id: string | null; total_amount: number; amount_paid: number; amount_due: number; status: string }>(() =>
        supabase
          .from('busy_sales_invoices')
          .select('id, invoice_number, invoice_date, customer_name, customer_id, total_amount, amount_paid, amount_due, status')
          .neq('status', 'paid')
          .gt('amount_due', 0)
          .order('id')),
      fetchAllPages<{ customer_id: string | null; customer_name: string | null; sales_invoice_id: string | null; amount: number; payment_mode: string | null; cheque_status: string | null }>(() =>
        supabase
          .from('busy_sales_payments')
          .select('id, customer_id, customer_name, sales_invoice_id, amount, payment_mode, cheque_status')
          .order('id')),
    ]);
    const invoices = [...invoiceRows].sort((a, b) => (a.invoice_date || '').localeCompare(b.invoice_date || ''));

    // money received "on account" (not against an invoice) reduces the opening balance; returned cheques don't count
    const onAccount = onAccountByCustomer(payments);
    const pendingCheque = new Map<string, number>();
    payments.forEach((p) => {
      const key = custKey(p.customer_name);
      if (p.payment_mode === 'cheque' && p.cheque_status === 'pending') pendingCheque.set(key, (pendingCheque.get(key) || 0) + Number(p.amount || 0));
    });

    const customerMap = new Map<string, { id: string; name: string; phone: string | null; opening_balance: number | null }>();
    customerData.forEach((c) => {
      customerMap.set(custKey(c.name), {
        id: c.id,
        name: c.name,
        phone: c.phone,
        opening_balance: c.opening_balance,
      });
    });

    // keyed by custKey(): "ABC Traders" and "abc traders " are one customer (opening balance counted once)
    const outstandingMap = new Map<string, CustomerOutstandingData>();
    const today = new Date();

    invoices.forEach((invoice) => {
      const key = custKey(invoice.customer_name);
      const customerInfo = customerMap.get(key);
      const existing = outstandingMap.get(key);

      const invoiceData: Invoice = {
        id: invoice.id,
        invoice_id: invoice.id,
        voucher_no: invoice.invoice_number,
        date: invoice.invoice_date,
        total_amount: Number(invoice.total_amount) || 0,
        total_paid: Number(invoice.amount_paid) || 0,
        sell_due: Number(invoice.amount_due) || 0,
        payment_status: invoice.status,
      };

      if (existing) {
        existing.total_sales += Number(invoice.total_amount) || 0;
        existing.total_paid += Number(invoice.amount_paid) || 0;
        existing.total_due += Number(invoice.amount_due) || 0;
        existing.invoices.push(invoiceData);
        if (!existing.oldest_unpaid_date || invoice.invoice_date < existing.oldest_unpaid_date) {
          existing.oldest_unpaid_date = invoice.invoice_date;
        }
      } else {
        outstandingMap.set(key, {
          customer_id: customerInfo?.id || invoice.customer_id || null,
          customer_name: customerInfo?.name || invoice.customer_name,
          phone: customerInfo?.phone || null,
          total_sales: Number(invoice.total_amount) || 0,
          total_paid: Number(invoice.amount_paid) || 0,
          total_due: Number(invoice.amount_due) || 0,
          opening_balance: netOpening(key, customerInfo?.opening_balance, onAccount),
          opening_balance_gross: openingBal(customerInfo?.opening_balance),
          on_account_paid: onAccount.get(key) || 0,
          pending_cheques: pendingCheque.get(key) || 0,
          aging: { current: 0, d31: 0, d61: 0, d90: 0 },
          invoices: [invoiceData],
          oldest_unpaid_date: invoice.invoice_date,
          days_outstanding: 0,
        });
      }
    });

    customerData.forEach((c) => {
      const key = custKey(c.name);
      if (netOpening(key, c.opening_balance, onAccount) > 0 && !outstandingMap.has(key)) {
        outstandingMap.set(key, {
          customer_id: c.id,
          customer_name: c.name,
          phone: c.phone,
          total_sales: 0,
          total_paid: 0,
          total_due: 0,
          opening_balance: netOpening(key, c.opening_balance, onAccount),
          opening_balance_gross: openingBal(c.opening_balance),
          on_account_paid: onAccount.get(key) || 0,
          pending_cheques: pendingCheque.get(key) || 0,
          aging: { current: 0, d31: 0, d61: 0, d90: 0 },
          invoices: [],
          oldest_unpaid_date: null,
          days_outstanding: 0,
        });
      }
    });

    const outstandingList = Array.from(outstandingMap.values())
      .filter((c) => (c.total_due + c.opening_balance) > 0)
      .map((c) => {
        if (c.oldest_unpaid_date) {
          const oldestDate = new Date(c.oldest_unpaid_date);
          c.days_outstanding = Math.floor((today.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24));
        }
        // ageing: unpaid invoices by age; opening balance is older than any invoice so it sits in 90+
        c.invoices.forEach((inv) => {
          const age = Math.floor((today.getTime() - new Date(inv.date).getTime()) / (1000 * 60 * 60 * 24));
          if (age <= 30) c.aging.current += inv.sell_due;
          else if (age <= 60) c.aging.d31 += inv.sell_due;
          else if (age <= 90) c.aging.d61 += inv.sell_due;
          else c.aging.d90 += inv.sell_due;
        });
        if (c.opening_balance > 0) c.aging.d90 += c.opening_balance; else c.aging.current += c.opening_balance;
        return c;
      });

    let totalOutstanding = 0;
    let totalDaysOutstanding = 0;
    let totalOpeningBalance = 0;
    let invoiceCount = 0;

    outstandingList.forEach((c) => {
      totalOutstanding += c.total_due + c.opening_balance;
      totalOpeningBalance += Math.max(0, c.opening_balance);
      c.invoices.forEach((inv) => {
        const invDate = new Date(inv.date);
        totalDaysOutstanding += Math.floor((today.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24));
        invoiceCount++;
      });
    });

    setSummary({
      total_outstanding: totalOutstanding,
      total_customers: outstandingList.length,
      avg_days_outstanding: invoiceCount > 0 ? Math.round(totalDaysOutstanding / invoiceCount) : 0,
      total_opening_balance: totalOpeningBalance,
    });

    setCustomers(outstandingList);
    setLoading(false);
  }

  function printStatement(c: CustomerOutstandingData) {
    const w = window.open('', '_blank', 'width=800,height=1000');
    if (!w) { alert('Allow pop-ups to print'); return; }
    const total = c.total_due + c.opening_balance;
    const money = (n: number) => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const d = (s: string | null) => { const t = s ? new Date(s) : null; return t && !isNaN(t.getTime()) ? t.toLocaleDateString('en-GB') : ''; };
    // running balance: opening (or on-account credit) first, then each unpaid invoice oldest first
    let run = c.opening_balance;
    const opening = c.opening_balance > 0 ? `<tr><td></td><td>Opening balance b/f${c.on_account_paid > 0 ? ` (after ${money(c.on_account_paid)} received on account)` : ''}</td><td class="r"></td><td class="r"></td><td class="r">${money(c.opening_balance)}</td><td class="r">${money(run)}</td></tr>`
      : c.opening_balance < 0 ? `<tr><td></td><td>Less: received on account (credit)</td><td class="r"></td><td class="r"></td><td class="r">${money(c.opening_balance)}</td><td class="r">${money(run)}</td></tr>` : '';
    const rows = c.invoices.map((inv) => { run += inv.sell_due; return `<tr><td>${d(inv.date)}</td><td>${esc(inv.voucher_no)}</td><td class="r">${money(inv.total_amount)}</td><td class="r">${money(inv.total_paid)}</td><td class="r">${money(inv.sell_due)}</td><td class="r">${money(run)}</td></tr>`; }).join('');
    const co = companyFor();
    w.document.write(`<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"><title>Statement - ${esc(c.customer_name)}</title><style>
      body{font-family:'IBM Plex Sans',Arial,sans-serif;color:#111;padding:32px;} h1{font-size:20px;margin:0} .sub{color:#555;font-size:12px}
      .head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px} .cust{font-size:15px;font-weight:700}
      table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px} th,td{padding:7px 8px;border-bottom:1px solid #ddd;text-align:left} th{background:#f3f4f6;font-size:11px;text-transform:uppercase} .r{text-align:right}
      tfoot td{font-weight:700;border-top:2px solid #333} .age{margin-top:20px;font-size:12px} .age span{display:inline-block;margin-right:18px}
      .note{margin-top:28px;font-size:12px;color:#555} @media print{body{padding:0}}
    </style></head><body>
      <div class="head"><div><h1>${esc(co.name)}</h1><div class="sub">${esc(co.address)}</div></div><div class="sub" style="text-align:right">STATEMENT OF ACCOUNT<br/>${new Date().toLocaleDateString('en-GB')}</div></div>
      <div class="cust">${esc(c.customer_name)}</div>${c.phone ? `<div class="sub">${esc(c.phone)}</div>` : ''}
      <table><thead><tr><th>Date</th><th>Invoice</th><th class="r">Amount</th><th class="r">Paid</th><th class="r">Due</th><th class="r">Balance</th></tr></thead>
      <tbody>${opening}${rows}</tbody>
      <tfoot><tr><td colspan="5">Total outstanding</td><td class="r">LKR ${money(total)}</td></tr></tfoot></table>
      <div class="age"><strong>Ageing:</strong> <span>0–30: ${money(c.aging.current)}</span><span>31–60: ${money(c.aging.d31)}</span><span>61–90: ${money(c.aging.d61)}</span><span>90+: ${money(c.aging.d90)}</span></div>${c.pending_cheques > 0 ? `<div class="age">Cheques received, not yet realised: LKR ${money(c.pending_cheques)}</div>` : ''}
      <div class="note">Please settle the balance at your earliest. Thank you for your business.</div>
      <script>window.onload=function(){window.print();}</script></body></html>`);
    w.document.close();
  }

  function toggleCustomer(customerName: string) {
    const newExpanded = new Set(expandedCustomers);
    if (newExpanded.has(customerName)) {
      newExpanded.delete(customerName);
    } else {
      newExpanded.add(customerName);
    }
    setExpandedCustomers(newExpanded);
  }

  function formatCurrency(amount: number) {
    return 'LKR ' + new Intl.NumberFormat('en-LK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  function formatDate(dateStr: string) {
    if (!dateStr || isNaN(new Date(dateStr).getTime())) return '-';
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  function getAgingColor(days: number) {
    if (days <= 30) return 'text-green-600';
    if (days <= 60) return 'text-amber-600';
    if (days <= 90) return 'text-orange-600';
    return 'text-red-600';
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'paid':
        return 'bg-green-100 text-green-700';
      case 'partial':
        return 'bg-amber-100 text-amber-700';
      case 'pending':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  }

  const filteredCustomers = customers
    .filter((c) => {
      if (searchTerm && !c.customer_name.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'amount') return (b.total_due + b.opening_balance) - (a.total_due + a.opening_balance);
      if (sortBy === 'days') return b.days_outstanding - a.days_outstanding;
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
          <div className="p-2 bg-gradient-to-br from-rose-500 to-red-600 rounded-xl">
            <DollarSign className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Outstanding Balances</h2>
            <p className="text-sm text-gray-500">Customer payments due from sales invoices</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors print:hidden"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
          <button
            onClick={loadOutstanding}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors print:hidden"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-rose-50 rounded-lg">
              <DollarSign className="w-5 h-5 text-rose-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Outstanding</p>
              <p className="text-xl font-bold text-rose-600">{formatCurrency(summary.total_outstanding)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-50 rounded-lg">
              <Calendar className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Opening Balances</p>
              <p className="text-xl font-bold text-orange-600">{formatCurrency(summary.total_opening_balance)}</p>
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
              <Calendar className="w-5 h-5 text-teal-600" />
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
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'amount' | 'days' | 'name')}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="amount">Sort by Amount</option>
                <option value="days">Sort by Days Outstanding</option>
                <option value="name">Sort by Name</option>
              </select>
            </div>
          </div>
        </div>

        {searchTerm && (
          <p className="px-5 py-2 text-xs text-gray-500 border-b border-gray-100">
            Showing {filteredCustomers.length} of {customers.length} customers ({formatCurrency(filteredCustomers.reduce((t, c) => t + c.total_due + c.opening_balance, 0))}). Totals above and the ageing summary are for all customers.
          </p>
        )}
        {filteredCustomers.length === 0 ? (
          <div className="p-12 text-center">
            <DollarSign className="w-12 h-12 text-green-400 mx-auto mb-3" />
            <p className="text-lg font-medium text-gray-900">{searchTerm ? 'No matching customers' : 'No Outstanding Balances'}</p>
            <p className="text-sm text-gray-500">{searchTerm ? 'No customer with a balance matches the search' : 'All customer payments are up to date'}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredCustomers.map((customer) => {
              const isExpanded = expandedCustomers.has(customer.customer_name);
              const totalBalance = customer.total_due + customer.opening_balance;

              return (
                <div key={customer.customer_name}>
                  <button
                    onClick={() => toggleCustomer(customer.customer_name)}
                    className="w-full px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-2 rounded-lg bg-rose-50">
                          <Users className="w-5 h-5 text-rose-600" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-gray-900">{customer.customer_name}</p>
                            {customer.days_outstanding > 60 && (
                              <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded-full">
                                {customer.days_outstanding} days
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            {customer.phone && (
                              <span className="text-xs text-gray-500 flex items-center gap-1">
                                <Phone className="w-3 h-3" />
                                {customer.phone}
                              </span>
                            )}
                            <span className="text-xs text-gray-500">
                              {customer.invoices.length} unpaid invoice{customer.invoices.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <p className="text-xs text-gray-500">Total Sales</p>
                          <p className="whitespace-nowrap text-sm font-medium text-gray-700">{formatCurrency(customer.total_sales)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-green-600">Paid</p>
                          <p className="whitespace-nowrap text-sm font-medium text-green-600">{formatCurrency(customer.total_paid)}</p>
                        </div>
                        {customer.opening_balance > 0 && (
                          <div className="text-right" title={customer.on_account_paid > 0 ? `Opening ${formatCurrency(customer.opening_balance_gross)} less ${formatCurrency(customer.on_account_paid)} received on account` : undefined}>
                            <p className="text-xs text-orange-600">Opening Bal</p>
                            <p className="whitespace-nowrap text-sm font-medium text-orange-600">{formatCurrency(customer.opening_balance)}</p>
                          </div>
                        )}
                        {customer.opening_balance < 0 && (
                          <div className="text-right" title="Received on account beyond the opening balance — deducted from the invoices">
                            <p className="text-xs text-purple-600">On-account credit</p>
                            <p className="whitespace-nowrap text-sm font-medium text-purple-600">−{formatCurrency(-customer.opening_balance)}</p>
                          </div>
                        )}
                        {customer.pending_cheques > 0 && (
                          <div className="text-right" title="Cheques received but not yet realised">
                            <p className="text-xs text-blue-600">Cheques pending</p>
                            <p className="whitespace-nowrap text-sm font-medium text-blue-600">{formatCurrency(customer.pending_cheques)}</p>
                          </div>
                        )}
                        <div className="text-right hidden lg:block">
                          <p className="text-xs text-gray-500">Ageing 0–30 / 31–60 / 61–90 / 90+</p>
                          <p className="text-xs font-medium">
                            <span className="text-gray-700">{Math.round(customer.aging.current).toLocaleString()}</span>
                            <span className="text-gray-400"> / </span>
                            <span className="text-amber-600">{Math.round(customer.aging.d31).toLocaleString()}</span>
                            <span className="text-gray-400"> / </span>
                            <span className="text-orange-600">{Math.round(customer.aging.d61).toLocaleString()}</span>
                            <span className="text-gray-400"> / </span>
                            <span className="text-rose-600">{Math.round(customer.aging.d90).toLocaleString()}</span>
                          </p>
                        </div>
                        <div className="text-right min-w-[140px]">
                          <p className="text-xs text-rose-600">Outstanding</p>
                          <p className="whitespace-nowrap text-lg font-bold text-rose-600">{formatCurrency(totalBalance)}</p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPaymentCustomer(customer);
                          }}
                          className="px-3 py-1.5 text-xs font-medium text-green-600 bg-green-50 rounded-lg hover:bg-green-100 transition-colors flex items-center gap-1"
                        >
                          <CreditCard className="w-3.5 h-3.5" />
                          Collect
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); printStatement(customer); }}
                          className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-1 print:hidden"
                          title="Print statement of account"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Statement
                        </button>
                        {customer.customer_id && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCustomer({ id: customer.customer_id!, name: customer.customer_name });
                            }}
                            className="px-3 py-1.5 text-xs font-medium text-teal-600 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
                          >
                            View Profile
                          </button>
                        )}
                        {isExpanded ? (
                          <ChevronDown className="w-5 h-5 text-gray-400" />
                        ) : (
                          <ChevronRight className="w-5 h-5 text-gray-400" />
                        )}
                      </div>
                    </div>
                  </button>

                  {isExpanded && customer.invoices.length > 0 && (
                    <div className="bg-gray-50 border-t border-gray-100">
                      <div className="px-5 py-3">
                        <table className="w-full">
                          <thead>
                            <tr className="text-xs text-gray-500 uppercase">
                              <th className="text-left py-2 font-medium">Invoice #</th>
                              <th className="text-left py-2 font-medium">Date</th>
                              <th className="text-left py-2 font-medium">Status</th>
                              <th className="text-right py-2 font-medium">Total</th>
                              <th className="text-right py-2 font-medium">Paid</th>
                              <th className="text-right py-2 font-medium">Due</th>
                              <th className="text-right py-2 font-medium">Age</th>
                              <th className="text-center py-2 font-medium">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {customer.invoices.map((invoice) => {
                              const invoiceDate = new Date(invoice.date);
                              const today = new Date();
                              const ageDays = Math.floor((today.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24));

                              return (
                                <tr key={invoice.id} className="text-sm">
                                  <td className="py-2">
                                    <div className="flex items-center gap-2">
                                      <FileText className="w-4 h-4 text-gray-400" />
                                      <span className="font-medium text-gray-900">{invoice.voucher_no}</span>
                                    </div>
                                  </td>
                                  <td className="py-2 text-gray-600">{formatDate(invoice.date)}</td>
                                  <td className="py-2">
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(invoice.payment_status)}`}>
                                      {invoice.payment_status}
                                    </span>
                                  </td>
                                  <td className="py-2 text-right text-gray-700">{formatCurrency(invoice.total_amount)}</td>
                                  <td className="py-2 text-right text-green-600">{formatCurrency(invoice.total_paid)}</td>
                                  <td className="py-2 text-right font-medium text-rose-600">{formatCurrency(invoice.sell_due)}</td>
                                  <td className={`py-2 text-right font-medium ${getAgingColor(ageDays)}`}>
                                    {isNaN(ageDays) ? '-' : `${ageDays} days`}
                                  </td>
                                  <td className="py-2 text-center">
                                    <button
                                      onClick={() => setPaymentCustomer({
                                        ...customer,
                                        invoices: [invoice],
                                      })}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-600 bg-green-50 rounded hover:bg-green-100 transition-colors"
                                    >
                                      <CreditCard className="w-3 h-3" />
                                      Pay
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {isExpanded && customer.invoices.length === 0 && customer.opening_balance > 0 && (
                    <div className="bg-gray-50 border-t border-gray-100 px-5 py-4">
                      <p className="text-sm text-gray-600">
                        This customer has an opening balance of <span className="font-semibold text-orange-600">{formatCurrency(customer.opening_balance)}</span> with no unpaid invoices.
                      </p>
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
            // same buckets as each customer row (opening balance in 90+, on-account credit in 0-30), so the four add up to Total Outstanding
            const amount = customers.reduce((t, c) => t + [c.aging.current, c.aging.d31, c.aging.d61, c.aging.d90][index], 0);

            const percentage = summary.total_outstanding > 0 ? (amount / summary.total_outstanding) * 100 : 0;

            return (
              <div key={bucket.label} className="text-center">
                <div className="h-24 bg-gray-100 rounded-lg relative overflow-hidden mb-2">
                  <div
                    className={`absolute bottom-0 left-0 right-0 ${bucket.color} transition-all`}
                    style={{ height: `${Math.max(0, Math.min(percentage, 100))}%` }}
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

      {selectedCustomer && (
        <CustomerDetailModal
          customerId={selectedCustomer.id}
          customerName={selectedCustomer.name}
          onClose={() => setSelectedCustomer(null)}
        />
      )}

      {paymentCustomer && (
        <CollectPaymentModal
          customerName={paymentCustomer.customer_name}
          customerId={paymentCustomer.customer_id}
          invoices={paymentCustomer.invoices}
          openingBalance={paymentCustomer.opening_balance}
          onClose={() => setPaymentCustomer(null)}
          onPaymentRecorded={loadOutstanding}
        />
      )}
    </div>
  );
}
