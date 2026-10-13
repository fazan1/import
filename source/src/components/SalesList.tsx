import { useState, useEffect } from 'react';
import { Search, FileText, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface SalesInvoice {
  id: string;
  invoice_no: string;
  customer_name: string;
  contact_number: string | null;
  location: string | null;
  date: string;
  total_amount: number;
  total_paid: number;
  sell_due: number;
  payment_status: string;
  payment_method: string | null;
  total_items: number | null;
  added_by: string | null;
}

type SortField = 'date' | 'customer_name' | 'total_amount' | 'payment_status';
type SortDir = 'asc' | 'desc';

const STATUS_COLORS: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  partial: 'bg-teal-100 text-teal-700',
  overdue: 'bg-red-100 text-red-700',
};

export default function SalesList() {
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [filtered, setFiltered] = useState<SalesInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    loadInvoices();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [invoices, search, statusFilter, sortField, sortDir]);

  async function loadInvoices() {
    setLoading(true);
    const { data } = await supabase
      .from('sales_invoices')
      .select('id, invoice_no, customer_name, contact_number, location, date, total_amount, total_paid, sell_due, payment_status, payment_method, total_items, added_by')
      .order('date', { ascending: false });
    setInvoices(data || []);
    setLoading(false);
  }

  function applyFilters() {
    let result = [...invoices];

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(inv =>
        inv.customer_name?.toLowerCase().includes(q) ||
        inv.invoice_no?.toLowerCase().includes(q) ||
        inv.location?.toLowerCase().includes(q)
      );
    }

    if (statusFilter !== 'all') {
      result = result.filter(inv => inv.payment_status === statusFilter);
    }

    result.sort((a, b) => {
      let aVal: string | number = a[sortField] ?? '';
      let bVal: string | number = b[sortField] ?? '';
      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    setFiltered(result);
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronDown className="w-3 h-3 text-gray-300 ml-1" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-teal-500 ml-1" />
      : <ChevronDown className="w-3 h-3 text-teal-500 ml-1" />;
  }

  const totalRevenue = filtered.reduce((s, inv) => s + (inv.total_amount || 0), 0);
  const totalOutstanding = filtered.reduce((s, inv) => s + (inv.sell_due || 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Sales</h2>
          <p className="text-sm text-gray-500 mt-0.5">{filtered.length} invoice{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={loadInvoices}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Summary Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Invoices', value: filtered.length, color: 'text-gray-900' },
          { label: 'Total Revenue', value: `${totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: 'text-teal-700' },
          { label: 'Outstanding', value: `${totalOutstanding.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: 'text-red-600' },
          { label: 'Paid', value: filtered.filter(i => i.payment_status === 'paid').length, color: 'text-green-700' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by customer, invoice no, location..."
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-teal-600"></div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <FileText className="w-10 h-10 mb-3 text-gray-300" />
            <p className="text-sm">No invoices found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Invoice No</th>
                  <th
                    className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide cursor-pointer select-none"
                    onClick={() => toggleSort('customer_name')}
                  >
                    <div className="flex items-center">Customer <SortIcon field="customer_name" /></div>
                  </th>
                  <th
                    className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide cursor-pointer select-none"
                    onClick={() => toggleSort('date')}
                  >
                    <div className="flex items-center">Date <SortIcon field="date" /></div>
                  </th>
                  <th
                    className="text-right px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide cursor-pointer select-none"
                    onClick={() => toggleSort('total_amount')}
                  >
                    <div className="flex items-center justify-end">Amount <SortIcon field="total_amount" /></div>
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Paid</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Due</th>
                  <th
                    className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide cursor-pointer select-none"
                    onClick={() => toggleSort('payment_status')}
                  >
                    <div className="flex items-center">Status <SortIcon field="payment_status" /></div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(inv => (
                  <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{inv.invoice_no || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{inv.customer_name}</div>
                      {inv.location && <div className="text-xs text-gray-400">{inv.location}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{new Date(inv.date).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">
                      {inv.total_amount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-right text-green-700">
                      {inv.total_paid?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-right text-red-600">
                      {(inv.sell_due || 0) > 0
                        ? (inv.sell_due).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[inv.payment_status] || 'bg-gray-100 text-gray-600'}`}>
                        {inv.payment_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
