import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, X, Check, ShoppingCart, ChevronDown, ChevronUp, FileText, Pencil, Package, Printer, Search, Link } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { moveToRecycleBin } from '../lib/recycleBin';
import { replaceLines } from '../lib/lines';
import { fetchAllPages } from '../lib/fetchAll';
import SalesOrderPrint from './SalesOrderPrint';

// Today as YYYY-MM-DD in local time (toISOString gives the UTC date, which is yesterday before 5:30 am in Sri Lanka)
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Show a YYYY-MM-DD date as a local date (new Date('YYYY-MM-DD') is read as UTC midnight)
function showDate(s: string | null | undefined): string {
  if (!s) return '-';
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return s;
  return new Date(y, m - 1, d).toLocaleDateString();
}

interface Customer {
  id: string;
  name: string;
  phone: string | null;
}

interface ItemRecord {
  id: string;
  item_name: string;
  sku: string | null;
  unit: string;
  sales_price: number;
}

interface SalesOrderItem {
  id: string;
  item_id?: string | null;
  item_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
}

interface POLink {
  id: string;
  purchase_order_id: string;
  purchase_orders?: {
    id: string;
    order_date: string;
    status: string;
    suppliers?: {
      name: string;
    };
  };
}

interface SalesOrder {
  id: string;
  order_number: string;
  order_date: string;
  customer_id: string | null;
  customer_name: string;
  status: string;
  notes: string | null;
  total_amount: number;
  created_at: string;
  deal_type: string;
  linked_invoice_id: string | null;
  busy_sales_order_items?: SalesOrderItem[];
  so_po_links?: POLink[];
}

interface InvoiceOption {
  id: string;
  invoice_number: string;
  customer_name: string;
  invoice_date: string;
  total_amount: number;
  status: string;
  sales_order_id?: string | null;
}

interface NewItem {
  item_name: string;
  item_id: string | null;
  quantity: string;
  unit_price: string;
  unit: string;
}

interface SOItemForPO {
  item_name: string;
  quantity: number;
  unit: string;
}

interface BusySalesOrdersProps {
  onCreateInvoice?: (orderId: string) => void;
  onCopyToPO?: (orderId: string, items: SOItemForPO[]) => void;
}

