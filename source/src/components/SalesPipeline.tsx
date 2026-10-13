import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ArrowRight, ShoppingCart, FileText, CreditCard, CircleCheck, TriangleAlert as AlertTriangle } from 'lucide-react';

interface PipelineStage {
  label: string;
  count: number;
  value: number;
  icon: typeof ShoppingCart;
  color: string;
  bgColor: string;
  borderColor: string;
}

export default function SalesPipeline() {
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPipelineData();
  }, []);

  async function loadPipelineData() {
    setLoading(true);

    const [ordersResult, invoicesResult, paymentsResult] = await Promise.all([
      supabase.from('busy_sales_orders').select('id, total_amount, status'),
      supabase.from('busy_sales_invoices').select('id, total_amount, amount_paid, amount_due, status'),
      supabase.from('busy_sales_payments').select('id, amount'),
    ]);

    const orders = ordersResult.data || [];
    const invoices = invoicesResult.data || [];
    const payments = paymentsResult.data || [];

    const orderCount = orders.length;
    const orderValue = orders.reduce((s, o) => s + (o.total_amount || 0), 0);

    const invoiceCount = invoices.length;
    const invoiceValue = invoices.reduce((s, i) => s + (i.total_amount || 0), 0);

    const paymentCount = payments.length;
    const paymentValue = payments.reduce((s, p) => s + (p.amount || 0), 0);

    const paidInvoices = invoices.filter((i) => i.status === 'paid');
    const collectedCount = paidInvoices.length;
    const collectedValue = paidInvoices.reduce((s, i) => s + (i.total_amount || 0), 0);

    setStages([
      {
        label: 'Orders',
        count: orderCount,
        value: orderValue,
        icon: ShoppingCart,
        color: 'text-teal-700',
        bgColor: 'bg-teal-50',
        borderColor: 'border-blue-200',
      },
      {
        label: 'Invoiced',
        count: invoiceCount,
        value: invoiceValue,
        icon: FileText,
        color: 'text-teal-700',
        bgColor: 'bg-teal-50',
        borderColor: 'border-teal-200',
      },
      {
        label: 'Payments',
        count: paymentCount,
        value: paymentValue,
        icon: CreditCard,
        color: 'text-amber-700',
        bgColor: 'bg-amber-50',
        borderColor: 'border-amber-200',
      },
      {
        label: 'Collected',
        count: collectedCount,
        value: collectedValue,
        icon: CircleCheck,
        color: 'text-emerald-700',
        bgColor: 'bg-emerald-50',
        borderColor: 'border-emerald-200',
      },
    ]);

    setLoading(false);
  }

  function formatCurrency(amount: number) {
    if (amount >= 1000000) return `Rs.${(amount / 1000000).toFixed(1)}M`;
    if (amount >= 1000) return `Rs.${(amount / 1000).toFixed(0)}k`;
    return `Rs.${amount.toLocaleString()}`;
  }

  function getConversionRate(from: number, to: number): string {
    if (from === 0) return '--';
    return `${Math.round((to / from) * 100)}%`;
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="animate-pulse flex items-center justify-between gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex-1">
              <div className="h-20 bg-gray-100 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const hasBottleneck = stages[0].count > 0 && stages[1].count === 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Sales Pipeline</h3>
          <p className="text-xs text-gray-500 mt-0.5">Order to collection flow</p>
        </div>
        {hasBottleneck && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span className="text-xs font-medium text-amber-700">
              {stages[0].count} orders awaiting invoicing
            </span>
          </div>
        )}
      </div>

      {/* Pipeline Funnel */}
      <div className="p-6">
        <div className="flex items-stretch gap-2">
          {stages.map((stage, idx) => (
            <div key={stage.label} className="flex items-center flex-1 min-w-0">
              {/* Stage Card */}
              <div className={`flex-1 ${stage.bgColor} border ${stage.borderColor} rounded-xl p-4 transition-all hover:shadow-md`}>
                <div className="flex items-center gap-2 mb-2">
                  <div className={`p-1.5 rounded-lg bg-white/70`}>
                    <stage.icon className={`w-4 h-4 ${stage.color}`} />
                  </div>
                  <span className={`text-xs font-semibold uppercase tracking-wider ${stage.color}`}>
                    {stage.label}
                  </span>
                </div>
                <p className="text-2xl font-bold text-gray-900">{stage.count}</p>
                <p className="text-sm font-medium text-gray-600 mt-0.5">{formatCurrency(stage.value)}</p>

                {/* Conversion rate */}
                {idx > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-200/50">
                    <p className="text-xs text-gray-500">
                      Conversion: <span className="font-semibold text-gray-700">{getConversionRate(stages[idx - 1].count, stage.count)}</span>
                    </p>
                  </div>
                )}
              </div>

              {/* Arrow connector */}
              {idx < stages.length - 1 && (
                <div className="flex-shrink-0 px-1">
                  <ArrowRight className="w-5 h-5 text-gray-300" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Progress Bar */}
        <div className="mt-6">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
            <span>Pipeline Progress</span>
            <span>
              {stages[0].value > 0
                ? `${Math.round((stages[3].value / stages[0].value) * 100)}% collected`
                : 'No orders yet'}
            </span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex">
            {stages[0].value > 0 ? (
              <>
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${(stages[3].value / stages[0].value) * 100}%` }}
                />
                <div
                  className="h-full bg-amber-400 transition-all"
                  style={{ width: `${((stages[2].value - stages[3].value) / stages[0].value) * 100}%` }}
                />
                <div
                  className="h-full bg-teal-300 transition-all"
                  style={{ width: `${((stages[1].value - stages[2].value) / stages[0].value) * 100}%` }}
                />
                <div
                  className="h-full bg-blue-200 transition-all"
                  style={{ width: `${((stages[0].value - stages[1].value) / stages[0].value) * 100}%` }}
                />
              </>
            ) : (
              <div className="h-full w-full bg-gray-100" />
            )}
          </div>
          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              Collected
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              Payments
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <div className="w-2.5 h-2.5 rounded-full bg-teal-300" />
              Invoiced
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-200" />
              Orders Only
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
