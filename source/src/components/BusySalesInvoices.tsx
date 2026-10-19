import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, X, Check, FileText, ChevronDown, ChevronUp, CreditCard, Pencil, Eye, Printer, Users, Settings } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { custKey, onAccountByCustomer, netOpening } from '../lib/receivables';
import { fetchAllPages } from '../lib/fetchAll';
import { moveToRecycleBin } from '../lib/recycleBin';
import { replaceLines } from '../lib/lines';
import { syncInvoiceStock, removeInvoiceStock, describeIssue } from '../lib/whIssue';
import InvoicePrint from './InvoicePrint';

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  credit_days?: number | null;
  credit_amount?: number | null;
  opening_balance?: number | null;
}

interface ItemRecord {
  id: string;
  item_name: string;
  sku: string | null;
  unit: string;
  sales_price: number;
  purchase_price?: number;
}

interface SalesInvoiceItem {
  id: string;
  item_id?: string | null;
  item_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  cost_price: number;
  total: number;
}

interface SalesInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  sales_order_id: string | null;
  customer_id: string | null;
  customer_name: string;
  status: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  amount_paid: number;
  amount_due: number;
  notes: string | null;
  created_at: string;
  invoice_type: string;
  partner_name: string | null;
  split_percent: number | null;
  total_cost: number;
  gross_profit: number;
  your_profit: number;
  partner_profit: number;
  busy_sales_invoice_items?: SalesInvoiceItem[];
}

interface SalesOrder {
  id: string;
  order_number: string;
  customer_name: string;
  total_amount: number;
  deal_type: string | null;
  busy_sales_order_items?: {
    item_name: string;
    quantity: number;
    unit: string;
    unit_price: number;
  }[];
}

interface NewItem {
  item_name: string;
  item_id: string | null;
  quantity: string;
  unit_price: string;
  cost_price: string;
  unit: string;
}

interface Partner {
  id: string;
  name: string;
  phone: string;
}

interface BusySalesInvoicesProps {
  onRecordPayment?: (invoiceId: string) => void;
  preselectedOrderId?: string | null;
  onClearPreselection?: () => void;
}

