import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { openingBal } from '../lib/book';
import { RefreshCw, DollarSign, TrendingUp, Wallet, AlertTriangle, ChevronRight, FileText, CreditCard } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell, ComposedChart, Line } from "recharts";

interface Invoice { id: string; invoice_number: string; invoice_date: string; due_date: string | null; customer_id: string | null; customer_name: string; total_amount: number; amount_paid: number; amount_due: number; status: string; }
interface Payment { id: string; payment_date: string; customer_id: string | null; customer_name: string; amount: number; payment_mode: string; sales_invoice_id: string | null; }
interface Customer { id: string; name: string; opening_balance: number; credit_days: number | null; credit_amount: number | null; }

interface Props { onNavigate?: (view: string, filter?: { status?: string; customerId?: string }) => void; }

const n0 = (v: number) => Math.round(v).toLocaleString();
const rs = (v: number) => `Rs.${n0(v)}`;
const ym = (d: string) => d.slice(0, 7);
const monthLabel = (k: string) => new Date(k + '-01').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
const lastMonths = (n: number) => { const out: string[] = []; const d = new Date(); for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`); } return out; };
const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : `${v}`);
const days = (a: string, b: string) => Math.floor((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

export default function SLPortalDashboard({ onNavigate, embedded = false }: Props & { embedded?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [, setOrderCount] = useState(0);
  const [lines, setLines] = useState<{ invoice_id: string; quantity: number; unit_price: number; cost_price: number }[]>([]);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [i, p, c, o, li] = await Promise.all([
      supabase.from('busy_sales_invoices').select('id, invoice_number, invoice_date, due_date, customer_id, customer_name, total_amount, amount_paid, amount_due, status'),
      supabase.from('busy_sales_payments').select('id, payment_date, customer_id, customer_name, amount, payment_mode, sales_invoice_id').order('payment_date', { ascending: false }),
      supabase.from('customers').select('id, name, opening_balance, credit_days, credit_amount'),
      supabase.from('busy_sales_orders').select('id', { count: 'exact', head: true }),
      supabase.from('busy_sales_invoice_items').select('invoice_id, quantity, unit_price, cost_price'),
    ]);
    setLines((li.data || []) as { invoice_id: string; quantity: number; unit_price: number; cost_price: number }[]);
    setInvoices((i.data || []) as Invoice[]);
    setPayments((p.data || []) as Payment[]);
    setCustomers((c.data || []) as Customer[]);
    setOrderCount(o.count || 0);
    setLoading(false);
  }

  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const lastMonth = lastMonths(2)[0];
  const live = useMemo(() => invoices.filter((i) => i.status !== 'draft'), [invoices]);

  // ---- per customer outstanding (same rule as Customer Outstanding page) ----
  const perCustomer = useMemo(() => {
    const onAccount: Record<string, number> = {};
    const key = (n: string) => (n || '').trim().toLowerCase();
    for (const p of payments) if (!p.sales_invoice_id) onAccount[key(p.customer_name)] = (onAccount[key(p.customer_name)] || 0) + p.amount;
    const m: Record<string, { name: string; id: string | null; invoices: number; due: number; opening: number; b0: number; b30: number; b60: number; b90: number; oldest: number; credit_days: number | null; credit_amount: number | null; lastInvoice: string }> = {};
    const get = (name: string, id: string | null) => (m[name] ||= { name, id, invoices: 0, due: 0, opening: 0, b0: 0, b30: 0, b60: 0, b90: 0, oldest: 0, credit_days: null, credit_amount: null, lastInvoice: '' });
    for (const c of customers) {
      const net = openingBal(c.opening_balance) - (onAccount[key(c.name)] || 0);
      const x = get(c.name, c.id); x.credit_days = c.credit_days; x.credit_amount = c.credit_amount;
      if (net > 0) { x.opening = net; x.b90 += net; x.oldest = Math.max(x.oldest, 91); } else if (net < 0) { x.opening = net; x.b0 += net; }
    }
    for (const inv of live) {
      if (inv.status === 'paid' || inv.amount_due <= 0) { const x = get(inv.customer_name, inv.customer_id); if (inv.invoice_date > x.lastInvoice) x.lastInvoice = inv.invoice_date; continue; }
      const x = get(inv.customer_name, inv.customer_id);
      const age = days(today, inv.invoice_date);
      x.invoices += 1; x.due += inv.amount_due; x.oldest = Math.max(x.oldest, age);
      if (inv.invoice_date > x.lastInvoice) x.lastInvoice = inv.invoice_date;
      if (age <= 30) x.b0 += inv.amount_due; else if (age <= 60) x.b30 += inv.amount_due; else if (age <= 90) x.b60 += inv.amount_due; else x.b90 += inv.amount_due;
    }
    return Object.values(m).map((x) => ({ ...x, total: x.due + x.opening })).filter((x) => x.total > 0.5).sort((a, b) => b.total - a.total);
  }, [live, payments, customers, today]);

  const receivable = perCustomer.reduce((s, c) => s + c.total, 0);
  const ageing = { '0–30': perCustomer.reduce((s, c) => s + c.b0, 0), '31–60': perCustomer.reduce((s, c) => s + c.b30, 0), '61–90': perCustomer.reduce((s, c) => s + c.b60, 0), '90+': perCustomer.reduce((s, c) => s + c.b90, 0) };
  const overdue = ageing['31–60'] + ageing['61–90'] + ageing['90+'];
  const overCredit = perCustomer.filter((c) => (c.credit_amount && c.total > c.credit_amount) || (c.credit_days && c.oldest > c.credit_days && c.due > 0));

  // ---- month figures ----
  const salesIn = (m: string) => live.filter((i) => ym(i.invoice_date) === m).reduce((s, i) => s + i.total_amount, 0);
  const collectedIn = (m: string) => payments.filter((p) => ym(p.payment_date) === m).reduce((s, p) => s + p.amount, 0);
  const salesThis = salesIn(thisMonth), salesLast = salesIn(lastMonth);
  const thisMonthIds = new Set(live.filter((i) => (i.invoice_date || '').startsWith(thisMonth)).map((i) => i.id));
  const profitThis = lines.filter((l) => thisMonthIds.has(l.invoice_id) && Number(l.unit_price) > 0).reduce((t, l) => t + Number(l.quantity) * (Number(l.unit_price) - Number(l.cost_price || 0)), 0);
  const revThis = lines.filter((l) => thisMonthIds.has(l.invoice_id) && Number(l.unit_price) > 0).reduce((t, l) => t + Number(l.quantity) * Number(l.unit_price), 0);
  const collThis = collectedIn(thisMonth), collLast = collectedIn(lastMonth);
  const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : 0);
  const dueThisWeek = live.filter((i) => i.amount_due > 0 && i.status !== 'paid' && i.due_date && i.due_date >= today && days(i.due_date, today) <= 7);

  // ---- charts ----
  const months = lastMonths(6);
  const monthly = months.map((m) => ({ month: monthLabel(m), Sales: Math.round(salesIn(m)), Collected: Math.round(collectedIn(m)) }));
  const ageingChart = Object.entries(ageing).map(([k, v]) => ({ bucket: k, amount: Math.round(v) }));
  const ageColors = ['#10b981', '#f59e0b', '#f97316', '#ef4444'];
  const topCustomers = perCustomer.slice(0, 8).map((c) => ({ name: c.name.length > 18 ? c.name.slice(0, 17) + '…' : c.name, Current: Math.round(c.b0), Overdue: Math.round(c.b30 + c.b60 + c.b90) }));
  const dailyThisMonth = useMemo(() => {
    const dim = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const todayD = new Date().getDate();
    const out: { day: string; Received: number; Cumulative: number }[] = []; let cum = 0;
    for (let d = 1; d <= dim; d++) {
      const key = `${thisMonth}-${String(d).padStart(2, '0')}`;
      const v = Math.round(payments.filter((p) => p.payment_date === key).reduce((s, p) => s + p.amount, 0));
      cum += v; out.push({ day: String(d), Received: v, Cumulative: d <= todayD ? cum : NaN });
    }
    return out;
  }, [payments, thisMonth]);
  const modeSplit = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of payments) if (ym(p.payment_date) === thisMonth) m[p.payment_mode || 'other'] = (m[p.payment_mode || 'other'] || 0) + p.amount;
    return Object.entries(m).map(([k, v]) => ({ mode: k === 'bank_transfer' ? 'Bank' : k.charAt(0).toUpperCase() + k.slice(1), amount: Math.round(v) }));
  }, [payments, thisMonth]);
  const recentReceipts = payments.slice(0, 6);

  const card = 'bg-white rounded-xl border border-gray-200 p-4';
  const go = (v: string) => onNavigate?.(v);
  const trend = (a: number, b: number) => { const p = pct(a, b); return b === 0 ? '' : `${p >= 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(0)}% vs last month`; };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" /></div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          {!embedded && <h2 className="text-2xl font-bold text-gray-900">SL Portal Dashboard</h2>}
          <p className="text-sm text-gray-500">Sales, collections and customer credit (LKR)</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"><RefreshCw className="w-4 h-4" />Refresh</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {[
          { label: 'Receivable', value: rs(receivable), sub: `${perCustomer.length} customers owe`, icon: DollarSign, tone: 'text-amber-600 bg-amber-50', view: 'customer-outstanding' },
          { label: 'Overdue (31+ days)', value: rs(overdue), sub: receivable > 0 ? `${((overdue / receivable) * 100).toFixed(0)}% of receivable` : '', icon: AlertTriangle, tone: overdue > 0 ? 'text-red-600 bg-red-50' : 'text-green-600 bg-green-50', view: 'customer-outstanding' },
          { label: 'Sales this month', value: rs(salesThis), sub: trend(salesThis, salesLast), icon: TrendingUp, tone: 'text-teal-600 bg-teal-50', view: 'busy-sales-invoices' },
          { label: 'Collected this month', value: rs(collThis), sub: trend(collThis, collLast), icon: Wallet, tone: 'text-emerald-600 bg-emerald-50', view: 'busy-sales-payments' },
          { label: 'Due this week', value: String(dueThisWeek.length), sub: rs(dueThisWeek.reduce((s, i) => s + i.amount_due, 0)), icon: FileText, tone: 'text-teal-700 bg-teal-50', view: 'busy-sales-invoices' },
          { label: 'Gross profit this month', value: rs(profitThis), sub: revThis > 0 ? `margin ${((profitThis / revThis) * 100).toFixed(1)}%` : 'no sales yet', icon: TrendingUp, tone: profitThis >= 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50', view: 'reports' },
        ].map((k) => (
          <button key={k.label} onClick={() => go(k.view)} className={`${card} text-left hover:shadow-md transition-shadow`}>
            <div className="flex items-center justify-between mb-2"><span className={`p-2 rounded-lg ${k.tone}`}><k.icon className="w-4 h-4" /></span><ChevronRight className="w-4 h-4 text-gray-300" /></div>
            <p className="text-xs text-gray-500">{k.label}</p>
            <p className="text-lg font-bold text-gray-900 truncate">{k.value}</p>
            <p className="text-[11px] text-gray-500 truncate">{k.sub}</p>
          </button>
        ))}
      </div>

      {overCredit.length > 0 && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-3 text-sm">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-red-800">Over credit terms:</span>{' '}
            {overCredit.slice(0, 6).map((c) => `${c.name} (${rs(c.total)}${c.credit_amount && c.total > c.credit_amount ? ', over limit' : ''}${c.credit_days && c.oldest > c.credit_days ? `, ${c.oldest}d` : ''})`).join('; ')}{overCredit.length > 6 ? ` and ${overCredit.length - 6} more` : ''}.
            <button onClick={() => go('customer-outstanding')} className="ml-2 text-red-800 underline">Outstanding</button>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-1">Sales vs collected (last 6 months)</h3>
          <p className="text-xs text-gray-500 mb-3">Invoiced each month against cash actually received (incl. on-account)</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthly} margin={{ left: 0, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} width={44} />
              <Tooltip formatter={(v) => rs(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Sales" fill="#0d9488" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Collected" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-1">Receivables by age</h3>
          <p className="text-xs text-gray-500 mb-3">Opening balances sit in 90+</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={ageingChart} margin={{ left: 0, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} width={44} />
              <Tooltip formatter={(v) => rs(Number(v))} />
              <Bar dataKey="amount" name="Outstanding" radius={[4, 4, 0, 0]}>{ageingChart.map((_, i) => <Cell key={i} fill={ageColors[i]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-1">Top customers outstanding</h3>
          <p className="text-xs text-gray-500 mb-3">Green = within 30 days, red = overdue</p>
          {topCustomers.length === 0 ? <p className="text-sm text-gray-500 py-16 text-center">Nothing outstanding.</p> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={topCustomers} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={compact} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                <Tooltip formatter={(v) => rs(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Current" stackId="a" fill="#10b981" />
                <Bar dataKey="Overdue" stackId="a" fill="#ef4444" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-1">Collections this month</h3>
          <p className="text-xs text-gray-500 mb-3">Daily receipts and running total · {modeSplit.map((m) => `${m.mode} ${rs(m.amount)}`).join(' · ') || 'nothing yet'}</p>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={dailyThisMonth} margin={{ left: 0, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} interval={4} />
              <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} width={44} />
              <Tooltip formatter={(v) => rs(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Received" fill="#ccfbf1" />
              <Line type="monotone" dataKey="Cumulative" stroke="#0d9488" strokeWidth={2} dot={false} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Customer outstanding</h3>
            <button onClick={() => go('customer-outstanding')} className="text-sm text-teal-700 hover:underline">All →</button>
          </div>
          {perCustomer.length === 0 ? <p className="text-sm text-gray-500">Nothing outstanding.</p> : (
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase"><tr><th className="text-left py-1">Customer</th><th className="text-right py-1">Inv</th><th className="text-right py-1">Oldest</th><th className="text-right py-1">Total</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {perCustomer.slice(0, 8).map((c) => (
                  <tr key={c.name}>
                    <td className="py-1.5 font-medium truncate max-w-[12rem]">{c.name}</td>
                    <td className="py-1.5 text-right">{c.invoices}</td>
                    <td className={`py-1.5 text-right ${c.oldest > 60 ? 'text-red-600' : c.oldest > 30 ? 'text-amber-600' : 'text-gray-600'}`}>{c.due > 0 ? `${c.oldest}d` : 'opening'}</td>
                    <td className="py-1.5 text-right font-semibold">{rs(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><CreditCard className="w-4 h-4 text-teal-600" />Recent receipts</h3>
            <button onClick={() => go('busy-sales-payments')} className="text-sm text-teal-700 hover:underline">All →</button>
          </div>
          {recentReceipts.length === 0 ? <p className="text-sm text-gray-500">No receipts yet.</p> : (
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase"><tr><th className="text-left py-1">Date</th><th className="text-left py-1">Customer</th><th className="text-left py-1">Mode</th><th className="text-right py-1">Amount</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {recentReceipts.map((p) => (
                  <tr key={p.id}>
                    <td className="py-1.5 text-gray-600">{new Date(p.payment_date).toLocaleDateString('en-GB')}</td>
                    <td className="py-1.5 font-medium truncate max-w-[10rem]">{p.customer_name}{!p.sales_invoice_id && <span className="ml-1 text-[10px] text-purple-600">on account</span>}</td>
                    <td className="py-1.5 capitalize">{(p.payment_mode || '').replace('_', ' ')}</td>
                    <td className="py-1.5 text-right font-semibold">{rs(p.amount)}</td>
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
