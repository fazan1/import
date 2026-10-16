import { useState, useEffect, useRef } from 'react';
import { Plus, Pencil, Trash2, X, Check, Users, Search, ChevronLeft, FileText, CreditCard, ChevronDown, ChevronRight } from 'lucide-react';
import { supabase, fromAllBooksForBackup } from '../lib/supabase';
import { fetchAllPages } from '../lib/fetchAll';
import { isBookLocked } from '../lib/book';
import { moveToRecycleBin } from '../lib/recycleBin';
import { onAccountByCustomer, netOpening } from '../lib/receivables';

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  position: string | null;
  notes: string | null;
  opening_balance: number | null;
  created_at: string;
}

interface CustomerFormData {
  name: string;
  email: string;
  phone: string;
  company: string;
  position: string;
  notes: string;
  opening_balance: string;
}

interface InvoiceItem {
  id: string;
  item_name: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  total: number;
}

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  status: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  amount_paid: number;
  amount_due: number;
  notes: string | null;
  busy_sales_invoice_items: InvoiceItem[];
}

interface SalesPayment {
  id: string;
  payment_number: string | null;
  payment_date: string;
  payment_mode: string;
  amount: number;
  reference_number: string | null;
  notes: string | null;
  sales_invoice_id: string;
  cheque_status?: string | null;
  // many-to-one join: Supabase returns ONE object here (an array only in older typings)
  busy_sales_invoices: { invoice_number: string } | { invoice_number: string }[] | null;
}

const initialFormData: CustomerFormData = {
  name: '',
  email: '',
  phone: '',
  company: '',
  position: '',
  notes: '',
  opening_balance: '',
};

const STATUS_COLORS: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  partial: 'bg-amber-100 text-amber-700',
  sent: 'bg-teal-100 text-teal-700',
  draft: 'bg-gray-100 text-gray-600',
  overdue: 'bg-red-100 text-red-700',
};

