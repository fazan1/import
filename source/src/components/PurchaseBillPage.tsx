import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Save, Trash2, Receipt, Calendar, Package, Plus, CreditCard, X, Printer } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { moveToRecycleBin } from '../lib/recycleBin';
import PurchaseBillPrint from './PurchaseBillPrint';

interface Supplier {
  id: string;
  name: string;
  currency: string;
}

interface PurchaseOrderItem {
  id: string;
  item_name: string;
  quantity: number;
  unit_price_cny: number;
}

interface PurchaseOrder {
  id: string;
  supplier_id: string | null;
  order_date: string;
  status: string;
  notes: string | null;
  suppliers?: Supplier;
  purchase_order_items?: PurchaseOrderItem[];
}

interface BillItem {
  id?: string;
  purchase_order_item_id: string | null;
  item_name: string;
  quantity_received: string;
  unit_price_cny: string;
}

interface PurchaseBill {
  id: string;
  purchase_order_id: string;
  bill_number: string | null;
  cnv_invoice_number: string | null;
  batch_number: string | null;
  bill_date: string;
  due_date: string | null;
  status: string;
  exchange_rate: number;
  shipping_cost: number;
  customs_duty: number;
  other_charges: number;
  amount_paid: number;
  notes: string | null;
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

interface ItemRecord {
  id: string;
  item_name: string;
  sku: string | null;
  unit: string;
  purchase_price: number;
}

interface Props {
  purchaseOrderId: string;
  onBack: () => void;
}

export default function PurchaseBillPage({ purchaseOrderId, onBack }: Props) {
  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [existingBill, setExistingBill] = useState<PurchaseBill | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [billNumber, setBillNumber] = useState('');
  const [cnvInvoiceNumber, setCnvInvoiceNumber] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [exchangeRate, setExchangeRate] = useState('1');
  const [notes, setNotes] = useState('');
  const [billItems, setBillItems] = useState<BillItem[]>([]);

  const [payments, setPayments] = useState<Payment[]>([]);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [newPayment, setNewPayment] = useState({
    voucher_number: '',
    payment_date: new Date().toISOString().split('T')[0],
    payment_mode: 'CASH',
    amount: '',
    account_name: '',
    narration: '',
    rate_lkr: '',
    funded_by: 'investor'
  });
  const [savingPayment, setSavingPayment] = useState(false);

  const [allItems, setAllItems] = useState<ItemRecord[]>([]);
  const [searchTerms, setSearchTerms] = useState<string[]>([]);
  const [activeDropdown, setActiveDropdown] = useState<number | null>(null);
  const dropdownRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [showPrint, setShowPrint] = useState(false);

  useEffect(() => {
    loadData();
    loadAllItems();
  }, [purchaseOrderId]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (activeDropdown !== null) {
        const ref = dropdownRefs.current[activeDropdown];
        if (ref && !ref.contains(event.target as Node)) {
          setActiveDropdown(null);
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeDropdown]);

  async function loadAllItems() {
    const { data } = await supabase
      .from('items')
      .select('id, item_name, sku, unit, purchase_price')
      .order('item_name');
    if (data) setAllItems(data);
  }

  async function loadData() {
    setLoading(true);

    const { data: poData } = await supabase
      .from('purchase_orders')
      .select(`
        *,
        suppliers (id, name, currency),
        purchase_order_items (*)
      `)
      .eq('id', purchaseOrderId)
      .maybeSingle();

    if (poData) {
      setPurchaseOrder(poData);

      const { data: billData } = await supabase
        .from('purchase_bills')
        .select('*')
        .eq('purchase_order_id', purchaseOrderId)
        .maybeSingle();

      if (billData) {
        setExistingBill(billData);
        setBillNumber(billData.bill_number || '');
        setCnvInvoiceNumber(billData.cnv_invoice_number || '');
        setBatchNumber(billData.batch_number || '');
        setBillDate(billData.bill_date);
        setDueDate(billData.due_date || '');
        setExchangeRate(String(billData.exchange_rate || 1));
        setNotes(billData.notes || '');

        const [billItemsRes, paymentsRes] = await Promise.all([
          supabase
            .from('purchase_bill_items')
            .select('*')
            .eq('purchase_bill_id', billData.id),
          supabase
            .from('purchase_payments')
            .select('*')
            .eq('purchase_bill_id', billData.id)
            .order('payment_date', { ascending: false })
        ]);

        if (billItemsRes.data && billItemsRes.data.length > 0) {
          const loadedItems = billItemsRes.data.map(item => ({
            id: item.id,
            purchase_order_item_id: item.purchase_order_item_id,
            item_name: item.item_name,
            quantity_received: String(item.quantity_received),
            unit_price_cny: String(item.unit_price_cny)
          }));
          setBillItems(loadedItems);
          setSearchTerms(loadedItems.map(item => item.item_name));
        } else {
          initializeBillItemsFromPO(poData.purchase_order_items || []);
        }

        if (paymentsRes.data) {
          setPayments(paymentsRes.data);
        }
      } else {
        initializeBillItemsFromPO(poData.purchase_order_items || []);
      }
    }

    setLoading(false);
  }

  function initializeBillItemsFromPO(poItems: PurchaseOrderItem[]) {
    const initialItems = poItems.map(item => ({
      purchase_order_item_id: item.id,
      item_name: item.item_name,
      quantity_received: String(item.quantity),
      unit_price_cny: String(item.unit_price_cny)
    }));
    setBillItems(initialItems);
    setSearchTerms(initialItems.map(item => item.item_name));
  }

  function addItem() {
    setBillItems([...billItems, {
      purchase_order_item_id: null,
      item_name: '',
      quantity_received: '',
      unit_price_cny: ''
    }]);
    setSearchTerms([...searchTerms, '']);
  }

  function removeItem(index: number) {
    if (billItems.length > 1) {
      setBillItems(billItems.filter((_, i) => i !== index));
      setSearchTerms(searchTerms.filter((_, i) => i !== index));
    }
  }

  function updateItem(index: number, field: keyof BillItem, value: string) {
    const updated = [...billItems];
    if (field === 'item_name') updated[index].item_name = value;
    else if (field === 'quantity_received') updated[index].quantity_received = value;
    else if (field === 'unit_price_cny') updated[index].unit_price_cny = value;
    setBillItems(updated);
  }

  function getFilteredItems(searchTerm: string): ItemRecord[] {
    if (!searchTerm.trim()) return allItems.slice(0, 10);
    const term = searchTerm.toLowerCase();
    return allItems.filter(item =>
      item.item_name.toLowerCase().includes(term) ||
      (item.sku?.toLowerCase() || '').includes(term)
    ).slice(0, 10);
  }

  function selectItem(index: number, item: ItemRecord) {
    const updated = [...billItems];
    updated[index] = {
      ...updated[index],
      item_name: item.item_name,
      unit_price_cny: String(item.purchase_price || '')
    };
    setBillItems(updated);
    const newSearchTerms = [...searchTerms];
    newSearchTerms[index] = item.item_name;
    setSearchTerms(newSearchTerms);
    setActiveDropdown(null);
  }

  function handleItemSearch(index: number, value: string) {
    const newSearchTerms = [...searchTerms];
    newSearchTerms[index] = value;
    setSearchTerms(newSearchTerms);
    const updated = [...billItems];
    updated[index].item_name = value;
    setBillItems(updated);
    setActiveDropdown(index);
  }

  function calculateSubtotalCNY(): number {
    return billItems.reduce((sum, item) => {
      const qty = parseFloat(item.quantity_received) || 0;
      const price = parseFloat(item.unit_price_cny) || 0;
      return sum + (qty * price);
    }, 0);
  }

  function calculateTotalCNY(): number {
    return calculateSubtotalCNY();
  }

  function calculateTotalPaid(): number {
    return payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  }

  function calculateBalance(): number {
    return calculateTotalCNY() - calculateTotalPaid();
  }

  function getStatus(): string {
    const total = calculateTotalCNY();
    const paid = calculateTotalPaid();
    if (paid >= total && total > 0) return 'paid';
    if (paid > 0) return 'partial';
    return 'pending';
  }

  async function handleSave() {
    const validItems = billItems.filter(item =>
      item.item_name.trim() &&
      parseFloat(item.quantity_received) > 0
    );

    if (validItems.length === 0) return;

    setSaving(true);

    const billPayload = {
      purchase_order_id: purchaseOrderId,
      bill_number: billNumber.trim() || null,
      cnv_invoice_number: cnvInvoiceNumber.trim() || null,
      batch_number: batchNumber.trim() || null,
      bill_date: billDate,
      due_date: dueDate || (billDate ? new Date(new Date(billDate).getTime() + 30 * 86400000).toISOString().slice(0, 10) : null),
      status: getStatus(),
      exchange_rate: parseFloat(exchangeRate) || 1,
      shipping_cost: 0,
      customs_duty: 0,
      other_charges: 0,
      amount_paid: calculateTotalPaid(),
      notes: notes.trim() || null
    };

    let billId: string;

    if (existingBill) {
      const { error } = await supabase
        .from('purchase_bills')
        .update(billPayload)
        .eq('id', existingBill.id);

      if (error) {
        console.error('Error updating bill:', error);
        setSaving(false);
        return;
      }
      billId = existingBill.id;

      const { error: deleteError } = await supabase
        .from('purchase_bill_items')
        .delete()
        .eq('purchase_bill_id', billId);

      if (deleteError) {
        console.error('Error deleting old bill items:', deleteError);
        setSaving(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from('purchase_bills')
        .insert(billPayload)
        .select()
        .single();

      if (error || !data) {
        console.error('Error creating bill:', error);
        setSaving(false);
        return;
      }
      billId = data.id;
    }

    const itemsToInsert = validItems.map(item => ({
      purchase_bill_id: billId,
      purchase_order_item_id: item.purchase_order_item_id,
      item_name: item.item_name.trim(),
      quantity_received: parseFloat(item.quantity_received),
      unit_price_cny: parseFloat(item.unit_price_cny) || 0
    }));

    const { data: insertedItems, error: itemsError } = await supabase
      .from('purchase_bill_items')
      .insert(itemsToInsert)
      .select();

    if (itemsError) {
      console.error('Error saving bill items:', itemsError);
    }

    // Re-link packing list items that were generated from this bill
    if (existingBill && insertedItems && insertedItems.length > 0) {
      // Find all pl_input records pointing to this bill
      const { data: plInputs } = await supabase
        .from('pl_input')
        .select('id')
        .eq('purchase_bill_id', existingBill.id);

      if (plInputs && plInputs.length > 0) {
        const plInputIds = plInputs.map((p: { id: string }) => p.id);

        for (const newItem of insertedItems) {
          await supabase
            .from('packing_list_items')
            .update({
              purchase_bill_item_id: newItem.id,
              quantity: newItem.quantity_received,
              item_name: newItem.item_name,
              batch_number: batchNumber.trim() || '',
            })
            .in('pl_input_id', plInputIds)
            .eq('item_name', newItem.item_name);
        }
      }
    }

    for (const item of validItems) {
      const newPrice = parseFloat(item.unit_price_cny) || 0;
      if (newPrice > 0) {
        await supabase
          .from('items')
          .update({
            purchase_price: newPrice,
            updated_at: new Date().toISOString()
          })
          .eq('item_name', item.item_name.trim());
      }
    }

    await supabase
      .from('purchase_orders')
      .update({ status: getStatus() === 'paid' ? 'completed' : 'billed' })
      .eq('id', purchaseOrderId);

    setSaving(false);
    onBack();
  }

  async function handleAddPayment() {
    if (!existingBill || !newPayment.amount || parseFloat(newPayment.amount) <= 0) return;

    setSavingPayment(true);

    const { data, error } = await supabase
      .from('purchase_payments')
      .insert({
        purchase_bill_id: existingBill.id,
        voucher_number: newPayment.voucher_number.trim() || null,
        payment_date: newPayment.payment_date,
        payment_mode: newPayment.payment_mode,
        amount: parseFloat(newPayment.amount),
        account_name: newPayment.account_name.trim() || purchaseOrder?.suppliers?.name || null,
        narration: newPayment.narration.trim() || null,
        rate_lkr: parseFloat(newPayment.rate_lkr) || parseFloat(exchangeRate) || null,
        funded_by: newPayment.funded_by
      })
      .select()
      .single();

    if (error) {
      alert('Payment was NOT saved: ' + error.message);
    } else if (data) {
      setPayments([data, ...payments]);
      setShowPaymentForm(false);
      setNewPayment({
        voucher_number: '',
        payment_date: new Date().toISOString().split('T')[0],
        payment_mode: 'CASH',
        amount: '',
        account_name: '',
        narration: '',
        rate_lkr: '',
        funded_by: 'investor'
      });

      const newTotalPaid = payments.reduce((sum, p) => sum + p.amount, 0) + data.amount;
      const total = calculateTotalCNY();
      const newStatus = newTotalPaid >= total ? 'paid' : newTotalPaid > 0 ? 'partial' : 'pending';

      await supabase
        .from('purchase_bills')
        .update({ amount_paid: newTotalPaid, status: newStatus })
        .eq('id', existingBill.id);

      await supabase
        .from('purchase_orders')
        .update({ status: newStatus === 'paid' ? 'completed' : 'billed' })
        .eq('id', purchaseOrderId);
    }

    setSavingPayment(false);
  }

  async function handleDeleteBill() {
    if (!existingBill) return;
    if (!confirm(`Delete this bill? All bill items and payments will be removed. This cannot be undone.`)) return;

    await supabase.from('purchase_payments').delete().eq('purchase_bill_id', existingBill.id);
    await supabase.from('purchase_bill_items').delete().eq('purchase_bill_id', existingBill.id);
    await supabase.from('purchase_bills').delete().eq('id', existingBill.id);

    onBack();
  }

  async function handleDeletePayment(paymentId: string) {
    const pay = payments.find(p => p.id === paymentId);
    if (!pay) return;
    if (!confirm(`Delete this payment of ${pay.amount}? It goes to the Recycle Bin and can be restored.`)) return;

    await moveToRecycleBin({
      source_table: 'purchase_payments',
      source_id: paymentId,
      record_data: pay,
      display_name: `Payment ${pay.amount} on ${existingBill?.cnv_invoice_number || existingBill?.bill_number || 'bill'} (${pay.payment_date})`,
      portal: 'cn',
    });

    const { error } = await supabase
      .from('purchase_payments')
      .delete()
      .eq('id', paymentId);

    if (error) {
      alert('Could not delete payment: ' + error.message);
      return;
    }
    const updated = payments.filter(p => p.id !== paymentId);
    setPayments(updated);

    if (existingBill) {
      const newTotalPaid = updated.reduce((sum, p) => sum + p.amount, 0);
      const total = calculateTotalCNY();
      const newStatus = newTotalPaid >= total && total > 0 ? 'paid' : newTotalPaid > 0 ? 'partial' : 'pending';

      await supabase
        .from('purchase_bills')
        .update({ amount_paid: newTotalPaid, status: newStatus })
        .eq('id', existingBill.id);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-teal-600"></div>
      </div>
    );
  }

  if (!purchaseOrder) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Purchase order not found.</p>
        <button onClick={onBack} className="mt-4 text-teal-600 hover:text-teal-700">
          Go back
        </button>
      </div>
    );
  }

  const totalCNY = calculateTotalCNY();
  const rate = parseFloat(exchangeRate) || 1;
  const totalLKR = totalCNY * rate;
  const totalPaid = calculateTotalPaid();
  const balance = calculateBalance();
  const paymentModes = ['CASH', 'Ali Pay', 'WeChat Pay', 'Bank Transfer', 'Credit Card', 'Other'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={onBack}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {existingBill ? 'Edit Purchase Bill' : 'Create Purchase Bill'}
            </h2>
            <p className="text-sm text-gray-500">
              PO from {purchaseOrder.suppliers?.name || 'Unknown'} - {new Date(purchaseOrder.order_date).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {existingBill && (
            <>
              <button
                onClick={() => setShowPrint(true)}
                className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Printer className="w-4 h-4" />
                <span>Print</span>
              </button>
              <button
                onClick={handleDeleteBill}
                className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 border border-red-500 rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete</span>
              </button>
            </>
          )}
          <button
            onClick={handleSave}
            disabled={saving || billItems.every(i => !i.item_name.trim())}
            className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-600 rounded-lg hover:from-teal-600 hover:to-cyan-700 transition-all shadow-lg disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Saving...' : 'Save Bill'}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Receipt className="w-5 h-5 mr-2 text-teal-500" />
              Bill Details
            </h3>

            {/* CNV Invoice Number — prominent auto-generated badge */}
            <div className="mb-4 flex items-center gap-3 px-4 py-3 bg-teal-50 border border-teal-200 rounded-xl">
              <div className="flex-1">
                <p className="text-xs font-medium text-teal-600 uppercase tracking-wide mb-1">CNV Invoice Number (Auto-generated)</p>
                <input
                  type="text"
                  value={cnvInvoiceNumber}
                  onChange={(e) => setCnvInvoiceNumber(e.target.value)}
                  className="w-full text-xl font-bold text-teal-800 bg-transparent border-0 border-b border-teal-300 focus:outline-none focus:border-teal-600 pb-0.5"
                  placeholder="CNV-0001"
                />
              </div>
              <div className="px-3 py-1.5 bg-teal-600 text-white text-xs font-semibold rounded-lg">
                {existingBill ? 'Assigned' : 'Will auto-assign on save'}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bill Number</label>
                <input
                  type="text"
                  value={billNumber}
                  onChange={(e) => setBillNumber(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  placeholder="INV-001"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Batch Number</label>
                <input
                  type="text"
                  value={batchNumber}
                  onChange={(e) => setBatchNumber(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  placeholder="BATCH-2024-001"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bill Date</label>
                <input
                  type="date"
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Exchange Rate (CNY to LKR)</label>
                <input
                  type="number"
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  min="0"
                  step="0.0001"
                  placeholder="0.5"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  placeholder="Optional notes..."
                />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                <Package className="w-5 h-5 mr-2 text-teal-500" />
                Items Received
              </h3>
              <button
                onClick={addItem}
                className="text-sm text-teal-600 hover:text-teal-700 font-medium"
              >
                + Add Item
              </button>
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 uppercase px-1">
                <div className="col-span-4">Item Name</div>
                <div className="col-span-2">Qty Received</div>
                <div className="col-span-2">Unit Price (CNY)</div>
                <div className="col-span-3 text-right">Total (CNY)</div>
                <div className="col-span-1"></div>
              </div>

              {billItems.map((item, index) => {
                const qty = parseFloat(item.quantity_received) || 0;
                const price = parseFloat(item.unit_price_cny) || 0;
                const lineTotal = qty * price;
                const filteredItems = getFilteredItems(searchTerms[index] || '');
                return (
                  <div key={index} className="grid grid-cols-12 gap-2">
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
                    <input
                      type="number"
                      value={item.quantity_received}
                      onChange={(e) => updateItem(index, 'quantity_received', e.target.value)}
                      className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm"
                      placeholder="Qty"
                      min="0"
                    />
                    <input
                      type="number"
                      value={item.unit_price_cny}
                      onChange={(e) => updateItem(index, 'unit_price_cny', e.target.value)}
                      className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm"
                      placeholder="Price"
                      min="0"
                      step="0.01"
                    />
                    <div className="col-span-3 flex items-center justify-end px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium text-gray-700">
                      {lineTotal > 0 ? lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                    </div>
                    <button
                      onClick={() => removeItem(index)}
                      className="col-span-1 flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors"
                      disabled={billItems.length === 1}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end mt-3 pt-3 border-t border-gray-200">
              <div className="text-right">
                <span className="text-sm text-gray-500 mr-3">Total (CNY):</span>
                <span className="text-lg font-bold text-gray-900">
                  {totalCNY.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                <CreditCard className="w-5 h-5 mr-2 text-teal-500" />
                Payment Vouchers
              </h3>
              {existingBill && balance > 0 && (
                <button
                  onClick={() => setShowPaymentForm(true)}
                  className="flex items-center space-x-1 text-sm text-teal-600 hover:text-teal-700 font-medium"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Payment</span>
                </button>
              )}
            </div>

            {!existingBill && (
              <p className="text-sm text-gray-500 text-center py-4">
                Save the bill first to add payments
              </p>
            )}

            {existingBill && showPaymentForm && (
              <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-gray-700">New Payment Voucher</span>
                  <button
                    onClick={() => setShowPaymentForm(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Voucher No.</label>
                    <input
                      type="text"
                      value={newPayment.voucher_number}
                      onChange={(e) => setNewPayment({ ...newPayment, voucher_number: e.target.value })}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-teal-500"
                      placeholder="CA-035"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Date</label>
                    <input
                      type="date"
                      value={newPayment.payment_date}
                      onChange={(e) => setNewPayment({ ...newPayment, payment_date: e.target.value })}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Payment Mode</label>
                    <select
                      value={newPayment.payment_mode}
                      onChange={(e) => setNewPayment({ ...newPayment, payment_mode: e.target.value })}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-teal-500"
                    >
                      {paymentModes.map(mode => (
                        <option key={mode} value={mode}>{mode}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Amount (CNY)</label>
                    <input
                      type="number"
                      value={newPayment.amount}
                      onChange={(e) => setNewPayment({ ...newPayment, amount: e.target.value })}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-teal-500"
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                    />
                  </div>
                </div>
                <div className="mb-3">
                  <label className="block text-xs text-gray-500 mb-1">Account/Supplier</label>
                  <input
                    type="text"
                    value={newPayment.account_name}
                    onChange={(e) => setNewPayment({ ...newPayment, account_name: e.target.value })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-teal-500"
                    placeholder={purchaseOrder?.suppliers?.name || 'Account name'}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Rate (Rs per ¥)</label>
                    <input type="number" step="0.01" value={newPayment.rate_lkr} onChange={(e) => setNewPayment({ ...newPayment, rate_lkr: e.target.value })} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-teal-500" placeholder={exchangeRate} />
                    <p className="text-[11px] text-gray-500 mt-0.5">= Rs {((parseFloat(newPayment.amount) || 0) * (parseFloat(newPayment.rate_lkr) || parseFloat(exchangeRate) || 0)).toLocaleString('en-LK', { maximumFractionDigits: 0 })}</p>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Paid by</label>
                    <select value={newPayment.funded_by} onChange={(e) => setNewPayment({ ...newPayment, funded_by: e.target.value })} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded">
                      <option value="investor">Investor</option>
                      <option value="own">Own funds</option>
                    </select>
                  </div>
                </div>
                <div className="mb-3">
                  <label className="block text-xs text-gray-500 mb-1">Narration</label>
                  <input
                    type="text"
                    value={newPayment.narration}
                    onChange={(e) => setNewPayment({ ...newPayment, narration: e.target.value })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-teal-500"
                    placeholder="Short description"
                  />
                </div>
                <button
                  onClick={handleAddPayment}
                  disabled={savingPayment || !newPayment.amount}
                  className="w-full py-2 text-sm font-medium text-white bg-teal-600 rounded hover:bg-teal-700 disabled:opacity-50"
                >
                  {savingPayment ? 'Saving...' : 'Record Payment'}
                </button>
              </div>
            )}

            {existingBill && payments.length > 0 && (
              <div className="space-y-2">
                {payments.map((payment) => (
                  <div
                    key={payment.id}
                    className="flex items-center justify-between p-3 bg-green-50 border border-green-100 rounded-lg"
                  >
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium text-gray-900">
                          {payment.voucher_number || 'Payment'}
                        </span>
                        <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
                          {payment.payment_mode}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {new Date(payment.payment_date).toLocaleDateString()}
                        {payment.account_name && ` - ${payment.account_name}`}
                      </div>
                      {payment.narration && (
                        <div className="text-xs text-gray-400 mt-0.5">{payment.narration}</div>
                      )}
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className="text-sm font-bold text-green-700">
                        -{payment.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                      <button
                        onClick={() => handleDeletePayment(payment.id)}
                        className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {existingBill && payments.length === 0 && !showPaymentForm && (
              <p className="text-sm text-gray-400 text-center py-2">No payments recorded yet</p>
            )}
          </div>

          <div className="bg-gradient-to-br from-teal-500 to-cyan-600 rounded-xl shadow-lg p-6 text-white">
            <h3 className="text-lg font-semibold mb-4 flex items-center">
              <Calendar className="w-5 h-5 mr-2" />
              Bill Summary
            </h3>

            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-teal-100">Total (CNY)</span>
                <span className="font-medium">{totalCNY.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-teal-100">Exchange Rate</span>
                <span className="font-medium">x {rate}</span>
              </div>
              <div className="flex justify-between text-lg font-bold pt-2 border-t border-teal-400">
                <span>Bill Total (LKR)</span>
                <span>{totalLKR.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>

              <div className="pt-3 border-t border-teal-400">
                <div className="flex justify-between text-sm">
                  <span className="text-teal-100">Total Paid</span>
                  <span className="font-medium text-green-200">-{totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className={`flex justify-between text-lg font-bold mt-1 ${balance <= 0 ? 'text-green-200' : 'text-yellow-200'}`}>
                  <span>Balance Due</span>
                  <span>{balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              </div>

              <div className="pt-3">
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                  getStatus() === 'paid' ? 'bg-green-200 text-green-800' :
                  getStatus() === 'partial' ? 'bg-yellow-200 text-yellow-800' :
                  'bg-gray-200 text-gray-800'
                }`}>
                  {getStatus() === 'paid' ? 'Paid' : getStatus() === 'partial' ? 'Partially Paid' : 'Pending'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showPrint && existingBill && (
        <PurchaseBillPrint
          bill={existingBill}
          items={billItems.filter(i => i.item_name.trim()).map(item => ({
            id: item.id || crypto.randomUUID(),
            item_name: item.item_name,
            quantity_received: parseFloat(item.quantity_received) || 0,
            unit_price_cny: parseFloat(item.unit_price_cny) || 0
          }))}
          supplier={purchaseOrder?.suppliers || null}
          onClose={() => setShowPrint(false)}
        />
      )}
    </div>
  );
}
