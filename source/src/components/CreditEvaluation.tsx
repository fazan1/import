import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Award, Shield, TrendingUp, TrendingDown, Banknote, Clock, DollarSign, CircleAlert as AlertCircle, Zap, Activity, ChartBar as BarChart2 } from 'lucide-react';

interface CustomerCredit {
  id: string;
  name: string;
  phone: string | null;
  security_provided: boolean;
  credit_score: number;
  credit_days: number;
  credit_amount: number;
  average_days_to_pay: number;
  total_sales: number;
  total_due: number;
  total_paid: number;
  invoice_count: number;
  overdue_count: number;
  strength: 'Strong' | 'Moderate' | 'Weak';
  strength_score: number;
}

function calculateStrength(
  paymentRate: number,
  overdueCount: number,
  invoiceCount: number
): { strength: 'Strong' | 'Moderate' | 'Weak'; score: number } {
  let score = 0;

  // Payment rate (0-50 pts)
  if (paymentRate >= 90) score += 50;
  else if (paymentRate >= 75) score += 40;
  else if (paymentRate >= 60) score += 30;
  else if (paymentRate >= 40) score += 20;
  else score += 10;

  // Relationship depth — more invoices = more established (0-30 pts)
  if (invoiceCount >= 20) score += 30;
  else if (invoiceCount >= 10) score += 25;
  else if (invoiceCount >= 5) score += 18;
  else if (invoiceCount >= 2) score += 10;
  else score += 5;

  // Overdue penalty (0 to -20 pts)
  if (overdueCount === 0) score += 20;
  else if (overdueCount === 1) score += 10;
  else if (overdueCount === 2) score += 0;
  else if (overdueCount <= 4) score -= 10;
  else score -= 20;

  score = Math.max(0, Math.min(100, score));

  let strength: 'Strong' | 'Moderate' | 'Weak';
  if (score >= 70) strength = 'Strong';
  else if (score >= 40) strength = 'Moderate';
  else strength = 'Weak';

  return { strength, score };
}

