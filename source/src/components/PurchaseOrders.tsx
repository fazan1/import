import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, X, Check, Package, ChevronDown, ChevronUp, Receipt, ShoppingCart, Search, Calendar, Layers, Pencil, Printer } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { replaceLines } from '../lib/lines';
import { fetchAllPages } from '../lib/fetchAll';

// today's date on this device (toISOString gives the UTC date, i.e. yesterday before 5:30 am in Sri Lanka)
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// a row read with select('*') can be written back as long as joined data is left out
function stripJoined(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (v === null || typeof v !== 'object') out[k] = v;
  return out;
}
import { moveToRecycleBin } from '../lib/recycleBin';
import PurchaseBillPage from './PurchaseBillPage';
import PurchaseOrderPrint from './PurchaseOrderPrint';

interface Supplier {
  id: string;
  name: string;
  currency: string;
}

interface ItemRecord {
  id: string;
  item_name: string;
  sku: string | null;
  unit: string;
  purchase_price: number;
  purchase_currency: string;
}

interface PurchaseOrderItem {
  id: string;
  item_name: string;
  quantity: number;
  unit_price_cny: number;
  unit: string;
  weight_kg: number;
  cbm: number;
}

interface SalesOrder {
  id: string;
  order_number: string;
  customer_name: string;
  total_amount: number;
  status: string;
}

interface SOPOLink {
  id: string;
  sales_order_id: string;
  purchase_order_id: string;
  busy_sales_orders?: SalesOrder;
}

interface PurchaseBill {
  id: string;
  purchase_order_id: string;
  bill_number: string;
  cnv_invoice_number: string | null;
  batch_number: string | null;
  bill_date: string;
  exchange_rate: number;
  shipping_cost: number;
  customs_duty: number;
  other_charges: number;
  total_cbm: number;
  total_weight_kg: number;
}

interface PurchaseOrder {
  id: string;
  supplier_id: string | null;
  order_date: string;
  status: string;
  notes: string | null;
  created_at: string;
  total_weight_kg?: number;
  total_cbm?: number;
  suppliers?: Supplier;
  purchase_order_items?: PurchaseOrderItem[];
  so_po_links?: SOPOLink[];
  purchase_bills?: PurchaseBill[];
}

interface SupplierDetail {
  name: string;
  weight_kg: number;
  cbm: number;
  value_cny: number;
}

interface BatchSummary {
  batch_number: string;
  total_orders: number;
  total_items: number;
  total_value_cny: number;
  total_weight_kg: number;
  total_cbm: number;
  total_shipping: number;
  total_customs: number;
  total_other: number;
  suppliers: string[];
  supplierDetails: SupplierDetail[];
}

interface NewItem {
  item_name: string;
  item_id: string | null;
  quantity: string;
  unit_price_cny: string;
  unit: string;
  weight_kg: string;
  cbm: string;
}

interface PreselectedSOItem {
  item_name: string;
  quantity: number;
  unit: string;
}

interface PurchaseOrdersProps {
  preselectedSOItems?: PreselectedSOItem[];
  preselectedSOId?: string;
  onClearPreselection?: () => void;
}