// Local calendar date YYYY-MM-DD (toISOString gives the UTC date = yesterday before 5:30 am in Sri Lanka)
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// 'YYYY-MM-DD' shown as a local date (new Date('YYYY-MM-DD') is UTC midnight and can show the day before)
const showDate = (v: string | null | undefined) => { if (!v) return ''; const [y, m, d] = v.slice(0, 10).split('-').map(Number); return y && m && d ? new Date(y, m - 1, d).toLocaleDateString() : v; };
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export default function BusySalesInvoices({ onRecordPayment, preselectedOrderId, onClearPreselection }: BusySalesInvoicesProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [onAccount, setOnAccount] = useState<Map<string, number>>(new Map());
  const [pendingOrders, setPendingOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<SalesInvoice | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [selectedOrder, setSelectedOrder] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayLocal());
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [taxAmount, setTaxAmount] = useState('0');
  const [items, setItems] = useState<NewItem[]>([{ item_name: '', item_id: null, quantity: '', unit_price: '', cost_price: '', unit: 'Pcs' }]);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());
  const [allItems, setAllItems] = useState<ItemRecord[]>([]);
  const [whStock, setWhStock] = useState<Record<string, number>>({});
  const [whOnly, setWhOnly] = useState<ItemRecord[]>([]); // warehouse products that are not in the Items master
  const stockFor = (it: { id?: string | null; item_name?: string }) => { const v = (it.id ? whStock['id:' + it.id] : undefined) ?? whStock['nm:' + (it.item_name || '').trim().toLowerCase()]; return typeof v === 'number' ? v : null; };
  const [whCost, setWhCost] = useState<Record<string, number>>({});
  const costFor = (it: { id?: string | null; item_name?: string }) => { const v = (it.id ? whCost['id:' + it.id] : undefined) ?? whCost['nm:' + (it.item_name || '').trim().toLowerCase()]; return typeof v === 'number' && v > 0 ? v : null; };
  const [activeDropdown, setActiveDropdown] = useState<number | null>(null);
  const [searchTerms, setSearchTerms] = useState<string[]>(['']);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [printingInvoice, setPrintingInvoice] = useState<SalesInvoice | null>(null);

  // Double invoice state
  const [invoiceType, setInvoiceType] = useState<'single' | 'double'>('single');
  const [partnerName, setPartnerName] = useState('');
  const [splitPercent, setSplitPercent] = useState('60');
  const [partners, setPartners] = useState<Partner[]>([]);
  const [showPartnerDropdown, setShowPartnerDropdown] = useState(false);
  const [showManagePartners, setShowManagePartners] = useState(false);
  const [newPartnerName, setNewPartnerName] = useState('');
  const [newPartnerPhone, setNewPartnerPhone] = useState('');

  const dropdownRefs = useRef<(HTMLDivElement | null)[]>([]);
  const customerDropdownRef = useRef<HTMLDivElement>(null);
  const partnerDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (preselectedOrderId && pendingOrders.length > 0) {
      const order = pendingOrders.find(o => o.id === preselectedOrderId);
      if (order) {
        handleSelectOrder(preselectedOrderId);
        setShowForm(true);
        if (onClearPreselection) onClearPreselection();
      }
    }
  }, [preselectedOrderId, pendingOrders]);

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
      if (showPartnerDropdown && partnerDropdownRef.current && !partnerDropdownRef.current.contains(event.target as Node)) {
        setShowPartnerDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeDropdown, showCustomerDropdown, showPartnerDropdown]);

  async function loadData() {
    setLoading(true);

    const [customersRes, invoicesRes, itemsRes, ordersRes, partnersRes] = await Promise.all([
      fetchAllPages<Customer>(() => supabase.from('customers').select('id, name, phone, credit_days, credit_amount, opening_balance').order('name').order('id')),
      fetchAllPages<SalesInvoice>(() => supabase
        .from('busy_sales_invoices')
        .select(`*, busy_sales_invoice_items (*)`)
        .order('invoice_date', { ascending: false })
        .order('id')),
      fetchAllPages<ItemRecord>(() => supabase.from('items').select('id, item_name, sku, unit, sales_price, purchase_price').order('item_name').order('id')),
      supabase
        .from('busy_sales_orders')
        .select(`id, order_number, customer_name, total_amount, deal_type, busy_sales_order_items (item_name, quantity, unit, unit_price)`)
        .in('status', ['pending', 'confirmed'])
        .order('order_date', { ascending: false }),
      supabase.from('sl_partners').select('*').order('name')
    ]);

    setCustomers(customersRes.data);
    if (customersRes.error || itemsRes.error) alert('Could not load all customers / items: ' + (customersRes.error || itemsRes.error));
    if (invoicesRes.error) alert('Could not load all invoices: ' + invoicesRes.error);
    setInvoices(invoicesRes.data);
    // money received on account (this book) for the credit check
    fetchAllPages<{ customer_name: string | null; sales_invoice_id: string | null; amount: number; cheque_status: string | null }>(() =>
      supabase.from('busy_sales_payments').select('id, customer_name, sales_invoice_id, amount, cheque_status').order('id'))
      .then(({ data }) => setOnAccount(onAccountByCustomer(data)));
    setAllItems(itemsRes.data);
    fetchAllPages<{ id: string; name: string; master_item_id: string | null; is_active: boolean; avg_cost: number | null; unit: string | null; sell_price: number | null }>(() => supabase.from('wh_products').select('*').order('id')).then(async ({ data: wp }) => {
      const masterNames = new Set(itemsRes.data.map((i) => (i.item_name || '').trim().toLowerCase()));
      setWhOnly((wp ?? []).filter((w) => w.is_active !== false && !w.master_item_id && w.name && !masterNames.has(w.name.trim().toLowerCase()))
        .map((w) => ({ id: '', item_name: w.name.trim(), sku: null, unit: w.unit || 'PCS', sales_price: Number(w.sell_price) || 0, purchase_price: Number(w.avg_cost) || 0 })));
      const { data: st } = await supabase.from('wh_stock').select('product_id, qty');
      const byProd: Record<string, number> = {};
      (st ?? []).forEach((r) => { byProd[r.product_id] = (byProd[r.product_id] ?? 0) + Number(r.qty); });
      const m: Record<string, number> = {};
      const c: Record<string, number> = {};
      (wp ?? []).filter((w) => w.is_active).forEach((w) => { const q = byProd[w.id] ?? 0; if (w.master_item_id) { m['id:' + w.master_item_id] = q; c['id:' + w.master_item_id] = Number(w.avg_cost) || 0; } m['nm:' + w.name.trim().toLowerCase()] = q; c['nm:' + w.name.trim().toLowerCase()] = Number(w.avg_cost) || 0; });
      setWhStock(m); setWhCost(c);
    });
    if (ordersRes.data) setPendingOrders(ordersRes.data);
    if (partnersRes.data) setPartners(partnersRes.data);

    setLoading(false);
  }

  async function generateInvoiceNumber(): Promise<string> {
    const today = new Date();
    const prefix = `INV-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;

    const { data } = await supabase
      .from('busy_sales_invoices')
      .select('invoice_number')
      .like('invoice_number', `${prefix}%`)
      .order('invoice_number', { ascending: false })
      .limit(1);

    let nextNum = 1;
    if (data && data.length > 0) {
      const lastNum = parseInt(data[0].invoice_number.split('-').pop() || '0');
      nextNum = lastNum + 1;
    }

    return `${prefix}-${String(nextNum).padStart(4, '0')}`;
  }

  function handleSelectOrder(orderId: string) {
    setSelectedOrder(orderId);
    const order = pendingOrders.find(o => o.id === orderId);
    if (order) {
      setCustomerName(order.customer_name);
      setCustomerSearch(order.customer_name);
      setSelectedCustomer(customers.find(c => custKey(c.name) === custKey(order.customer_name))?.id || '');
      setInvoiceType(order.deal_type === 'double' ? 'double' : 'single');
      if (order.deal_type === 'double') setPartnerName(order.customer_name);
      if (order.busy_sales_order_items) {
        const orderItems = order.busy_sales_order_items.map(item => ({
          item_name: item.item_name,
          item_id: null,
          quantity: String(item.quantity),
          unit_price: String(item.unit_price),
          cost_price: '',
          unit: item.unit
        }));
        setItems(orderItems);
        setSearchTerms(orderItems.map(i => i.item_name));
      }
    }
  }

  function addItem() {
    setItems([...items, { item_name: '', item_id: null, quantity: '', unit_price: '', cost_price: '', unit: 'Pcs' }]);
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
      item_id: item.id || null,
      unit_price: String(item.sales_price || ''),
      cost_price: (() => { const wc = costFor({ id: item.id, item_name: item.item_name }); return wc ? String(wc) : item.purchase_price && item.purchase_price > 0 ? String(item.purchase_price) : updated[index].cost_price; })(),
      unit: item.unit
    };
    setItems(updated);
    const newSearchTerms = [...searchTerms];
    newSearchTerms[index] = item.item_name;
    setSearchTerms(newSearchTerms);
    setActiveDropdown(null);
  }

  // Credit position of the customer being invoiced: unpaid invoices + opening balance vs their limit / days
  function creditCheck(customerId: string): { outstanding: number; limit: number; overdueDays: number; creditDays: number; messages: string[] } | null {
    const c = customers.find((x) => x.id === customerId);
    if (!c) return null;
    // same rule as Customer Outstanding: unpaid dues + opening (OLD only) less on-account receipts
    const unpaid = invoices.filter((i) => (i.customer_id === customerId || custKey(i.customer_name) === custKey(c.name)) && i.status !== 'paid' && (i.amount_due || 0) > 0);
    const outstanding = unpaid.reduce((s, i) => s + (i.amount_due || 0), 0) + netOpening(c.name, c.opening_balance, onAccount);
    const today = Date.now();
    const overdueDays = unpaid.reduce((m, i) => Math.max(m, Math.floor((today - new Date(i.invoice_date).getTime()) / 86400000)), 0);
    const limit = c.credit_amount || 0;
    const creditDays = c.credit_days || 0;
    const messages: string[] = [];
    if (limit > 0 && outstanding > limit) messages.push(`Outstanding LKR ${outstanding.toLocaleString()} is over the credit limit of LKR ${limit.toLocaleString()}.`);
    if (creditDays > 0 && overdueDays > creditDays) messages.push(`Oldest unpaid invoice is ${overdueDays} days old — credit terms are ${creditDays} days.`);
    if (!messages.length && outstanding > 0) messages.push(`Currently owes LKR ${outstanding.toLocaleString()}${limit > 0 ? ` of LKR ${limit.toLocaleString()} limit` : ''}.`);
    return { outstanding, limit, overdueDays, creditDays, messages };
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
    const all = whOnly.length ? [...allItems, ...whOnly] : allItems;
    // every typed word must appear somewhere in the name / code, in any order ("sliding deeper" finds "Deeper Sliding ...")
    const words = searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return all.slice(0, 30);
    return all.filter((item) => {
      const hay = ((item.item_name || '') + ' ' + (item.sku || '')).toLowerCase();
      return words.every((w) => hay.includes(w));
    }).slice(0, 30);
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

  function calculateSubtotal(): number {
    return items.reduce((sum, item) => {
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unit_price) || 0;
      return sum + (qty * price);
    }, 0);
  }

  function calculateTotalCost(): number {
    return items.reduce((sum, item) => {
      const qty = parseFloat(item.quantity) || 0;
      const cost = parseFloat(item.cost_price) || 0;
      return sum + (qty * cost);
    }, 0);
  }

  function calculateProfitBreakdown() {
    const subtotal = calculateSubtotal();
    const totalCost = calculateTotalCost();
    const grossProfit = subtotal - totalCost;
    const myPct = parseFloat(splitPercent) || 0;
    const partnerPct = 100 - myPct;
    const yourProfit = (grossProfit * myPct) / 100;
    const partnerProfit = (grossProfit * partnerPct) / 100;
    return { grossProfit, totalCost, yourProfit, partnerProfit, myPct, partnerPct };
  }

  function resetForm() {
    setShowForm(false);
    setEditingInvoice(null);
    setSelectedCustomer('');
    setCustomerName('');
    setCustomerSearch('');
    setSelectedOrder('');
    setInvoiceDate(todayLocal());
    setDueDate('');
    setNotes('');
    setTaxAmount('0');
    setItems([{ item_name: '', item_id: null, quantity: '', unit_price: '', cost_price: '', unit: 'Pcs' }]);
    setSearchTerms(['']);
    setActiveDropdown(null);
    setInvoiceType('single');
    setPartnerName('');
    setSplitPercent('60');
  }

  function handleEdit(invoice: SalesInvoice) {
    setEditingInvoice(invoice);
    setSelectedCustomer(invoice.customer_id || '');
    setCustomerName(invoice.customer_name);
    setCustomerSearch(invoice.customer_name);
    setSelectedOrder(invoice.sales_order_id || '');
    setInvoiceDate(invoice.invoice_date);
    setDueDate(invoice.due_date || '');
    setNotes(invoice.notes || '');
    setTaxAmount(String(invoice.tax_amount));
    setInvoiceType((invoice.invoice_type as 'single' | 'double') || 'single');
    setPartnerName(invoice.partner_name || '');
    setSplitPercent(invoice.split_percent ? String(invoice.split_percent) : '60');

    if (invoice.busy_sales_invoice_items && invoice.busy_sales_invoice_items.length > 0) {
      const invoiceItems = invoice.busy_sales_invoice_items.map(item => ({
        item_name: item.item_name,
        item_id: item.item_id || null,
        quantity: String(item.quantity),
        unit_price: String(item.unit_price),
        cost_price: String(item.cost_price || ''),
        unit: item.unit
      }));
      setItems(invoiceItems);
      setSearchTerms(invoiceItems.map(i => i.item_name));
    } else {
      setItems([{ item_name: '', item_id: null, quantity: '', unit_price: '', cost_price: '', unit: 'Pcs' }]);
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
    if (!finalCustomerName || validItems.length === 0) return;
    if (savingRef.current) return; // double-click guard
    savingRef.current = true;
    try {
      await doSave(validItems, finalCustomerName);
    } finally {
      savingRef.current = false;
    }
  }

  async function doSave(validItems: NewItem[], finalCustomerName: string) {
    setSaving(true);

    const subtotal = r2(validItems.reduce((sum, item) => {
      return sum + r2(parseFloat(item.quantity) * parseFloat(item.unit_price));
    }, 0));
    const tax = r2(parseFloat(taxAmount) || 0);
    const totalAmount = r2(subtotal + tax);

    let totalCost = 0;
    let grossProfit = 0;
    let yourProfit = 0;
    let partnerProfit = 0;

    if (invoiceType === 'double') {
      totalCost = validItems.reduce((sum, item) => {
        return sum + (parseFloat(item.quantity) * (parseFloat(item.cost_price) || 0));
      }, 0);
      totalCost = r2(totalCost);
      grossProfit = r2(subtotal - totalCost);
      const myPct = parseFloat(splitPercent) || 0;
      yourProfit = r2((grossProfit * myPct) / 100);
      partnerProfit = r2(grossProfit - yourProfit);
    }

    const doubleFields = {
      invoice_type: invoiceType,
      partner_name: invoiceType === 'double' ? (partnerName.trim() || null) : null,
      split_percent: invoiceType === 'double' ? (parseFloat(splitPercent) || null) : null,
      total_cost: invoiceType === 'double' ? totalCost : 0,
      gross_profit: invoiceType === 'double' ? grossProfit : 0,
      your_profit: invoiceType === 'double' ? yourProfit : 0,
      partner_profit: invoiceType === 'double' ? partnerProfit : 0,
    };

    if (editingInvoice) {
      // re-read the paid amount: a payment may have been recorded since this list was loaded
      const { data: fresh, error: freshErr } = await supabase.from('busy_sales_invoices').select('amount_paid, status').eq('id', editingInvoice.id).maybeSingle();
      if (freshErr || !fresh) {
        alert('Could not read the invoice before saving: ' + (freshErr?.message || 'it was not found (deleted?)'));
        setSaving(false);
        return;
      }
      const paidNow = Number(fresh.amount_paid) || 0;
      const amountDue = r2(totalAmount - paidNow);
      const newStatus = amountDue <= 0 ? 'paid' : (paidNow > 0 ? 'partial' : (fresh.status === 'paid' || fresh.status === 'partial' ? 'sent' : fresh.status));

      const { error: updateError } = await supabase
        .from('busy_sales_invoices')
        .update({
          customer_id: selectedCustomer || null,
          customer_name: finalCustomerName,
          invoice_date: invoiceDate,
          due_date: dueDate || null,
          notes: notes.trim() || null,
          subtotal,
          tax_amount: tax,
          total_amount: totalAmount,
          amount_due: amountDue,
          status: newStatus,
          updated_at: new Date().toISOString(),
          ...doubleFields
        })
        .eq('id', editingInvoice.id);

      if (updateError) {
        console.error('Error updating invoice:', updateError);
        alert('Could not save the invoice: ' + updateError.message);
        setSaving(false);
        return;
      }

      const itemsToInsert = validItems.map(item => ({
        sales_invoice_id: editingInvoice.id,
        item_id: item.item_id,
        item_name: item.item_name.trim(),
        quantity: parseFloat(item.quantity),
        unit: item.unit,
        unit_price: parseFloat(item.unit_price),
        cost_price: parseFloat(item.cost_price) || 0,
        total: r2(parseFloat(item.quantity) * parseFloat(item.unit_price))
      }));

      const linesErr = await replaceLines('busy_sales_invoice_items', 'sales_invoice_id', editingInvoice.id, itemsToInsert);
      if (linesErr) {
        alert('The invoice header was saved, but its item lines could not be saved: ' + linesErr);
        setSaving(false);
        return;
      }
      // warehouse: re-issue the stock for the new lines (replaces what this invoice issued before)
      const wh = await syncInvoiceStock({ id: editingInvoice.id, number: editingInvoice.invoice_number, customer: finalCustomerName, date: invoiceDate }, itemsToInsert);
      const whMsg = describeIssue(wh); if (whMsg) alert(whMsg);
    } else {
      let invoiceNumber = '';
      let invoice: { id: string } | null = null;
      let invoiceError: { code?: string; message: string } | null = null;
      // try again with the next number if someone else took this number at the same moment
      for (let attempt = 0; attempt < 3; attempt++) {
      invoiceNumber = await generateInvoiceNumber();
      ({ data: invoice, error: invoiceError } = await supabase
        .from('busy_sales_invoices')
        .insert({
          invoice_number: invoiceNumber,
          sales_order_id: selectedOrder || null,
          customer_id: selectedCustomer || null,
          customer_name: finalCustomerName,
          invoice_date: invoiceDate,
          due_date: dueDate || null,
          notes: notes.trim() || null,
          status: 'sent',
          subtotal,
          tax_amount: tax,
          total_amount: totalAmount,
          amount_paid: 0,
          amount_due: totalAmount,
          ...doubleFields
        })
        .select()
        .single());
      if (!invoiceError || invoiceError.code !== '23505') break;
      }

      if (invoiceError || !invoice) {
        console.error('Error creating invoice:', invoiceError);
        alert('Could not create the invoice: ' + (invoiceError?.message || 'no data returned'));
        setSaving(false);
        return;
      }
      const newInvoiceId = invoice.id;

      const itemsToInsert = validItems.map(item => ({
        sales_invoice_id: newInvoiceId,
        item_id: item.item_id,
        item_name: item.item_name.trim(),
        quantity: parseFloat(item.quantity),
        unit: item.unit,
        unit_price: parseFloat(item.unit_price),
        cost_price: parseFloat(item.cost_price) || 0,
        total: r2(parseFloat(item.quantity) * parseFloat(item.unit_price))
      }));

      const { error: itemsErr } = await supabase.from('busy_sales_invoice_items').insert(itemsToInsert);
      if (itemsErr) {
        alert(`Invoice ${invoiceNumber} was created, but its item lines could not be saved: ${itemsErr.message}\n\nPlease open the invoice and add the items again.`);
        setSaving(false);
        loadData();
        return;
      }
      // warehouse: issue the sold items from stock (one issue note per location, linked to this invoice)
      const wh = await syncInvoiceStock({ id: newInvoiceId, number: invoiceNumber, customer: finalCustomerName, date: invoiceDate }, itemsToInsert);
      const whMsg = describeIssue(wh); if (whMsg) alert(whMsg);

      // the sales order is now invoiced: it leaves the "Create from Sales Order" list, so it can't be invoiced twice
      if (selectedOrder) {
        const { error: soErr } = await supabase
          .from('busy_sales_orders')
          .update({ status: 'invoiced', updated_at: new Date().toISOString() })
          .eq('id', selectedOrder)
          .in('status', ['pending', 'confirmed']);
        if (soErr) alert(`Invoice ${invoiceNumber} was created, but the sales order could not be marked as invoiced: ${soErr.message}`);
      }
    }

    for (const item of validItems) {
      const newPrice = parseFloat(item.unit_price) || 0;
      if (newPrice > 0) {
        await supabase
          .from('items')
          .update({ sales_price: newPrice, updated_at: new Date().toISOString() })
          .eq('item_name', item.item_name.trim());
      }
    }

    const orderId = editingInvoice?.sales_order_id || selectedOrder;
    if (orderId) {
      const soItemsToInsert = validItems.map(item => ({
        sales_order_id: orderId,
        item_id: item.item_id,
        item_name: item.item_name.trim(),
        quantity: parseFloat(item.quantity),
        unit: item.unit,
        unit_price: parseFloat(item.unit_price),
        total: r2(parseFloat(item.quantity) * parseFloat(item.unit_price))
      }));

      const soLinesErr = await replaceLines('busy_sales_order_items', 'sales_order_id', orderId, soItemsToInsert);
      if (soLinesErr) {
        alert('The invoice was saved, but the linked sales order lines could not be updated: ' + soLinesErr);
        setSaving(false);
        loadData();
        return;
      }

      const { error: soTotErr } = await supabase
        .from('busy_sales_orders')
        .update({ total_amount: totalAmount, customer_name: finalCustomerName, updated_at: new Date().toISOString() })
        .eq('id', orderId);
      if (soTotErr) alert('The invoice was saved, but the linked sales order total could not be updated: ' + soTotErr.message);
    }

    setSaving(false);
    resetForm();
    loadData();
  }

  async function handleDeleteInvoice(id: string) {
    if (!confirm('Are you sure you want to delete this invoice? It will be moved to the Recycle Bin.')) return;

    const invoiceToDelete = invoices.find(i => i.id === id);
    if (!invoiceToDelete) return;

    const { data: pays } = await supabase
      .from('busy_sales_payments')
      .select('amount')
      .eq('sales_invoice_id', id);
    if (pays && pays.length > 0) {
      const paid = pays.reduce((t, p) => t + (Number(p.amount) || 0), 0);
      if (!confirm(`This invoice has ${pays.length} payment(s) totalling ${paid.toLocaleString()} LKR.\n\nThe payments will be KEPT as on-account credit for ${invoiceToDelete.customer_name} (not deleted). If you want to remove the money too, delete the payments in Sales Payment first.\n\nDelete the invoice?`)) return;
    }

    const { data: invoiceItems } = await supabase
      .from('busy_sales_invoice_items')
      .select('*')
      .eq('sales_invoice_id', id);

    const result = await moveToRecycleBin({
      source_table: 'busy_sales_invoices',
      source_id: id,
      record_data: invoiceToDelete,
      related_data: { busy_sales_invoice_items: invoiceItems || [] },
      display_name: `Invoice ${invoiceToDelete.invoice_number} - ${invoiceToDelete.customer_name}`,
      portal: 'sl',
    });

    if (!result.success) {
      alert('Failed to move to recycle bin: ' + result.error);
      return;
    }

    const { error: linesErr } = await supabase.from('busy_sales_invoice_items').delete().eq('sales_invoice_id', id);
    if (linesErr) {
      alert('Could not delete invoice (its item lines could not be removed): ' + linesErr.message);
      return;
    }

    // warehouse: remove what this invoice issued (stock goes back)
    const whDel = await removeInvoiceStock(id);
    if (whDel) alert('Warehouse stock could not be put back for this invoice: ' + whDel + '\n\nThe invoice is still deleted; correct the stock in Warehouse if needed.');

    const { error } = await supabase.from('busy_sales_invoices').delete().eq('id', id);
    if (error) {
      // Put the lines back so the invoice is not left empty
      if (invoiceItems && invoiceItems.length > 0) {
        const { error: backErr } = await supabase.from('busy_sales_invoice_items').insert(invoiceItems);
        if (backErr) {
          alert('Could not delete invoice: ' + error.message + '\n\nIts item lines were removed and could not be put back (' + backErr.message + '). They are saved in the Recycle Bin entry.');
          loadData();
          return;
        }
      }
      alert('Could not delete invoice: ' + error.message + '\n\nThe invoice and its lines were kept.');
      return;
    }

    if (invoiceToDelete.sales_order_id) {
      const { count } = await supabase
        .from('busy_sales_invoices')
        .select('id', { count: 'exact', head: true })
        .eq('sales_order_id', invoiceToDelete.sales_order_id);
      if (!count) {
        await supabase
          .from('busy_sales_orders')
          .update({ status: 'confirmed', linked_invoice_id: null, updated_at: new Date().toISOString() })
          .eq('id', invoiceToDelete.sales_order_id)
          .eq('status', 'invoiced');
      }
    }
    loadData();
  }

  function toggleInvoiceExpand(id: string) {
    const newExpanded = new Set(expandedInvoices);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedInvoices(newExpanded);
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'paid': return 'bg-green-100 text-green-800';
      case 'partial': return 'bg-teal-100 text-teal-800';
      case 'overdue': return 'bg-red-100 text-red-800';
      case 'sent': return 'bg-amber-100 text-amber-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  }

  async function handleAddPartner() {
    if (!newPartnerName.trim()) return;
    const { data } = await supabase
      .from('sl_partners')
      .insert({ name: newPartnerName.trim(), phone: newPartnerPhone.trim() })
      .select()
      .single();
    if (data) {
      setPartners([...partners, data]);
      setNewPartnerName('');
      setNewPartnerPhone('');
    }
  }

  async function handleDeletePartner(id: string) {
    await supabase.from('sl_partners').delete().eq('id', id);
    setPartners(partners.filter(p => p.id !== id));
  }

  const profitBreakdown = invoiceType === 'double' ? calculateProfitBreakdown() : null;

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
        <h2 className="text-2xl font-bold text-gray-900">Sales Invoices</h2>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-600 rounded-lg hover:from-teal-600 hover:to-cyan-700 transition-all shadow-lg"
        >
          <Plus className="w-4 h-4" />
          <span>New Invoice</span>
        </button>
      </div>

      {/* Manage Partners Modal */}
      {showManagePartners && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <div className="flex items-center space-x-2">
                <Users className="w-5 h-5 text-teal-600" />
                <h3 className="text-lg font-semibold text-gray-900">Manage Partners</h3>
              </div>
              <button onClick={() => setShowManagePartners(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={newPartnerName}
                  onChange={e => setNewPartnerName(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm"
                  placeholder="Partner name"
                />
                <input
                  type="text"
                  value={newPartnerPhone}
                  onChange={e => setNewPartnerPhone(e.target.value)}
                  className="w-36 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm"
                  placeholder="Phone (optional)"
                />
                <button
                  onClick={handleAddPartner}
                  disabled={!newPartnerName.trim()}
                  className="px-3 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 text-sm font-medium"
                >
                  Add
                </button>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {partners.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-4">No partners yet.</p>
                )}
                {partners.map(p => (
                  <div key={p.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{p.name}</p>
                      {p.phone && <p className="text-xs text-gray-500">{p.phone}</p>}
                    </div>
                    <button
                      onClick={() => handleDeletePartner(p.id)}
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-semibold text-gray-900">
              {editingInvoice ? 'Edit Invoice' : 'New Sales Invoice'}
            </h3>
            {/* Single / Double toggle */}
            <div className="flex items-center bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setInvoiceType('single')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  invoiceType === 'single'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Single
              </button>
              <button
                onClick={() => setInvoiceType('double')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  invoiceType === 'double'
                    ? 'bg-teal-600 text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Double
              </button>
            </div>
          </div>

          {/* Double invoice partner section */}
          {invoiceType === 'double' && (
            <div className="mb-5 p-4 bg-teal-50 border border-teal-200 rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <Users className="w-4 h-4 text-teal-700" />
                  <span className="text-sm font-semibold text-teal-800">Partnership Details</span>
                </div>
                <button
                  onClick={() => setShowManagePartners(true)}
                  className="flex items-center space-x-1 text-xs text-teal-600 hover:text-teal-800 font-medium"
                >
                  <Settings className="w-3 h-3" />
                  <span>Manage Partners</span>
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2 relative" ref={partnerDropdownRef}>
                  <label className="block text-xs font-medium text-teal-700 mb-1">Partner Name</label>
                  <input
                    type="text"
                    value={partnerName}
                    onChange={e => { setPartnerName(e.target.value); setShowPartnerDropdown(true); }}
                    onFocus={() => setShowPartnerDropdown(true)}
                    className="w-full px-3 py-2 border border-teal-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 bg-white text-sm"
                    placeholder="Search or enter partner name..."
                  />
                  {showPartnerDropdown && partners.filter(p =>
                    !partnerName.trim() || p.name.toLowerCase().includes(partnerName.toLowerCase())
                  ).length > 0 && (
                    <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {partners
                        .filter(p => !partnerName.trim() || p.name.toLowerCase().includes(partnerName.toLowerCase()))
                        .map(p => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => { setPartnerName(p.name); setShowPartnerDropdown(false); }}
                            className="w-full px-3 py-2 text-left hover:bg-teal-50 flex items-center justify-between text-sm border-b border-gray-100 last:border-b-0"
                          >
                            <span className="font-medium text-gray-900">{p.name}</span>
                            {p.phone && <span className="text-xs text-gray-500">{p.phone}</span>}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-teal-700 mb-1">Your Split %</label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      value={splitPercent}
                      onChange={e => setSplitPercent(e.target.value)}
                      className="w-full px-3 py-2 border border-teal-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 bg-white text-sm"
                      placeholder="60"
                      min="0"
                      max="100"
                    />
                    <span className="text-sm text-teal-700 font-medium whitespace-nowrap">
                      / {100 - (parseFloat(splitPercent) || 0)}%
                    </span>
                  </div>
                  <p className="text-xs text-teal-600 mt-1">You / Partner</p>
                </div>
              </div>
            </div>
          )}

          {!editingInvoice && pendingOrders.length > 0 && (
            <div className="mb-4 p-3 bg-teal-50 border border-blue-200 rounded-lg">
              <label className="block text-sm font-medium text-teal-800 mb-2">
                Create from Sales Order (optional)
              </label>
              <select
                value={selectedOrder}
                onChange={(e) => handleSelectOrder(e.target.value)}
                className="w-full px-3 py-2 border border-teal-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              >
                <option value="">-- Create manually --</option>
                {pendingOrders.map(order => (
                  <option key={order.id} value={order.id}>
                    {order.order_number} - {order.customer_name} (LKR {order.total_amount.toLocaleString()})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
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
                placeholder="Search or enter customer..."
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
              {selectedCustomer && (() => {
                const cc = creditCheck(selectedCustomer);
                if (!cc || cc.messages.length === 0) return null;
                const bad = (cc.limit > 0 && cc.outstanding > cc.limit) || (cc.creditDays > 0 && cc.overdueDays > cc.creditDays);
                return (
                  <div className={`mt-2 text-xs rounded-lg px-3 py-2 border ${bad ? 'bg-red-50 border-red-300 text-red-800' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                    {bad ? '⚠ ' : ''}{cc.messages.join(' ')}
                  </div>
                );
              })()}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Date</label>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tax Amount (LKR)</label>
              <input
                type="number"
                value={taxAmount}
                onChange={(e) => setTaxAmount(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="0"
                min="0"
                step="0.01"
              />
            </div>
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Invoice Items</label>
              <button onClick={addItem} className="text-sm text-teal-600 hover:text-teal-700 font-medium">
                + Add Item
              </button>
            </div>

            <div className="space-y-3 md:space-y-2">
              {/* Table header */}
              {invoiceType === 'single' ? (
                <div className="hidden md:grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 uppercase px-1">
                  <div className="col-span-4">Item Name</div>
                  <div className="col-span-1">Unit</div>
                  <div className="col-span-2">Quantity</div>
                  <div className="col-span-2">LKR Unit Price</div>
                  <div className="col-span-2 text-right">Total</div>
                  <div className="col-span-1"></div>
                </div>
              ) : (
                <div className="hidden md:grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 uppercase px-1">
                  <div className="col-span-3">Item Name</div>
                  <div className="col-span-1">Unit</div>
                  <div className="col-span-1">Qty</div>
                  <div className="col-span-2">Sale Price</div>
                  <div className="col-span-2">Cost Price</div>
                  <div className="col-span-2 text-right">Total</div>
                  <div className="col-span-1"></div>
                </div>
              )}

              {items.map((item, index) => {
                const qty = parseFloat(item.quantity) || 0;
                const price = parseFloat(item.unit_price) || 0;
                const lineTotal = qty * price;
                const filteredItems = getFilteredItems(searchTerms[index] || '');
                return (
                  <div key={index} className="grid grid-cols-12 gap-2 pb-3 md:pb-0 border-b md:border-0 border-gray-100">
                    <div
                      className={invoiceType === 'double' ? 'col-span-12 md:col-span-3 relative' : 'col-span-12 md:col-span-4 relative'}
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
                      {activeDropdown === index && filteredItems.length === 0 && (searchTerms[index] || '').trim() !== '' && (
                        <div className="absolute z-30 w-full min-w-[280px] mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs text-gray-500">
                          No item found in Items or Warehouse. It will be saved as typed — add it in Masters → Items to pick it next time.
                        </div>
                      )}
                      {activeDropdown === index && filteredItems.length > 0 && (
                        <div className="absolute z-30 w-full min-w-[280px] mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                          {filteredItems.map((itemRecord) => (
                            <button
                              key={itemRecord.id || 'wh:' + itemRecord.item_name}
                              type="button"
                              onClick={() => selectItem(index, itemRecord)}
                              className="w-full px-3 py-2 text-left hover:bg-teal-50 flex items-center justify-between text-sm border-b border-gray-100 last:border-b-0"
                            >
                              <span className="font-medium text-gray-900">{itemRecord.item_name}</span>
                              <span className="text-xs text-gray-500 flex items-center gap-2">
                                {itemRecord.sku && <span>{itemRecord.sku}</span>}
                                {(() => { const q = stockFor({ id: itemRecord.id, item_name: itemRecord.item_name }); return q === null ? <span className="text-gray-300">no stock record</span> : <span className={`font-mono px-1.5 py-0.5 rounded ${q <= 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>{q.toLocaleString()} in stock</span>; })()}
                                <span className="text-teal-600">{itemRecord.unit}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="col-span-2 md:col-span-1 flex flex-col items-center justify-center px-2 py-1 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600" title="Unit · warehouse stock">
                      {item.unit}
                      {(() => { const q = stockFor({ id: item.item_id, item_name: item.item_name }); return q === null ? null : <span className={`font-mono text-[10px] ${q < Number(item.quantity || 0) ? 'text-red-600' : 'text-green-700'}`}>{q.toLocaleString()}</span>; })()}
                    </div>
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                      className={`${invoiceType === 'double' ? 'col-span-2 md:col-span-1' : 'col-span-3 md:col-span-2'} min-w-0 px-2 md:px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm`}
                      placeholder="Qty"
                      min="0"
                    />
                    <input
                      type="number"
                      value={item.unit_price}
                      onChange={(e) => updateItem(index, 'unit_price', e.target.value)}
                      className={`${invoiceType === 'double' ? 'col-span-4' : 'col-span-3'} md:col-span-2 min-w-0 px-2 md:px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm`}
                      placeholder="Sale price"
                      min="0"
                      step="0.01"
                    />
                    {invoiceType === 'double' && (
                      <input
                        type="number"
                        value={item.cost_price}
                        onChange={(e) => updateItem(index, 'cost_price', e.target.value)}
                        className="col-span-4 md:col-span-2 min-w-0 px-2 md:px-3 py-2 border border-teal-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm bg-teal-50"
                        placeholder="Cost price"
                        min="0"
                        step="0.01"
                      />
                    )}
                    <div className={`${invoiceType === 'double' ? 'col-span-10' : 'col-span-3'} md:col-span-2 min-w-0 flex items-center justify-end px-2 md:px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 whitespace-nowrap overflow-hidden`}>
                      {lineTotal > 0 ? `LKR ${lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                    </div>
                    <button
                      onClick={() => removeItem(index)}
                      className={`${invoiceType === 'double' ? 'col-span-2' : 'col-span-1'} md:col-span-1 flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors`}
                      disabled={items.length === 1}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end mt-3 pt-3 border-t border-gray-200">
              <div className="text-right space-y-1">
                <div>
                  <span className="text-sm text-gray-500 mr-3">Subtotal:</span>
                  <span className="text-base font-medium text-gray-700">
                    LKR {calculateSubtotal().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div>
                  <span className="text-sm text-gray-500 mr-3">Tax:</span>
                  <span className="text-base font-medium text-gray-700">
                    LKR {(parseFloat(taxAmount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="pt-1 border-t border-gray-200">
                  <span className="text-sm text-gray-500 mr-3">Total:</span>
                  <span className="text-lg font-bold text-gray-900">
                    LKR {(calculateSubtotal() + (parseFloat(taxAmount) || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            {/* Profit breakdown for double invoices */}
            {invoiceType === 'double' && profitBreakdown && (
              <div className="mt-3 p-4 bg-teal-50 border border-teal-200 rounded-xl">
                <p className="text-xs font-semibold text-teal-700 uppercase tracking-wide mb-3">Profit Breakdown</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-white rounded-lg p-3 border border-teal-100">
                    <p className="text-xs text-gray-500 mb-1">Total Cost</p>
                    <p className="text-sm font-bold text-gray-800">
                      LKR {profitBreakdown.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-teal-100">
                    <p className="text-xs text-gray-500 mb-1">Gross Profit</p>
                    <p className={`text-sm font-bold ${profitBreakdown.grossProfit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      LKR {profitBreakdown.grossProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="bg-teal-600 rounded-lg p-3">
                    <p className="text-xs text-teal-100 mb-1">Your Share ({profitBreakdown.myPct}%)</p>
                    <p className="text-sm font-bold text-white">
                      LKR {profitBreakdown.yourProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-teal-100">
                    <p className="text-xs text-gray-500 mb-1">
                      {partnerName ? `${partnerName}'s Share` : 'Partner Share'} ({profitBreakdown.partnerPct}%)
                    </p>
                    <p className="text-sm font-bold text-gray-800">
                      LKR {profitBreakdown.partnerProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              placeholder="Optional notes..."
              rows={2}
            />
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
              {saving ? 'Saving...' : (editingInvoice ? 'Update Invoice' : 'Create Invoice')}
            </button>
          </div>
        </div>
      )}

      {invoices.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No invoices yet. Create your first invoice to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {invoices.map((invoice) => {
            const isExpanded = expandedInvoices.has(invoice.id);
            const isDouble = invoice.invoice_type === 'double';

            return (
              <div key={invoice.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div
                  className="flex flex-wrap items-center justify-between gap-2 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => toggleInvoiceExpand(invoice.id)}
                >
                  <div className="flex items-center space-x-4 min-w-0">
                    <div className="flex items-center space-x-2">
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      )}
                      <FileText className="w-5 h-5 text-teal-500" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <p className="font-medium text-gray-900">
                          {invoice.invoice_number} - {invoice.customer_name}
                        </p>
                        {isDouble && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-800">
                            Double
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">
                        {showDate(invoice.invoice_date)}
                        {invoice.due_date && ` | Due: ${showDate(invoice.due_date)}`}
                        {isDouble && invoice.partner_name && (
                          <span className="ml-2 text-teal-600">Partner: {invoice.partner_name}</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 sm:gap-4 ml-auto">
                    <div className="text-right">
                      <p className="font-semibold text-gray-900">
                        LKR {invoice.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      <div className="flex items-center space-x-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(invoice.status)}`}>
                          {invoice.status}
                        </span>
                        {invoice.amount_due > 0 && (
                          <span className="text-xs text-red-600 font-medium">
                            Due: LKR {invoice.amount_due.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setPrintingInvoice(invoice); }}
                      className="p-2 text-gray-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                      title="Print Invoice"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                    {invoice.status !== 'paid' && onRecordPayment && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRecordPayment(invoice.id); }}
                        className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                        title="Record Payment"
                      >
                        <CreditCard className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleEdit(invoice); }}
                      className="p-2 text-gray-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                      title="Edit Invoice"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleInvoiceExpand(invoice.id); }}
                      className="p-2 text-gray-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                      title="View Details"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteInvoice(invoice.id); }}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50 p-4">
                    {invoice.busy_sales_invoice_items && invoice.busy_sales_invoice_items.length > 0 && (
                      <div className="overflow-x-auto">
                      <table className="w-full mb-4">
                        <thead>
                          <tr className="text-xs text-gray-500 uppercase">
                            <th className="text-left pb-2">Item</th>
                            <th className="text-left pb-2">Unit</th>
                            <th className="text-right pb-2">Qty</th>
                            <th className="text-right pb-2">Unit Price (LKR)</th>
                            {isDouble && <th className="text-right pb-2">Cost Price (LKR)</th>}
                            <th className="text-right pb-2">Total (LKR)</th>
                          </tr>
                        </thead>
                        <tbody className="text-sm">
                          {invoice.busy_sales_invoice_items.map((item) => (
                            <tr key={item.id} className="border-t border-gray-200">
                              <td className="py-2 text-gray-900">{item.item_name}</td>
                              <td className="py-2 text-gray-600">{item.unit}</td>
                              <td className="py-2 text-right text-gray-600">{item.quantity}</td>
                              <td className="py-2 text-right text-gray-600">
                                {item.unit_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              {isDouble && (
                                <td className="py-2 text-right text-teal-600">
                                  {(item.cost_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                              )}
                              <td className="py-2 text-right font-medium text-gray-900">
                                {item.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    )}

                    <div className="flex flex-wrap justify-between items-start gap-4">
                      <div>
                        {invoice.notes && (
                          <p className="text-sm text-gray-500 italic">Notes: {invoice.notes}</p>
                        )}
                        {/* Profit breakdown in expanded view */}
                        {isDouble && (
                          <div className="mt-3 grid grid-cols-2 gap-2 max-w-xs">
                            <div className="bg-white border border-teal-100 rounded-lg p-2">
                              <p className="text-xs text-gray-400">Total Cost</p>
                              <p className="text-sm font-semibold text-gray-700">LKR {(invoice.total_cost || 0).toLocaleString()}</p>
                            </div>
                            <div className="bg-white border border-teal-100 rounded-lg p-2">
                              <p className="text-xs text-gray-400">Gross Profit</p>
                              <p className={`text-sm font-semibold ${(invoice.gross_profit || 0) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                                LKR {(invoice.gross_profit || 0).toLocaleString()}
                              </p>
                            </div>
                            <div className="bg-teal-600 rounded-lg p-2">
                              <p className="text-xs text-teal-100">Your Share ({invoice.split_percent}%)</p>
                              <p className="text-sm font-semibold text-white">LKR {(invoice.your_profit || 0).toLocaleString()}</p>
                            </div>
                            <div className="bg-white border border-teal-100 rounded-lg p-2">
                              <p className="text-xs text-gray-400">
                                {invoice.partner_name ? `${invoice.partner_name} (${100 - (invoice.split_percent || 0)}%)` : `Partner (${100 - (invoice.split_percent || 0)}%)`}
                              </p>
                              <p className="text-sm font-semibold text-gray-700">LKR {(invoice.partner_profit || 0).toLocaleString()}</p>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="text-right text-sm space-y-1">
                        <div className="flex justify-between">
                          <span className="text-gray-500 mr-4">Subtotal:</span>
                          <span className="text-gray-700">LKR {invoice.subtotal.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500 mr-4">Tax:</span>
                          <span className="text-gray-700">LKR {invoice.tax_amount.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between font-semibold border-t border-gray-200 pt-1">
                          <span className="text-gray-700 mr-4">Total:</span>
                          <span className="text-gray-900">LKR {invoice.total_amount.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-green-600">
                          <span className="mr-4">Paid:</span>
                          <span>LKR {invoice.amount_paid.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-red-600 font-semibold">
                          <span className="mr-4">Due:</span>
                          <span>LKR {invoice.amount_due.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {printingInvoice && (
        <InvoicePrint
          invoice={printingInvoice}
          onClose={() => setPrintingInvoice(null)}
        />
      )}
    </div>
  );
}