export default function CreditEvaluation() {
  const [customers, setCustomers] = useState<CustomerCredit[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'score' | 'sales' | 'due' | 'strength'>('strength');
  const [filterBy, setFilterBy] = useState<'all' | 'good' | 'fair' | 'cash' | 'strong' | 'moderate' | 'weak'>('all');

  useEffect(() => {
    loadCreditData();
  }, []);

  function calculateCreditScore(
    totalSales: number,
    totalPaid: number,
    totalDue: number,
    securityProvided: boolean,
    overdueCount: number
  ): number {
    let score = 0;

    const paymentRate = totalSales > 0 ? (totalPaid / totalSales) * 100 : 0;

    if (paymentRate >= 90) score += 50;
    else if (paymentRate >= 70) score += 40;
    else if (paymentRate >= 50) score += 30;
    else if (paymentRate >= 30) score += 20;
    else score += 10;

    if (totalSales >= 100000) score += 30;
    else if (totalSales >= 50000) score += 25;
    else if (totalSales >= 20000) score += 20;
    else if (totalSales >= 10000) score += 15;
    else if (totalSales >= 5000) score += 10;
    else score += 5;

    const overdueRatio = totalSales > 0 ? (totalDue / totalSales) * 100 : 0;
    if (overdueRatio > 80) score -= 20;
    else if (overdueRatio > 60) score -= 15;
    else if (overdueRatio > 40) score -= 10;
    else if (overdueRatio > 20) score -= 5;

    // Overdue invoice count penalty
    if (overdueCount >= 3) score -= 10;
    else if (overdueCount >= 1) score -= 5;

    if (securityProvided) score += 10;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function getCreditTermsFromScore(score: number): { days: number } {
    if (score >= 75) return { days: 35 };
    if (score >= 50) return { days: 20 };
    return { days: 0 };
  }

  async function loadCreditData() {
    setLoading(true);

    const today = new Date().toISOString().split('T')[0];

    const [{ data: customersData }, { data: invoices }] = await Promise.all([
      supabase.from('customers').select('id, name, phone, security_provided, average_days_to_pay'),
      supabase.from('busy_sales_invoices').select('customer_name, total_amount, amount_paid, amount_due, status, due_date'),
    ]);

    if (invoices) {
      const salesMap = new Map<string, {
        totalSales: number;
        totalDue: number;
        totalPaid: number;
        invoiceCount: number;
        overdueCount: number;
      }>();

      invoices.forEach((inv) => {
        const key = inv.customer_name;
        const isOverdue =
          inv.status === 'overdue' ||
          (inv.status !== 'paid' && inv.due_date && inv.due_date < today);

        const existing = salesMap.get(key);
        if (existing) {
          existing.totalSales += inv.total_amount || 0;
          existing.totalDue += inv.amount_due || 0;
          existing.totalPaid += inv.amount_paid || 0;
          existing.invoiceCount += 1;
          if (isOverdue) existing.overdueCount += 1;
        } else {
          salesMap.set(key, {
            totalSales: inv.total_amount || 0,
            totalDue: inv.amount_due || 0,
            totalPaid: inv.amount_paid || 0,
            invoiceCount: 1,
            overdueCount: isOverdue ? 1 : 0,
          });
        }
      });

      const customersMap = new Map(
        (customersData || []).map(c => [c.name, c])
      );

      const customerCredits: CustomerCredit[] = Array.from(salesMap.entries()).map(([customerName, sales]) => {
        const customerRecord = customersMap.get(customerName);
        const securityProvided = customerRecord?.security_provided || false;
        const avgDaysToPay = customerRecord?.average_days_to_pay ? parseFloat(customerRecord.average_days_to_pay) : 0;

        const creditScore = calculateCreditScore(
          sales.totalSales,
          sales.totalPaid,
          sales.totalDue,
          securityProvided,
          sales.overdueCount
        );

        const creditTerms = getCreditTermsFromScore(creditScore);
        const avgMonthlySales = sales.totalSales / 3;
        const creditAmount = securityProvided
          ? Math.round(avgMonthlySales * 1.5)
          : Math.round(avgMonthlySales);

        const paymentRate = sales.totalSales > 0 ? (sales.totalPaid / sales.totalSales) * 100 : 0;
        const { strength, score: strengthScore } = calculateStrength(
          paymentRate,
          sales.overdueCount,
          sales.invoiceCount
        );

        return {
          id: customerRecord?.id || `temp-${customerName}`,
          name: customerName,
          phone: customerRecord?.phone || null,
          security_provided: securityProvided,
          credit_score: creditScore,
          credit_days: creditTerms.days,
          credit_amount: creditAmount,
          average_days_to_pay: avgDaysToPay,
          total_sales: sales.totalSales,
          total_due: sales.totalDue,
          total_paid: sales.totalPaid,
          invoice_count: sales.invoiceCount,
          overdue_count: sales.overdueCount,
          strength,
          strength_score: strengthScore,
        };
      });

      setCustomers(customerCredits);
    }

    setLoading(false);
  }

  function getSortedCustomers() {
    let filtered = customers;

    if (filterBy === 'good') filtered = customers.filter(c => c.credit_score >= 75);
    else if (filterBy === 'fair') filtered = customers.filter(c => c.credit_score >= 50 && c.credit_score < 75);
    else if (filterBy === 'cash') filtered = customers.filter(c => c.credit_score < 50);
    else if (filterBy === 'strong') filtered = customers.filter(c => c.strength === 'Strong');
    else if (filterBy === 'moderate') filtered = customers.filter(c => c.strength === 'Moderate');
    else if (filterBy === 'weak') filtered = customers.filter(c => c.strength === 'Weak');

    return [...filtered].sort((a, b) => {
      if (sortBy === 'score') return b.credit_score - a.credit_score;
      if (sortBy === 'sales') return b.total_sales - a.total_sales;
      if (sortBy === 'due') return b.total_due - a.total_due;
      if (sortBy === 'strength') return b.strength_score - a.strength_score;
      return 0;
    });
  }

  function formatCurrency(amount: number) {
    return 'LKR ' + new Intl.NumberFormat('en-LK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  function getCreditScoreColor(score: number) {
    if (score >= 75) return 'text-green-600 bg-green-50';
    if (score >= 50) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  }

  function getCreditScoreBadge(score: number) {
    if (score >= 75) return { label: 'Good', color: 'bg-green-500' };
    if (score >= 50) return { label: 'Fair', color: 'bg-yellow-500' };
    return { label: 'Poor', color: 'bg-red-500' };
  }

  function getCreditTerms(creditDays: number) {
    if (creditDays === 0) return 'Cash Only';
    return `${creditDays} Days`;
  }

  function getStrengthConfig(strength: 'Strong' | 'Moderate' | 'Weak') {
    if (strength === 'Strong') return {
      bg: 'bg-emerald-100',
      text: 'text-emerald-700',
      bar: 'bg-emerald-500',
      icon: 'text-emerald-600',
    };
    if (strength === 'Moderate') return {
      bg: 'bg-amber-100',
      text: 'text-amber-700',
      bar: 'bg-amber-400',
      icon: 'text-amber-600',
    };
    return {
      bg: 'bg-red-100',
      text: 'text-red-700',
      bar: 'bg-red-400',
      icon: 'text-red-600',
    };
  }

  const sortedCustomers = getSortedCustomers();
  const totalCreditExtended = customers.reduce((sum, c) => sum + c.credit_amount, 0);
  const avgCreditScore = customers.length > 0
    ? Math.round(customers.reduce((sum, c) => sum + c.credit_score, 0) / customers.length)
    : 0;
  const goodCreditCount = customers.filter(c => c.credit_score >= 75).length;
  const fairCreditCount = customers.filter(c => c.credit_score >= 50 && c.credit_score < 75).length;
  const cashOnlyCount = customers.filter(c => c.credit_score < 50).length;
  const strongCount = customers.filter(c => c.strength === 'Strong').length;
  const moderateCount = customers.filter(c => c.strength === 'Moderate').length;
  const weakCount = customers.filter(c => c.strength === 'Weak').length;
  const totalOverdue = customers.reduce((sum, c) => sum + c.overdue_count, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-700 to-slate-900 rounded-2xl shadow-xl p-8 text-white">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-3xl font-bold mb-2">Credit Evaluation System</h1>
            <p className="text-slate-300 font-medium">Live data from Busy SL Portal — payment history, invoice behaviour &amp; customer strength</p>
          </div>
          <Award className="w-16 h-16 opacity-80" />
        </div>
        <div className="mt-4 flex items-center space-x-6 text-sm text-slate-400">
          <span className="flex items-center space-x-1"><Activity className="w-4 h-4 mr-1" />{customers.length} customers tracked</span>
          <span className="flex items-center space-x-1"><BarChart2 className="w-4 h-4 mr-1" />{customers.reduce((s, c) => s + c.invoice_count, 0)} invoices analysed</span>
          {totalOverdue > 0 && (
            <span className="flex items-center space-x-1 text-red-400"><AlertCircle className="w-4 h-4 mr-1" />{totalOverdue} overdue invoices</span>
          )}
        </div>
      </div>

      {/* Top KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl shadow-md p-6 border-2 border-yellow-200">
          <div className="flex items-center justify-between mb-3">
            <Award className="w-10 h-10 text-yellow-500" />
            <span className="text-4xl font-extrabold text-gray-900">{avgCreditScore}</span>
          </div>
          <h3 className="text-sm font-bold text-gray-700 uppercase">Avg Credit Score</h3>
          <p className="text-xs text-gray-500 mt-1">Out of 100</p>
        </div>

        <div className="bg-white rounded-xl shadow-md p-6 border-2 border-blue-200">
          <div className="flex items-center justify-between mb-3">
            <Banknote className="w-10 h-10 text-blue-500" />
            <span className="text-xl font-extrabold text-gray-900">{formatCurrency(totalCreditExtended)}</span>
          </div>
          <h3 className="text-sm font-bold text-gray-700 uppercase">Total Credit Limit</h3>
          <p className="text-xs text-gray-500 mt-1">Available to customers</p>
        </div>

        <div className="bg-white rounded-xl shadow-md p-6 border-2 border-emerald-200">
          <div className="flex items-center justify-between mb-3">
            <Zap className="w-10 h-10 text-emerald-500" />
            <span className="text-4xl font-extrabold text-gray-900">{strongCount}</span>
          </div>
          <h3 className="text-sm font-bold text-gray-700 uppercase">Strong Customers</h3>
          <p className="text-xs text-gray-500 mt-1">Reliable payers</p>
        </div>

        <div className="bg-white rounded-xl shadow-md p-6 border-2 border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <DollarSign className="w-10 h-10 text-gray-500" />
            <span className="text-4xl font-extrabold text-gray-900">{customers.length}</span>
          </div>
          <h3 className="text-sm font-bold text-gray-700 uppercase">Total Customers</h3>
          <p className="text-xs text-gray-500 mt-1">In Busy SL Portal</p>
        </div>
      </div>

      {/* Strength breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl p-6 border-2 border-emerald-200 shadow-md">
          <div className="flex items-center justify-between mb-3">
            <div className="bg-emerald-500 text-white rounded-full w-12 h-12 flex items-center justify-center shadow-lg">
              <Zap className="w-6 h-6" />
            </div>
            <span className="text-5xl font-extrabold text-emerald-600">{strongCount}</span>
          </div>
          <h3 className="text-lg font-bold text-emerald-700">Strong</h3>
          <p className="text-sm text-emerald-600 font-medium mt-1">Payment rate 80%+ &amp; 0–1 overdue</p>
        </div>

        <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-6 border-2 border-amber-200 shadow-md">
          <div className="flex items-center justify-between mb-3">
            <div className="bg-amber-500 text-white rounded-full w-12 h-12 flex items-center justify-center shadow-lg">
              <Activity className="w-6 h-6" />
            </div>
            <span className="text-5xl font-extrabold text-amber-600">{moderateCount}</span>
          </div>
          <h3 className="text-lg font-bold text-amber-700">Moderate</h3>
          <p className="text-sm text-amber-600 font-medium mt-1">Some delays or outstanding balance</p>
        </div>

        <div className="bg-gradient-to-br from-red-50 to-pink-50 rounded-xl p-6 border-2 border-red-200 shadow-md">
          <div className="flex items-center justify-between mb-3">
            <div className="bg-red-500 text-white rounded-full w-12 h-12 flex items-center justify-center shadow-lg">
              <AlertCircle className="w-6 h-6" />
            </div>
            <span className="text-5xl font-extrabold text-red-600">{weakCount}</span>
          </div>
          <h3 className="text-lg font-bold text-red-700">Weak</h3>
          <p className="text-sm text-red-600 font-medium mt-1">High overdue or poor payment history</p>
        </div>
      </div>

      {/* Credit tier summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg p-5 border border-green-200 flex items-center space-x-4 shadow-sm">
          <div className="w-3 h-12 bg-green-500 rounded-full flex-shrink-0" />
          <div>
            <p className="text-2xl font-extrabold text-green-600">{goodCreditCount}</p>
            <p className="text-sm font-semibold text-gray-700">Good Credit — Score 75+</p>
            <p className="text-xs text-gray-500">35 days credit terms</p>
          </div>
        </div>
        <div className="bg-white rounded-lg p-5 border border-yellow-200 flex items-center space-x-4 shadow-sm">
          <div className="w-3 h-12 bg-yellow-400 rounded-full flex-shrink-0" />
          <div>
            <p className="text-2xl font-extrabold text-yellow-600">{fairCreditCount}</p>
            <p className="text-sm font-semibold text-gray-700">Fair Credit — Score 50–74</p>
            <p className="text-xs text-gray-500">20 days credit terms</p>
          </div>
        </div>
        <div className="bg-white rounded-lg p-5 border border-red-200 flex items-center space-x-4 shadow-sm">
          <div className="w-3 h-12 bg-red-500 rounded-full flex-shrink-0" />
          <div>
            <p className="text-2xl font-extrabold text-red-600">{cashOnlyCount}</p>
            <p className="text-sm font-semibold text-gray-700">Cash Only — Score &lt;50</p>
            <p className="text-xs text-gray-500">No credit terms</p>
          </div>
        </div>
      </div>

      {/* Customer table */}
      <div className="bg-white rounded-xl shadow-md border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-xl font-bold text-gray-900">Customer Credit &amp; Strength Details</h2>
            <div className="flex items-center space-x-3">
              <select
                value={filterBy}
                onChange={(e) => setFilterBy(e.target.value as typeof filterBy)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent font-medium"
              >
                <option value="all">All Customers</option>
                <optgroup label="By Strength">
                  <option value="strong">Strong</option>
                  <option value="moderate">Moderate</option>
                  <option value="weak">Weak</option>
                </optgroup>
                <optgroup label="By Credit">
                  <option value="good">Good Credit</option>
                  <option value="fair">Fair Credit</option>
                  <option value="cash">Cash Only</option>
                </optgroup>
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent font-medium"
              >
                <option value="strength">Sort by Strength</option>
                <option value="score">Sort by Credit Score</option>
                <option value="sales">Sort by Total Sales</option>
                <option value="due">Sort by Outstanding</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-5 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Customer</th>
                <th className="px-5 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Strength</th>
                <th className="px-5 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Credit Score</th>
                <th className="px-5 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Credit Terms</th>
                <th className="px-5 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Total Sales</th>
                <th className="px-5 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Total Paid</th>
                <th className="px-5 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Outstanding</th>
                <th className="px-5 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Pay Rate</th>
                <th className="px-5 py-4 text-center text-xs font-bold text-gray-600 uppercase tracking-wider">Invoices</th>
                <th className="px-5 py-4 text-center text-xs font-bold text-gray-600 uppercase tracking-wider">Overdue</th>
                <th className="px-5 py-4 text-center text-xs font-bold text-gray-600 uppercase tracking-wider">Security</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {sortedCustomers.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center text-gray-500">
                    No customers found in Busy SL Portal
                  </td>
                </tr>
              ) : (
                sortedCustomers.map((customer) => {
                  const badge = getCreditScoreBadge(customer.credit_score);
                  const paymentRate = customer.total_sales > 0
                    ? ((customer.total_paid / customer.total_sales) * 100).toFixed(1)
                    : '0.0';
                  const sc = getStrengthConfig(customer.strength);

                  return (
                    <tr key={customer.id} className="hover:bg-gray-50 transition-colors">
                      {/* Customer */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="font-semibold text-gray-900">{customer.name}</div>
                        {customer.phone && <div className="text-xs text-gray-500 mt-0.5">{customer.phone}</div>}
                      </td>

                      {/* Strength */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="flex flex-col space-y-1 min-w-[110px]">
                          <div className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${sc.bg} ${sc.text}`}>
                            {customer.strength === 'Strong' && <Zap className={`w-3 h-3 mr-1 ${sc.icon}`} />}
                            {customer.strength === 'Moderate' && <Activity className={`w-3 h-3 mr-1 ${sc.icon}`} />}
                            {customer.strength === 'Weak' && <AlertCircle className={`w-3 h-3 mr-1 ${sc.icon}`} />}
                            {customer.strength}
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full ${sc.bar}`}
                              style={{ width: `${customer.strength_score}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-400">{customer.strength_score}/100</span>
                        </div>
                      </td>

                      {/* Credit Score */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <div className={`px-3 py-1.5 rounded-lg font-bold text-base ${getCreditScoreColor(customer.credit_score)}`}>
                            {customer.credit_score}
                          </div>
                          <span className={`px-2.5 py-0.5 text-xs font-bold text-white rounded-full ${badge.color}`}>
                            {badge.label}
                          </span>
                        </div>
                      </td>

                      {/* Credit Terms */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm">
                          <Clock className="w-4 h-4 mr-1.5 text-gray-400 flex-shrink-0" />
                          <span className="font-semibold text-gray-900">{getCreditTerms(customer.credit_days)}</span>
                        </div>
                        {customer.credit_days > 0 && (
                          <div className="text-xs text-gray-400 mt-0.5 ml-5.5">{formatCurrency(customer.credit_amount)} limit</div>
                        )}
                      </td>

                      {/* Total Sales */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm">
                          <TrendingUp className="w-4 h-4 mr-1.5 text-green-500 flex-shrink-0" />
                          <span className="font-semibold text-gray-900">{formatCurrency(customer.total_sales)}</span>
                        </div>
                      </td>

                      {/* Total Paid */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <span className="font-semibold text-green-600 text-sm">{formatCurrency(customer.total_paid)}</span>
                      </td>

                      {/* Outstanding */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm">
                          {customer.total_due > 0 && <AlertCircle className="w-4 h-4 mr-1.5 text-red-500 flex-shrink-0" />}
                          <span className={`font-bold ${customer.total_due > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                            {formatCurrency(customer.total_due)}
                          </span>
                        </div>
                      </td>

                      {/* Payment Rate */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm">
                          {parseFloat(paymentRate) >= 70 ? (
                            <TrendingUp className="w-4 h-4 mr-1.5 text-green-500 flex-shrink-0" />
                          ) : (
                            <TrendingDown className="w-4 h-4 mr-1.5 text-red-500 flex-shrink-0" />
                          )}
                          <span className={`font-semibold ${parseFloat(paymentRate) >= 70 ? 'text-green-600' : 'text-red-600'}`}>
                            {paymentRate}%
                          </span>
                        </div>
                      </td>

                      {/* Invoice count */}
                      <td className="px-5 py-4 whitespace-nowrap text-center">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-teal-50 text-teal-700 font-bold text-sm">
                          {customer.invoice_count}
                        </span>
                      </td>

                      {/* Overdue count */}
                      <td className="px-5 py-4 whitespace-nowrap text-center">
                        {customer.overdue_count > 0 ? (
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-100 text-red-700 font-bold text-sm">
                            {customer.overdue_count}
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-green-50 text-green-600 font-bold text-sm">0</span>
                        )}
                      </td>

                      {/* Security */}
                      <td className="px-5 py-4 whitespace-nowrap text-center">
                        {customer.security_provided ? (
                          <div className="inline-flex items-center px-2.5 py-1 rounded-full bg-teal-100 text-teal-700">
                            <Shield className="w-3.5 h-3.5 mr-1" />
                            <span className="text-xs font-bold">Yes</span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">No</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Methodology */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-teal-50 border-l-4 border-blue-500 p-5 rounded-lg">
          <div className="flex items-start">
            <AlertCircle className="w-5 h-5 text-blue-500 mr-3 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-base font-bold text-blue-900 mb-2">Credit Score Calculation</h3>
              <ul className="space-y-1.5 text-sm text-teal-800">
                <li><strong>Payment Behaviour (50 pts):</strong> 90%+ paid = 50, 70%+ = 40, 50%+ = 30</li>
                <li><strong>Sales Volume (30 pts):</strong> LKR 100k+ = 30, 50k+ = 25, 20k+ = 20</li>
                <li><strong>Overdue Ratio (−20 pts):</strong> 80%+ outstanding = −20, 60%+ = −15</li>
                <li><strong>Overdue Invoices (−10 pts):</strong> 3+ overdue invoices = −10 pts</li>
                <li><strong>Security Bonus (+10 pts):</strong> Collateral provided</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="bg-emerald-50 border-l-4 border-emerald-500 p-5 rounded-lg">
          <div className="flex items-start">
            <Zap className="w-5 h-5 text-emerald-500 mr-3 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-base font-bold text-emerald-900 mb-2">Customer Strength Calculation</h3>
              <ul className="space-y-1.5 text-sm text-emerald-800">
                <li><strong>Payment Rate (50 pts):</strong> 90%+ = 50, 75%+ = 40, 60%+ = 30</li>
                <li><strong>Relationship Depth (30 pts):</strong> 20+ invoices = 30, 10+ = 25, 5+ = 18</li>
                <li><strong>Overdue Invoices (20 pts):</strong> 0 overdue = +20, 1 = +10, 3+ = −10</li>
                <li><strong>Strong:</strong> 70+ &nbsp;|&nbsp; <strong>Moderate:</strong> 40–69 &nbsp;|&nbsp; <strong>Weak:</strong> &lt;40</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
