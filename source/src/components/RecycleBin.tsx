import { useState, useEffect } from 'react';
import { Trash2, RotateCcw, Clock, Package, FileText, Users, Truck, Receipt, X, TriangleAlert as AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { restoreFromRecycleBin, permanentlyDelete } from '../lib/recycleBin';

interface RecycleBinItem {
  id: string;
  source_table: string;
  source_id: string;
  record_data: Record<string, unknown>;
  related_data: Record<string, unknown>;
  display_name: string;
  portal: 'cn' | 'sl';
  deleted_at: string;
  expires_at: string;
}

interface RecycleBinProps {
  portal?: 'cn' | 'sl';
}

const tableIcons: Record<string, typeof Package> = {
  purchase_orders: Package,
  purchase_bills: FileText,
  purchase_payments: Receipt,
  pl_input: Truck,
  packing_list_items: Package,
  costing_duty_sheet: FileText,
  suppliers: Users,
  items: Package,
  busy_sales_orders: FileText,
  busy_sales_invoices: Receipt,
  busy_sales_payments: Receipt,
  customers: Users,
};

const tableLabels: Record<string, string> = {
  purchase_orders: 'Purchase Order',
  purchase_bills: 'Purchase Bill',
  purchase_payments: 'Purchase Payment',
  pl_input: 'Packing List Input',
  packing_list_items: 'Packing List Item',
  costing_duty_sheet: 'Costing Sheet',
  suppliers: 'Supplier',
  items: 'Item',
  busy_sales_orders: 'Sales Order',
  busy_sales_invoices: 'Sales Invoice',
  busy_sales_payments: 'Sales Payment',
  customers: 'Customer',
};

export default function RecycleBin({ portal }: RecycleBinProps) {
  const [items, setItems] = useState<RecycleBinItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'cn' | 'sl'>(portal || 'all');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    loadItems();
  }, [filter]);

  async function loadItems() {
    setLoading(true);

    let query = supabase
      .from('recycle_bin')
      .select('*')
      .order('deleted_at', { ascending: false });

    if (filter !== 'all') {
      query = query.eq('portal', filter);
    }

    const { data, error } = await query;

    if (!error && data) {
      setItems(data);
    }

    setLoading(false);
  }

  async function handleRestore(id: string) {
    setRestoring(id);

    const result = await restoreFromRecycleBin(id);

    if (result.success) {
      setItems(items.filter((item) => item.id !== id));
    } else {
      alert('Failed to restore: ' + result.error);
    }

    setRestoring(null);
  }

  async function handlePermanentDelete(id: string) {
    setDeleting(id);

    const result = await permanentlyDelete(id);

    if (result.success) {
      setItems(items.filter((item) => item.id !== id));
    } else {
      alert('Failed to delete: ' + result.error);
    }

    setDeleting(null);
    setShowDeleteConfirm(null);
  }

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getDaysUntilExpiry(expiresAt: string) {
    const now = new Date();
    const expiry = new Date(expiresAt);
    const diffTime = expiry.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }

  function getIcon(sourceTable: string) {
    const IconComponent = tableIcons[sourceTable] || FileText;
    return IconComponent;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-red-100 rounded-lg">
            <Trash2 className="w-6 h-6 text-red-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Recycle Bin</h1>
            <p className="text-sm text-gray-500">
              Items are automatically deleted after 30 days
            </p>
          </div>
        </div>

        {!portal && (
          <div className="flex gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                filter === 'all'
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('cn')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                filter === 'cn'
                  ? 'bg-teal-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              CN Portal
            </button>
            <button
              onClick={() => setFilter('sl')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                filter === 'sl'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              SL Portal
            </button>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <Trash2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Recycle Bin is Empty
          </h3>
          <p className="text-gray-500">
            Deleted items will appear here for 30 days before being permanently removed.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="divide-y divide-gray-200">
            {items.map((item) => {
              const IconComponent = getIcon(item.source_table);
              const daysLeft = getDaysUntilExpiry(item.expires_at);
              const isExpiringSoon = daysLeft <= 7;

              return (
                <div
                  key={item.id}
                  className="p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div
                        className={`p-2 rounded-lg ${
                          item.portal === 'cn'
                            ? 'bg-teal-100'
                            : 'bg-green-100'
                        }`}
                      >
                        <IconComponent
                          className={`w-5 h-5 ${
                            item.portal === 'cn'
                              ? 'text-teal-700'
                              : 'text-green-600'
                          }`}
                        />
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-gray-900">
                            {item.display_name}
                          </h3>
                          <span
                            className={`px-2 py-0.5 text-xs rounded-full ${
                              item.portal === 'cn'
                                ? 'bg-teal-100 text-teal-700'
                                : 'bg-green-100 text-green-700'
                            }`}
                          >
                            {item.portal === 'cn' ? 'CN Portal' : 'SL Portal'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                          <span>{tableLabels[item.source_table] || item.source_table}</span>
                          <span className="text-gray-300">|</span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            Deleted {formatDate(item.deleted_at)}
                          </span>
                          {isExpiringSoon && (
                            <>
                              <span className="text-gray-300">|</span>
                              <span className="flex items-center gap-1 text-amber-600">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                Expires in {daysLeft} days
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRestore(item.id)}
                        disabled={restoring === item.id}
                        className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors disabled:opacity-50"
                      >
                        {restoring === item.id ? (
                          <div className="w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <RotateCcw className="w-4 h-4" />
                        )}
                        <span>Restore</span>
                      </button>

                      {showDeleteConfirm === item.id ? (
                        <div className="flex items-center gap-2 bg-red-50 rounded-lg p-1">
                          <span className="text-sm text-red-700 px-2">Delete forever?</span>
                          <button
                            onClick={() => handlePermanentDelete(item.id)}
                            disabled={deleting === item.id}
                            className="px-3 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors disabled:opacity-50 text-sm font-medium"
                          >
                            {deleting === item.id ? '...' : 'Yes'}
                          </button>
                          <button
                            onClick={() => setShowDeleteConfirm(null)}
                            className="p-1.5 text-gray-500 hover:text-gray-700"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowDeleteConfirm(item.id)}
                          className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="text-center text-sm text-gray-500">
        {items.length} item{items.length !== 1 ? 's' : ''} in recycle bin
      </div>
    </div>
  );
}
