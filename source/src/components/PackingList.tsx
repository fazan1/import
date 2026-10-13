import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import ChangeHistory from './ChangeHistory';
import { History as HistoryIcon } from 'lucide-react';
import { Package, Plus, Search, RefreshCw, X, Link, Trash2, Download, History, ChevronDown, Printer } from 'lucide-react';
import * as XLSX from 'xlsx';
import PackingListPrint from './PackingListPrint';

interface PackingListItem {
  id: string;
  batch_number: string;
  packing_list_no: string;
  no_of_pkgs: number;
  item_name: string;
  quantity: number;
  unit: string;
  weight_kg: number;
  cbm: number;
  status: string;
  notes: string;
  pl_input_id: string | null;
  purchase_bill_item_id: string | null;
}

interface PLInputRecord {
  id: string;
  packing_list_no: string;
  supplier_name: string;
  purchase_bill_id: string | null;
  status: string;
  batch_number: string | null;
}

interface PurchaseBillItem {
  id: string;
  item_name: string;
  quantity_received: number;
  unit: string;
}

function sortBatches(batches: string[]): string[] {
  return [...batches].sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ''), 10);
    const numB = parseInt(b.replace(/\D/g, ''), 10);
    if (!isNaN(numA) && !isNaN(numB)) return numB - numA;
    return b.localeCompare(a);
  });
}

