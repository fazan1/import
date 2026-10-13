import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Package, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';
import { useAutoSave } from '../hooks/useAutoSave';

interface OrderItem {
  id: string;
  product_name: string;
  current_stock: number;
  lead_time_weeks: number;
  safety_stock_percentage: number;
  avg_weekly_sales: number;
  on_the_way_stock: number;
  total_required_stock: number;
  demand_during_lead_time: number;
  safety_stock: number;
  sku?: string;
  location?: string;
}

interface FormulaBreakdown {
  demandDuringLeadTime: number;
  safetyBuffer: number;
  totalRequired: number;
}

export default function OrderQuantity() {
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<number>(0);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const calculateFormula = (item: OrderItem): FormulaBreakdown => {
    return {
      demandDuringLeadTime: item.demand_during_lead_time,
      safetyBuffer: item.safety_stock,
      totalRequired: item.total_required_stock,
    };
  };

  const fetchOrderItems = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('order_quantity_view')
        .select('*')
        .order('product_name');

      if (error) throw error;
      const filtered = (data || []).filter(item => Number(item.on_the_way_stock) >= 1);
      setOrderItems(filtered);
    } catch (error: any) {
      console.error('Error fetching order items:', error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrderItems();
  }, []);

  const saveLeadTime = useCallback(async (id: string, value: number) => {
    setSavingIds(prev => new Set(prev).add(id));
    try {
      const { error } = await supabase
        .from('stock_items')
        .update({ lead_time_weeks: value })
        .eq('id', id);

      if (!error) {
        await fetchOrderItems();
      }
    } finally {
      setSavingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [fetchOrderItems]);

  const { save: debouncedSaveLeadTime } = useAutoSave({
    onSave: async () => {
      if (editingId) {
        await saveLeadTime(editingId, editValue);
        setEditingId(null);
      }
    },
    debounceMs: 500,
  });

  const handleLeadTimeEdit = (id: string, currentValue: number) => {
    setEditingId(id);
    setEditValue(currentValue);
    setExpandedRow(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading order quantities...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Package className="w-8 h-8 text-red-600" />
          <h1 className="text-3xl font-bold text-gray-900">Order Quantity</h1>
        </div>
        <p className="text-gray-600">Items that need to be reordered based on stock levels and sales velocity</p>
      </div>

      {orderItems.length === 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-8 text-center">
          <TrendingUp className="w-12 h-12 text-green-600 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-green-900 mb-2">All Stock Levels Healthy</h3>
          <p className="text-green-700">No items require reordering at this time</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="w-8 px-4 py-3"></th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Product Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Current Stock
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Lead Time (weeks)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Avg Weekly Sales
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Safety Stock %
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Order Quantity
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {orderItems.map((item) => {
                  const formula = calculateFormula(item);
                  const isExpanded = expandedRow === item.id;
                  return (
                    <tbody key={item.id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-4 text-center">
                          <button
                            onClick={() => setExpandedRow(isExpanded ? null : item.id)}
                            className="text-gray-400 hover:text-gray-600 transition"
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-5 h-5" />
                            ) : (
                              <ChevronDown className="w-5 h-5" />
                            )}
                          </button>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{item.product_name}</div>
                          {item.location && (
                            <div className="text-xs text-gray-500">{item.location}</div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{Math.round(item.current_stock)} pcs</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {editingId === item.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                value={editValue}
                                onChange={(e) => {
                                  setEditValue(Number(e.target.value));
                                  debouncedSaveLeadTime();
                                }}
                                onBlur={() => setEditingId(null)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    (e.target as HTMLInputElement).blur();
                                  } else if (e.key === 'Escape') {
                                    setEditingId(null);
                                  }
                                }}
                                className={`w-20 px-2 py-1 rounded text-sm border transition-colors ${
                                  savingIds.has(item.id) ? 'border-green-400 bg-green-50' : 'border-gray-300 bg-white'
                                }`}
                                min="1"
                                step="1"
                                autoFocus
                              />
                              {savingIds.has(item.id) && (
                                <span className="text-xs text-green-600 font-medium">Saving...</span>
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={() => handleLeadTimeEdit(item.id, item.lead_time_weeks)}
                              className="text-sm text-teal-700 hover:text-teal-800 underline"
                            >
                              {item.lead_time_weeks} weeks
                            </button>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{Math.round(item.avg_weekly_sales)} pcs/week</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{Math.round(item.safety_stock_percentage)}%</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">
                            {Math.round(item.on_the_way_stock)} pcs
                          </span>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-teal-50 border-t-2 border-blue-200">
                          <td colSpan={7} className="px-6 py-4">
                            <div className="space-y-3">
                              <h4 className="font-semibold text-blue-900">Formula Breakdown</h4>
                              <div className="grid md:grid-cols-3 gap-4">
                                <div className="bg-white rounded p-3 border border-blue-200">
                                  <p className="text-xs text-teal-700 mb-1">Step 1: Demand During Lead Time</p>
                                  <p className="text-sm font-mono text-gray-900">
                                    {Math.round(item.avg_weekly_sales)} pcs/week × {Math.round(item.lead_time_weeks)} weeks = {Math.round(formula.demandDuringLeadTime)} pcs
                                  </p>
                                </div>
                                <div className="bg-white rounded p-3 border border-blue-200">
                                  <p className="text-xs text-teal-700 mb-1">Step 2: Safety Buffer</p>
                                  <p className="text-sm font-mono text-gray-900">
                                    Based on {Math.round(item.safety_stock_percentage)}% service level = {Math.round(formula.safetyBuffer)} pcs
                                  </p>
                                </div>
                                <div className="bg-white rounded p-3 border border-blue-200">
                                  <p className="text-xs text-teal-700 mb-1">Step 3: Total Required</p>
                                  <p className="text-sm font-mono text-gray-900">
                                    {Math.round(formula.demandDuringLeadTime)} + {Math.round(formula.safetyBuffer)} = {Math.round(formula.totalRequired)} pcs
                                  </p>
                                </div>
                              </div>
                              <div className="bg-green-50 rounded p-3 border border-green-200 mt-2">
                                <p className="text-xs text-green-600 mb-1">Final Calculation: Order Quantity</p>
                                <p className="text-sm font-mono font-semibold text-green-900">
                                  {Math.round(formula.totalRequired)} pcs (total required) - {Math.round(item.current_stock)} pcs (current stock) = {Math.round(item.on_the_way_stock)} pcs to order
                                </p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-6 bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-lg p-5">
        <h3 className="text-base font-bold text-red-900 mb-3">How Order Quantities Are Calculated</h3>
        <div className="grid md:grid-cols-2 gap-4 text-sm text-red-800">
          <div>
            <p className="font-semibold mb-2">Step-by-Step:</p>
            <ul className="space-y-1.5">
              <li>1. <strong>Demand During Lead Time</strong> = Avg Weekly Sales × Lead Time (weeks)</li>
              <li>2. <strong>Safety Buffer</strong> = Statistical safety stock based on sales variability</li>
              <li>3. <strong>Total Required</strong> = Demand + Safety Buffer</li>
              <li>4. <strong>Order Quantity</strong> = Total Required - Current Stock</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold mb-2">What This Means:</p>
            <ul className="space-y-1.5">
              <li>• Only items with order qty &gt; 0 are shown</li>
              <li>• Safety stock adjusts based on sales volatility</li>
              <li>• Higher safety % means more protection against stockouts</li>
              <li>• Lead time directly impacts how much stock is needed</li>
            </ul>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-red-300">
          <p className="text-xs text-red-700">
            <strong>Tip:</strong> Click the expand button on any row to see the detailed formula breakdown for that product.
          </p>
        </div>
      </div>
    </div>
  );
}
