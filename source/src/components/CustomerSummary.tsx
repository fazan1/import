import { useState, useEffect } from 'react';
import { Search, Users, Phone, FileText, DollarSign, TrendingUp, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  company: string | null;
  location: string | null;
  totalInvoices: number;
  totalRevenue: number;
  totalPaid: number;
  totalDue: number;
  totalCalls: number;
  completedCalls: number;
  lastCallDate: string | null;
  lastInvoiceDate: string | null;
}

type SortField = 'name' | 'totalRevenue' | 'totalDue' | 'totalCalls';
type SortDir = 'asc' | 'desc';

export default function CustomerSummary() {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [filtered, setFiltered] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('totalRevenue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [rows, search, sortField, sortDir]);

  async function loadData() {
    setLoading(true);

    const [customersRes, invoicesRes, callsRes] = await Promise.all([
      supabase.from('customers').select('id, name, phone, company'),
      supabase.from('sales_invoices').select('customer_name, total_amount, total_paid, sell_due, date'),
      supabase.from('calls').select('customer_name, status, completed_date, scheduled_date'),
    ]);

    const customers = customersRes.data || [];
    const invoices = invoicesRes.data || [];
    const calls = callsRes.data || [];

    const summary: CustomerRow[] = customers.map(c => {
      const custInvoices = invoices.filter(inv => inv.customer_name === c.name);
      const custCalls = calls.filter(call => call.customer_name === c.name);

      const totalRevenue = custInvoices.reduce((s, inv) => s + (inv.total_amount || 0), 0);
      const totalPaid = custInvoices.reduce((s, inv) => s + (inv.total_paid || 0), 0);
      const totalDue = custInvoices.reduce((s, inv) => s + (inv.sell_due || 0), 0);

      const completedCalls = custCalls.filter(c => c.status === 'completed');
      const sortedInvoices = [...custInvoices].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const sortedCalls = [...custCalls].sort((a, b) => (b.scheduled_date || '').localeCompare(a.scheduled_date || ''));

      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        company: c.company,
        location: null,
        totalInvoices: custInvoices.length,
        totalRevenue,
        totalPaid,
        totalDue,
        totalCalls: custCalls.length,
        completedCalls: completedCalls.length,
        lastCallDate: sortedCalls[0]?.scheduled_date || null,
        lastInvoiceDate: sortedInvoices[0]?.date || null,
      };
    });

    setRows(summary);
    setLoading(false);
  }

  function applyFilters() {
    let result = [...rows];

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        r.name.toLowerCase().includes(q) ||
        (r.company?.toLowerCase() || '').includes(q) ||
        (r.phone || '').includes(q)
      );
    }

    result.sort((a, b) => {
      const aVal = a[sortField] ?? 0;
      const bVal = b[sortField] ?? 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
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

  const totalRevenue = filtered.reduce((s, r) => s + r.totalRevenue, 0);
  const totalDue = filtered.reduce((s, r) => s + r.totalDue, 0);
  const activeCustomers = filtered.filter(r => r.totalInvoices > 0).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Customer Summary</h2>
          <p className="text-sm text-gray-500 mt-0.5">{filtered.length} customer{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Customers', value: filtered.length, icon: Users, color: 'text-teal-700', bg: 'bg-teal-50', iconColor: 'text-teal-600' },
          { label: 'Active Customers', value: activeCustomers, icon: TrendingUp, color: 'text-teal-700', bg: 'bg-teal-50', iconColor: 'text-teal-700' },
          { label: 'Total Revenue', value: totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 }), icon: DollarSign, color: 'text-emerald-700', bg: 'bg-emerald-50', iconColor: 'text-emerald-600' },
          { label: 'Total Outstanding', value: totalDue.toLocaleString(undefined, { maximumFractionDigits: 0 }), icon: FileText, color: 'text-red-600', bg: 'bg-red-50', iconColor: 'text-red-600' },
        ].map(s => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className={`inline-flex p-2 ${s.bg} rounded-lg mb-2`}>
                <Icon className={`w-4 h-4 ${s.iconColor}`} />
              </div>
              <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
            </div>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, company, phone..."
          className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-teal-600"></div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Users className="w-10 h-10 mb-3 text-gray-300" />
            <p className="text-sm">No customers found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th
                    className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide cursor-pointer select-none"
                    onClick={() => toggleSort('name')}
                  >
                    <div className="flex items-center">Customer <SortIcon field="name" /></div>
                  </th>
                  <th
                    className="text-right px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide cursor-pointer select-none"
                    onClick={() => toggleSort('totalCalls')}
                  >
                    <div className="flex items-center justify-end"><Phone className="w-3 h-3 mr-1" />Calls <SortIcon field="totalCalls" /></div>
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">
                    <div className="flex items-center justify-end"><FileText className="w-3 h-3 mr-1" />Invoices</div>
                  </th>
                  <th
                    className="text-right px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide cursor-pointer select-none"
                    onClick={() => toggleSort('totalRevenue')}
                  >
                    <div className="flex items-center justify-end">Revenue <SortIcon field="totalRevenue" /></div>
                  </th>
                  <th
                    className="text-right px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide cursor-pointer select-none"
                    onClick={() => toggleSort('totalDue')}
                  >
                    <div className="flex items-center justify-end">Outstanding <SortIcon field="totalDue" /></div>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Last Activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{row.name}</div>
                      {row.company && <div className="text-xs text-gray-400">{row.company}</div>}
                      {row.phone && <div className="text-xs text-gray-400">{row.phone}</div>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="text-gray-900 font-medium">{row.totalCalls}</div>
                      <div className="text-xs text-green-600">{row.completedCalls} done</div>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700 font-medium">{row.totalInvoices}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="font-semibold text-gray-900">
                        {row.totalRevenue > 0
                          ? row.totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })
                          : '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.totalDue > 0 ? (
                        <span className="font-semibold text-red-600">
                          {row.totalDue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                      ) : (
                        <span className="text-green-600 font-medium text-xs">Cleared</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {row.lastInvoiceDate
                        ? <div>Invoice: {new Date(row.lastInvoiceDate).toLocaleDateString()}</div>
                        : null}
                      {row.lastCallDate
                        ? <div>Call: {new Date(row.lastCallDate).toLocaleDateString()}</div>
                        : null}
                      {!row.lastInvoiceDate && !row.lastCallDate && '—'}
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