export default function BusySalesOrders({ onCreateInvoice, onCopyToPO }: BusySalesOrdersProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState<SalesOrder | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [orderDate, setOrderDate] = useState(todayLocal());
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<NewItem[]>([{ item_name: '', item_id: null, quantity: '', unit_price: '', unit: 'Piece' }]);
  const [saving, setSaving] = useState(false);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [allItems, setAllItems] = useState<ItemRecord[]>([]);
  const [activeDropdown, setActiveDropdown] = useState<number | null>(null);
  const [searchTerms, setSearchTerms] = useState<string[]>(['']);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  // Form deal type toggle
  const [formDealType, setFormDealType] = useState<'single' | 'double'>('single');

  // Double deal state
  const [doubleModalOrderId, setDoubleModalOrderId] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [linkingSaving, setLinkingSaving] = useState(false);

  // Print state
  const [printOrderId, setPrintOrderId] = useState<string | null>(null);

  const dropdownRefs = useRef<(HTMLDivElement | null)[]>([]);
  const customerDropdownRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (activeDropdown !== null) {
        const ref = dropdownRefs.current[activeDropdown];
        if (ref && !ref.contains(event.target as Node)) {
          setActiveDropdown(null);
        }
      }
      if (showCustomerDropdown && customerDropdownRef.current && !customerDropdownRef.current.contains(event.target as Node)) {
        setShowCustomerDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeDropdown, showCustomerDropdown]);

  async function loadData() {
    setLoading(true);

    const [customersRes, ordersRes, itemsRes, invoicesRes] = await Promise.all([
      fetchAllPages<Customer>(() => supabase.from('customers').select('id, name, phone').order('name').order('id')),
      fetchAllPages<SalesOrder>(() => supabase
        .from('busy_sales_orders')
        .select(`
          *,
          busy_sales_order_items (*),
          so_po_links (
            id,
            purchase_order_id,
            purchase_orders (
              id,
              order_date,
              status,
              suppliers (name)
            )
          )
        `)
        .order('order_date', { ascending: false })
        .order('id')),
      fetchAllPages<ItemRecord>(() => supabase.from('items').select('id, item_name, sku, unit, sales_price').order('item_name').order('id')),
      fetchAllPages<InvoiceOption>(() => supabase
        .from('busy_sales_invoices')
        .select('id, invoice_number, customer_name, invoice_date, total_amount, status, sales_order_id')
        .order('invoice_date', { ascending: false })
        .order('id'))
    ]);

    const loadErr = customersRes.error || ordersRes.error || itemsRes.error || invoicesRes.error;
    if (loadErr) alert('Could not load all sales orders data: ' + loadErr);
    if (!customersRes.error) setCustomers(customersRes.data);
    if (!ordersRes.error) setOrders(ordersRes.data);
    if (!itemsRes.error) setAllItems(itemsRes.data);
    if (!invoicesRes.error) setInvoices(invoicesRes.data);

    setLoading(false);
  }

  async function generateOrderNumber(): Promise<string> {
    const today = new Date();
    const prefix = `SO-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;

    const { data } = await supabase
      .from('busy_sales_orders')
      .select('order_number')
      .like('order_number', `${prefix}%`)
      .order('order_number', { ascending: false })
      .limit(1);

    let nextNum = 1;
    if (data && data.length > 0) {
      const lastNum = parseInt(data[0].order_number.split('-').pop() || '0');
      nextNum = lastNum + 1;
    }

    return `${prefix}-${String(nextNum).padStart(4, '0')}`;
  }

  function addItem() {
    setItems([...items, { item_name: '', item_id: null, quantity: '', unit_price: '', unit: 'Piece' }]);
    setSearchTerms([...searchTerms, '']);
  }

  function removeItem(index: number) {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
      setSearchTerms(searchTerms.filter((_, i) => i !== index));
    }
  }

  function selectItem(index: number, item: ItemRecord) {
    const updated = [...items];
    updated[index] = {
      ...updated[index],
      item_name: item.item_name,
      item_id: item.id,
      unit_price: String(item.sales_price || ''),
      unit: item.unit
    };
    setItems(updated);
    const newSearchTerms = [...searchTerms];
    newSearchTerms[index] = item.item_name;
    setSearchTerms(newSearchTerms);
    setActiveDropdown(null);
  }

  function selectCustomer(customer: Customer) {
    setSelectedCustomer(customer.id);
    setCustomerName(customer.name);
    setCustomerSearch(customer.name);
    setShowCustomerDropdown(false);
  }

  function handleItemSearch(index: number, value: string) {
    const newSearchTerms = [...searchTerms];
    newSearchTerms[index] = value;
    setSearchTerms(newSearchTerms);
    const updated = [...items];
    updated[index].item_name = value;
    updated[index].item_id = null;
    setItems(updated);
    setActiveDropdown(index);
  }

  function getFilteredItems(searchTerm: string): ItemRecord[] {
    if (!searchTerm.trim()) return allItems.slice(0, 10);
    const term = searchTerm.toLowerCase();
    return allItems.filter(item =>
      item.item_name.toLowerCase().includes(term) ||
      (item.sku?.toLowerCase() || '').includes(term)
    ).slice(0, 10);
  }

  function getFilteredCustomers(): Customer[] {
    if (!customerSearch.trim()) return customers.slice(0, 10);
    const term = customerSearch.toLowerCase();
    return customers.filter(c =>
      c.name.toLowerCase().includes(term) ||
      (c.phone?.toLowerCase() || '').includes(term)
    ).slice(0, 10);
  }

  function updateItem(index: number, field: keyof NewItem, value: string) {
    const updated = [...items];
    updated[index][field] = value;
    setItems(updated);
  }

  function resetForm() {
    setShowForm(false);
    setEditingOrder(null);
    setSelectedCustomer('');
    setCustomerName('');
    setCustomerSearch('');
    setOrderDate(todayLocal());
    setNotes('');
    setItems([{ item_name: '', item_id: null, quantity: '', unit_price: '', unit: 'Piece' }]);
    setSearchTerms(['']);
    setActiveDropdown(null);
    setFormDealType('single');
  }

  function handleEdit(order: SalesOrder) {
    setEditingOrder(order);
    setSelectedCustomer(order.customer_id || '');
    setCustomerName(order.customer_name);
    setCustomerSearch(order.customer_name);
    setOrderDate(order.order_date);
    setNotes(order.notes || '');
    setFormDealType((order.deal_type as 'single' | 'double') || 'single');

    if (order.busy_sales_order_items && order.busy_sales_order_items.length > 0) {
      const orderItems = order.busy_sales_order_items.map(item => ({
        item_name: item.item_name,
        item_id: item.item_id || null,
        quantity: String(item.quantity),
        unit_price: String(item.unit_price),
        unit: item.unit
      }));
      setItems(orderItems);
      setSearchTerms(orderItems.map(i => i.item_name));
    } else {
      setItems([{ item_name: '', item_id: null, quantity: '', unit_price: '', unit: 'Piece' }]);
      setSearchTerms(['']);
    }

    setShowForm(true);
  }

  async function handleSave() {
    const validItems = items.filter(item =>
      item.item_name.trim() &&
      parseFloat(item.quantity) > 0 &&
      parseFloat(item.unit_price) >= 0
    );

    const finalCustomerName = customerName.trim() || customerSearch.trim();
    if (!finalCustomerName) return;
    if (validItems.length === 0) {
      alert('Please enter at least one item with a quantity above 0 and a price.');
      return;
    }
    const skipped = items.filter(item => item.item_name.trim() && !validItems.includes(item));
    if (skipped.length > 0 && !confirm(`${skipped.length} item line(s) have no quantity or price and will NOT be saved:\n${skipped.map(i => i.item_name.trim()).join('\n')}\n\nSave anyway?`)) return;

    if (savingRef.current) return; // stop a double-click creating two orders
    savingRef.current = true;
    setSaving(true);

    const totalAmount = Math.round(validItems.reduce((sum, item) => {
      return sum + (parseFloat(item.quantity) * parseFloat(item.unit_price));
    }, 0) * 100) / 100;
    const goingDouble = formDealType === 'double' && !(editingOrder && editingOrder.deal_type === 'double');

    if (editingOrder) {
      const { error: updateError } = await supabase
        .from('busy_sales_orders')
        .update({
          customer_id: selectedCustomer || null,
          customer_name: finalCustomerName,
          order_date: orderDate,
          notes: notes.trim() || null,
          total_amount: totalAmount,
          deal_type: formDealType,
          ...(formDealType === 'single' ? { linked_invoice_id: null } : {}),
          updated_at: new Date().toISOString()
        })
        .eq('id', editingOrder.id);

      if (updateError) {
        console.error('Error updating order:', updateError);
        alert('Could not save the sales order: ' + updateError.message);
        savingRef.current = false;
        setSaving(false);
        return;
      }

      const itemsToInsert = validItems.map(item => ({
        sales_order_id: editingOrder.id,
        item_id: item.item_id,
        item_name: item.item_name.trim(),
        quantity: parseFloat(item.quantity),
        unit: item.unit,
        unit_price: parseFloat(item.unit_price),
        total: Math.round(parseFloat(item.quantity) * parseFloat(item.unit_price) * 100) / 100
      }));

      const linesErr = await replaceLines('busy_sales_order_items', 'sales_order_id', editingOrder.id, itemsToInsert);
      if (linesErr) {
        alert('The sales order header was saved, but its item lines could not be saved: ' + linesErr);
        savingRef.current = false;
        setSaving(false);
        return;
      }
      const editedId = editingOrder.id;
      savingRef.current = false;
      setSaving(false);
      resetForm();
      await loadData();
      if (goingDouble) openDoubleModal(editedId);
      return;
    } else {
      const orderNumber = await generateOrderNumber();

      const { data: order, error: orderError } = await supabase
        .from('busy_sales_orders')
        .insert({
          order_number: orderNumber,
          customer_id: selectedCustomer || null,
          customer_name: finalCustomerName,
          order_date: orderDate,
          notes: notes.trim() || null,
          status: 'pending',
          total_amount: totalAmount,
          deal_type: formDealType
        })
        .select()
        .single();

      if (orderError || !order) {
        console.error('Error creating order:', orderError);
        alert('Could not create the sales order: ' + (orderError?.message || 'unknown error'));
        savingRef.current = false;
        setSaving(false);
        return;
      }

      const itemsToInsert = validItems.map(item => ({
        sales_order_id: order.id,
        item_id: item.item_id,
        item_name: item.item_name.trim(),
        quantity: parseFloat(item.quantity),
        unit: item.unit,
        unit_price: parseFloat(item.unit_price),
        total: Math.round(parseFloat(item.quantity) * parseFloat(item.unit_price) * 100) / 100
      }));

      const { error: itemsErr } = await supabase.from('busy_sales_order_items').insert(itemsToInsert);
      if (itemsErr) {
        // Do not leave an order with no lines: remove the empty header, keep the form so nothing typed is lost
        const { error: undoErr } = await supabase.from('busy_sales_orders').delete().eq('id', order.id);
        alert('Could not save the order items: ' + itemsErr.message +
          (undoErr ? `\n\nOrder ${orderNumber} was created without items; please open it and add the items again.` : '\n\nThe order was not created. Your entries are still in the form.'));
        savingRef.current = false;
        setSaving(false);
        if (undoErr) { resetForm(); loadData(); }
        return;
      }

      savingRef.current = false;
      setSaving(false);
      resetForm();
      await loadData();
      if (formDealType === 'double') {
        openDoubleModal(order.id);
      }
      return;
    }

  }

  async function handleDeleteOrder(id: string) {
    const madeInvoice = invoices.find(inv => inv.sales_order_id === id);
    if (madeInvoice) {
      alert(`Invoice ${madeInvoice.invoice_number} was made from this sales order. Delete that invoice first, then the order.`);
      return;
    }
    if (!confirm('Are you sure you want to delete this sales order? It will be moved to the Recycle Bin.')) return;

    const orderToDelete = orders.find(o => o.id === id);
    if (!orderToDelete) return;

    const { data: orderItems } = await supabase
      .from('busy_sales_order_items')
      .select('*')
      .eq('sales_order_id', id);

    const { data: soLinks } = await supabase
      .from('so_po_links')
      .select('*')
      .eq('sales_order_id', id);

    const result = await moveToRecycleBin({
      source_table: 'busy_sales_orders',
      source_id: id,
      record_data: orderToDelete,
      related_data: {
        busy_sales_order_items: orderItems || [],
        so_po_links: soLinks || [],
      },
      display_name: `SO ${orderToDelete.order_number} - ${orderToDelete.customer_name}`,
      portal: 'sl',
    });

    if (!result.success) {
      alert('Failed to move to recycle bin: ' + result.error);
      return;
    }

    // Put removed child rows back if a later step fails, so nothing is lost
    async function putBack(what: string): Promise<string> {
      const problems: string[] = [];
      if (soLinks && soLinks.length > 0) {
        const { error: e } = await supabase.from('so_po_links').insert(soLinks);
        if (e) problems.push('PO links: ' + e.message);
      }
      if (what === 'all' && orderItems && orderItems.length > 0) {
        const { error: e } = await supabase.from('busy_sales_order_items').insert(orderItems);
        if (e) problems.push('item lines: ' + e.message);
      }
      return problems.length
        ? '\n\nSome removed rows could not be put back (' + problems.join('; ') + '). They are saved in the Recycle Bin entry.'
        : '\n\nThe order and its lines were kept.';
    }

    const { error: linksErr } = await supabase.from('so_po_links').delete().eq('sales_order_id', id);
    if (linksErr) {
      alert('Could not delete sales order (its PO links could not be removed): ' + linksErr.message);
      return;
    }
    const { error: itemsErr } = await supabase.from('busy_sales_order_items').delete().eq('sales_order_id', id);
    if (itemsErr) {
      alert('Could not delete sales order (its item lines could not be removed): ' + itemsErr.message + await putBack('links'));
      loadData();
      return;
    }

    const { error } = await supabase.from('busy_sales_orders').delete().eq('id', id);
    if (error) {
      console.error('Error deleting order:', error);
      alert('Could not delete sales order: ' + error.message + await putBack('all'));
      loadData();
    } else {
      loadData();
    }
  }

  async function handleConfirmOrder(id: string) {
    const { error } = await supabase
      .from('busy_sales_orders')
      .update({ status: 'confirmed', updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      console.error('Error confirming order:', error);
      alert('Could not confirm the order: ' + error.message);
    } else {
      loadData();
    }
  }

  function toggleOrderExpand(id: string) {
    const newExpanded = new Set(expandedOrders);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedOrders(newExpanded);
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'confirmed': return 'bg-green-100 text-green-800';
      case 'invoiced': return 'bg-teal-100 text-teal-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-amber-100 text-amber-800';
    }
  }

  function getInvoiceStatusBadge(status: string) {
    switch (status) {
      case 'paid': return 'bg-green-100 text-green-700';
      case 'partial': return 'bg-teal-100 text-teal-700';
      case 'overdue': return 'bg-red-100 text-red-700';
      case 'sent': return 'bg-amber-100 text-amber-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  }

  function openDoubleModal(orderId: string) {
    setDoubleModalOrderId(orderId);
    setInvoiceSearch('');
  }

  function closeDoubleModal() {
    setDoubleModalOrderId(null);
    setInvoiceSearch('');
  }

  async function handleLinkInvoice(invoiceId: string) {
    if (!doubleModalOrderId) return;
    setLinkingSaving(true);

    const { error } = await supabase
      .from('busy_sales_orders')
      .update({
        deal_type: 'double',
        linked_invoice_id: invoiceId,
        updated_at: new Date().toISOString()
      })
      .eq('id', doubleModalOrderId);

    if (error) {
      console.error('Error linking invoice:', error);
      alert('Could not link the invoice: ' + error.message);
    } else {
      closeDoubleModal();
      loadData();
    }

    setLinkingSaving(false);
  }

  async function handleUnlinkInvoice(orderId: string) {
    const { error } = await supabase
      .from('busy_sales_orders')
      .update({
        deal_type: 'single',
        linked_invoice_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (error) {
      console.error('Error unlinking invoice:', error);
      alert('Could not unlink the invoice: ' + error.message);
    } else {
      loadData();
    }
  }

  const filteredInvoices = invoices.filter(inv => {
    if (!invoiceSearch.trim()) return true;
    const term = invoiceSearch.toLowerCase();
    return (
      (inv.invoice_number || '').toLowerCase().includes(term) ||
      (inv.customer_name || '').toLowerCase().includes(term)
    );
  });

  const doubleModalOrder = doubleModalOrderId ? orders.find(o => o.id === doubleModalOrderId) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-teal-600"></div>
      </div>
    );
  }

  return (
    <>
    <div className="space-y-6">
      {/* Double Deal — Invoice Picker Modal */}
      {doubleModalOrderId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <div>
                <div className="flex items-center space-x-2">
                  <Link className="w-5 h-5 text-teal-600" />
                  <h3 className="text-lg font-semibold text-gray-900">Link to Sales Invoice</h3>
                </div>
                {doubleModalOrder && (
                  <p className="text-sm text-gray-500 mt-0.5">
                    {doubleModalOrder.order_number} — {doubleModalOrder.customer_name}
                  </p>
                )}
              </div>
              <button onClick={closeDoubleModal} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5">
              {/* Search */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={invoiceSearch}
                  onChange={e => setInvoiceSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm"
                  placeholder="Search by invoice number or customer..."
                  autoFocus
                />
              </div>

              {/* Invoice list */}
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {filteredInvoices.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-8">No invoices found.</p>
                )}
                {filteredInvoices.map(inv => (
                  <button
                    key={inv.id}
                    onClick={() => handleLinkInvoice(inv.id)}
                    disabled={linkingSaving}
                    className="w-full flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-teal-400 hover:bg-teal-50 transition-all text-left group"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-lg bg-teal-100 flex items-center justify-center group-hover:bg-teal-200 transition-colors">
                        <FileText className="w-4 h-4 text-teal-600" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{inv.invoice_number}</p>
                        <p className="text-xs text-gray-500">{inv.customer_name} · {showDate(inv.invoice_date)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-800">LKR {Number(inv.total_amount || 0).toLocaleString()}</p>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getInvoiceStatusBadge(inv.status)}`}>
                        {inv.status}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Sales Orders</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-600 rounded-lg hover:from-teal-600 hover:to-cyan-700 transition-all shadow-lg print:hidden"
          >
            <Plus className="w-4 h-4" />
            <span>New Order</span>
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              {editingOrder ? 'Edit Sales Order' : 'New Sales Order'}
            </h3>
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setFormDealType('single')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  formDealType === 'single'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Single
              </button>
              <button
                type="button"
                onClick={() => setFormDealType('double')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  formDealType === 'double'
                    ? 'bg-teal-600 text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Double
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="relative" ref={customerDropdownRef}>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer *</label>
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => {
                  setCustomerSearch(e.target.value);
                  setCustomerName(e.target.value);
                  setSelectedCustomer('');
                  setShowCustomerDropdown(true);
                }}
                onFocus={() => setShowCustomerDropdown(true)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Search or enter customer name..."
              />
              {showCustomerDropdown && getFilteredCustomers().length > 0 && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {getFilteredCustomers().map((customer) => (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => selectCustomer(customer)}
                      className="w-full px-3 py-2 text-left hover:bg-teal-50 flex items-center justify-between text-sm border-b border-gray-100 last:border-b-0"
                    >
                      <span className="font-medium text-gray-900">{customer.name}</span>
                      {customer.phone && <span className="text-xs text-gray-500">{customer.phone}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Order Date</label>
              <input
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Optional notes"
              />
            </div>
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Order Items</label>
              <button onClick={addItem} className="text-sm text-teal-600 hover:text-teal-700 font-medium">
                + Add Item
              </button>
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 uppercase px-1 [&>*]:min-w-0">
                <div className="col-span-4">Item Name</div>
                <div className="col-span-1">Unit</div>
                <div className="col-span-2">Quantity</div>
                <div className="col-span-2">LKR Unit Price</div>
                <div className="col-span-2 text-right">Total</div>
                <div className="col-span-1"></div>
              </div>

              {items.map((item, index) => {
                const qty = parseFloat(item.quantity) || 0;
                const price = parseFloat(item.unit_price) || 0;
                const lineTotal = qty * price;
                const filteredItems = getFilteredItems(searchTerms[index] || '');
                return (
                  <div key={index} className="grid grid-cols-12 gap-2 [&>*]:min-w-0">
                    <div
                      className="col-span-4 relative"
                      ref={el => { dropdownRefs.current[index] = el; }}
                    >
                      <input
                        type="text"
                        value={searchTerms[index] || ''}
                        onChange={(e) => handleItemSearch(index, e.target.value)}
                        onFocus={() => setActiveDropdown(index)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm"
                        placeholder="Search item..."
                      />
                      {activeDropdown === index && filteredItems.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {filteredItems.map((itemRecord) => (
                            <button
                              key={itemRecord.id}
                              type="button"
                              onClick={() => selectItem(index, itemRecord)}
                              className="w-full px-3 py-2 text-left hover:bg-teal-50 flex items-center justify-between text-sm border-b border-gray-100 last:border-b-0"
                            >
                              <span className="font-medium text-gray-900">{itemRecord.item_name}</span>
                              <span className="text-xs text-gray-500">
                                {itemRecord.sku && <span className="mr-2">{itemRecord.sku}</span>}
                                <span className="text-teal-600">{itemRecord.unit}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <select
                      value={item.unit}
                      onChange={(e) => updateItem(index, 'unit', e.target.value)}
                      className="col-span-1 w-full px-1 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-xs"
                    >
                      <option value="Piece">Piece</option>
                      <option value="Box">Box</option>
                      <option value="CTN">CTN</option>
                      <option value="Set">Set</option>
                      <option value="Kg">Kg</option>
                      <option value="Meter">Meter</option>
                    </select>
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                      className="col-span-2 w-full px-1 sm:px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm"
                      placeholder="Qty"
                      min="0"
                    />
                    <input
                      type="number"
                      value={item.unit_price}
                      onChange={(e) => updateItem(index, 'unit_price', e.target.value)}
                      className="col-span-2 w-full px-1 sm:px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm"
                      placeholder="Price"
                      min="0"
                      step="0.01"
                    />
                    <div className="col-span-2 flex items-center justify-end px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium text-gray-700">
                      {lineTotal > 0 ? `LKR ${lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                    </div>
                    <button
                      onClick={() => removeItem(index)}
                      className="col-span-1 flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors"
                      disabled={items.length === 1}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end mt-3 pt-3 border-t border-gray-200">
              <div className="text-right">
                <span className="text-sm text-gray-500 mr-3">Total:</span>
                <span className="text-lg font-bold text-gray-900">
                  LKR {items.reduce((sum, item) => {
                    const qty = parseFloat(item.quantity) || 0;
                    const price = parseFloat(item.unit_price) || 0;
                    return sum + (qty * price);
                  }, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              onClick={resetForm}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <X className="w-4 h-4 inline mr-1" />
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!(customerName.trim() || customerSearch.trim()) || items.every(i => !i.item_name.trim()) || saving}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="w-4 h-4 inline mr-1" />
              {saving ? 'Saving...' : (editingOrder ? 'Update Order' : 'Create Order')}
            </button>
          </div>
        </div>
      )}

      {orders.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <ShoppingCart className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No sales orders yet. Create your first order to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const isExpanded = expandedOrders.has(order.id);
            const isDouble = order.deal_type === 'double';
            const linkedInvoice = isDouble && order.linked_invoice_id
              ? invoices.find(inv => inv.id === order.linked_invoice_id)
              : null;

            return (
              <div key={order.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div
                  className="flex flex-wrap items-center justify-between gap-2 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => toggleOrderExpand(order.id)}
                >
                  <div className="flex items-center space-x-4 min-w-0">
                    <div className="flex items-center space-x-2">
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      )}
                      <ShoppingCart className="w-5 h-5 text-teal-500" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <p className="font-medium text-gray-900 break-words">
                          {order.order_number} - {order.customer_name}
                        </p>
                        {isDouble && (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-800">
                            <Link className="w-3 h-3" />
                            <span>Double</span>
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">
                        {showDate(order.order_date)} - {order.busy_sales_order_items?.length || 0} items
                        {linkedInvoice && (
                          <span className="ml-2 text-teal-600">
                            · Linked: {linkedInvoice.invoice_number}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 ml-auto">
                    <div className="text-right">
                      <p className="font-semibold text-gray-900">
                        LKR {Number(order.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      <div className="flex items-center justify-end space-x-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(order.status)}`}>
                          {order.status}
                        </span>
                        {order.so_po_links && order.so_po_links.length > 0 && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            <Package className="w-3 h-3 mr-0.5" />
                            {order.so_po_links.length} PO
                          </span>
                        )}
                      </div>
                    </div>

                    {order.status === 'pending' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleConfirmOrder(order.id); }}
                        className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-100 rounded-lg hover:bg-green-200 transition-colors"
                        title="Confirm Order"
                      >
                        Confirm
                      </button>
                    )}
                    {(order.status === 'pending' || order.status === 'confirmed') && onCreateInvoice && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const made = invoices.find(inv => inv.sales_order_id === order.id);
                          if (made && !confirm(`Invoice ${made.invoice_number} was already made from this sales order.\n\nMake another invoice from it?`)) return;
                          onCreateInvoice(order.id);
                        }}
                        className="p-2 text-gray-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                        title="Create Invoice"
                      >
                        <FileText className="w-4 h-4" />
                      </button>
                    )}
                    {(order.status === 'pending' || order.status === 'confirmed') && onCopyToPO && order.busy_sales_order_items && order.busy_sales_order_items.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const poItems = order.busy_sales_order_items!.map(item => ({
                            item_name: item.item_name,
                            quantity: item.quantity,
                            unit: item.unit
                          }));
                          onCopyToPO(order.id, poItems);
                        }}
                        className="p-2 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                        title="Copy to Purchase Order"
                      >
                        <Package className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleEdit(order); }}
                      className="p-2 text-gray-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                      title="Edit Order"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    {order.status !== 'invoiced' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteOrder(order.id); }}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete Order"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); setPrintOrderId(order.id); }}
                      className="p-2 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                      title="Print Sales Order"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50 p-4">
                    {/* Single / Double toggle inside expanded section */}
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Deal Type</span>
                      <div className="flex items-center bg-gray-200 rounded-lg p-0.5">
                        <button
                          onClick={() => { if (isDouble) handleUnlinkInvoice(order.id); }}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                            !isDouble
                              ? 'bg-white text-gray-900 shadow-sm'
                              : 'text-gray-500 hover:text-gray-700'
                          }`}
                        >
                          Single
                        </button>
                        <button
                          onClick={() => { if (!isDouble) openDoubleModal(order.id); }}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                            isDouble
                              ? 'bg-teal-600 text-white shadow-sm'
                              : 'text-gray-500 hover:text-gray-700'
                          }`}
                        >
                          Double
                        </button>
                      </div>
                    </div>

                    {/* Linked Invoice panel */}
                    {isDouble && linkedInvoice && (
                      <div className="mb-4 p-3 bg-teal-50 border border-teal-200 rounded-lg flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="w-7 h-7 bg-teal-100 rounded-lg flex items-center justify-center">
                            <Link className="w-3.5 h-3.5 text-teal-600" />
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-teal-800">Linked Invoice</p>
                            <p className="text-sm font-medium text-teal-900">
                              {linkedInvoice.invoice_number} — {linkedInvoice.customer_name}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-teal-900">LKR {Number(linkedInvoice.total_amount || 0).toLocaleString()}</p>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getInvoiceStatusBadge(linkedInvoice.status)}`}>
                            {linkedInvoice.status}
                          </span>
                        </div>
                      </div>
                    )}

                    {order.so_po_links && order.so_po_links.length > 0 && (
                      <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <p className="text-xs font-medium text-green-800 mb-2 flex items-center">
                          <Package className="w-3 h-3 mr-1" />
                          Linked Purchase Orders
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {order.so_po_links.map(link => link.purchase_orders && (
                            <span
                              key={link.id}
                              className="inline-flex items-center px-2 py-1 bg-white border border-green-300 rounded text-xs"
                            >
                              <span className="font-medium text-green-900">
                                {link.purchase_orders.suppliers?.name || 'Unknown'}
                              </span>
                              <span className="ml-1 text-green-600">
                                ({showDate(link.purchase_orders.order_date)})
                              </span>
                              <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                link.purchase_orders.status === 'completed' ? 'bg-green-200 text-green-800' :
                                link.purchase_orders.status === 'shipped' ? 'bg-blue-200 text-teal-800' :
                                'bg-amber-200 text-amber-800'
                              }`}>
                                {link.purchase_orders.status}
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {order.busy_sales_order_items && order.busy_sales_order_items.length > 0 && (
                      <div className="overflow-x-auto">
                      <table className="w-full min-w-[480px]">
                        <thead>
                          <tr className="text-xs text-gray-500 uppercase">
                            <th className="text-left pb-2">Item</th>
                            <th className="text-left pb-2">Unit</th>
                            <th className="text-right pb-2">Qty</th>
                            <th className="text-right pb-2">Unit Price (LKR)</th>
                            <th className="text-right pb-2">Total (LKR)</th>
                            {onCopyToPO && <th className="text-center pb-2 w-10"></th>}
                          </tr>
                        </thead>
                        <tbody className="text-sm">
                          {order.busy_sales_order_items.map((item) => (
                            <tr key={item.id} className="border-t border-gray-200">
                              <td className="py-2 text-gray-900">{item.item_name}</td>
                              <td className="py-2 text-gray-600">{item.unit}</td>
                              <td className="py-2 text-right text-gray-600">{item.quantity}</td>
                              <td className="py-2 text-right text-gray-600">
                                {Number(item.unit_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="py-2 text-right font-medium text-gray-900">
                                {Number(item.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              {onCopyToPO && (
                                <td className="py-2 text-center">
                                  <button
                                    onClick={() => onCopyToPO(order.id, [{
                                      item_name: item.item_name,
                                      quantity: item.quantity,
                                      unit: item.unit
                                    }])}
                                    className="p-1.5 text-orange-500 hover:text-orange-700 hover:bg-orange-100 rounded transition-colors border border-orange-200"
                                    title="Copy to Purchase Order"
                                  >
                                    <Package className="w-4 h-4" />
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    )}
                    {order.notes && (
                      <p className="mt-3 text-sm text-gray-500 italic">Notes: {order.notes}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
    {printOrderId && (
      <SalesOrderPrint orderId={printOrderId} onClose={() => setPrintOrderId(null)} />
    )}
    </>
  );
}
