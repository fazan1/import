import { useState, useEffect } from 'react';
import { Receipt, Search, Calendar, Building2, ChevronRight, Plus, X, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { deletePurchaseBill } from '../lib/bills';
import { fetchAllPages } from '../lib/fetchAll';
import PurchaseBillPage from './PurchaseBillPage';

interface Supplier {
  id: string;
  name: string;
}

interface PurchaseOrder {
  id: string;
  order_date: string;
  status: string;
  suppliers: Supplier | Supplier[] | null;
}

interface BillItem {
  quantity_received: number;
  unit_price_cny: number;
}

interface PurchaseBill {
  id: string;
  purchase_order_id: string;
  bill_number: string | null;
  batch_number: string | null;
  bill_date: string;
  due_date: string | null;
  status: string;
  exchange_rate: number;
  amount_paid: number;
  purchase_orders: PurchaseOrder;
  purchase_bill_items: BillItem[];
}

function getSupplierName(suppliers: Supplier | Supplier[] | null | undefined): string {
  if (!suppliers) return '';
  if (Array.isArray(suppliers)) return suppliers[0]?.name || '';
  return suppliers.name || '';
}

interface PurchaseBillsProps {
  preselectedBillId?: string;
  onClearPreselection?: () => void;
}

export default function PurchaseBills({ preselectedBillId, onClearPreselection }: PurchaseBillsProps) {
  const [bills, setBills] = useState<PurchaseBill[]>([]);
  const [unbilledOrders, setUnbilledOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (preselectedBillId && bills.length > 0) {
      const bill = bills.find(b => b.id === preselectedBillId);
      if (bill) {
        setSelectedOrderId(bill.purchase_order_id);
        onClearPreselection?.();
      }
    }
  }, [preselectedBillId, bills, onClearPreselection]);

  async function loadData() {
    setLoading(true);

    // fetchAllPages: every bill and order of the current book, not only the first 1000
    const billsRes = await fetchAllPages<PurchaseBill>(() => supabase
      .from('purchase_bills')
      .select(`
        *,
        purchase_orders (
          id,
          order_date,
          status,
          suppliers (id, name)
        ),
        purchase_bill_items (
          quantity_received,
          unit_price_cny
        )
      `)
      .order('bill_date', { ascending: false })
      .order('id'));

    if (billsRes.error) alert('Could not load all bills: ' + billsRes.error);
    else {
      setBills(billsRes.data);

      const billedOrderIds = new Set(billsRes.data.map(b => b.purchase_order_id));

      const ordersRes = await fetchAllPages<PurchaseOrder>(() => supabase
        .from('purchase_orders')
        .select(`
          id,
          order_date,
          status,
          suppliers (id, name)
        `)
        .order('order_date', { ascending: false })
        .order('id'));

      if (ordersRes.error) alert('Could not load all orders: ' + ordersRes.error);
      else {
        const unbilled = ordersRes.data.filter(order => !billedOrderIds.has(order.id));
        setUnbilledOrders(unbilled);
      }
    }

    setLoading(false);
  }

  async function handleDelete(e: React.MouseEvent, billId: string, billNumber: string | null) {
    e.stopPropagation();
    if (!confirm(`Delete bill "${billNumber || 'this bill'}" with its items and payments? It goes to the Recycle Bin and can be restored.`)) return;
    const err = await deletePurchaseBill(billId);
    if (err) alert('Could not delete the bill: ' + err);
    loadData();
  }

  function handleBack() {
    setSelectedOrderId(null);
    loadData();
  }

  if (selectedOrderId) {
    return <PurchaseBillPage purchaseOrderId={selectedOrderId} onBack={handleBack} />;
  }

  const uniqueBatches = [...new Set(bills.map(b => b.batch_number).filter(Boolean))];

  const filteredBills = bills.filter(bill => {
    const supplierName = getSupplierName(bill.purchase_orders?.suppliers);
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch =
      (bill.bill_number?.toLowerCase() || '').includes(searchLower) ||
      (bill.batch_number?.toLowerCase() || '').includes(searchLower) ||
      supplierName.toLowerCase().includes(searchLower);
    const matchesStatus = statusFilter === 'all' || bill.status === statusFilter;
    const matchesDate = !dateFilter || bill.bill_date === dateFilter;
    const matchesBatch = !batchFilter || bill.batch_number === batchFilter;
    return matchesSearch && matchesStatus && matchesDate && matchesBatch;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid': return 'bg-green-100 text-green-700';
      case 'partial': return 'bg-yellow-100 text-yellow-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'paid': return 'Paid';
      case 'partial': return 'Partial';
      default: return 'Pending';
    }
  };

  function getBillTotalCNY(bill: PurchaseBill): number {
    if (!bill.purchase_bill_items) return 0;
    return bill.purchase_bill_items.reduce((sum, item) => sum + (item.quantity_received * item.unit_price_cny), 0);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-teal-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Purchase Bills</h2>
      </div>

      {unbilledOrders.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-amber-800 mb-3 flex items-center">
            <Plus className="w-4 h-4 mr-2" />
            Orders Pending Bills ({unbilledOrders.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {unbilledOrders.slice(0, 6).map((order) => (
              <button
                key={order.id}
                onClick={() => setSelectedOrderId(order.id)}
                className="flex items-center justify-between p-3 bg-white rounded-lg border border-amber-200 hover:border-amber-400 hover:shadow-sm transition-all text-left"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {getSupplierName(order.suppliers) || 'Unknown Supplier'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(order.order_date).toLocaleDateString()}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-amber-500" />
              </button>
            ))}
          </div>
          {unbilledOrders.length > 6 && (
            <p className="text-xs text-amber-600 mt-2">
              +{unbilledOrders.length - 6} more orders
            </p>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by bill number, batch, or supplier..."
                className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-400" />
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            <select
              value={batchFilter}
              onChange={(e) => setBatchFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            >
              <option value="">All Batches</option>
              {uniqueBatches.map(batch => (
                <option key={batch} value={batch!}>{batch}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
            </select>
            {(searchTerm || dateFilter || batchFilter || statusFilter !== 'all') && (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setDateFilter('');
                  setBatchFilter('');
                  setStatusFilter('all');
                }}
                className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
                Clear
              </button>
            )}
          </div>
        </div>

        {filteredBills.length === 0 ? (
          <div className="text-center py-12">
            <Receipt className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No bills found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredBills.map((bill) => (
              <button
                key={bill.id}
                onClick={() => setSelectedOrderId(bill.purchase_order_id)}
                className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors text-left"
              >
                <div className="flex items-center space-x-4">
                  <div className="p-2 bg-teal-50 rounded-lg">
                    <Receipt className="w-5 h-5 text-teal-600" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <p className="font-medium text-gray-900">
                        {bill.bill_number || `Bill for PO`}
                      </p>
                      {bill.batch_number && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-teal-100 text-teal-700 rounded">
                          {bill.batch_number}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-3 mt-1 text-sm text-gray-500">
                      <span className="flex items-center">
                        <Building2 className="w-3.5 h-3.5 mr-1" />
                        {getSupplierName(bill.purchase_orders?.suppliers) || 'Unknown'}
                      </span>
                      <span className="flex items-center">
                        <Calendar className="w-3.5 h-3.5 mr-1" />
                        {new Date(bill.bill_date).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="text-right mr-2">
                    <p className="text-sm font-semibold text-gray-900">
                      {getBillTotalCNY(bill).toLocaleString(undefined, { maximumFractionDigits: 0 })} <span className="text-xs text-gray-500">CNY</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      {(getBillTotalCNY(bill) * (Number(bill.exchange_rate) || 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })} LKR
                    </p>
                  </div>
                  <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${getStatusColor(bill.status)}`}>
                    {getStatusLabel(bill.status)}
                  </span>
                  <button
                    onClick={(e) => handleDelete(e, bill.id, bill.bill_number)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete bill"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
