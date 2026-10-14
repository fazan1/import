import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { TrendingUp, Ship, Layers } from 'lucide-react';

interface BatchData {
  batch: string;
  valueCNY: number;
  weightKg: number;
  cbm: number;
  suppliers: number;
  items: number;
  paidCNY: number;
  cumulativeValue: number;
  cumulativeWeight: number;
  date: string;
}

export default function BatchGrowthChart() {
  const [data, setData] = useState<BatchData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBatchData();
  }, []);

  async function loadBatchData() {
    setLoading(true);

    try {
      const { data: bills, error } = await supabase
        .from('purchase_bills')
        .select(`
          id,
          batch_number,
          bill_date,
          amount_paid,
          status,
          purchase_order_id,
          purchase_bill_items (
            quantity_received,
            unit_price_cny
          ),
          purchase_orders!purchase_bills_purchase_order_id_fkey (
            supplier_id,
            total_weight_kg,
            total_cbm
          )
        `)
        .not('batch_number', 'is', null)
        .order('batch_number');

      if (error || !bills || bills.length === 0) {
        setData([]);
        setLoading(false);
        return;
      }

      // CBM / weight come from the packing list (what was actually packed), not the PO estimate
      const { data: plRows } = await supabase.from('packing_list_items').select('batch_number, cbm, weight_kg');
      const plAgg = new Map<string, { cbm: number; kg: number }>();
      for (const r of (plRows || []) as { batch_number: string | null; cbm: number; weight_kg: number }[]) {
        if (!r.batch_number) continue;
        const a = plAgg.get(r.batch_number) || { cbm: 0, kg: 0 };
        a.cbm += Number(r.cbm) || 0; a.kg += Number(r.weight_kg) || 0;
        plAgg.set(r.batch_number, a);
      }

    const batchMap = new Map<string, {
      valueCNY: number;
      weightKg: number;
      cbm: number;
      suppliers: Set<string>;
      items: number;
      paidCNY: number;
      date: string;
    }>();

    for (const bill of bills) {
      const bn = bill.batch_number as string;
      if (!batchMap.has(bn)) {
        batchMap.set(bn, {
          valueCNY: 0,
          weightKg: 0,
          cbm: 0,
          suppliers: new Set(),
          items: 0,
          paidCNY: 0,
          date: bill.bill_date || '',
        });
      }

      const entry = batchMap.get(bn)!;

      const items = bill.purchase_bill_items as { quantity_received: number; unit_price_cny: number }[] | null;
      if (items) {
        for (const item of items) {
          entry.valueCNY += (item.quantity_received || 0) * (item.unit_price_cny || 0);
          entry.items += 1;
        }
      }

      const poRaw = bill.purchase_orders as unknown;
      const po = (Array.isArray(poRaw) ? poRaw[0] : poRaw) as { supplier_id: string; total_weight_kg: number; total_cbm: number } | null;
      if (po && po.supplier_id) entry.suppliers.add(po.supplier_id);

      entry.paidCNY += bill.amount_paid || 0;

      if (bill.bill_date && (!entry.date || bill.bill_date < entry.date)) {
        entry.date = bill.bill_date;
      }
    }

    for (const [bn, entry] of batchMap) {
      const pl = plAgg.get(bn);
      if (pl) { entry.cbm = pl.cbm; entry.weightKg = pl.kg; }
    }
    const sortedBatches = Array.from(batchMap.entries()).sort((a, b) => (a[1].date || '').localeCompare(b[1].date || '') || a[0].localeCompare(b[0]));

    let cumulativeValue = 0;
    let cumulativeWeight = 0;

    const chartData: BatchData[] = sortedBatches.map(([bn, entry]) => {
      cumulativeValue += entry.valueCNY;
      cumulativeWeight += entry.weightKg;
      return {
        batch: /^(LCL|FCL)-/.test(bn) ? bn : `Batch ${bn}`,
        valueCNY: Math.round(entry.valueCNY),
        weightKg: Math.round(entry.weightKg),
        cbm: Math.round(entry.cbm * 100) / 100,
        suppliers: entry.suppliers.size,
        items: entry.items,
        paidCNY: Math.round(entry.paidCNY),
        cumulativeValue: Math.round(cumulativeValue),
        cumulativeWeight: Math.round(cumulativeWeight),
        date: entry.date,
      };
    });

    setData(chartData);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-48" />
          <div className="h-64 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="text-center py-12 text-gray-400">
          <Ship className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="font-medium">No batch data yet</p>
          <p className="text-sm mt-1">Process your first container to see growth metrics</p>
        </div>
      </div>
    );
  }

  const latest = data[data.length - 1];
  const previous = data.length > 1 ? data[data.length - 2] : null;
  const growthPct = previous && previous.valueCNY > 0
    ? Math.round(((latest.valueCNY - previous.valueCNY) / previous.valueCNY) * 100)
    : null;


  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Business Growth</h2>
              <p className="text-emerald-100 text-xs">Container-by-container progression</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-white">{data.length}</p>
            <p className="text-emerald-100 text-xs">Batches Processed</p>
          </div>
        </div>
      </div>

      {/* Key Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-6 border-b border-gray-100">
        <div className="text-center">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Total Value</p>
          <p className="text-xl font-bold text-gray-900 mt-1">
            ¥{latest.cumulativeValue.toLocaleString()}
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Total Weight</p>
          <p className="text-xl font-bold text-gray-900 mt-1">
            {latest.cumulativeWeight.toLocaleString()} kg
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Avg Per Batch</p>
          <p className="text-xl font-bold text-gray-900 mt-1">
            ¥{Math.round(latest.cumulativeValue / data.length).toLocaleString()}
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Growth</p>
          <p className={`text-xl font-bold mt-1 ${growthPct !== null && growthPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {growthPct !== null ? `${growthPct >= 0 ? '+' : ''}${growthPct}%` : '--'}
          </p>
        </div>
      </div>

      {/* Chart */}
      <div className="p-6">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="batch"
                tick={{ fontSize: 12, fill: '#6b7280' }}
                axisLine={{ stroke: '#e5e7eb' }}
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11, fill: '#6b7280' }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11, fill: '#6b7280' }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k kg`}
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
                  if (name === 'Batch Value') return [`¥${v.toLocaleString()}`, name];
                  if (name === 'Cumulative Value') return [`¥${v.toLocaleString()}`, name];
                  if (name === 'Weight (kg)') return [`${v.toLocaleString()} kg`, name];
                  return [v.toLocaleString(), name];
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: '12px', paddingTop: '12px' }}
              />
              <Bar
                yAxisId="left"
                dataKey="valueCNY"
                name="Batch Value"
                fill="#e8552a"
                radius={[4, 4, 0, 0]}
                barSize={48}
              />
              <Bar
                yAxisId="right"
                dataKey="weightKg"
                name="Weight (kg)"
                fill="#94a3b8"
                radius={[4, 4, 0, 0]}
                barSize={48}
                opacity={0.6}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="cumulativeValue"
                name="Cumulative Value"
                stroke="#059669"
                strokeWidth={3}
                dot={{ fill: '#059669', r: 5, strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 7, strokeWidth: 2, stroke: '#fff' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>


      {/* Batch Detail Table */}
      <div className="px-6 pb-6">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
          Batch Breakdown
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Batch</th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">Value (CNY)</th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">Weight</th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">CBM</th>
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">Paid</th>
                <th className="text-center py-2 px-3 text-xs font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((batch) => {
                const paymentPct = batch.valueCNY > 0 ? (batch.paidCNY / batch.valueCNY) * 100 : 0;
                return (
                  <tr key={batch.batch} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 px-3 font-medium text-gray-800 flex items-center gap-2">
                      <Layers className="w-3.5 h-3.5 text-teal-500" />
                      {batch.batch}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-700">¥{batch.valueCNY.toLocaleString()}</td>
                    <td className="py-2 px-3 text-right text-gray-700">{batch.weightKg.toLocaleString()} kg</td>
                    <td className="py-2 px-3 text-right text-gray-700">{batch.cbm} CBM</td>
                    <td className="py-2 px-3 text-right text-gray-700">¥{batch.paidCNY.toLocaleString()}</td>
                    <td className="py-2 px-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        paymentPct >= 100 ? 'bg-emerald-100 text-emerald-700' :
                        paymentPct > 0 ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {paymentPct >= 100 ? 'Paid' : paymentPct > 0 ? 'Partial' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
