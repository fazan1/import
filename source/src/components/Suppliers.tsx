import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, X, Check, Building2, ChevronLeft, FileText, CreditCard, ShoppingCart, ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { moveToRecycleBin } from '../lib/recycleBin';

interface Supplier {
  id: string;
  name: string;
  country: string | null;
  currency: string;
  contact_details: string | null;
  created_at: string;
  updated_at: string;
}

interface SupplierFormData {
  name: string;
  country: string;
  currency: string;
  contact_details: string;
}

interface BillItem {
  id: string;
  item_name: string;
  quantity_received: number;
  unit_price_cny: number;
  unit: string | null;
}

interface Payment {
  id: string;
  voucher_number: string | null;
  payment_date: string;
  payment_mode: string;
  amount: number;
  account_name: string | null;
  narration: string | null;
}

interface Bill {
  id: string;
  bill_number: string | null;
  cnv_invoice_number: string | null;
  batch_number: string | null;
  bill_date: string;
  due_date: string | null;
  status: string;
  exchange_rate: number;
  amount_paid: number;
  purchase_bill_items: BillItem[];
  purchase_payments: Payment[];
}

interface PurchaseOrder {
  id: string;
  order_date: string;
  status: string;
  purchase_bills: Bill[];
}

interface SupplierDetail {
  supplier: Supplier;
  orders: PurchaseOrder[];
}

const initialFormData: SupplierFormData = {
  name: '',
  country: '',
  currency: 'CNY',
  contact_details: '',
};

const STATUS_COLORS: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  partial: 'bg-amber-100 text-amber-700',
  pending: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-teal-100 text-teal-700',
  received: 'bg-teal-100 text-teal-700',
};

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string | null) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Supplier Detail View ──────────────────────────────────────────────────────