export default function PurchaseOrders({ preselectedSOItems, preselectedSOId, onClearPreselection }: PurchaseOrdersProps) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [orderDate, setOrderDate] = useState(localToday());
  const [notes, setNotes] = useState('');
  const [totalWeightKg, setTotalWeightKg] = useState('');
  const [totalCbm, setTotalCbm] = useState('');
  const [items, setItems] = useState<NewItem[]>([{ item_name: '', item_id: null, quantity: '', unit_price_cny: '', unit: 'Piece', weight_kg: '', cbm: '' }]);
  const [saving, setSaving] = useState(false);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [selectedOrderForBill, setSelectedOrderForBill] = useState<string | null>(null);
  const [allItems, setAllItems] = useState<ItemRecord[]>([]);
  const [activeDropdown, setActiveDropdown] = useState<number | null>(null);
  const [searchTerms, setSearchTerms] = useState<string[]>(['']);
  const [selectedSalesOrders, setSelectedSalesOrders] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [batchSearch, setBatchSearch] = useState('');
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null);
  const [loadingBatch, setLoadingBatch] = useState(false);
  const [availableBatches, setAvailableBatches] = useState<string[]>([]);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);
  const [printOrderId, setPrintOrderId] = useState<string | null>(null);
  const dropdownRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (preselectedSOItems && preselectedSOItems.length > 0) {
      const newItems = preselectedSOItems.map(item => ({
        item_name: item.item_name,
        item_id: null,
        quantity: String(item.quantity),
        unit_price_cny: '',
        unit: item.unit,
        weight_kg: '',
        cbm: ''
      }));
      setItems(newItems);
      setSearchTerms(newItems.map(i => i.item_name));
      if (preselectedSOId) {
        setSelectedSalesOrders([preselectedSOId]);
      }
      setShowForm(true);
      if (onClearPreselection) {
        onClearPreselection();
      }
    }
  }, [preselectedSOItems, preselectedSOId, onClearPreselection]);

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

  async function loadData() {
    setLoading(true);

    // POs and batches: every row, not only the first 1000
    const [suppliersRes, ordersRes, itemsRes, salesOrdersRes, batchesRes] = await Promise.all([
      supabase.from('suppliers').select('id, name, currency').order('name'),
      fetchAllPages<PurchaseOrder>(() => supabase
        .from('purchase_orders')
        .select(`
          *,
          suppliers (id, name, currency),
          purchase_order_items (*),
          so_po_links (
            id,
            sales_order_id,
            purchase_order_id,
            busy_sales_orders (id, order_number, customer_name, total_amount, status)
          ),
          purchase_bills (*, purchase_bill_items (quantity_received))
        `)
        .order('order_date', { ascending: false })
        .order('id')),
      supabase.from('items').select('id, item_name, sku, unit, purchase_price, purchase_currency').order('item_name'),
      supabase
        .from('busy_sales_orders')
        .select('id, order_number, customer_name, total_amount, status')
        .in('status', ['pending', 'confirmed'])
        .order('order_date', { ascending: false }),
      fetchAllPages<{ batch_number: string | null }>(() => supabase
        .from('purchase_bills')
        .select('batch_number')
        .not('batch_number', 'is', null)
        .order('id'))
    ]);

    if (ordersRes.error) alert('Could not load all purchase orders: ' + ordersRes.error);

    if (suppliersRes.data) setSuppliers(suppliersRes.data);
    if (!ordersRes.error) setOrders(ordersRes.data);
    if (itemsRes.data) setAllItems(itemsRes.data);
    if (salesOrdersRes.data) setSalesOrders(salesOrdersRes.data);
    if (batchesRes.data) {
      const uniqueBatches = [...new Set(batchesRes.data.map(b => b.batch_number).filter(Boolean))] as string[];
      setAvailableBatches(uniqueBatches.sort());
    }

    setLoading(false);
  }

  async function searchByBatch(batchNum: string) {
    if (!batchNum.trim()) {
      setBatchSummary(null);
      return;
    }

    setLoadingBatch(true);

    const { data: billsData } = await supabase
      .from('purchase_bills')
      .select(`
        *,
        purchase_bill_items (quantity_received, unit_price_cny),
        purchase_orders (
          *,
          suppliers (id, name, currency),
          purchase_order_items (*)
        )
      `)
      .eq('batch_number', batchNum.trim());

    if (billsData && billsData.length > 0) {
      const supplierNames = new Set<string>();
      const supplierDataMap = new Map<string, SupplierDetail>();
      let totalItems = 0;
      let totalValueCny = 0;
      let totalWeightKg = 0;
      let totalCbm = 0;
      let totalShipping = 0;
      let totalCustoms = 0;
      let totalOther = 0;

      billsData.forEach(bill => {
        const po = bill.purchase_orders;
        const supplierName = po?.suppliers?.name || 'Unknown';
        if (po?.suppliers?.name) {
          supplierNames.add(po.suppliers.name);
        }

        // value of what was BILLED (bill lines), not the PO — a bill can differ from its PO
        let billValueCny = 0;
        const billLines = (bill.purchase_bill_items || []) as { quantity_received: number; unit_price_cny: number }[];
        if (billLines.length) {
          totalItems += billLines.length;
          billLines.forEach((item) => {
            const itemValue = (Number(item.quantity_received) || 0) * (Number(item.unit_price_cny) || 0);
            totalValueCny += itemValue;
            billValueCny += itemValue;
          });
        } else if (po?.purchase_order_items) {
          totalItems += po.purchase_order_items.length;
          po.purchase_order_items.forEach((item: PurchaseOrderItem) => {
            const itemValue = (Number(item.quantity) || 0) * (Number(item.unit_price_cny) || 0);
            totalValueCny += itemValue;
            billValueCny += itemValue;
          });
        }

        const billWeight = Number(bill.total_weight_kg) || 0;
        const billCbm = Number(bill.total_cbm) || 0;

        totalWeightKg += billWeight;
        totalCbm += billCbm;
        totalShipping += Number(bill.shipping_cost) || 0;
        totalCustoms += Number(bill.customs_duty) || 0;
        totalOther += Number(bill.other_charges) || 0;

        const existing = supplierDataMap.get(supplierName);
        if (existing) {
          existing.weight_kg += billWeight;
          existing.cbm += billCbm;
          existing.value_cny += billValueCny;
        } else {
          supplierDataMap.set(supplierName, {
            name: supplierName,
            weight_kg: billWeight,
            cbm: billCbm,
            value_cny: billValueCny
          });
        }
      });

      setBatchSummary({
        batch_number: batchNum,
        total_orders: billsData.length,
        total_items: totalItems,
        total_value_cny: totalValueCny,
        total_weight_kg: totalWeightKg,
        total_cbm: totalCbm,
        total_shipping: totalShipping,
        total_customs: totalCustoms,
        total_other: totalOther,
        suppliers: Array.from(supplierNames),
        supplierDetails: Array.from(supplierDataMap.values())
      });
    } else {
      setBatchSummary(null);
    }

    setLoadingBatch(false);
  }

  function addItem() {
    setItems([...items, { item_name: '', item_id: null, quantity: '', unit_price_cny: '', unit: 'Piece', weight_kg: '', cbm: '' }]);
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
      unit_price_cny: String(item.purchase_price || ''),
      unit: item.unit
    };
    setItems(updated);
    const newSearchTerms = [...searchTerms];
    newSearchTerms[index] = item.item_name;
    setSearchTerms(newSearchTerms);
    setActiveDropdown(null);
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

  function updateItem(index: number, field: keyof NewItem, value: string) {
    const updated = [...items];
    updated[index][field] = value;
    setItems(updated);
  }

  function resetForm() {
    setShowForm(false);
    setEditingOrder(null);
    setSelectedSupplier('');
    setOrderDate(localToday());
    setNotes('');
    setTotalWeightKg('');
    setTotalCbm('');
    setItems([{ item_name: '', item_id: null, quantity: '', unit_price_cny: '', unit: 'Piece', weight_kg: '', cbm: '' }]);
    setSearchTerms(['']);
    setActiveDropdown(null);
    setSelectedSalesOrders([]);
  }

  function startEditOrder(order: PurchaseOrder) {
    setEditingOrder(order);
    setSelectedSupplier(order.supplier_id || '');
    setOrderDate(order.order_date);
    setNotes(order.notes || '');
    setTotalWeightKg(String(order.total_weight_kg || ''));
    setTotalCbm(String(order.total_cbm || ''));

    if (order.purchase_order_items && order.purchase_order_items.length > 0) {
      const editItems = order.purchase_order_items.map(item => ({
        item_name: item.item_name,
        item_id: (item as unknown as { item_id?: string | null }).item_id ?? null,
        quantity: String(item.quantity),
        unit_price_cny: String(item.unit_price_cny),
        unit: item.unit || 'Piece',
        weight_kg: String(item.weight_kg || ''),
        cbm: String(item.cbm || '')
      }));
      setItems(editItems);
      setSearchTerms(editItems.map(i => i.item_name));
    } else {
      setItems([{ item_name: '', item_id: null, quantity: '', unit_price_cny: '', unit: 'Piece', weight_kg: '', cbm: '' }]);
      setSearchTerms(['']);
    }

    if (order.so_po_links) {
      setSelectedSalesOrders(order.so_po_links.map(link => link.sales_order_id));
    } else {
      setSelectedSalesOrders([]);
    }

    setShowForm(true);
  }

  function toggleSalesOrder(soId: string) {
    if (selectedSalesOrders.includes(soId)) {
      setSelectedSalesOrders(selectedSalesOrders.filter(id => id !== soId));
    } else {
      setSelectedSalesOrders([...selectedSalesOrders, soId]);
    }
  }

  async function handleSave() {
    const validItems = items.filter(item =>
      item.item_name.trim() &&
      parseFloat(item.quantity) > 0 &&
      parseFloat(item.unit_price_cny) >= 0
    );

    if (!selectedSupplier) return;
    // a line with a name but no quantity/price used to be dropped without a word
    const badLines = items.filter(item => item.item_name.trim() && !validItems.includes(item));
    if (badLines.length) {
      alert('Please enter a quantity and price for: ' + badLines.map(i => i.item_name.trim()).join(', '));
      return;
    }
    if (validItems.length === 0) {
      alert('Add at least one item with a quantity and price.');
      return;
    }

    setSaving(true);

    if (editingOrder) {
      const { error: orderError } = await supabase
        .from('purchase_orders')
        .update({
          supplier_id: selectedSupplier,
          order_date: orderDate,
          notes: notes.trim() || null,
          total_weight_kg: parseFloat(totalWeightKg) || 0,
          total_cbm: parseFloat(totalCbm) || 0
        })
        .eq('id', editingOrder.id);

      if (orderError) {
        console.error('Error updating order:', orderError);
        alert('Could not save the PO: ' + orderError.message);
        setSaving(false);
        return;
      }

      // the PO lines as they are NOW in the database (the list on screen may be out of date)
      const { data: freshPoItems, error: poItemsReadError } = await supabase
        .from('purchase_order_items')
        .select('*')
        .eq('purchase_order_id', editingOrder.id);
      if (poItemsReadError) {
        alert('Could not read the PO lines, so they were not changed: ' + poItemsReadError.message);
        setSaving(false);
        return;
      }
      const oldPoItems = (freshPoItems || []) as Record<string, unknown>[];

      // Bills of this PO, read BEFORE the PO lines change (so nothing can be lost)
      const { data: linkedBills, error: billsLookupError } = await supabase
        .from('purchase_bills')
        .select('id, bill_number, cnv_invoice_number, purchase_bill_items (*)')
        .eq('purchase_order_id', editingOrder.id);
      if (billsLookupError) {
        console.error('Error looking up linked bills:', billsLookupError);
        alert('Could not check the bills of this PO, so the PO lines were not changed: ' + billsLookupError.message);
        setSaving(false);
        return;
      }

      const itemsToInsert = validItems.map(item => ({
        purchase_order_id: editingOrder.id,
        item_id: item.item_id,
        item_name: item.item_name.trim(),
        quantity: parseFloat(item.quantity),
        unit_price_cny: parseFloat(item.unit_price_cny),
        unit: item.unit,
        weight_kg: parseFloat(item.weight_kg) || 0,
        cbm: parseFloat(item.cbm) || 0
      }));

      // replaceLines puts the old lines back if the new ones cannot be saved
      const linesErr = await replaceLines('purchase_order_items', 'purchase_order_id', editingOrder.id, itemsToInsert);
      const { data: insertedItems, error: itemsError } = linesErr
        ? { data: null, error: null }
        : await supabase.from('purchase_order_items').select('*').eq('purchase_order_id', editingOrder.id);

      if (linesErr || itemsError || !insertedItems) {
        console.error('Error updating order items:', linesErr || itemsError);
        alert('Could not save the PO lines: ' + (linesErr || itemsError?.message || ''));
        setSaving(false);
        loadData();
        return;
      }

      // Bills: a bill that is still an exact copy of the old PO follows the PO.
      // A bill with its own quantities or prices (what really arrived) is NEVER overwritten.
      const lineKey = (name: unknown, qty: unknown, price: unknown) =>
        `${String(name ?? '').trim().toLowerCase()}|${Number(qty) || 0}|${Number(price) || 0}`;
      const sameLines = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');
      const oldPoKeys = oldPoItems.map(i => lineKey(i.item_name, i.quantity, i.unit_price_cny));
      const newIdByName = new Map(insertedItems.map(i => [String(i.item_name).trim().toLowerCase(), i.id as string]));
      const keptBills: string[] = [];

      for (const bill of linkedBills || []) {
        const billLines = ((bill as { purchase_bill_items?: Record<string, unknown>[] }).purchase_bill_items || []);
        const billKeys = billLines.map(i => lineKey(i.item_name, i.quantity_received, i.unit_price_cny));
        const label = bill.cnv_invoice_number || bill.bill_number || 'bill';

        if (sameLines(billKeys, oldPoKeys)) {
          const err = await replaceLines('purchase_bill_items', 'purchase_bill_id', bill.id, insertedItems.map(item => ({
            purchase_bill_id: bill.id,
            purchase_order_item_id: item.id,
            item_name: item.item_name,
            quantity_received: item.quantity,
            unit_price_cny: item.unit_price_cny,
            unit: item.unit
          })));
          if (err) { alert(`Bill ${label} could not follow the PO change: ${err}`); continue; }
          // keep packing-list lines pointing at the new bill lines
          const { data: newLines } = await supabase.from('purchase_bill_items').select('id, item_name').eq('purchase_bill_id', bill.id);
          const newLineByName = new Map((newLines || []).map(l => [String(l.item_name).trim().toLowerCase(), l.id as string]));
          for (const old of billLines) {
            const nid = newLineByName.get(String(old.item_name ?? '').trim().toLowerCase());
            if (nid && old.id) await supabase.from('packing_list_items').update({ purchase_bill_item_id: nid }).eq('purchase_bill_item_id', old.id as string);
          }
        } else {
          keptBills.push(label);
          // its lines stay as they are; only re-point them to the new PO lines (and restore them if the database removed them)
          const { data: still } = await supabase.from('purchase_bill_items').select('id').eq('purchase_bill_id', bill.id);
          if ((still || []).length === 0 && billLines.length) {
            await supabase.from('purchase_bill_items').insert(billLines.map(l => ({
              ...stripJoined(l),
              purchase_order_item_id: newIdByName.get(String(l.item_name ?? '').trim().toLowerCase()) ?? null,
            })));
          } else {
            for (const l of billLines) {
              await supabase.from('purchase_bill_items')
                .update({ purchase_order_item_id: newIdByName.get(String(l.item_name ?? '').trim().toLowerCase()) ?? null })
                .eq('id', l.id as string);
            }
          }
        }
      }
      if (keptBills.length) {
        alert(`PO saved. These bills have their own quantities/prices and were NOT changed: ${keptBills.join(', ')}.\nIf they should change too, edit them on the Bills page.`);
      }

      const linksErr = await replaceLines('so_po_links', 'purchase_order_id', editingOrder.id, selectedSalesOrders.map(soId => ({
        sales_order_id: soId,
        purchase_order_id: editingOrder.id
      })));
      if (linksErr) alert('PO saved, but the sales-order links could not be updated: ' + linksErr);
    } else {
      const { data: order, error: orderError } = await supabase
        .from('purchase_orders')
        .insert({
          supplier_id: selectedSupplier,
          order_date: orderDate,
          notes: notes.trim() || null,
          status: 'pending',
          total_weight_kg: parseFloat(totalWeightKg) || 0,
          total_cbm: parseFloat(totalCbm) || 0
        })
        .select()
        .single();

      if (orderError || !order) {
        console.error('Error creating order:', orderError);
        if (orderError?.code !== 'BOOK_MODE') alert('Could not create the PO: ' + (orderError?.message || ''));
        setSaving(false);
        return;
      }

      const itemsToInsert = validItems.map(item => ({
        purchase_order_id: order.id,
        item_id: item.item_id,
        item_name: item.item_name.trim(),
        quantity: parseFloat(item.quantity),
        unit_price_cny: parseFloat(item.unit_price_cny),
        unit: item.unit,
        weight_kg: parseFloat(item.weight_kg) || 0,
        cbm: parseFloat(item.cbm) || 0
      }));

      const { error: itemsError } = await supabase
        .from('purchase_order_items')
        .insert(itemsToInsert);

      if (itemsError) {
        // do not leave an empty PO behind; keep the form so nothing typed is lost
        console.error('Error creating order items:', itemsError);
        await supabase.from('purchase_orders').delete().eq('id', order.id);
        alert('Could not save the PO lines, so the PO was not created: ' + itemsError.message + '\nYour entries are still in the form.');
        setSaving(false);
        return;
      }

      if (selectedSalesOrders.length > 0) {
        const linksToInsert = selectedSalesOrders.map(soId => ({
          sales_order_id: soId,
          purchase_order_id: order.id
        }));
        const { error: linksError } = await supabase.from('so_po_links').insert(linksToInsert);
        if (linksError) alert('PO created, but the sales-order links could not be saved: ' + linksError.message);
      }
    }

    setSaving(false);
    resetForm();
    loadData();
  }

  async function handleDeleteOrder(id: string) {
    if (!confirm('Are you sure you want to delete this purchase order? It will be moved to the Recycle Bin.')) return;

    const orderToDelete = orders.find(o => o.id === id);
    if (!orderToDelete) return;

    // a PO with a bill must not lose its lines (the bill, its payments and packing list hang on them)
    const { data: poBills, error: poBillsError } = await supabase
      .from('purchase_bills')
      .select('id, bill_number, cnv_invoice_number')
      .eq('purchase_order_id', id);
    if (poBillsError) { alert('Could not check the bills of this PO, so nothing was deleted: ' + poBillsError.message); return; }
    if (poBills && poBills.length) {
      alert(`This PO has bill(s): ${poBills.map(b => b.cnv_invoice_number || b.bill_number || 'bill').join(', ')}.\nDelete the bill(s) on the Bills page first, then delete the PO.`);
      return;
    }

    const { data: orderItems, error: itemsReadError } = await supabase
      .from('purchase_order_items')
      .select('*')
      .eq('purchase_order_id', id);

    const { data: soLinks, error: linksReadError } = await supabase
      .from('so_po_links')
      .select('*')
      .eq('purchase_order_id', id);
    if (itemsReadError || linksReadError) {
      alert('Could not read this PO, so nothing was deleted: ' + (itemsReadError || linksReadError)!.message);
      return;
    }

    const supplierName = suppliers.find(s => s.id === orderToDelete.supplier_id)?.name || 'Unknown';

    const result = await moveToRecycleBin({
      source_table: 'purchase_orders',
      source_id: id,
      record_data: orderToDelete,
      related_data: {
        purchase_order_items: orderItems || [],
        so_po_links: soLinks || [],
      },
      display_name: `PO - ${supplierName} (${orderToDelete.order_date})`,
      portal: 'cn',
    });

    if (!result.success) {
      alert('Failed to move to recycle bin: ' + result.error);
      return;
    }

    const { error: linksDelError } = await supabase.from('so_po_links').delete().eq('purchase_order_id', id);
    if (linksDelError) { alert('Could not delete the PO: ' + linksDelError.message); return; }
    const { error: itemsDelError } = await supabase.from('purchase_order_items').delete().eq('purchase_order_id', id);
    if (itemsDelError) {
      if (soLinks?.length) await supabase.from('so_po_links').insert(soLinks);
      alert('Could not delete the PO: ' + itemsDelError.message);
      return;
    }

    const { error } = await supabase
      .from('purchase_orders')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting order:', error);
      // put the lines and links back so the PO is not left empty
      if (orderItems?.length) await supabase.from('purchase_order_items').insert(orderItems);
      if (soLinks?.length) await supabase.from('so_po_links').insert(soLinks);
      alert('Could not delete the PO: ' + error.message + ' (its lines were kept)');
    }
    loadData();
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

  function calculateOrderTotal(orderItems: PurchaseOrderItem[] | undefined): number {
    if (!orderItems) return 0;
    return orderItems.reduce((sum, item) => sum + (item.quantity * item.unit_price_cny), 0);
  }

  if (selectedOrderForBill) {
    return (
      <PurchaseBillPage
        purchaseOrderId={selectedOrderForBill}
        onBack={() => {
          setSelectedOrderForBill(null);
          loadData();
        }}
      />
    );
  }

  const printModal = printOrderId ? (
    <PurchaseOrderPrint
      orderId={printOrderId}
      onClose={() => setPrintOrderId(null)}
    />
  ) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-teal-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {printModal}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Purchase Orders</h2>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-600 rounded-lg hover:from-teal-600 hover:to-cyan-700 transition-all shadow-lg"
        >
          <Plus className="w-4 h-4" />
          <span>New PO</span>
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by item name or notes..."
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
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          >
            <option value="">All Suppliers</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          >
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="shipped">Shipped</option>
            <option value="completed">Completed</option>
          </select>
          {(searchTerm || dateFilter || supplierFilter || statusFilter) && (
            <button
              onClick={() => {
                setSearchTerm('');
                setDateFilter('');
                setSupplierFilter('');
                setStatusFilter('');
              }}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Layers className="w-5 h-5 text-teal-600" />
          <h3 className="text-sm font-semibold text-gray-900">Batch Invoice Search</h3>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <input
              type="text"
              value={batchSearch}
              onChange={(e) => setBatchSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  searchByBatch(batchSearch);
                }
              }}
              placeholder="Enter batch number..."
              className="w-full px-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              list="batch-options"
            />
            <datalist id="batch-options">
              {availableBatches.map(b => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </div>
          <button
            onClick={() => searchByBatch(batchSearch)}
            disabled={loadingBatch}
            className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
          >
            {loadingBatch ? 'Searching...' : 'Search Batch'}
          </button>
          {batchSummary && (
            <button
              onClick={() => {
                setBatchSearch('');
                setBatchSummary(null);
              }}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {batchSummary && (
          <div className="mt-4 p-4 bg-gradient-to-r from-teal-50 to-cyan-50 border border-teal-200 rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-lg font-bold text-teal-900">
                Batch #{batchSummary.batch_number} Summary
              </h4>
              <span className="px-3 py-1 bg-teal-600 text-white text-sm font-medium rounded-full">
                {batchSummary.total_orders} Order{batchSummary.total_orders !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="bg-white p-3 rounded-lg border border-teal-100">
                <p className="text-xs text-gray-500 uppercase">Total Items</p>
                <p className="text-xl font-bold text-gray-900">{batchSummary.total_items}</p>
              </div>
              <div className="bg-white p-3 rounded-lg border border-teal-100">
                <p className="text-xs text-gray-500 uppercase">Value (CNY)</p>
                <p className="text-xl font-bold text-teal-700">
                  {batchSummary.total_value_cny.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="bg-white p-3 rounded-lg border border-teal-100">
                <p className="text-xs text-gray-500 uppercase">Weight (KG)</p>
                <p className="text-xl font-bold text-gray-900">{batchSummary.total_weight_kg.toFixed(2)}</p>
              </div>
              <div className="bg-white p-3 rounded-lg border border-teal-100">
                <p className="text-xs text-gray-500 uppercase">Volume (CBM)</p>
                <p className="text-xl font-bold text-gray-900">{batchSummary.total_cbm.toFixed(3)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
              <div className="bg-white p-3 rounded-lg border border-amber-100">
                <p className="text-xs text-gray-500 uppercase">Shipping Cost</p>
                <p className="text-lg font-semibold text-amber-700">
                  {batchSummary.total_shipping.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="bg-white p-3 rounded-lg border border-amber-100">
                <p className="text-xs text-gray-500 uppercase">Customs Duty</p>
                <p className="text-lg font-semibold text-amber-700">
                  {batchSummary.total_customs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="bg-white p-3 rounded-lg border border-amber-100">
                <p className="text-xs text-gray-500 uppercase">Other Charges</p>
                <p className="text-lg font-semibold text-amber-700">
                  {batchSummary.total_other.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            <div className="bg-white p-3 rounded-lg border border-teal-200">
              <p className="text-xs text-gray-500 uppercase mb-1">Total Cost (CNY + Charges)</p>
              <p className="text-2xl font-bold text-teal-800">
                CNY {(batchSummary.total_value_cny + batchSummary.total_shipping + batchSummary.total_customs + batchSummary.total_other).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>

            {batchSummary.supplierDetails.length > 0 && (
              <div className="mt-3 pt-3 border-t border-teal-200">
                <p className="text-xs text-gray-500 uppercase mb-1">Suppliers (hover for weight/CBM)</p>
                <div className="flex flex-wrap gap-2">
                  {batchSummary.supplierDetails.map(supplier => (
                    <span
                      key={supplier.name}
                      className="relative group px-2 py-1 bg-gray-100 text-gray-700 text-sm rounded cursor-help hover:bg-teal-100 hover:text-teal-800 transition-colors"
                    >
                      {supplier.name}
                      <span className="pointer-events-none absolute left-0 top-full mt-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-[9999] whitespace-nowrap shadow-xl">
                        <span className="font-semibold block text-center border-b border-gray-700 pb-1 mb-1">{supplier.name}</span>
                        <span className="block">Weight: {supplier.weight_kg.toFixed(2)} KG</span>
                        <span className="block">CBM: {supplier.cbm.toFixed(3)}</span>
                        <span className="block">Value: CNY {supplier.value_cny.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        <span className="absolute left-4 bottom-full w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[6px] border-b-gray-900"></span>
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            {editingOrder ? 'Edit Purchase Order' : 'New Purchase Order'}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Supplier *
              </label>
              <select
                value={selectedSupplier}
                onChange={(e) => setSelectedSupplier(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="">Select supplier...</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Order Date
              </label>
              <input
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Total Weight (KG)
              </label>
              <input
                type="number"
                value={totalWeightKg}
                onChange={(e) => setTotalWeightKg(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Approx. KG"
                min="0"
                step="0.01"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Total CBM
              </label>
              <input
                type="number"
                value={totalCbm}
                onChange={(e) => setTotalCbm(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Approx. CBM"
                min="0"
                step="0.001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Optional notes"
              />
            </div>
          </div>

          {salesOrders.length > 0 && (
            <div className="mb-6 p-4 bg-teal-50 border border-blue-200 rounded-lg">
              <label className="block text-sm font-medium text-teal-800 mb-2">
                <ShoppingCart className="w-4 h-4 inline mr-1" />
                Link to Sales Orders (optional)
              </label>
              <p className="text-xs text-teal-700 mb-3">Select customer orders this purchase is fulfilling</p>
              <div className="flex flex-wrap gap-2">
                {salesOrders.map(so => (
                  <button
                    key={so.id}
                    type="button"
                    onClick={() => toggleSalesOrder(so.id)}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${
                      selectedSalesOrders.includes(so.id)
                        ? 'bg-teal-600 text-white border-blue-600'
                        : 'bg-white text-teal-800 border-teal-300 hover:bg-teal-100'
                    }`}
                  >
                    <span className="font-medium">{so.order_number}</span>
                    <span className="ml-1 opacity-75">({so.customer_name})</span>
                  </button>
                ))}
              </div>
              {selectedSalesOrders.length > 0 && (
                <p className="text-xs text-teal-700 mt-2">
                  {selectedSalesOrders.length} sales order(s) selected
                </p>
              )}
            </div>
          )}

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Items Ordered</label>
              <button
                onClick={addItem}
                className="text-sm text-teal-600 hover:text-teal-700 font-medium"
              >
                + Add Item
              </button>
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 uppercase px-1">
                <div className="col-span-5">Item Name</div>
                <div className="col-span-1">Unit</div>
                <div className="col-span-2">Quantity</div>
                <div className="col-span-2">CNY Price</div>
                <div className="col-span-1 text-right">Total</div>
                <div className="col-span-1"></div>
              </div>

              {items.map((item, index) => {
                const qty = parseFloat(item.quantity) || 0;
                const price = parseFloat(item.unit_price_cny) || 0;
                const lineTotal = qty * price;
                const filteredItems = getFilteredItems(searchTerms[index] || '');
                return (
                  <div key={index} className="grid grid-cols-12 gap-2">
                    <div
                      className="col-span-5 relative"
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
                      className="col-span-1 px-1 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-xs"
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
                    <div className="col-span-1 flex items-center justify-end px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium text-gray-700">
                      {lineTotal > 0 ? `${lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
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
                  CNY {items.reduce((sum, item) => {
                    const qty = parseFloat(item.quantity) || 0;
                    const price = parseFloat(item.unit_price_cny) || 0;
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
              disabled={!selectedSupplier || items.every(i => !i.item_name.trim()) || saving}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="w-4 h-4 inline mr-1" />
              {saving ? 'Saving...' : editingOrder ? 'Update PO' : 'Create PO'}
            </button>
          </div>
        </div>
      )}

      {(() => {
        const filteredOrders = orders.filter(order => {
          const matchesSearch = !searchTerm ||
            order.purchase_order_items?.some(item =>
              item.item_name.toLowerCase().includes(searchTerm.toLowerCase())
            ) ||
            (order.notes?.toLowerCase() || '').includes(searchTerm.toLowerCase());
          const matchesDate = !dateFilter || order.order_date === dateFilter;
          const matchesSupplier = !supplierFilter || order.supplier_id === supplierFilter;
          const matchesStatus = !statusFilter || order.status === statusFilter;
          return matchesSearch && matchesDate && matchesSupplier && matchesStatus;
        });

        if (filteredOrders.length === 0) {
          return (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
              <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">
                {orders.length === 0
                  ? 'No purchase orders yet. Create your first PO to get started.'
                  : 'No orders match your filters.'}
              </p>
            </div>
          );
        }

        return (
          <div className="space-y-3">
            {filteredOrders.map((order) => {
            const isExpanded = expandedOrders.has(order.id);
            const total = calculateOrderTotal(order.purchase_order_items);
            const currency = order.suppliers?.currency || 'CNY';

            return (
              <div key={order.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => toggleOrderExpand(order.id)}
                >
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      )}
                      <Package className="w-5 h-5 text-teal-500" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900">
                          {order.suppliers?.name || 'Unknown Supplier'}
                        </p>
                        {order.purchase_bills?.[0]?.cnv_invoice_number && (
                          <span className="px-2 py-0.5 bg-teal-50 border border-teal-200 text-teal-700 text-xs font-semibold rounded">
                            {order.purchase_bills[0].cnv_invoice_number}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">
                        {new Date(String(order.order_date).slice(0, 10) + 'T00:00:00').toLocaleDateString()} · {order.purchase_order_items?.length || 0} items
                        {order.purchase_bills?.[0]?.batch_number && (
                          <span className="ml-2 text-gray-400">· Batch {order.purchase_bills[0].batch_number}</span>
                        )}
                        {(() => {
                          const ordered = (order.purchase_order_items || []).reduce((s, i) => s + (i.quantity || 0), 0);
                          const billed = (order.purchase_bills || []).reduce((s, b) => s + ((b as unknown as { purchase_bill_items?: { quantity_received: number }[] }).purchase_bill_items || []).reduce((t, i) => t + (i.quantity_received || 0), 0), 0);
                          if (!ordered) return null;
                          const open = Math.max(0, ordered - billed);
                          return (
                            <span className={`ml-2 ${open > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                              · {billed.toLocaleString()} / {ordered.toLocaleString()} billed{open > 0 ? ` (${open.toLocaleString()} open)` : ' ✓'}
                            </span>
                          );
                        })()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="text-right">
                      <p className="font-semibold text-gray-900">
                        {currency} {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        order.status === 'completed' ? 'bg-green-100 text-green-800' :
                        order.status === 'shipped' ? 'bg-teal-100 text-teal-800' :
                        'bg-amber-100 text-amber-800'
                      }`}>
                        {order.status}
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditOrder(order);
                      }}
                      className="p-2 text-gray-500 hover:text-teal-700 hover:bg-teal-50 rounded-lg transition-colors"
                      title="Edit PO"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPrintOrderId(order.id);
                      }}
                      className="p-2 text-gray-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                      title="Print PO"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedOrderForBill(order.id);
                      }}
                      className="p-2 text-gray-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                      title="Create/View Bill"
                    >
                      <Receipt className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteOrder(order.id);
                      }}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete PO"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50 p-4">
                    {order.so_po_links && order.so_po_links.length > 0 && (
                      <div className="mb-4 p-3 bg-teal-50 border border-blue-200 rounded-lg">
                        <p className="text-xs font-medium text-teal-800 mb-2 flex items-center">
                          <ShoppingCart className="w-3 h-3 mr-1" />
                          Linked Sales Orders
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {order.so_po_links.map(link => link.busy_sales_orders && (
                            <span
                              key={link.id}
                              className="inline-flex items-center px-2 py-1 bg-white border border-teal-300 rounded text-xs"
                            >
                              <span className="font-medium text-blue-900">{link.busy_sales_orders.order_number}</span>
                              <span className="ml-1 text-teal-700">- {link.busy_sales_orders.customer_name}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {(order.total_weight_kg || order.total_cbm) ? (
                      <div className="mb-3 flex gap-4 text-sm">
                        {order.total_weight_kg ? (
                          <span className="px-3 py-1 bg-gray-100 rounded text-gray-700">
                            <span className="font-medium">Weight:</span> {order.total_weight_kg} KG
                          </span>
                        ) : null}
                        {order.total_cbm ? (
                          <span className="px-3 py-1 bg-gray-100 rounded text-gray-700">
                            <span className="font-medium">Volume:</span> {order.total_cbm} CBM
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {order.purchase_order_items && order.purchase_order_items.length > 0 && (
                      <>
                        <table className="w-full">
                          <thead>
                            <tr className="text-xs text-gray-500 uppercase">
                              <th className="text-left pb-2">Item</th>
                              <th className="text-right pb-2">Qty</th>
                              <th className="text-right pb-2">Unit Price ({currency})</th>
                              <th className="text-right pb-2">Total ({currency})</th>
                            </tr>
                          </thead>
                          <tbody className="text-sm">
                            {order.purchase_order_items.map((item) => (
                              <tr key={item.id} className="border-t border-gray-200">
                                <td className="py-2 text-gray-900">{item.item_name}</td>
                                <td className="py-2 text-right text-gray-600">{item.quantity}</td>
                                <td className="py-2 text-right text-gray-600">
                                  {item.unit_price_cny.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="py-2 text-right font-medium text-gray-900">
                                  {(item.quantity * item.unit_price_cny).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-gray-300 font-medium">
                              <td className="py-2 text-gray-700">Total</td>
                              <td className="py-2 text-right text-gray-700">
                                {order.purchase_order_items.reduce((sum, i) => sum + Number(i.quantity), 0)}
                              </td>
                              <td className="py-2 text-right text-gray-500 text-xs">
                                {order.purchase_order_items.reduce((sum, i) => sum + (Number(i.weight_kg) || 0), 0).toFixed(2)} kg
                              </td>
                              <td className="py-2 text-right text-gray-900">
                                {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </>
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
        );
      })()}
    </div>
  );
}
