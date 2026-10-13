import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { openingBal } from '../lib/book';
import { custKey, onAccountByCustomer, netOpening } from '../lib/receivables';
import { fetchAllPages } from '../lib/fetchAll';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Users, Clock, Shield, Star } from 'lucide-react';

interface CustomerCollection {
  id: string;
  name: string;
  totalOwed: number;
  totalPaid: number;
  outstanding: number;
  openingBalance: number;
  invoiceCount: number;
  oldestDays: number;
  creditScore: number | null;
  avgDaysToPay: number | null;
  securityProvided: boolean;
}

export default function CustomerCollectionTracker() {
  const [customers, setCustomers] = useState<CustomerCollection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCollectionData();
  }, []);

  async function loadCollectionData() {
    setLoading(true);

    // fetchAllPages: no 1000-row cut-off (current book only, applied automatically)
    const [invoicesResult, customersResult, paymentsResult] = await Promise.all([
      fetchAllPages<{ customer_id: string | null; customer_name: string; total_amount: number; amount_paid: number; amount_due: number; status: string; invoice_date: string }>(() => supabase
        .from('busy_sales_invoices')
        .select('id, customer_id, customer_name, total_amount, amount_paid, amount_due, status, invoice_date')
        .order('id')),
      fetchAllPages<{ id: string; name: string; opening_balance: number | null; credit_score: number | null; average_days_to_pay: number | null; security_provided: boolean | null }>(() => supabase
        .from('customers')
        .select('id, name, opening_balance, credit_score, average_days_to_pay, security_provided')
        .order('id')),
      fetchAllPages<{ customer_name: string | null; sales_invoice_id: string | null; amount: number; cheque_status: string | null }>(() => supabase
        .from('busy_sales_payments')
        .select('id, customer_name, sales_invoice_id, amount, cheque_status')
        .order('id')),
    ]);

    const invoices = invoicesResult.data;
    const allCustomers = customersResult.data;
    // same rule as Customer Outstanding: opening (OLD only) less money received on account; one entry per custKey()
    const onAccount = onAccountByCustomer(paymentsResult.data);

    const customerMap = new Map<string, CustomerCollection>();

    for (const c of allCustomers) {
      const key = custKey(c.name);
      if (openingBal(c.opening_balance) > 0 && !customerMap.has(key)) {
        const net = netOpening(key, c.opening_balance, onAccount);
        customerMap.set(key, {
          id: c.id,
          name: c.name,
          totalOwed: openingBal(c.opening_balance),
          totalPaid: onAccount.get(key) || 0,
          outstanding: net,
          openingBalance: net,
          invoiceCount: 0,
          oldestDays: 0,
          creditScore: c.credit_score,
          avgDaysToPay: c.average_days_to_pay,
          securityProvided: c.security_provided || false,
        });
      }
    }

    const today = new Date();

    for (const inv of invoices) {
      const key = custKey(inv.customer_name);
      const existing = customerMap.get(key);

      const invDate = new Date(inv.invoice_date);
      const daysSince = Math.floor((today.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24));

      if (existing) {
        existing.totalOwed += inv.total_amount || 0;
        existing.totalPaid += inv.amount_paid || 0;
        existing.outstanding += inv.amount_due || 0;
        existing.invoiceCount += 1;
        if (daysSince > existing.oldestDays) existing.oldestDays = daysSince;
      } else {
        const custRecord = allCustomers.find((c) => c.id === inv.customer_id);
        customerMap.set(key, {
          id: inv.customer_id || inv.customer_name,
          name: inv.customer_name,
          totalOwed: inv.total_amount || 0,
          totalPaid: inv.amount_paid || 0,
          outstanding: inv.amount_due || 0,
          openingBalance: 0,
          invoiceCount: 1,
          oldestDays: daysSince,
          creditScore: custRecord?.credit_score || null,
          avgDaysToPay: custRecord?.average_days_to_pay || null,
          securityProvided: custRecord?.security_provided || false,
        });
      }
    }

    const sorted = Array.from(customerMap.values())
      .filter((c) => c.outstanding > 0 || c.totalPaid > 0)
      .sort((a, b) => b.outstanding - a.outstanding);

    setCustomers(sorted);
    setLoading(false);
  }

  function formatCurrency(amount: number) {
    if (amount >= 1000000) return `Rs.${(amount / 1000000).toFixed(2)}M`;
    if (amount >= 1000) return `Rs.${(amount / 1000).toFixed(0)}k`;
    return `Rs.${amount.toLocaleString()}`;
  }

  function getAgingColor(days: number): string {
    if (days === 0) return 'text-gray-500';
    if (days <= 30) return 'text-green-600';
    if (days <= 60) return 'text-amber-600';
    return 'text-red-600';
  }

  function getAgingBg(days: number): string {
    if (days === 0) return 'bg-gray-50';
    if (days <= 30) return 'bg-green-50';
    if (days <= 60) return 'bg-amber-50';
    return 'bg-red-50';
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-56" />
          <div className="h-48 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (customers.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="text-center py-10 text-gray-400">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="font-medium">No collection data yet</p>
          <p className="text-sm mt-1">Create invoices to start tracking collections</p>
        </div>
      </div>
    );
  }

  const totalOutstanding = customers.reduce((s, c) => s + Math.max(0, c.outstanding), 0); // credits don't reduce others' dues (same as Customer Outstanding)
  const totalCollected = customers.reduce((s, c) => s + c.totalPaid, 0);
  const collectionRate = (totalCollected + totalOutstanding) > 0
    ? Math.round((totalCollected / (totalCollected + totalOutstanding)) * 100)
    : 0;

  const chartData = customers.slice(0, 10).map((c) => ({
    name: c.name.length > 15 ? c.name.substring(0, 15) + '...' : c.name,
    fullName: c.name,
    collected: c.totalPaid,
    outstanding: c.outstanding,
  }));

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Customer Collection Tracker</h3>
          <p className="text-xs text-gray-500 mt-0.5">Outstanding balances and payment progress</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs text-gray-500">Collection Rate</p>
            <p className={`text-lg font-bold ${collectionRate >= 70 ? 'text-emerald-600' : collectionRate >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
              {collectionRate}%
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">Outstanding</p>
            <p className="text-lg font-bold text-red-600">{formatCurrency(totalOutstanding)}</p>
          </div>
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="px-6 pt-6 pb-2">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`}
                  axisLine={{ stroke: '#e5e7eb' }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#374151' }}
                  width={120}
                  axisLine={{ stroke: '#e5e7eb' }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                  }}
                  formatter={(value, name) => {
                    const v = Number(value);
                    const label = name === 'collected' ? 'Collected' : 'Outstanding';
                    return [`Rs.${v.toLocaleString()}`, label];
                  }}
                  labelFormatter={(label) => {
                    const item = chartData.find((d) => d.name === label);
                    return item?.fullName || label;
                  }}
                />
                <Bar dataKey="collected" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} name="collected" />
                <Bar dataKey="outstanding" stackId="a" fill="#f59e0b" radius={[0, 4, 4, 0]} name="outstanding">
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.outstanding > entry.collected ? '#ef4444' : '#f59e0b'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-4 mt-2 pb-2">
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              Collected
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              Outstanding
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
              High Risk
            </div>
          </div>
        </div>
      )}

      {/* Customer Detail List */}
      <div className="px-6 pb-6">
        <div className="space-y-2">
          {customers.map((customer) => {
            const paidPct = customer.totalOwed > 0
              ? Math.round((customer.totalPaid / customer.totalOwed) * 100)
              : 0;

            return (
              <div key={customer.id} className={`rounded-lg p-3 border border-gray-100 ${getAgingBg(customer.oldestDays)}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center border border-gray-200 flex-shrink-0">
                      <Users className="w-4 h-4 text-gray-500" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-800 truncate">{customer.name}</p>
                        {customer.securityProvided && (
                          <span title="Security provided"><Shield className="w-3.5 h-3.5 text-green-500 flex-shrink-0" /></span>
                        )}
                        {customer.creditScore && customer.creditScore >= 80 && (
                          <span title={`Credit score: ${customer.creditScore}`}><Star className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" /></span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                        {customer.invoiceCount > 0 && (
                          <span>{customer.invoiceCount} invoice{customer.invoiceCount > 1 ? 's' : ''}</span>
                        )}
                        {customer.openingBalance > 0 && (
                          <span className="text-orange-600">Opening: {formatCurrency(customer.openingBalance)}</span>
                        )}
                        {customer.avgDaysToPay !== null && customer.avgDaysToPay > 0 && (
                          <span>Avg {Math.round(customer.avgDaysToPay)}d to pay</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0">
                    {customer.oldestDays > 0 && (
                      <div className={`flex items-center gap-1 text-xs font-medium ${getAgingColor(customer.oldestDays)}`}>
                        <Clock className="w-3.5 h-3.5" />
                        {customer.oldestDays}d
                      </div>
                    )}
                    <div className="text-right">
                      <p className="text-sm font-bold text-red-600">{formatCurrency(customer.outstanding)}</p>
                      <p className="text-xs text-gray-500">{paidPct}% paid</p>
                    </div>
                  </div>
                </div>
                {/* Mini progress bar */}
                <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${paidPct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