function SupplierDetailView({ supplier, onBack }: { supplier: Supplier; onBack: () => void }) {
  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedBills, setExpandedBills] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'bills' | 'payments' | 'orders'>('bills');

  useEffect(() => {
    loadDetail();
  }, [supplier.id]);

  async function loadDetail() {
    setLoading(true);
    const { data, error } = await supabase
      .from('purchase_orders')
      .select(`
        id, order_date, status,
        purchase_bills (
          id, bill_number, cnv_invoice_number, batch_number, bill_date, due_date,
          status, exchange_rate, amount_paid,
          purchase_bill_items (id, item_name, quantity_received, unit_price_cny, unit),
          purchase_payments (id, voucher_number, payment_date, payment_mode, amount, account_name, narration)
        )
      `)
      .eq('supplier_id', supplier.id)
      .order('order_date', { ascending: false });

    if (!error) {
      setDetail({ supplier, orders: (data || []) as PurchaseOrder[] });
    }
    setLoading(false);
  }

  // Flatten all bills and payments across orders
  const allBills: (Bill & { order_date: string })[] = [];
  const allPayments: (Payment & { bill_number: string | null; cnv_invoice_number: string | null })[] = [];

  (detail?.orders || []).forEach((o) => {
    o.purchase_bills.forEach((b) => {
      allBills.push({ ...b, order_date: o.order_date });
      b.purchase_payments.forEach((p) => {
        allPayments.push({ ...p, bill_number: b.bill_number, cnv_invoice_number: b.cnv_invoice_number });
      });
    });
  });

  allBills.sort((a, b) => new Date(b.bill_date).getTime() - new Date(a.bill_date).getTime());
  allPayments.sort((a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime());

  const totalBilled = allBills.reduce((s, b) => s + b.purchase_bill_items.reduce((a, i) => a + i.quantity_received * i.unit_price_cny, 0), 0);
  const totalPaid = allBills.reduce((s, b) => s + b.amount_paid, 0);
  const totalPending = Math.max(0, totalBilled - totalPaid);

  function toggleBill(id: string) {
    setExpandedBills((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-teal-600" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-teal-50 rounded-xl">
            <Building2 className="w-5 h-5 text-teal-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">{supplier.name}</h2>
            <p className="text-xs text-gray-500">{supplier.country || ''}{supplier.country && supplier.currency ? ' · ' : ''}{supplier.currency}</p>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Total Billed (CNY)</p>
          <p className="text-lg font-bold text-gray-900">{fmt(totalBilled)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Total Paid (CNY)</p>
          <p className="text-lg font-bold text-green-600">{fmt(totalPaid)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Outstanding (CNY)</p>
          <p className={`text-lg font-bold ${totalPending > 0 ? 'text-amber-600' : 'text-green-600'}`}>{fmt(totalPending)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-200">
          {([
            { id: 'bills', label: 'Bills', icon: FileText, count: allBills.length },
            { id: 'payments', label: 'Payments', icon: CreditCard, count: allPayments.length },
            { id: 'orders', label: 'Purchase Orders', icon: ShoppingCart, count: detail?.orders.length ?? 0 },
          ] as const).map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-teal-600 text-teal-700 bg-teal-50'
                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${activeTab === tab.id ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-500'}`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Bills Tab */}
        {activeTab === 'bills' && (
          <div>
            {allBills.length === 0 ? (
              <div className="p-12 text-center text-gray-400">No bills found for this supplier</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {allBills.map((b) => {
                  const billTotal = b.purchase_bill_items.reduce((a, i) => a + i.quantity_received * i.unit_price_cny, 0);
                  const pending = Math.max(0, billTotal - b.amount_paid);
                  const isExpanded = expandedBills.has(b.id);
                  return (
                    <div key={b.id}>
                      <button
                        type="button"
                        onClick={() => toggleBill(b.id)}
                        className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                          <div>
                            <p className="font-medium text-gray-900 text-sm">
                              {b.cnv_invoice_number || b.bill_number || 'Unnamed Bill'}
                              {b.batch_number && <span className="ml-2 text-xs px-2 py-0.5 bg-teal-50 text-teal-700 rounded-full">{b.batch_number}</span>}
                            </p>
                            <p className="text-xs text-gray-500">{fmtDate(b.bill_date)}{b.due_date ? ` · Due ${fmtDate(b.due_date)}` : ''}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <p className="text-xs text-gray-400">Total</p>
                            <p className="text-sm font-semibold text-gray-900">{fmt(billTotal)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-gray-400">Paid</p>
                            <p className="text-sm font-semibold text-green-600">{fmt(b.amount_paid)}</p>
                          </div>
                          <div className="text-right min-w-[80px]">
                            <p className="text-xs text-gray-400">Pending</p>
                            <p className={`text-sm font-bold ${pending > 0 ? 'text-amber-600' : 'text-green-600'}`}>{fmt(pending)}</p>
                          </div>
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[b.status] || 'bg-gray-100 text-gray-600'}`}>
                            {b.status}
                          </span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="bg-gray-50 border-t border-gray-100 px-5 py-3">
                          {b.purchase_bill_items.length === 0 ? (
                            <p className="text-sm text-gray-400 py-2">No items on this bill</p>
                          ) : (
                            <table className="w-full text-sm mb-3">
                              <thead className="text-xs uppercase text-gray-500 border-b border-gray-200">
                                <tr>
                                  <th className="pb-2 text-left">Item</th>
                                  <th className="pb-2 text-right">Qty</th>
                                  <th className="pb-2 text-right">Unit Price (CNY)</th>
                                  <th className="pb-2 text-right">Total (CNY)</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {b.purchase_bill_items.map((item) => (
                                  <tr key={item.id}>
                                    <td className="py-1.5 text-gray-800">{item.item_name}</td>
                                    <td className="py-1.5 text-right text-gray-600">{item.quantity_received}{item.unit ? ` ${item.unit}` : ''}</td>
                                    <td className="py-1.5 text-right text-gray-600">{fmt(item.unit_price_cny)}</td>
                                    <td className="py-1.5 text-right font-medium text-gray-900">{fmt(item.quantity_received * item.unit_price_cny)}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot className="border-t-2 border-gray-200 font-semibold">
                                <tr>
                                  <td colSpan={3} className="pt-2 text-gray-700">Bill Total</td>
                                  <td className="pt-2 text-right text-gray-900">{fmt(billTotal)}</td>
                                </tr>
                              </tfoot>
                            </table>
                          )}

                          {b.purchase_payments.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Payments</p>
                              <div className="space-y-1">
                                {b.purchase_payments.map((p) => (
                                  <div key={p.id} className="flex items-center justify-between py-1 text-sm">
                                    <div className="flex items-center gap-3">
                                      <CreditCard className="w-3.5 h-3.5 text-gray-400" />
                                      <span className="text-gray-700">{fmtDate(p.payment_date)}</span>
                                      {p.voucher_number && <span className="text-gray-500 text-xs">#{p.voucher_number}</span>}
                                      <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">{p.payment_mode}</span>
                                      {p.account_name && <span className="text-xs text-gray-500">{p.account_name}</span>}
                                    </div>
                                    <span className="font-semibold text-green-600">{fmt(p.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Payments Tab */}
        {activeTab === 'payments' && (
          <div>
            {allPayments.length === 0 ? (
              <div className="p-12 text-center text-gray-400">No payments found for this supplier</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs uppercase text-gray-500 border-b border-gray-200">
                      <tr>
                        <th className="px-5 py-3 text-left">Date</th>
                        <th className="px-5 py-3 text-left">Voucher</th>
                        <th className="px-5 py-3 text-left">Bill / CNV</th>
                        <th className="px-5 py-3 text-left">Mode</th>
                        <th className="px-5 py-3 text-left">Account</th>
                        <th className="px-5 py-3 text-left">Narration</th>
                        <th className="px-5 py-3 text-right">Amount (CNY)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {allPayments.map((p) => (
                        <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-5 py-3 text-gray-700">{fmtDate(p.payment_date)}</td>
                          <td className="px-5 py-3 text-gray-600">{p.voucher_number || '-'}</td>
                          <td className="px-5 py-3 text-gray-600">{p.cnv_invoice_number || p.bill_number || '-'}</td>
                          <td className="px-5 py-3">
                            <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full text-xs">{p.payment_mode}</span>
                          </td>
                          <td className="px-5 py-3 text-gray-600">{p.account_name || '-'}</td>
                          <td className="px-5 py-3 text-gray-500 max-w-xs truncate">{p.narration || '-'}</td>
                          <td className="px-5 py-3 text-right font-semibold text-green-600">{fmt(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                      <tr>
                        <td colSpan={6} className="px-5 py-3 text-gray-700">Total Payments</td>
                        <td className="px-5 py-3 text-right text-green-700">{fmt(allPayments.reduce((s, p) => s + p.amount, 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* Purchase Orders Tab */}
        {activeTab === 'orders' && (
          <div>
            {(detail?.orders.length ?? 0) === 0 ? (
              <div className="p-12 text-center text-gray-400">No purchase orders found for this supplier</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500 border-b border-gray-200">
                    <tr>
                      <th className="px-5 py-3 text-left">Order Date</th>
                      <th className="px-5 py-3 text-left">Status</th>
                      <th className="px-5 py-3 text-right">Bills</th>
                      <th className="px-5 py-3 text-right">Amount Billed (CNY)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {detail?.orders.map((o) => {
                      const oTotal = o.purchase_bills.reduce(
                        (s, b) => s + b.purchase_bill_items.reduce((a, i) => a + i.quantity_received * i.unit_price_cny, 0),
                        0
                      );
                      return (
                        <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-5 py-3 text-gray-700">{fmtDate(o.order_date)}</td>
                          <td className="px-5 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[o.status] || 'bg-gray-100 text-gray-600'}`}>
                              {o.status}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right text-gray-600">{o.purchase_bills.length}</td>
                          <td className="px-5 py-3 text-right font-medium text-gray-900">{fmt(oTotal)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Suppliers List ───────────────────────────────────────────────────────

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<SupplierFormData>(initialFormData);
  const [saving, setSaving] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);

  useEffect(() => {
    loadSuppliers();
  }, []);

  async function loadSuppliers() {
    setLoading(true);
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .order('name');

    if (error) {
      console.error('Error loading suppliers:', error);
    } else {
      setSuppliers(data || []);
    }
    setLoading(false);
  }

  function handleEdit(supplier: Supplier) {
    setEditingId(supplier.id);
    setFormData({
      name: supplier.name,
      country: supplier.country || '',
      currency: supplier.currency,
      contact_details: supplier.contact_details || '',
    });
    setShowForm(true);
  }

  function handleCancel() {
    setShowForm(false);
    setEditingId(null);
    setFormData(initialFormData);
  }

  async function handleSave() {
    if (!formData.name.trim()) return;

    setSaving(true);

    if (editingId) {
      const { error } = await supabase
        .from('suppliers')
        .update({
          name: formData.name.trim(),
          country: formData.country.trim() || null,
          currency: formData.currency.trim() || 'CNY',
          contact_details: formData.contact_details.trim() || null,
        })
        .eq('id', editingId);

      if (error) console.error('Error updating supplier:', error);
    } else {
      const { error } = await supabase
        .from('suppliers')
        .insert({
          name: formData.name.trim(),
          country: formData.country.trim() || null,
          currency: formData.currency.trim() || 'CNY',
          contact_details: formData.contact_details.trim() || null,
        });

      if (error) console.error('Error creating supplier:', error);
    }

    setSaving(false);
    handleCancel();
    loadSuppliers();
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this supplier? It will be moved to the Recycle Bin.')) return;

    const supplierToDelete = suppliers.find(s => s.id === id);
    if (!supplierToDelete) return;

    const result = await moveToRecycleBin({
      source_table: 'suppliers',
      source_id: id,
      record_data: supplierToDelete,
      display_name: `Supplier: ${supplierToDelete.name}`,
      portal: 'cn',
    });

    if (!result.success) {
      alert('Failed to move to recycle bin: ' + result.error);
      return;
    }

    const { error } = await supabase.from('suppliers').delete().eq('id', id);
    if (error) {
      console.error('Error deleting supplier:', error);
    } else {
      loadSuppliers();
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-teal-600" />
      </div>
    );
  }

  if (selectedSupplier) {
    return <SupplierDetailView supplier={selectedSupplier} onBack={() => setSelectedSupplier(null)} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Suppliers</h2>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-600 rounded-lg hover:from-teal-600 hover:to-cyan-700 transition-all shadow-lg"
        >
          <Plus className="w-4 h-4" />
          <span>Add Supplier</span>
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            {editingId ? 'Edit Supplier' : 'New Supplier'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Supplier Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Enter supplier name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
              <input
                type="text"
                value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Enter country"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <input
                type="text"
                value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="CNY"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact Details</label>
              <input
                type="text"
                value={formData.contact_details}
                onChange={(e) => setFormData({ ...formData, contact_details: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Email, phone, WeChat, etc."
              />
            </div>
          </div>
          <div className="flex justify-end space-x-3 mt-6">
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <X className="w-4 h-4 inline mr-1" />
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!formData.name.trim() || saving}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="w-4 h-4 inline mr-1" />
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {suppliers.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No suppliers yet. Add your first supplier to get started.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Supplier Name</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Country</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Currency</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Contact Details</th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {suppliers.map((supplier) => (
                <tr key={supplier.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <button
                      onClick={() => setSelectedSupplier(supplier)}
                      className="font-medium text-teal-700 hover:text-teal-900 hover:underline text-left"
                    >
                      {supplier.name}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{supplier.country || '-'}</td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-800">
                      {supplier.currency}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-600 max-w-xs truncate">{supplier.contact_details || '-'}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end space-x-2">
                      <button
                        onClick={() => handleEdit(supplier)}
                        className="p-2 text-gray-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(supplier.id)}
                        className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