export default function PackingList() {
  const [items, setItems] = useState<PackingListItem[]>([]);
  const [plInputRecords, setPlInputRecords] = useState<PLInputRecord[]>([]);
  const [shipmentNos, setShipmentNos] = useState<string[]>([]);
  const [shipBills, setShipBills] = useState<{ id: string; bill_number: string; cnv_invoice_number: string | null; bill_date: string; batch_number: string | null; supplier_name: string }[]>([]);
  const [creatingFromBill, setCreatingFromBill] = useState<string | null>(null);
  const [allBatches, setAllBatches] = useState<string[]>([]);
  const [activeBatch, setActiveBatch] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showPrintView, setShowPrintView] = useState(false);
  const [selectedPlNo, setSelectedPlNo] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedPlInput, setSelectedPlInput] = useState<PLInputRecord | null>(null);
  const [billItems, setBillItems] = useState<PurchaseBillItem[]>([]);
  const [loadingBillItems, setLoadingBillItems] = useState(false);
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBatchHistory, setShowBatchHistory] = useState(false);
  const [editingValue, setEditingValue] = useState<string>('');
  const [newItem, setNewItem] = useState({
    packing_list_no: '',
    item_name: '',
    quantity: 0,
    unit: 'PCS',
    no_of_pkgs: 0,
    weight_kg: 0,
    cbm: 0,
  });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell]);

  async function loadData() {
    setLoading(true);
    await Promise.all([loadItems(), loadPlInputRecords(), loadShipmentsAndBills()]);
    setLoading(false);
  }

  async function loadShipmentsAndBills() {
    const [s, b] = await Promise.all([
      supabase.from('shipments').select('shipment_no').order('created_at', { ascending: false }),
      supabase.from('purchase_bills').select('id, bill_number, cnv_invoice_number, bill_date, batch_number, purchase_orders(suppliers(name))').not('batch_number', 'is', null),
    ]);
    setShipmentNos((s.data || []).map((x) => x.shipment_no));
    setShipBills(((b.data || []) as unknown as { id: string; bill_number: string; cnv_invoice_number: string | null; bill_date: string; batch_number: string | null; purchase_orders: { suppliers: { name: string } | null } | null }[])
      .map((x) => ({ id: x.id, bill_number: x.bill_number, cnv_invoice_number: x.cnv_invoice_number, bill_date: x.bill_date, batch_number: x.batch_number, supplier_name: x.purchase_orders?.suppliers?.name || '' })));
  }

  // Create the PL Input record and its packing list rows straight from a bill that is in the shipment
  async function createPlFromBill(bill: { id: string; bill_number: string; cnv_invoice_number: string | null; bill_date: string; batch_number: string | null; supplier_name: string }) {
    if (!bill.batch_number) return;
    setCreatingFromBill(bill.id);
    const existingInBatch = plInputRecords.filter((r) => !r.packing_list_no.startsWith('M') && r.batch_number === bill.batch_number).length;
    const { data: inserted, error } = await supabase.from('pl_input').insert({
      purchase_bill_id: bill.id, date: bill.bill_date, supplier_name: bill.supplier_name, shipper_name: '',
      packing_list_no: String(existingInBatch + 1), batch_number: bill.batch_number, expected: true, received: false, entered_in_register: false,
    }).select('id, packing_list_no').single();
    if (error || !inserted) { console.error('Error creating PL Input:', error); alert('Could not create the packing list: ' + (error?.message || 'unknown error')); setCreatingFromBill(null); return; }
    const { data: billItems } = await supabase.from('purchase_bill_items').select('id, item_name, quantity_received, unit').eq('purchase_bill_id', bill.id);
    if (billItems && billItems.length > 0) {
      const rows = billItems.map((item) => ({
        batch_number: bill.batch_number, packing_list_no: inserted.packing_list_no, pl_input_id: inserted.id, purchase_bill_item_id: item.id,
        item_name: item.item_name, quantity: item.quantity_received ?? 0, unit: item.unit || 'PCS', no_of_pkgs: 0, weight_kg: 0, cbm: 0, status: 'Matched',
      }));
      const { error: e2 } = await supabase.from('packing_list_items').insert(rows);
      if (e2) { console.error('Error creating packing list items:', e2); alert('Packing list created but items failed: ' + e2.message); }
    }
    setCreatingFromBill(null);
    await loadData();
    setActiveBatch(bill.batch_number);
  }

  async function loadItems() {
    const { data, error } = await supabase
      .from('packing_list_items')
      .select('*')
      .order('packing_list_no', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (error) {
      console.error('Error loading packing list items:', error);
      return;
    }

    const rows = data || [];
    setItems(rows);

    const batchSet = new Set<string>();
    rows.forEach((r) => {
      if (r.batch_number) batchSet.add(r.batch_number);
    });
    setAllBatches(sortBatches(Array.from(batchSet)));
  }

  // Tabs = every shipment + every batch that has packing list rows or PL Input records
  const tabBatches = sortBatches(Array.from(new Set([...shipmentNos, ...allBatches, ...plInputRecords.map((p) => p.batch_number).filter((b): b is string => !!b)])));
  useEffect(() => {
    if (loading) return;
    setActiveBatch((prev) => (prev && (tabBatches.includes(prev) || prev === '__unassigned__') ? prev : tabBatches[0] || '__unassigned__'));
  }, [loading, tabBatches.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadPlInputRecords() {
    const { data, error } = await supabase
      .from('pl_input')
      .select('id, packing_list_no, supplier_name, purchase_bill_id, status, batch_number')
      .order('packing_list_no', { ascending: true });

    if (error) {
      console.error('Error loading PL Input records:', error);
      return;
    }

    setPlInputRecords(data || []);
  }

  async function loadBillItemsForPlInput(plInput: PLInputRecord) {
    if (!plInput.purchase_bill_id) return;

    setLoadingBillItems(true);
    const { data, error } = await supabase
      .from('purchase_bill_items')
      .select('id, item_name, quantity_received, unit')
      .eq('purchase_bill_id', plInput.purchase_bill_id);

    if (error) {
      console.error('Error loading bill items:', error);
      setLoadingBillItems(false);
      return;
    }

    setBillItems(data || []);
    setLoadingBillItems(false);
  }

  function selectPlInputForLink(plInput: PLInputRecord) {
    setSelectedPlInput(plInput);
    if (plInput.purchase_bill_id) {
      loadBillItemsForPlInput(plInput);
      setShowLinkModal(true);
    } else {
      setNewItem({
        ...newItem,
        packing_list_no: plInput.packing_list_no,
      });
      setShowAddModal(true);
    }
  }

  async function createPackingListFromPlInput() {
    if (!selectedPlInput || billItems.length === 0) return;

    const { data: billData } = await supabase
      .from('purchase_bills')
      .select('batch_number')
      .eq('id', selectedPlInput.purchase_bill_id)
      .maybeSingle();

    // Use the PL's own batch first (Shipping stamps it), then the bill's
    const batchNumber = selectedPlInput.batch_number || billData?.batch_number || '';

    const newItems = billItems.map((item) => ({
      batch_number: batchNumber,
      packing_list_no: selectedPlInput.packing_list_no,
      pl_input_id: selectedPlInput.id,
      purchase_bill_item_id: item.id,
      item_name: item.item_name,
      quantity: item.quantity_received,
      unit: item.unit || 'PCS',
      no_of_pkgs: 0,
      weight_kg: 0,
      cbm: 0,
      status: 'Matched',
    }));

    const { error } = await supabase.from('packing_list_items').insert(newItems);

    if (error) {
      console.error('Error creating packing list items:', error);
      alert('Could not create the packing list rows: ' + error.message);
      return;
    }

    setShowLinkModal(false);
    setSelectedPlInput(null);
    setBillItems([]);
    setSelectedPlNo('');
    setStatusFilter('');
    setSearchTerm('');
    await loadData();
    setActiveBatch(batchNumber || '__unassigned__');
  }

  async function addManualItem() {
    if (!newItem.packing_list_no || !newItem.item_name) return;

    const matchingPlInput = plInputRecords.find(
      (pl) => pl.packing_list_no === newItem.packing_list_no
    );

    const { error } = await supabase.from('packing_list_items').insert({
      batch_number: activeBatch === '__unassigned__' ? '' : activeBatch,
      packing_list_no: newItem.packing_list_no,
      pl_input_id: matchingPlInput?.id || null,
      item_name: newItem.item_name,
      quantity: newItem.quantity,
      unit: newItem.unit,
      no_of_pkgs: newItem.no_of_pkgs,
      weight_kg: newItem.weight_kg,
      cbm: newItem.cbm,
      status: matchingPlInput ? 'Matched' : 'Manual',
    });

    if (error) {
      console.error('Error adding item:', error);
      return;
    }

    setShowAddModal(false);
    setNewItem({
      packing_list_no: '',
      item_name: '',
      quantity: 0,
      unit: 'PCS',
      no_of_pkgs: 0,
      weight_kg: 0,
      cbm: 0,
    });
    loadItems();
  }

  async function deleteItem(id: string) {
    if (!confirm('Delete this item?')) return;

    const { error } = await supabase
      .from('packing_list_items')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting item:', error);
      return;
    }

    loadItems();
  }

  // Each typed value is saved ONCE (Enter, Tab or leaving the box — whichever comes first), with the value that was typed.
  // Before, Enter/Tab saved it and leaving the box saved it again (sometimes with an old value), and the box could close
  // while typing in the next one.
  const committedRef = useRef<Set<string>>(new Set());
  const [savedNote, setSavedNote] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const cellKey = (id: string, field: string) => `${id}:${field}`;
  function openCell(id: string, field: string, value: string) {
    committedRef.current.delete(cellKey(id, field));
    setEditingValue(value);
    setEditingCell({ id, field });
  }

  async function updateCell(id: string, field: string, value: number | string) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const before = item[field as keyof PackingListItem];
    if (String(before ?? '') === String(value)) return;            // nothing changed: nothing to save
    setSaving(true);
    let error;
    if (field === 'no_of_pkgs') {
      // packages belong to the whole packing list: every line of this PL gets the same number
      let q = supabase.from('packing_list_items').update({ no_of_pkgs: value, updated_at: new Date().toISOString() });
      q = item.batch_number ? q.eq('batch_number', item.batch_number) : q.is('batch_number', null);
      ({ error } = await q.eq('packing_list_no', item.packing_list_no));
      if (!error) setItems(prev => prev.map(i => i.batch_number === item.batch_number && i.packing_list_no === item.packing_list_no ? { ...i, no_of_pkgs: value as number } : i));
    } else {
      ({ error } = await supabase.from('packing_list_items').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', id));
      if (!error) setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i));
    }
    setSaving(false);
    if (error) {
      console.error('Error updating item:', error);
      alert(`Could not save ${field === 'weight_kg' ? 'the weight' : field === 'cbm' ? 'the CBM' : 'the packages'} for "${item.item_name}": ${error.message}`);
      return;
    }
    setSavedNote(`Saved ✓ ${item.item_name}: ${field === 'weight_kg' ? 'kg' : field === 'cbm' ? 'CBM' : 'packages'} ${before || 0} → ${value}`);
    window.setTimeout(() => setSavedNote(''), 4000);
  }

  function handleCellClick(id: string, field: string, currentValue: number) {
    if (field === 'weight_kg' || field === 'cbm' || field === 'no_of_pkgs') {
      if (editingCell?.id === id && editingCell?.field === field) return;
      openCell(id, field, currentValue > 0 ? String(currentValue) : '');
    }
  }

  /** save the typed value once; `close` = also close the box (only if it is still this box) */
  function commitEdit(id: string, field: string, close = true) {
    const key = cellKey(id, field);
    if (!committedRef.current.has(key)) {
      committedRef.current.add(key);
      updateCell(id, field, parseFloat(editingValue) || 0);
    }
    if (close) setEditingCell(c => (c && c.id === id && c.field === field ? null : c));
  }

  function handleKeyDown(e: React.KeyboardEvent, id: string, field: string) {
    if (e.key === 'Enter') {
      commitEdit(id, field);
    } else if (e.key === 'Escape') {
      committedRef.current.add(cellKey(id, field));                 // leaving with Escape saves nothing
      setEditingCell(null);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitEdit(id, field, false);

      const currentIdx = filteredItems.findIndex(i => i.id === id);
      const fields = ['no_of_pkgs', 'weight_kg', 'cbm'];
      const fieldIdx = fields.indexOf(field);

      let nextId = id;
      let nextField = field;

      if (e.shiftKey) {
        if (fieldIdx > 0) {
          nextField = fields[fieldIdx - 1];
        } else if (currentIdx > 0) {
          nextId = filteredItems[currentIdx - 1].id;
          nextField = fields[fields.length - 1];
        }
      } else {
        if (fieldIdx < fields.length - 1) {
          nextField = fields[fieldIdx + 1];
        } else if (currentIdx < filteredItems.length - 1) {
          nextId = filteredItems[currentIdx + 1].id;
          nextField = fields[0];
        }
      }

      if (nextId !== id || nextField !== field) {
        const nextItem = filteredItems.find(i => i.id === nextId);
        const nextVal = nextItem ? (nextItem[nextField as keyof PackingListItem] as number) : 0;
        openCell(nextId, nextField, nextVal > 0 ? String(nextVal) : '');
      } else {
        setEditingCell(null);
      }
    }
  }

  function exportToExcel() {
    const wsData: (string | number)[][] = [
      ['PACKING LIST'],
      [],
      ['Packing List No', 'NO. OF PKGS', 'FULL DESCRIPTION OF GOODS', 'QTY', 'UNIT OF MEASURE', 'WEIGHT (KG)', 'CBM', 'Status'],
    ];

    const seenPlNosExport = new Set<string>();
    filteredItems.forEach((item) => {
      const isMatched = !!item.pl_input_id;
      const isFirst = !seenPlNosExport.has(item.packing_list_no);
      if (isFirst) seenPlNosExport.add(item.packing_list_no);
      wsData.push([
        item.packing_list_no,
        isFirst ? (item.no_of_pkgs || 0) : '',
        item.item_name,
        item.quantity,
        item.unit,
        item.weight_kg || 0,
        item.cbm || 0,
        isMatched ? 'MATCHED' : 'PENDING',
      ]);
    });

    wsData.push([]);
    wsData.push(['GRAND TOTALS:', '', '', '', '', '', '', '']);

    const ws = XLSX.utils.aoa_to_sheet(wsData);

    const dataStartRow = 4;
    const dataEndRow = dataStartRow + filteredItems.length - 1;
    const totalRow = dataEndRow + 2;

    if (filteredItems.length > 0) {
      ws[`B${totalRow}`] = { t: 'n', f: `SUM(B${dataStartRow}:B${dataEndRow})` };
      ws[`F${totalRow}`] = { t: 'n', f: `SUM(F${dataStartRow}:F${dataEndRow})` };
      ws[`G${totalRow}`] = { t: 'n', f: `SUM(G${dataStartRow}:G${dataEndRow})` };
    }

    ws['!cols'] = [
      { wch: 15 },
      { wch: 12 },
      { wch: 40 },
      { wch: 10 },
      { wch: 15 },
      { wch: 12 },
      { wch: 10 },
      { wch: 12 },
    ];

    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }];

    const headerStyle = {
      fill: { fgColor: { rgb: '1A365D' } },
      font: { color: { rgb: 'FFFFFF' }, bold: true },
      alignment: { horizontal: 'center' },
    };

    const highlightStyle = {
      fill: { fgColor: { rgb: 'D97706' } },
      font: { color: { rgb: 'FFFFFF' }, bold: true },
    };

    const titleStyle = {
      font: { bold: true, sz: 16 },
      alignment: { horizontal: 'center' },
    };

    if (ws['A1']) ws['A1'].s = titleStyle;

    for (let c = 0; c < 8; c++) {
      const cell = XLSX.utils.encode_cell({ r: 2, c });
      if (ws[cell]) {
        ws[cell].s = c === 5 || c === 6 ? highlightStyle : headerStyle;
      }
    }

    const totalRowIdx = wsData.length - 1;
    for (let c = 0; c < 8; c++) {
      const cell = XLSX.utils.encode_cell({ r: totalRowIdx, c });
      if (ws[cell]) {
        ws[cell].s = c === 5 || c === 6 ? highlightStyle : headerStyle;
      }
    }

    for (let r = 3; r < wsData.length - 2; r++) {
      const statusCell = XLSX.utils.encode_cell({ r, c: 7 });
      if (ws[statusCell]) {
        const isMatched = ws[statusCell].v === 'MATCHED';
        ws[statusCell].s = {
          fill: { fgColor: { rgb: isMatched ? 'D1FAE5' : 'F3F4F6' } },
          font: { color: { rgb: isMatched ? '047857' : '4B5563' }, bold: true },
        };
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Packing List');

    XLSX.writeFile(wb, `packing_list_${new Date().toISOString().split('T')[0]}.xlsx`);
  }

  // Filter items by active batch
  const batchItems = items.filter((item) => {
    if (activeBatch === '__unassigned__') return !item.batch_number;
    return item.batch_number === activeBatch;
  });

  // PL Input records for the active batch
  const batchPlInputRecords = plInputRecords.filter((pl) => {
    if (activeBatch === '__unassigned__') return !pl.batch_number;
    return pl.batch_number === activeBatch;
  });

  const plBillIds = new Set(plInputRecords.map((p) => p.purchase_bill_id).filter(Boolean));
  const billsWithoutPl = activeBatch === '__unassigned__' ? [] : shipBills.filter((b) => b.batch_number === activeBatch && !plBillIds.has(b.id));

  const matchedPlInputIds = new Set(batchItems.filter((i) => i.pl_input_id).map((i) => i.pl_input_id));
  const unmatchedPlInputs = batchPlInputRecords.filter(
    (pl) => !matchedPlInputIds.has(pl.id)
  );

  const filteredItems = batchItems.filter((item) => {
    const matchesSearch =
      item.item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.packing_list_no.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesPlNo = !selectedPlNo || item.packing_list_no === selectedPlNo;
    const isMatched = !!item.pl_input_id;
    const matchesStatus = !statusFilter ||
      (statusFilter === 'matched' && isMatched) ||
      (statusFilter === 'pending' && !isMatched);
    return matchesSearch && matchesPlNo && matchesStatus;
  });

  const uniquePlNos = [...new Set(batchItems.map((i) => i.packing_list_no))];

  // First row per PL group — only this row shows and counts no_of_pkgs
  const firstRowByPlNo = new Map<string, string>();
  filteredItems.forEach((item) => {
    if (!firstRowByPlNo.has(item.packing_list_no)) {
      firstRowByPlNo.set(item.packing_list_no, item.id);
    }
  });

  // Total pkgs only counts the first row of each PL group to avoid duplication
  const totalPkgs = filteredItems.reduce((sum, i) => {
    if (firstRowByPlNo.get(i.packing_list_no) === i.id) {
      return sum + (i.no_of_pkgs || 0);
    }
    return sum;
  }, 0);
  const totalWeight = filteredItems.reduce((sum, i) => sum + (i.weight_kg || 0), 0);
  const totalCbm = filteredItems.reduce((sum, i) => sum + (i.cbm || 0), 0);

  // Batch history summary
  const batchSummary = allBatches.map((b) => {
    const batchRows = items.filter((i) => i.batch_number === b);
    const matched = batchRows.filter((i) => !!i.pl_input_id).length;
    const plNos = [...new Set(batchRows.map((i) => i.packing_list_no))];
    return {
      batch: b,
      total: batchRows.length,
      matched,
      plCount: plNos.length,
    };
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-blue-600"></div>
      </div>
    );
  }

  return (
    <>
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Packing List</h2>
        <div className="flex items-center space-x-2">
          {saving && <span className="text-sm text-teal-700">Saving...</span>}
          {!saving && savedNote && <span className="text-sm text-green-700">{savedNote}</span>}
          {activeBatch && activeBatch !== '__unassigned__' && (
            <button onClick={() => setHistoryOpen(true)} className="flex items-center gap-1 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50" title="Every change to this shipment, who and when"><HistoryIcon className="w-4 h-4" />History</button>
          )}
          <button
            onClick={loadData}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            onClick={exportToExcel}
            disabled={filteredItems.length === 0}
            className="flex items-center space-x-1 px-3 py-1.5 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>Export</span>
          </button>
          <button
            onClick={() => setShowPrintView(true)}
            disabled={filteredItems.length === 0}
            className="flex items-center space-x-1 px-3 py-1.5 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm disabled:opacity-50"
          >
            <Printer className="w-4 h-4" />
            <span>Print / PDF</span>
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center space-x-1 px-3 py-1.5 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Add Item</span>
          </button>
        </div>
      </div>

      {/* Batch Selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-gray-500">Batch:</span>
        {tabBatches.map((b) => (
          <button
            key={b}
            onClick={() => { setActiveBatch(b); setSelectedPlNo(''); }}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-all ${
              activeBatch === b
                ? 'bg-slate-900 text-white border-slate-900 shadow'
                : 'bg-white text-gray-600 border-gray-300 hover:border-slate-900 hover:text-[#1a365d]'
            }`}
          >
            {shipmentNos.includes(b) ? b : `Batch ${b}`}
          </button>
        ))}
        {items.some((i) => !i.batch_number) && (
          <button
            onClick={() => { setActiveBatch('__unassigned__'); setSelectedPlNo(''); }}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-all ${
              activeBatch === '__unassigned__'
                ? 'bg-gray-700 text-white border-gray-700 shadow'
                : 'bg-white text-gray-500 border-gray-300 hover:border-gray-500'
            }`}
          >
            Unassigned
          </button>
        )}
        <button
          onClick={() => setShowBatchHistory(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-300 rounded-full hover:bg-gray-50 hover:border-gray-400 transition-colors"
        >
          <History className="w-4 h-4" />
          <span>Load Previous</span>
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      {billsWithoutPl.length > 0 && (
        <div className="bg-teal-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-center space-x-2 mb-2">
            <Package className="w-4 h-4 text-teal-700" />
            <span className="text-sm font-medium text-blue-900">Bills in {activeBatch} with no packing list yet — click to create one from the bill items:</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {billsWithoutPl.map((b) => (
              <button key={b.id} disabled={creatingFromBill === b.id} onClick={() => createPlFromBill(b)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-sm bg-white border border-teal-300 rounded hover:bg-teal-100 disabled:opacity-50">
                <span className="font-medium text-teal-800">{b.cnv_invoice_number || b.bill_number}</span>
                <span className="text-xs text-gray-500">{b.supplier_name}</span>
                <Plus className="w-3 h-3 text-teal-700" />
              </button>
            ))}
          </div>
        </div>
      )}

      {unmatchedPlInputs.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <div className="flex items-center space-x-2 mb-2">
            <Package className="w-4 h-4 text-amber-600" />
            <span className="text-sm font-medium text-amber-900">Awaiting Match:</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {unmatchedPlInputs.map((pl) => (
              <button
                key={pl.id}
                onClick={() => selectPlInputForLink(pl)}
                className={`flex items-center space-x-1 px-2 py-1 text-sm bg-white border rounded hover:bg-amber-100 transition-colors ${
                  pl.purchase_bill_id ? 'border-amber-300' : 'border-emerald-300'
                }`}
              >
                <span className={`font-medium ${pl.purchase_bill_id ? 'text-amber-800' : 'text-emerald-800'}`}>
                  #{pl.packing_list_no}
                </span>
                {!pl.purchase_bill_id && (
                  <span className="text-xs bg-emerald-100 text-emerald-700 px-1 rounded">Manual</span>
                )}
                <Plus className={`w-3 h-3 ${pl.purchase_bill_id ? 'text-amber-600' : 'text-emerald-600'}`} />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search item name or PL number..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            />
          </div>
          <select
            value={selectedPlNo}
            onChange={(e) => setSelectedPlNo(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          >
            <option value="">All PL</option>
            {uniquePlNos.map((plNo) => (
              <option key={plNo} value={plNo}>#{plNo}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          >
            <option value="">All Status</option>
            <option value="matched">Matched</option>
            <option value="pending">Pending</option>
          </select>
          {(searchTerm || selectedPlNo || statusFilter) && (
            <button
              onClick={() => {
                setSearchTerm('');
                setSelectedPlNo('');
                setStatusFilter('');
              }}
              className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Batch History Modal */}
      {showBatchHistory && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Batch History</h3>
                <p className="text-sm text-gray-500">Select a batch to view its Packing List</p>
              </div>
              <button onClick={() => setShowBatchHistory(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="space-y-3">
              {batchSummary.map((b) => {
                const pct = b.total > 0 ? Math.round((b.matched / b.total) * 100) : 0;
                const isActive = activeBatch === b.batch;
                return (
                  <button
                    key={b.batch}
                    onClick={() => { setActiveBatch(b.batch); setSelectedPlNo(''); setShowBatchHistory(false); }}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
                      isActive
                        ? 'border-slate-900 bg-slate-900/5'
                        : 'border-gray-200 hover:border-slate-900 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-gray-900">Batch {b.batch}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">{b.plCount} PL</span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          pct === 100 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {b.matched}/{b.total} Matched
                        </span>
                      </div>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full transition-all ${pct === 100 ? 'bg-green-500' : 'bg-amber-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </button>
                );
              })}
              {batchSummary.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">No batch history found</p>
              )}
            </div>
          </div>
        </div>
      )}

      {showLinkModal && selectedPlInput && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-4 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold text-gray-900">
                  Match PL #{selectedPlInput.packing_list_no}
                </h3>
                <p className="text-sm text-gray-500">{selectedPlInput.supplier_name}</p>
              </div>
              <button onClick={() => setShowLinkModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {loadingBillItems ? (
              <div className="flex items-center justify-center py-6">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-200 border-t-blue-600"></div>
              </div>
            ) : billItems.length > 0 ? (
              <div>
                <p className="text-xs text-gray-500 mb-2">Items will be auto-filled. Enter Weight & CBM manually.</p>
                <table className="w-full text-sm border border-gray-200">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-700 border-b">Item</th>
                      <th className="px-2 py-1.5 text-right font-medium text-gray-700 border-b">Qty</th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-700 border-b">Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billItems.map((item, idx) => (
                      <tr key={item.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-2 py-1.5 border-b border-gray-100">{item.item_name}</td>
                        <td className="px-2 py-1.5 text-right border-b border-gray-100">{item.quantity_received}</td>
                        <td className="px-2 py-1.5 border-b border-gray-100">{item.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex justify-end space-x-2 mt-3">
                  <button
                    onClick={() => setShowLinkModal(false)}
                    className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={createPackingListFromPlInput}
                    className="px-3 py-1.5 text-sm bg-teal-600 text-white rounded hover:bg-teal-700 transition-colors"
                  >
                    Create Packing List
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-gray-500 text-sm space-y-3">
                <p>The linked purchase bill has no item lines, so there is nothing to copy.</p>
                <p className="text-xs">Either open the bill under <b>Bills</b> and add its items (then come back and click Match again), or add the packing list rows by hand:</p>
                <button
                  onClick={() => { setShowLinkModal(false); setNewItem({ ...newItem, packing_list_no: selectedPlInput?.packing_list_no || '' }); setShowAddModal(true); }}
                  className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-[#2c5282]"
                >
                  Add items manually to PL #{selectedPlInput?.packing_list_no}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-5 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-gray-900">
                  {newItem.packing_list_no ? `Add Item to PL #${newItem.packing_list_no}` : 'Add Packing List Item'}
                </h3>
                {newItem.packing_list_no && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {plInputRecords.find((pl) => pl.packing_list_no === newItem.packing_list_no)?.supplier_name || ''}
                  </p>
                )}
              </div>
              <button onClick={() => { setShowAddModal(false); setNewItem({ ...newItem, packing_list_no: '' }); }} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Packing List No *</label>
                <input
                  type="text"
                  value={newItem.packing_list_no}
                  onChange={(e) => setNewItem({ ...newItem, packing_list_no: e.target.value })}
                  placeholder="e.g. 1, 2, 3..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  readOnly={!!plInputRecords.find((pl) => pl.packing_list_no === newItem.packing_list_no)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Item Name *</label>
                <input
                  type="text"
                  value={newItem.item_name}
                  onChange={(e) => setNewItem({ ...newItem, item_name: e.target.value })}
                  placeholder="Enter item name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                  <input
                    type="number"
                    value={newItem.quantity}
                    onChange={(e) => setNewItem({ ...newItem, quantity: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                  <input
                    type="text"
                    value={newItem.unit}
                    onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">No. of Pkgs</label>
                  <input
                    type="number"
                    value={newItem.no_of_pkgs}
                    onChange={(e) => setNewItem({ ...newItem, no_of_pkgs: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Weight (KG)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newItem.weight_kg}
                    onChange={(e) => setNewItem({ ...newItem, weight_kg: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">CBM</label>
                  <input
                    type="number"
                    step="0.001"
                    value={newItem.cbm}
                    onChange={(e) => setNewItem({ ...newItem, cbm: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end space-x-2 mt-5">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setNewItem({
                    packing_list_no: '',
                    item_name: '',
                    quantity: 0,
                    unit: 'PCS',
                    no_of_pkgs: 0,
                    weight_kg: 0,
                    cbm: 0,
                  });
                }}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={addManualItem}
                disabled={!newItem.packing_list_no || !newItem.item_name}
                className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Item
              </button>
            </div>
          </div>
        </div>
      )}

      {filteredItems.length > 0 ? (
        <div className="border border-gray-400 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-900 text-white">
                  <th className="px-3 py-2 text-center font-semibold border border-slate-700 w-28">Packing List No</th>
                  <th className="px-3 py-2 text-center font-semibold border border-slate-700 w-20">NO. OF PKGS</th>
                  <th className="px-3 py-2 text-left font-semibold border border-slate-700">FULL DESCRIPTION OF GOODS</th>
                  <th className="px-3 py-2 text-center font-semibold border border-slate-700 w-20">QTY</th>
                  <th className="px-3 py-2 text-center font-semibold border border-slate-700 w-32">UNIT OF MEASURE</th>
                  <th className="px-3 py-2 text-center font-semibold border border-slate-700 w-24 bg-amber-600">WEIGHT (KG)</th>
                  <th className="px-3 py-2 text-center font-semibold border border-slate-700 w-20 bg-amber-600">CBM</th>
                  <th className="px-3 py-2 text-center font-semibold border border-slate-700 w-24">Status</th>
                  <th className="px-3 py-2 text-center font-semibold border border-slate-700 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item, idx) => {
                  const isMatched = !!item.pl_input_id;
                  const isFirstInGroup = firstRowByPlNo.get(item.packing_list_no) === item.id;
                  return (
                    <tr
                      key={item.id}
                      className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-teal-50`}
                    >
                      <td className="px-3 py-2 text-center border border-gray-300 font-medium text-gray-700">
                        {item.packing_list_no}
                      </td>
                      <td
                        className={`px-3 py-2 text-center border border-gray-300 ${
                          isFirstInGroup ? 'cursor-pointer hover:bg-teal-100' : 'bg-gray-50'
                        } ${editingCell?.id === item.id && editingCell?.field === 'no_of_pkgs' ? 'p-0' : ''}`}
                        onClick={() => isFirstInGroup && handleCellClick(item.id, 'no_of_pkgs', item.no_of_pkgs)}
                      >
                        {isFirstInGroup ? (
                          editingCell?.id === item.id && editingCell?.field === 'no_of_pkgs' ? (
                            <input
                              ref={inputRef}
                              type="number"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              className="w-full h-full px-2 py-1.5 text-center border-2 border-blue-500 outline-none"
                              onBlur={() => commitEdit(item.id, 'no_of_pkgs')}
                              onKeyDown={(e) => handleKeyDown(e, item.id, 'no_of_pkgs')}
                            />
                          ) : (
                            <span className={item.no_of_pkgs ? 'font-semibold' : 'text-gray-400 italic'}>{item.no_of_pkgs || '-'}</span>
                          )
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 border border-gray-300 font-medium text-gray-900">{item.item_name}</td>
                      <td className="px-3 py-2 text-center border border-gray-300">{item.quantity}</td>
                      <td className="px-3 py-2 text-center border border-gray-300 text-gray-600">{item.unit}</td>
                      <td
                        className={`px-3 py-2 text-right border border-gray-300 cursor-pointer bg-amber-50 hover:bg-amber-100 ${
                          editingCell?.id === item.id && editingCell?.field === 'weight_kg' ? 'p-0' : ''
                        }`}
                        onClick={() => handleCellClick(item.id, 'weight_kg', item.weight_kg)}
                      >
                        {editingCell?.id === item.id && editingCell?.field === 'weight_kg' ? (
                          <input
                            ref={inputRef}
                            type="number"
                            step="0.01"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            className="w-full h-full px-2 py-1.5 text-right border-2 border-blue-500 outline-none bg-white"
                            onBlur={() => commitEdit(item.id, 'weight_kg')}
                            onKeyDown={(e) => handleKeyDown(e, item.id, 'weight_kg')}
                          />
                        ) : item.weight_kg > 0 ? (
                          <span className="font-medium">{item.weight_kg.toFixed(2)}</span>
                        ) : (
                          <span className="text-amber-600 italic text-xs">enter</span>
                        )}
                      </td>
                      <td
                        className={`px-3 py-2 text-right border border-gray-300 cursor-pointer bg-amber-50 hover:bg-amber-100 ${
                          editingCell?.id === item.id && editingCell?.field === 'cbm' ? 'p-0' : ''
                        }`}
                        onClick={() => handleCellClick(item.id, 'cbm', item.cbm)}
                      >
                        {editingCell?.id === item.id && editingCell?.field === 'cbm' ? (
                          <input
                            ref={inputRef}
                            type="number"
                            step="0.001"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            className="w-full h-full px-2 py-1.5 text-right border-2 border-blue-500 outline-none bg-white"
                            onBlur={() => commitEdit(item.id, 'cbm')}
                            onKeyDown={(e) => handleKeyDown(e, item.id, 'cbm')}
                          />
                        ) : item.cbm > 0 ? (
                          <span className="font-medium">{item.cbm.toFixed(3)}</span>
                        ) : (
                          <span className="text-amber-600 italic text-xs">enter</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center border border-gray-300">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                          isMatched ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {isMatched ? 'MATCHED' : 'PENDING'}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-center border border-gray-300">
                        <button
                          onClick={() => deleteItem(item.id)}
                          className="p-1 text-red-500 hover:bg-red-50 rounded transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-slate-900 text-white font-bold">
                  <td className="px-3 py-2 text-right border border-slate-700">GRAND TOTALS:</td>
                  <td className="px-3 py-2 text-center border border-slate-700 bg-teal-700">{totalPkgs}</td>
                  <td colSpan={3} className="px-3 py-2 border border-slate-700"></td>
                  <td className="px-3 py-2 text-right border border-slate-700 bg-amber-600">{totalWeight.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right border border-slate-700 bg-amber-600">{totalCbm.toFixed(3)}</td>
                  <td className="px-3 py-2 border border-slate-700"></td>
                  <td className="px-3 py-2 border border-slate-700"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <Package className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500 text-sm">No packing list items for {activeBatch === '__unassigned__' ? 'Unassigned' : activeBatch}{billsWithoutPl.length > 0 ? ' — use the blue buttons above to create them from the bills.' : unmatchedPlInputs.length > 0 ? ' — click a PL number above to create its items.' : '.'}</p>
          <p className="text-xs text-gray-400 mt-1">Click on a PL Input above to create</p>
        </div>
      )}

      <div className="bg-teal-50 border border-blue-100 rounded-lg p-3 text-xs text-teal-800">
        <div className="flex items-center space-x-1 mb-1">
          <Link className="w-3.5 h-3.5" />
          <span className="font-medium">Quick Tips:</span>
        </div>
        <ul className="space-y-0.5 ml-4">
          <li>Click on yellow cells (Weight/CBM) to enter values directly</li>
          <li>Press Tab to move to next cell, Enter to save</li>
          <li>Items are auto-populated when PL number matches</li>
        </ul>
      </div>
    </div>
      {showPrintView && (
        <PackingListPrint
          items={filteredItems}
          batchNumber={activeBatch === '__unassigned__' ? 'Unassigned' : activeBatch}
          onClose={() => setShowPrintView(false)}
        />
      )}
      {historyOpen && activeBatch && <ChangeHistory batch={activeBatch} onClose={() => setHistoryOpen(false)} />}
    </>
  );
}