const PAYMENT_MODE_COLORS: Record<string, string> = {
  cash: 'bg-green-100 text-green-700',
  cheque: 'bg-teal-100 text-teal-700',
  bank_transfer: 'bg-cyan-100 text-cyan-700',
  online: 'bg-teal-100 text-teal-700',
};

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string | null) {
  if (!d) return '-';
  // 'YYYY-MM-DD' read as a LOCAL date (new Date('YYYY-MM-DD') is UTC midnight)
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Customer Detail View ──────────────────────────────────────────────────────

function CustomerDetailView({ customer, onBack }: { customer: Customer; onBack: () => void }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<SalesPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'invoices' | 'payments'>('invoices');
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadData();
  }, [customer.id]);

  async function loadData() {
    setLoading(true);

    // Quote the name so commas, brackets or dots in it don't break the filter
    const quotedName = '"' + (customer.name || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    // fetchAllPages: no 1000-row cut-off (current book only, applied automatically)
    const [invRes, payRes] = await Promise.all([
      fetchAllPages<Invoice>(() => supabase
        .from('busy_sales_invoices')
        .select(`
          id, invoice_number, invoice_date, due_date, status,
          subtotal, tax_amount, total_amount, amount_paid, amount_due, notes,
          busy_sales_invoice_items (id, item_name, quantity, unit, unit_price, total)
        `)
        .or(`customer_id.eq.${customer.id},customer_name.eq.${quotedName}`)
        .order('id')),
      fetchAllPages<SalesPayment>(() => supabase
        .from('busy_sales_payments')
        .select(`
          id, payment_number, payment_date, payment_mode, amount,
          reference_number, notes, sales_invoice_id, cheque_status,
          busy_sales_invoices (invoice_number)
        `)
        .or(`customer_id.eq.${customer.id},customer_name.eq.${quotedName}`)
        .order('id')),
    ]);

    if (invRes.error || payRes.error) {
      alert('Could not load this customer\'s invoices/payments: ' + (invRes.error || payRes.error));
    }
    setInvoices([...invRes.data].sort((a, b) => (b.invoice_date || '').localeCompare(a.invoice_date || '')));
    setPayments([...payRes.data].sort((a, b) => (b.payment_date || '').localeCompare(a.payment_date || '')));
    setLoading(false);
  }

  function toggleInvoice(id: string) {
    setExpandedInvoices((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const totalBilled = invoices.reduce((s, i) => s + i.total_amount, 0);
  const totalPaid = invoices.reduce((s, i) => s + i.amount_paid, 0);
  const totalDue = invoices.filter((i) => i.status !== 'paid' && i.amount_due > 0).reduce((s, i) => s + i.amount_due, 0);
  // same rule as Customer Outstanding: opening (OLD only) less money received on account (payments loaded above are this customer's)
  const openingBalance = netOpening(customer.name, customer.opening_balance, onAccountByCustomer(payments.map((p) => ({ ...p, customer_name: customer.name }))));
  const netOutstanding = totalDue + openingBalance;

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
            <Users className="w-5 h-5 text-teal-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">{customer.name}</h2>
            <p className="text-xs text-gray-500">
              {[customer.company, customer.phone, customer.email].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Total Billed</p>
          <p className="text-lg font-bold text-gray-900">{fmt(totalBilled)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Total Paid</p>
          <p className="text-lg font-bold text-green-600">{fmt(totalPaid)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Invoice Outstanding</p>
          <p className={`text-lg font-bold ${totalDue > 0 ? 'text-amber-600' : 'text-green-600'}`}>{fmt(totalDue)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Net Outstanding</p>
          {openingBalance > 0 && (
            <p className="text-xs text-gray-400">incl. opening {fmt(openingBalance)}</p>
          )}
          <p className={`text-lg font-bold ${netOutstanding > 0 ? 'text-red-600' : 'text-green-600'}`}>{fmt(netOutstanding)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-200">
          {([
            { id: 'invoices', label: 'Sales Invoices', icon: FileText, count: invoices.length },
            { id: 'payments', label: 'Payments', icon: CreditCard, count: payments.length },
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

        {/* Invoices Tab */}
        {activeTab === 'invoices' && (
          <div>
            {invoices.length === 0 ? (
              <div className="p-12 text-center text-gray-400">No invoices found for this customer</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {invoices.map((inv) => {
                  const isExpanded = expandedInvoices.has(inv.id);
                  return (
                    <div key={inv.id}>
                      <button
                        type="button"
                        onClick={() => toggleInvoice(inv.id)}
                        className="w-full px-5 py-3.5 flex flex-wrap gap-2 items-center justify-between hover:bg-gray-50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                          <div>
                            <p className="font-medium text-gray-900 text-sm">{inv.invoice_number}</p>
                            <p className="text-xs text-gray-500">
                              {fmtDate(inv.invoice_date)}{inv.due_date ? ` · Due ${fmtDate(inv.due_date)}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 sm:gap-6">
                          <div className="text-right">
                            <p className="text-xs text-gray-400">Total</p>
                            <p className="text-sm font-semibold text-gray-900">{fmt(inv.total_amount)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-gray-400">Paid</p>
                            <p className="text-sm font-semibold text-green-600">{fmt(inv.amount_paid)}</p>
                          </div>
                          <div className="text-right min-w-[80px]">
                            <p className="text-xs text-gray-400">Due</p>
                            <p className={`text-sm font-bold ${inv.amount_due > 0 ? 'text-amber-600' : 'text-green-600'}`}>{fmt(inv.amount_due)}</p>
                          </div>
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[inv.status] || 'bg-gray-100 text-gray-600'}`}>
                            {inv.status}
                          </span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="bg-gray-50 border-t border-gray-100 px-5 py-3">
                          {inv.busy_sales_invoice_items.length === 0 ? (
                            <p className="text-sm text-gray-400 py-2">No items on this invoice</p>
                          ) : (
                            <table className="w-full text-sm mb-3">
                              <thead className="text-xs uppercase text-gray-500 border-b border-gray-200">
                                <tr>
                                  <th className="pb-2 text-left">Item</th>
                                  <th className="pb-2 text-right">Qty</th>
                                  <th className="pb-2 text-right">Unit Price</th>
                                  <th className="pb-2 text-right">Total</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {inv.busy_sales_invoice_items.map((item) => (
                                  <tr key={item.id}>
                                    <td className="py-1.5 text-gray-800">{item.item_name}</td>
                                    <td className="py-1.5 text-right text-gray-600">{item.quantity}{item.unit ? ` ${item.unit}` : ''}</td>
                                    <td className="py-1.5 text-right text-gray-600">{fmt(item.unit_price)}</td>
                                    <td className="py-1.5 text-right font-medium text-gray-900">{fmt(item.total)}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot className="border-t border-gray-200">
                                {inv.tax_amount > 0 && (
                                  <>
                                    <tr>
                                      <td colSpan={3} className="pt-2 text-xs text-gray-500">Subtotal</td>
                                      <td className="pt-2 text-right text-sm text-gray-700">{fmt(inv.subtotal)}</td>
                                    </tr>
                                    <tr>
                                      <td colSpan={3} className="text-xs text-gray-500">Tax</td>
                                      <td className="text-right text-sm text-gray-700">{fmt(inv.tax_amount)}</td>
                                    </tr>
                                  </>
                                )}
                                <tr className="font-semibold border-t border-gray-200">
                                  <td colSpan={3} className="pt-2 text-gray-700">Total</td>
                                  <td className="pt-2 text-right text-gray-900">{fmt(inv.total_amount)}</td>
                                </tr>
                              </tfoot>
                            </table>
                          )}
                          {inv.notes && (
                            <p className="text-xs text-gray-500 mt-1 italic">{inv.notes}</p>
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
            {payments.length === 0 ? (
              <div className="p-12 text-center text-gray-400">No payments found for this customer</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs uppercase text-gray-500 border-b border-gray-200">
                      <tr>
                        <th className="px-5 py-3 text-left">Date</th>
                        <th className="px-5 py-3 text-left">Payment #</th>
                        <th className="px-5 py-3 text-left">Invoice</th>
                        <th className="px-5 py-3 text-left">Mode</th>
                        <th className="px-5 py-3 text-left">Reference</th>
                        <th className="px-5 py-3 text-left">Notes</th>
                        <th className="px-5 py-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {payments.map((p) => (
                        <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-5 py-3 text-gray-700">{fmtDate(p.payment_date)}</td>
                          <td className="px-5 py-3 text-gray-600">{p.payment_number || '-'}</td>
                          <td className="px-5 py-3 text-gray-600">{(Array.isArray(p.busy_sales_invoices) ? p.busy_sales_invoices[0]?.invoice_number : p.busy_sales_invoices?.invoice_number) || '-'}</td>
                          <td className="px-5 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_MODE_COLORS[p.payment_mode] || 'bg-gray-100 text-gray-600'}`}>
                              {(p.payment_mode || '').replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-gray-500">{p.reference_number || '-'}</td>
                          <td className="px-5 py-3 text-gray-500 max-w-xs truncate">{p.notes || '-'}</td>
                          <td className={`px-5 py-3 text-right font-semibold ${p.cheque_status === 'returned' ? 'text-red-500 line-through' : 'text-green-600'}`}>{fmt(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                      <tr>
                        <td colSpan={6} className="px-5 py-3 text-gray-700">Total Received</td>
                        <td className="px-5 py-3 text-right text-green-700">{fmt(payments.filter((p) => p.cheque_status !== 'returned').reduce((s, p) => s + (Number(p.amount) || 0), 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Customers List ───────────────────────────────────────────────────────

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CustomerFormData>(initialFormData);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const savingRef = useRef(false); // double-click guard
  const locked = isBookLocked(); // shop login: can add customers, not change or delete them (shared master)

  useEffect(() => {
    loadCustomers();
  }, []);

  async function loadCustomers() {
    setLoading(true);
    const { data, error } = await fetchAllPages<Customer>(() => supabase
      .from('customers')
      .select('*')
      .order('id'));

    if (error) {
      console.error('Error loading customers:', error);
      alert('Could not load customers: ' + error);
    } else {
      setCustomers([...data].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    }
    setLoading(false);
  }

  function handleEdit(customer: Customer) {
    setEditingId(customer.id);
    setFormData({
      name: customer.name,
      email: customer.email || '',
      phone: customer.phone || '',
      company: customer.company || '',
      position: customer.position || '',
      notes: customer.notes || '',
      opening_balance: customer.opening_balance?.toString() || '',
    });
    setShowForm(true);
  }

  function handleCancel() {
    setShowForm(false);
    setEditingId(null);
    setFormData(initialFormData);
  }

  async function handleSave() {
    if (!formData.name.trim() || savingRef.current) return;

    // same customer whatever the capitals / spaces (balances are matched by name)
    const norm = (n: string | null | undefined) => (n || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const dup = customers.find((c) => c.id !== editingId && norm(c.name) === norm(formData.name));
    if (dup) {
      alert(`A customer called "${dup.name}" already exists. Use that one (or give this one a different name).`);
      return;
    }
    const oldName = editingId ? customers.find((c) => c.id === editingId)?.name || '' : '';
    const newName = formData.name.trim();
    const renamed = !!editingId && oldName !== newName;
    if (renamed && !confirm(`Rename "${oldName}" to "${newName}"?\n\nThe name will also be changed on this customer's sales invoices and payments (all books), so the balance stays linked.`)) return;

    savingRef.current = true;
    setSaving(true);
    let failed = '';
    let savedMaster = false; // the customer itself was saved (only the name carry-over failed)

    if (editingId) {
      const { error } = await supabase
        .from('customers')
        .update({
          name: formData.name.trim(),
          email: formData.email.trim() || null,
          phone: formData.phone.trim() || null,
          company: formData.company.trim() || null,
          position: formData.position.trim() || null,
          notes: formData.notes.trim() || null,
          opening_balance: formData.opening_balance ? parseFloat(formData.opening_balance) : 0,
        })
        .eq('id', editingId);

      if (error) {
        console.error('Error updating customer:', error);
        failed = error.message;
      } else if (renamed) {
        // invoices / payments are matched by name too (custKey in receivables.ts): carry the new name over
        const quotedOld = '"' + oldName.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
        for (const table of ['busy_sales_invoices', 'busy_sales_payments']) {
          const { error: e2 } = await supabase.from(table).update({ customer_name: newName })
            .or(`customer_id.eq.${editingId},customer_name.eq.${quotedOld}`);
          if (e2) { failed = `The customer was renamed, but ${table === 'busy_sales_invoices' ? 'its invoices' : 'its payments'} still carry the old name "${oldName}": ${e2.message}`; savedMaster = true; }
        }
      }
    } else {
      const { error } = await supabase
        .from('customers')
        .insert({
          name: formData.name.trim(),
          email: formData.email.trim() || null,
          phone: formData.phone.trim() || null,
          company: formData.company.trim() || null,
          position: formData.position.trim() || null,
          notes: formData.notes.trim() || null,
          opening_balance: formData.opening_balance ? parseFloat(formData.opening_balance) : 0,
        });

      if (error) {
        console.error('Error creating customer:', error);
        failed = error.message;
      }
    }

    savingRef.current = false;
    setSaving(false);
    if (failed) {
      alert('Could not save the customer: ' + failed);
      if (!savedMaster) return; // keep the form open so nothing typed is lost
    }
    handleCancel();
    loadCustomers();
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this customer? It will be moved to the Recycle Bin.')) return;

    const customerToDelete = customers.find(c => c.id === id);
    if (!customerToDelete) return;

    // customers are shared by every book: refuse while any book still has invoices / payments for this customer
    const quotedName = '"' + (customerToDelete.name || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    for (const table of ['busy_sales_invoices', 'busy_sales_payments']) {
      const { count, error: useErr } = await fromAllBooksForBackup(table)
        .select('id', { count: 'exact', head: true })
        .or(`customer_id.eq.${id},customer_name.eq.${quotedName}`);
      if (useErr) {
        alert('Could not check this customer\'s records: ' + useErr.message);
        return;
      }
      if (count) {
        alert(`${customerToDelete.name} still has ${count} sales ${table === 'busy_sales_invoices' ? 'invoice(s)' : 'payment(s)'} (in one of the books). Delete those first, or keep the customer.`);
        return;
      }
    }

    const result = await moveToRecycleBin({
      source_table: 'customers',
      source_id: id,
      record_data: customerToDelete,
      display_name: `Customer: ${customerToDelete.name}`,
      portal: 'sl',
    });

    if (!result.success) {
      alert('Failed to move to recycle bin: ' + result.error);
      return;
    }

    const { error } = await supabase.from('customers').delete().eq('id', id);
    if (error) {
      console.error('Error deleting customer:', error);
      alert('Could not delete the customer: ' + error.message + '\n\n(A copy was put in the Recycle Bin; you can remove it there.)');
    } else {
      loadCustomers();
    }
  }

  const filteredCustomers = customers.filter((customer) => {
    const query = searchQuery.toLowerCase();
    return (
      customer.name.toLowerCase().includes(query) ||
      (customer.company?.toLowerCase().includes(query)) ||
      (customer.phone?.toLowerCase().includes(query)) ||
      (customer.email?.toLowerCase().includes(query))
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-teal-600" />
      </div>
    );
  }

  if (selectedCustomer) {
    return <CustomerDetailView customer={selectedCustomer} onBack={() => setSelectedCustomer(null)} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-gray-900">Customers</h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search customers..."
              className="pl-10 pr-4 py-2 w-full sm:w-64 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm"
            />
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-600 rounded-lg hover:from-teal-600 hover:to-cyan-700 transition-all shadow-lg"
          >
            <Plus className="w-4 h-4" />
            <span>Add Customer</span>
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            {editingId ? 'Edit Customer' : 'New Customer'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Enter customer name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="email@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="text"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="+971 XX XXX XXXX"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
              <input
                type="text"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Company name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Position</label>
              <input
                type="text"
                value={formData.position}
                onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Job title"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input
                type="text"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Additional notes"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Opening Balance</label>
              <input
                type="number"
                step="0.01"
                value={formData.opening_balance}
                onChange={(e) => setFormData({ ...formData, opening_balance: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Amount owed before start"
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

      {filteredCustomers.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">
            {searchQuery ? 'No customers match your search.' : 'No customers yet. Add your first customer to get started.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Customer Name</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Company</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Phone</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Email</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Position</th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Opening Balance</th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredCustomers.map((customer) => (
                <tr key={customer.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <button
                      onClick={() => setSelectedCustomer(customer)}
                      className="font-medium text-teal-700 hover:text-teal-900 hover:underline text-left"
                    >
                      {customer.name}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{customer.company || '-'}</td>
                  <td className="px-6 py-4 text-gray-600">{customer.phone || '-'}</td>
                  <td className="px-6 py-4 text-gray-600 max-w-xs truncate">{customer.email || '-'}</td>
                  <td className="px-6 py-4 text-gray-600">{customer.position || '-'}</td>
                  <td className="px-6 py-4 text-right">
                    {customer.opening_balance ? (
                      <span className="font-medium text-amber-600">
                        {customer.opening_balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    ) : (
                      <span className="text-gray-400">0.00</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {!locked && <div className="flex items-center justify-end space-x-2">
                      <button
                        onClick={() => handleEdit(customer)}
                        className="p-2 text-gray-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(customer.id)}
                        className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>}
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
