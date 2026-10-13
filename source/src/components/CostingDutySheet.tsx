import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Calculator, RefreshCw, Plus, Trash2, Download, Search, X, History, ChevronDown, Printer, Scale, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import CostingDutyPrint from './CostingDutyPrint';

interface PackingListItem {
  id: string;
  batch_number: string;
  packing_list_no: string;
  item_name: string;
  quantity: number;
  unit: string;
  weight_kg: number;
  cbm: number;
  purchase_bill_item_id: string | null;
}

interface PurchaseBillItem {
  id: string;
  unit_price_cny: number;
}

interface CostingRecord {
  id: string;
  batch_number: string;
  packing_list_item_id: string | null;
  description: string;
  qty: number;
  unit: string;
  weight_kg: number;
  cbm: number;
  unit_price_cny: number;
  cny_rate: number;
  unit_price_lkr: number;
  type: 'RESALE' | 'FACTORY';
  duty_basis: 'CBM' | 'KG' | 'PCS';
  duty_rate: number;
  duty_per_unit: number;
  landed_cost_per_unit: number;
  selling_price: number;
  profit_per_unit: number;
  total_landed_cost: number;
  total_sales: number;
  total_profit: number;
}

function sortBatches(batches: string[]): string[] {
  return [...batches].sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ''), 10);
    const numB = parseInt(b.replace(/\D/g, ''), 10);
    if (!isNaN(numA) && !isNaN(numB)) return numB - numA;
    return b.localeCompare(a);
  });
}

export default function CostingDutySheet() {
  const [records, setRecords] = useState<CostingRecord[]>([]);
  const [packingItems, setPackingItems] = useState<PackingListItem[]>([]);
  const [billItemsMap, setBillItemsMap] = useState<Record<string, PurchaseBillItem>>({});
  const [allBatches, setAllBatches] = useState<string[]>([]);
  const [activeBatch, setActiveBatch] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showPrintView, setShowPrintView] = useState(false);
  const [selectedPlNo, setSelectedPlNo] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [dutyBasisFilter, setDutyBasisFilter] = useState('');
  const [globalCnyRate, setGlobalCnyRate] = useState(0);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showBatchHistory, setShowBatchHistory] = useState(false);
  const [lumpsumCharges, setLumpsumCharges] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [shipment, setShipment] = useState<{ id: string; default_basis: 'CBM' | 'KG' | 'PCS'; rate_cbm: number; rate_kg: number; rate_pcs: number; actual_charges: number; mode: string } | null>(null);
  const [showSplit, setShowSplit] = useState(false);
  const [splitField, setSplitField] = useState<'cbm' | 'weight_kg'>('cbm');
  const [splitBasis, setSplitBasis] = useState<'value' | 'quantity' | 'equal'>('value');
  const [splitTotal, setSplitTotal] = useState('');
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

  // Update CNY rate display when active batch changes
  useEffect(() => {
    if (!activeBatch) return;
    const batchRecords = records.filter(r => (r.batch_number || '') === activeBatch);
    if (batchRecords.length > 0 && batchRecords[0].cny_rate > 0) {
      setGlobalCnyRate(batchRecords[0].cny_rate);
    } else {
      // New or unrated batch: carry over the rate from the latest batch that has one
      const lastRated = [...records].reverse().find(r => r.cny_rate > 0);
      setGlobalCnyRate(lastRated ? lastRated.cny_rate : 0);
    }
    setSelectedIds(new Set());
    setSelectedPlNo('');
    setSearchTerm('');
    setTypeFilter('');
    setDutyBasisFilter('');
    setLumpsumCharges(0);
    setShipment(null);
    supabase
      .from('shipments')
      .select('id, default_basis, rate_cbm, rate_kg, rate_pcs, actual_charges, mode')
      .eq('shipment_no', activeBatch)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setShipment(data);
          if (data.actual_charges > 0) setLumpsumCharges(data.actual_charges);
        }
      });
  }, [activeBatch]);

  // Persist the shipment charges so they survive a reload (only when the batch is a Shipping record)
  async function saveLumpsum(value: number) {
    setLumpsumCharges(value);
    if (!shipment) return;
    await supabase.from('shipments').update({ actual_charges: value }).eq('id', shipment.id);
  }

  function shipmentRate(basis: 'CBM' | 'KG' | 'PCS') {
    if (!shipment) return 0;
    return basis === 'CBM' ? shipment.rate_cbm : basis === 'KG' ? shipment.rate_kg : shipment.rate_pcs;
  }

  async function loadData() {
    setLoading(true);
    await Promise.all([loadRecords(), loadPackingItems()]);
    setLoading(false);
  }

  async function loadRecords() {
    const { data, error } = await supabase
      .from('costing_duty_sheet')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error loading costing records:', error);
      return;
    }

    const parsed: CostingRecord[] = (data || []).map(row => ({
      ...row,
      batch_number: row.batch_number || '',
      qty: parseFloat(row.qty) || 0,
      weight_kg: parseFloat(row.weight_kg) || 0,
      cbm: parseFloat(row.cbm) || 0,
      unit_price_cny: parseFloat(row.unit_price_cny) || 0,
      cny_rate: parseFloat(row.cny_rate) || 0,
      unit_price_lkr: parseFloat(row.unit_price_lkr) || 0,
      duty_rate: parseFloat(row.duty_rate) || 0,
      duty_per_unit: parseFloat(row.duty_per_unit) || 0,
      landed_cost_per_unit: parseFloat(row.landed_cost_per_unit) || 0,
      selling_price: parseFloat(row.selling_price) || 0,
      profit_per_unit: parseFloat(row.profit_per_unit) || 0,
      total_landed_cost: parseFloat(row.total_landed_cost) || 0,
      total_sales: parseFloat(row.total_sales) || 0,
      total_profit: parseFloat(row.total_profit) || 0,
    }));

    setRecords(parsed);

    // Derive batches from packing_list_items (source of truth) — done in loadPackingItems
    // But also capture any batches from existing costing records
    const batchSet = new Set<string>();
    parsed.forEach(r => { if (r.batch_number) batchSet.add(r.batch_number); });
    // allBatches will be merged in loadPackingItems
    return batchSet;
  }

  async function loadPackingItems() {
    const { data: plItems, error: plError } = await supabase
      .from('packing_list_items')
      .select('id, batch_number, packing_list_no, item_name, quantity, unit, weight_kg, cbm, purchase_bill_item_id')
      .order('packing_list_no', { ascending: true });

    if (plError) {
      console.error('Error loading packing list items:', plError);
      return;
    }

    const items = plItems || [];
    setPackingItems(items);

    // Build bill items map
    const billItemIds = items
      .filter(i => i.purchase_bill_item_id)
      .map(i => i.purchase_bill_item_id as string);

    if (billItemIds.length > 0) {
      const { data: billItems, error: billError } = await supabase
        .from('purchase_bill_items')
        .select('id, unit_price_cny')
        .in('id', billItemIds);

      if (!billError && billItems) {
        const map: Record<string, PurchaseBillItem> = {};
        billItems.forEach(item => { map[item.id] = item; });
        setBillItemsMap(map);
      }
    }

    // Derive batches from packing list items, plus any shipment created in Shipping
    const batchSet = new Set<string>();
    items.forEach(i => { if (i.batch_number) batchSet.add(i.batch_number); });
    const { data: ships } = await supabase.from('shipments').select('shipment_no');
    (ships || []).forEach((sh: { shipment_no: string }) => batchSet.add(sh.shipment_no));
    const sorted = sortBatches(Array.from(batchSet));
    setAllBatches(sorted);

    setActiveBatch(prev => {
      if (prev && batchSet.has(prev)) return prev;
      return sorted[0] || '';
    });
  }

  async function importFromPackingList() {
    const batchPackingItems = packingItems.filter(i => (i.batch_number || '') === activeBatch);
    if (batchPackingItems.length === 0) {
      alert(`No packing list rows exist for ${activeBatch} yet.\nGo to Packing List, open the ${activeBatch} tab and create the rows from the bills first.`);
      setShowImportModal(false);
      return;
    }

    const existingPlItemIds = new Set(
      records
        .filter(r => r.packing_list_item_id && (r.batch_number || '') === activeBatch)
        .map(r => r.packing_list_item_id)
    );
    const newItems = batchPackingItems.filter(i => !existingPlItemIds.has(i.id));

    if (newItems.length === 0) {
      setShowImportModal(false);
      return;
    }

    const toInsert = newItems.map(item => {
      const billItem = item.purchase_bill_item_id ? billItemsMap[item.purchase_bill_item_id] : null;
      return {
        batch_number: activeBatch,
        packing_list_item_id: item.id,
        description: item.item_name,
        qty: item.quantity,
        unit: item.unit,
        weight_kg: item.weight_kg || 0,
        cbm: item.cbm || 0,
        unit_price_cny: billItem?.unit_price_cny || 0,
        cny_rate: globalCnyRate,
        type: 'RESALE',
        duty_basis: shipment ? shipment.default_basis : 'CBM',
        duty_rate: shipment ? shipmentRate(shipment.default_basis) : 0,
        selling_price: 0,
      };
    });

    const { error } = await supabase.from('costing_duty_sheet').insert(toInsert);

    if (error) {
      console.error('Error importing items:', error);
      alert('Import failed: ' + error.message);
      return;
    }

    setShowImportModal(false);
    loadRecords();
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function applySplit() {
    const total = parseFloat(splitTotal) || 0;
    const rows = records.filter(r => selectedIds.has(r.id));
    if (rows.length < 2 || total <= 0) return;

    const weightOf = (r: CostingRecord) =>
      splitBasis === 'value' ? r.unit_price_cny * r.qty
      : splitBasis === 'quantity' ? r.qty
      : 1;
    let weights = rows.map(weightOf);
    let sum = weights.reduce((a, b) => a + b, 0);
    if (sum <= 0) { // e.g. no prices yet - fall back to equal split
      weights = rows.map(() => 1);
      sum = rows.length;
    }
    // round to 4 places and push the rounding difference onto the last row so the total is exact
    const shares = weights.map(w => Math.round((total * w / sum) * 10000) / 10000);
    const drift = Math.round((total - shares.reduce((a, b) => a + b, 0)) * 10000) / 10000;
    shares[shares.length - 1] = Math.round((shares[shares.length - 1] + drift) * 10000) / 10000;

    setSaving(true);
    for (let i = 0; i < rows.length; i++) {
      const { error } = await supabase
        .from('costing_duty_sheet')
        .update({ [splitField]: shares[i] })
        .eq('id', rows[i].id);
      if (error) console.error('Error applying split:', error);
    }
    setSaving(false);
    setShowSplit(false);
    setSplitTotal('');
    setSelectedIds(new Set());
    loadRecords();
  }

  async function addManualRow() {
    const { error } = await supabase.from('costing_duty_sheet').insert({
      batch_number: activeBatch,
      description: '',
      qty: 0,
      unit: 'PCS',
      weight_kg: 0,
      cbm: 0,
      unit_price_cny: 0,
      cny_rate: globalCnyRate,
      type: 'RESALE',
      duty_basis: shipment ? shipment.default_basis : 'CBM',
      duty_rate: shipment ? shipmentRate(shipment.default_basis) : 0,
      selling_price: 0,
    });

    if (error) {
      console.error('Error adding row:', error);
      return;
    }

    loadRecords();
  }

  async function deleteRecord(id: string) {
    if (!confirm('Delete this row?')) return;
    const { error } = await supabase.from('costing_duty_sheet').delete().eq('id', id);
    if (error) { console.error('Error deleting:', error); return; }
    setRecords(prev => prev.filter(r => r.id !== id));
  }

  async function updateCell(id: string, field: string, value: number | string) {
    // Optimistically update local state immediately so selects don't revert
    setRecords(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    setEditingCell(null);

    setSaving(true);
    const { data, error } = await supabase
      .from('costing_duty_sheet')
      .update({ [field]: value })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating:', error);
    } else if (data) {
      // Merge DB-recalculated fields back into local state for this row only
      const updated: CostingRecord = {
        ...data,
        batch_number: data.batch_number || '',
        qty: parseFloat(data.qty) || 0,
        weight_kg: parseFloat(data.weight_kg) || 0,
        cbm: parseFloat(data.cbm) || 0,
        unit_price_cny: parseFloat(data.unit_price_cny) || 0,
        cny_rate: parseFloat(data.cny_rate) || 0,
        unit_price_lkr: parseFloat(data.unit_price_lkr) || 0,
        duty_rate: parseFloat(data.duty_rate) || 0,
        duty_per_unit: parseFloat(data.duty_per_unit) || 0,
        landed_cost_per_unit: parseFloat(data.landed_cost_per_unit) || 0,
        selling_price: parseFloat(data.selling_price) || 0,
        profit_per_unit: parseFloat(data.profit_per_unit) || 0,
        total_landed_cost: parseFloat(data.total_landed_cost) || 0,
        total_sales: parseFloat(data.total_sales) || 0,
        total_profit: parseFloat(data.total_profit) || 0,
      };
      setRecords(prev => prev.map(r => r.id === id ? updated : r));
    }
    setSaving(false);
  }

  async function updateGlobalCnyRate(rate: number) {
    const batchRecs = records.filter(r => (r.batch_number || '') === activeBatch);
    if (batchRecs.length === 0) {
      setGlobalCnyRate(rate);
      return;
    }

    // Optimistic update
    setGlobalCnyRate(rate);
    setRecords(prev => prev.map(r =>
      (r.batch_number || '') === activeBatch ? { ...r, cny_rate: rate } : r
    ));

    setSaving(true);
    const ids = batchRecs.map(r => r.id);
    const { data, error } = await supabase
      .from('costing_duty_sheet')
      .update({ cny_rate: rate })
      .in('id', ids)
      .select();

    if (error) {
      console.error('Error updating CNY rate:', error);
    } else if (data) {
      // Merge recalculated rows back
      const updatedMap: Record<string, CostingRecord> = {};
      data.forEach((row: Record<string, unknown>) => {
        updatedMap[row.id as string] = {
          ...row,
          batch_number: (row.batch_number as string) || '',
          qty: parseFloat(row.qty as string) || 0,
          weight_kg: parseFloat(row.weight_kg as string) || 0,
          cbm: parseFloat(row.cbm as string) || 0,
          unit_price_cny: parseFloat(row.unit_price_cny as string) || 0,
          cny_rate: parseFloat(row.cny_rate as string) || 0,
          unit_price_lkr: parseFloat(row.unit_price_lkr as string) || 0,
          duty_rate: parseFloat(row.duty_rate as string) || 0,
          duty_per_unit: parseFloat(row.duty_per_unit as string) || 0,
          landed_cost_per_unit: parseFloat(row.landed_cost_per_unit as string) || 0,
          selling_price: parseFloat(row.selling_price as string) || 0,
          profit_per_unit: parseFloat(row.profit_per_unit as string) || 0,
          total_landed_cost: parseFloat(row.total_landed_cost as string) || 0,
          total_sales: parseFloat(row.total_sales as string) || 0,
          total_profit: parseFloat(row.total_profit as string) || 0,
        } as CostingRecord;
      });
      setRecords(prev => prev.map(r => updatedMap[r.id] ?? r));
    }
    setSaving(false);
  }

  function handleCellClick(id: string, field: string, currentValue: string | number) {
    const editableFields = ['description', 'qty', 'unit', 'weight_kg', 'cbm', 'unit_price_cny', 'duty_rate', 'selling_price'];
    if (!editableFields.includes(field)) return;
    setEditingCell({ id, field });
    setEditingValue(String(currentValue));
  }

  function commitEdit(id: string, field: string) {
    const isNumeric = ['qty', 'weight_kg', 'cbm', 'unit_price_cny', 'duty_rate', 'selling_price'].includes(field);
    updateCell(id, field, isNumeric ? parseFloat(editingValue) || 0 : editingValue);
  }

  function handleKeyDown(e: React.KeyboardEvent, id: string, field: string) {
    if (e.key === 'Enter') {
      commitEdit(id, field);
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  }

  function exportToExcel() {
    const wsData: (string | number)[][] = [
      [`COSTING & DUTY SHEET - Batch ${activeBatch}`],
      [`CNY Rate: ${globalCnyRate}`],
      [],
      ['Description', 'Qty', 'Unit', 'Weight KG', 'CBM', 'Unit Price CNY', 'CNY Rate', 'Unit Price LKR', 'Type', 'Duty Basis', 'Duty Rate', 'Duty/Unit', 'Landed Cost/Unit', 'Selling Price', 'Profit/Unit', 'Total Landed', 'Total Sales', 'Total Profit'],
    ];

    filteredRecords.forEach(r => {
      wsData.push([
        r.description,
        r.qty,
        r.unit,
        r.weight_kg,
        r.cbm,
        r.unit_price_cny,
        r.cny_rate,
        parseFloat(r.unit_price_lkr.toFixed(2)),
        r.type,
        r.duty_basis,
        r.duty_rate,
        parseFloat(r.duty_per_unit.toFixed(2)),
        parseFloat(r.landed_cost_per_unit.toFixed(2)),
        r.selling_price,
        parseFloat(r.profit_per_unit.toFixed(2)),
        parseFloat(r.total_landed_cost.toFixed(2)),
        parseFloat(r.total_sales.toFixed(2)),
        parseFloat(r.total_profit.toFixed(2)),
      ]);
    });

    wsData.push([]);
    wsData.push([
      '', '', '', '', '', '', '', '', '', '', '', '', '', 'TOTALS:',
      '',
      parseFloat(totals.totalLanded.toFixed(2)),
      parseFloat(totals.totalSales.toFixed(2)),
      parseFloat(totals.totalProfit.toFixed(2)),
    ]);

    const ws = XLSX.utils.aoa_to_sheet(wsData);

    ws['!cols'] = [
      { wch: 30 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 10 },
      { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 },
      { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
      { wch: 14 }, { wch: 12 }, { wch: 12 },
    ];
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 17 } }];

    const headerStyle = { fill: { fgColor: { rgb: '1A365D' } }, font: { color: { rgb: 'FFFFFF' }, bold: true }, alignment: { horizontal: 'center' } };
    const priceColStyle = { fill: { fgColor: { rgb: '1E40AF' } }, font: { color: { rgb: 'FFFFFF' }, bold: true } };
    const dutyColStyle = { fill: { fgColor: { rgb: 'D97706' } }, font: { color: { rgb: 'FFFFFF' }, bold: true } };
    const landedColStyle = { fill: { fgColor: { rgb: '047857' } }, font: { color: { rgb: 'FFFFFF' }, bold: true } };
    const salesColStyle = { fill: { fgColor: { rgb: '0D9488' } }, font: { color: { rgb: 'FFFFFF' }, bold: true } };
    const titleStyle = { font: { bold: true, sz: 16 }, alignment: { horizontal: 'center' } };

    if (ws['A1']) ws['A1'].s = titleStyle;

    const headerColors: Record<number, object> = {
      5: priceColStyle, 6: priceColStyle, 7: priceColStyle,
      10: dutyColStyle, 11: dutyColStyle,
      12: landedColStyle, 13: salesColStyle, 14: salesColStyle,
      15: landedColStyle, 16: salesColStyle, 17: salesColStyle,
    };

    for (let c = 0; c < 18; c++) {
      const cell = XLSX.utils.encode_cell({ r: 3, c });
      if (ws[cell]) ws[cell].s = headerColors[c] || headerStyle;
    }

    const totalRow = wsData.length - 1;
    for (let c = 0; c < 18; c++) {
      const cell = XLSX.utils.encode_cell({ r: totalRow, c });
      if (ws[cell]) {
        if (c === 15) ws[cell].s = landedColStyle;
        else if (c >= 16) ws[cell].s = salesColStyle;
        else ws[cell].s = headerStyle;
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Costing Duty Sheet');
    XLSX.writeFile(wb, `costing_batch${activeBatch}_${new Date().toISOString().split('T')[0]}.xlsx`);
  }

  // Batch-scoped derived data
  const batchRecords = records.filter(r => (r.batch_number || '') === activeBatch);
  const batchPackingItems = packingItems.filter(i => (i.batch_number || '') === activeBatch);
  const uniquePlNos = [...new Set(batchPackingItems.map(i => i.packing_list_no))];
  const existingPlItemIds = new Set(batchRecords.filter(r => r.packing_list_item_id).map(r => r.packing_list_item_id));
  const newItemsCount = batchPackingItems.filter(i => !existingPlItemIds.has(i.id)).length;

  const plItemMap = new Map(packingItems.map(p => [p.id, p]));

  const filteredRecords = batchRecords.filter(r => {
    const matchesSearch = r.description.toLowerCase().includes(searchTerm.toLowerCase());
    const plItem = r.packing_list_item_id ? plItemMap.get(r.packing_list_item_id) : undefined;
    const matchesPlNo = !selectedPlNo || plItem?.packing_list_no === selectedPlNo;
    const matchesType = !typeFilter || r.type === typeFilter;
    const matchesDutyBasis = !dutyBasisFilter || r.duty_basis === dutyBasisFilter;
    return matchesSearch && matchesPlNo && matchesType && matchesDutyBasis;
  }).sort((a, b) => {
    const plA = a.packing_list_item_id ? plItemMap.get(a.packing_list_item_id)?.packing_list_no || '' : '';
    const plB = b.packing_list_item_id ? plItemMap.get(b.packing_list_item_id)?.packing_list_no || '' : '';
    if (plA !== plB) return plA.localeCompare(plB, undefined, { numeric: true });
    return a.description.localeCompare(b.description);
  });

  const totals = {
    totalLanded: filteredRecords.reduce((sum, r) => sum + r.total_landed_cost, 0),
    totalSales: filteredRecords.filter(r => r.type === 'RESALE').reduce((sum, r) => sum + r.total_sales, 0),
    totalProfit: filteredRecords.filter(r => r.type === 'RESALE').reduce((sum, r) => sum + r.total_profit, 0),
    totalProductCost: filteredRecords.reduce((sum, r) => sum + (r.unit_price_lkr * r.qty), 0),
    totalDutyAllocated: filteredRecords.reduce((sum, r) => sum + (r.duty_per_unit * r.qty), 0),
    // FACTORY rows are goods for the glove factory: counted as transferred at landed cost, not as unsold stock
    factoryTransfer: filteredRecords.filter(r => r.type === 'FACTORY').reduce((sum, r) => sum + r.total_landed_cost, 0),
  };

  const totalInvestment = totals.totalProductCost + lumpsumCharges;
  const expectedProfit = totals.totalSales + totals.factoryTransfer - totalInvestment;
  const profitMargin = totals.totalSales > 0 ? (expectedProfit / totals.totalSales) * 100 : 0;
  const isProfitable = expectedProfit > 0;

  // Batch history summary
  const batchSummary = allBatches.map(b => {
    const br = records.filter(r => (r.batch_number || '') === b);
    const plItems = packingItems.filter(i => (i.batch_number || '') === b);
    return { batch: b, costingCount: br.length, plItemCount: plItems.length };
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Costing & Duty Sheet</h2>
        <div className="flex items-center space-x-2">
          {saving && <span className="text-sm text-teal-700">Saving...</span>}
          <button
            onClick={loadData}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            onClick={exportToExcel}
            disabled={filteredRecords.length === 0}
            className="flex items-center space-x-1 px-3 py-1.5 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>Export</span>
          </button>
          <button
            onClick={() => setShowPrintView(true)}
            disabled={filteredRecords.length === 0}
            className="flex items-center space-x-1 px-3 py-1.5 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm disabled:opacity-50"
          >
            <Printer className="w-4 h-4" />
            <span>Print / PDF</span>
          </button>
          {activeBatch && (
            <>
              <button
                onClick={() => setShowImportModal(true)}
                disabled={newItemsCount === 0}
                className="flex items-center space-x-1 px-3 py-1.5 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                <span>Import from PL {newItemsCount > 0 ? `(${newItemsCount})` : ''}</span>
              </button>
              <button
                onClick={addManualRow}
                className="flex items-center space-x-1 px-3 py-1.5 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Add Row</span>
              </button>
              <button
                onClick={() => setShowSplit(true)}
                disabled={selectedIds.size < 2}
                title={selectedIds.size < 2 ? 'Tick 2 or more rows packed together first' : 'Divide one total CBM or weight across the ticked rows'}
                className="flex items-center space-x-1 px-3 py-1.5 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Scale className="w-4 h-4" />
                <span>Split CBM / Wt{selectedIds.size >= 2 ? ` (${selectedIds.size})` : ''}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Batch Selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-gray-500">Batch:</span>
        {allBatches.map(b => (
          <button
            key={b}
            onClick={() => setActiveBatch(b)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-all ${
              activeBatch === b
                ? 'bg-slate-900 text-white border-slate-900 shadow'
                : 'bg-white text-gray-600 border-gray-300 hover:border-slate-900 hover:text-[#1a365d]'
            }`}
          >
            Batch {b}
          </button>
        ))}
        <button
          onClick={() => setShowBatchHistory(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-300 rounded-full hover:bg-gray-50 hover:border-gray-400 transition-colors"
        >
          <History className="w-4 h-4" />
          <span>Load Previous</span>
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      {/* Batch History Modal */}
      {showBatchHistory && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Batch History</h3>
                <p className="text-sm text-gray-500">Select a batch to load its costing sheet</p>
              </div>
              <button onClick={() => setShowBatchHistory(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="space-y-3">
              {batchSummary.map(b => {
                const isActive = activeBatch === b.batch;
                const pct = b.plItemCount > 0 ? Math.round((b.costingCount / b.plItemCount) * 100) : 0;
                return (
                  <button
                    key={b.batch}
                    onClick={() => { setActiveBatch(b.batch); setShowBatchHistory(false); }}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
                      isActive
                        ? 'border-slate-900 bg-slate-900/5'
                        : 'border-gray-200 hover:border-slate-900 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-gray-900">Batch {b.batch}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">{b.plItemCount} PL items</span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          b.costingCount > 0 ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {b.costingCount} costing rows
                        </span>
                      </div>
                    </div>
                    {b.plItemCount > 0 && (
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full bg-teal-500 transition-all"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    )}
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

      {!activeBatch ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <Calculator className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500 text-sm">No batches found</p>
          <p className="text-xs text-gray-400 mt-1">Create packing list items first to see batches here</p>
        </div>
      ) : (
        <>
          {globalCnyRate <= 0 && batchRecords.length > 0 && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-300 text-red-800 rounded-lg px-4 py-2 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>CNY rate is 0 for this batch, so landed cost shows duty only. Enter the rate below to include product cost.</span>
            </div>
          )}

          {/* Filters & CNY Rate */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">CNY Rate:</label>
                <input
                  type="number"
                  step="0.01"
                  value={globalCnyRate || ''}
                  onChange={(e) => setGlobalCnyRate(parseFloat(e.target.value) || 0)}
                  onBlur={(e) => updateGlobalCnyRate(parseFloat(e.target.value) || 0)}
                  className="w-24 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g. 45.50"
                />
                <span className="text-xs text-gray-500">LKR per CNY</span>
              </div>
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search description..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>
              <select
                value={selectedPlNo}
                onChange={(e) => setSelectedPlNo(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="">All PL</option>
                {uniquePlNos.map((plNo) => (
                  <option key={plNo} value={plNo}>#{plNo}</option>
                ))}
              </select>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="">All Types</option>
                <option value="RESALE">Resale</option>
                <option value="FACTORY">Factory</option>
              </select>
              <select
                value={dutyBasisFilter}
                onChange={(e) => setDutyBasisFilter(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="">All Duty Basis</option>
                <option value="CBM">CBM</option>
                <option value="KG">KG</option>
                <option value="PCS">PCS</option>
              </select>
              {(searchTerm || selectedPlNo || typeFilter || dutyBasisFilter) && (
                <button
                  onClick={() => { setSearchTerm(''); setSelectedPlNo(''); setTypeFilter(''); setDutyBasisFilter(''); }}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Shipment Profitability Dashboard */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-start gap-6">
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-teal-700" />
                  Shipment Profitability
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Shipment Charges - Lumpsum (LKR)
                    </label>
                    <p className="text-xs text-gray-500 mb-2">
                      Customs Duty + Ocean Freight + Other Charges (excl. product cost)
                    </p>
                    <input
                      type="number"
                      step="0.01"
                      value={lumpsumCharges || ''}
                      onChange={(e) => setLumpsumCharges(parseFloat(e.target.value) || 0)}
                      onBlur={(e) => saveLumpsum(parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter shipment charges..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Product Cost from Table (LKR)
                    </label>
                    <p className="text-xs text-gray-500 mb-2">Sum of (Unit Price LKR x Qty) for all items</p>
                    <div className="w-full px-3 py-2 text-sm bg-gray-100 border border-gray-300 rounded-lg font-semibold text-gray-800">
                      {totals.totalProductCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              </div>
              <div className="w-px bg-gray-200 self-stretch"></div>
              <div className="w-80">
                <h4 className="text-xs font-semibold text-gray-700 mb-3">Profitability Status</h4>
                {(lumpsumCharges > 0 || totals.totalSales > 0) ? (
                  <div className={`p-4 rounded-lg border-2 ${
                    lumpsumCharges === 0
                      ? 'bg-gray-50 border-gray-200'
                      : isProfitable
                        ? 'bg-green-50 border-green-400'
                        : 'bg-red-50 border-red-400'
                  }`}>
                    {lumpsumCharges > 0 && totals.totalSales > 0 && (
                      <div className={`text-lg font-bold mb-3 flex items-center gap-2 ${isProfitable ? 'text-green-700' : 'text-red-700'}`}>
                        {isProfitable ? (
                          <>
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                            PROFITABLE
                          </>
                        ) : (
                          <>
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/></svg>
                            LOSS
                          </>
                        )}
                      </div>
                    )}
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Product Cost:</span>
                        <span className="font-semibold text-gray-700">{totals.totalProductCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Shipment Charges:</span>
                        <span className="font-semibold text-teal-700">{lumpsumCharges.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between items-center pt-1.5 border-t border-gray-200">
                        <span className="text-gray-700 font-medium">Total Investment:</span>
                        <span className="font-bold text-gray-900">{totalInvestment.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Expected Sales (resale):</span>
                        <span className="font-semibold text-teal-700">{totals.totalSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </div>
                      {totals.factoryTransfer > 0 && (
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">To factory at landed cost:</span>
                          <span className="font-semibold text-purple-700">{totals.factoryTransfer.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                        </div>
                      )}
                      <div className={`flex justify-between items-center pt-1.5 border-t ${isProfitable ? 'border-green-300' : 'border-red-300'}`}>
                        <span className="text-gray-700 font-medium">Expected Profit:</span>
                        <span className={`font-bold text-lg ${isProfitable ? 'text-green-600' : 'text-red-600'}`}>
                          {expectedProfit > 0 ? '+' : ''}{expectedProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      {totals.totalSales > 0 && lumpsumCharges > 0 && (
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">Profit Margin:</span>
                          <span className={`font-bold ${isProfitable ? 'text-green-600' : 'text-red-600'}`}>
                            {profitMargin.toFixed(1)}%
                          </span>
                        </div>
                      )}
                    </div>
                    {lumpsumCharges > 0 && totals.totalSales > 0 && (
                      <div className="mt-3 pt-2 border-t border-gray-200">
                        <p className="text-[11px] text-gray-500">
                          Duty allocated in table: {totals.totalDutyAllocated.toLocaleString('en-US', { minimumFractionDigits: 2 })} |
                          Unallocated charges: {(lumpsumCharges - totals.totalDutyAllocated).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    )}
                    {lumpsumCharges === 0 && (
                      <p className="mt-2 text-xs text-gray-500">Enter shipment charges to see profitability</p>
                    )}
                  </div>
                ) : (
                  <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
                    <p className="text-sm text-gray-500">Add items and enter shipment charges to check profitability</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Import Modal */}
          {showSplit && (() => {
            const rows = records.filter(r => selectedIds.has(r.id));
            const total = parseFloat(splitTotal) || 0;
            const weightOf = (r: CostingRecord) =>
              splitBasis === 'value' ? r.unit_price_cny * r.qty : splitBasis === 'quantity' ? r.qty : 1;
            let ws = rows.map(weightOf);
            let sum = ws.reduce((a, b) => a + b, 0);
            if (sum <= 0) { ws = rows.map(() => 1); sum = rows.length; }
            return (
              <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowSplit(false)}>
                <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-semibold text-gray-900">Split one total across {rows.length} rows</h3>
                    <button onClick={() => setShowSplit(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
                  </div>
                  <p className="text-xs text-gray-500 mb-4">For items packed together where you only know the group total. Each row gets its share; the shares add up to the total you enter.</p>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">What to split</label>
                      <select value={splitField} onChange={(e) => setSplitField(e.target.value as 'cbm' | 'weight_kg')} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded">
                        <option value="cbm">CBM</option>
                        <option value="weight_kg">Weight (kg)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Group total</label>
                      <input type="number" step="0.0001" autoFocus value={splitTotal} onChange={(e) => setSplitTotal(e.target.value)} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded" placeholder={splitField === 'cbm' ? 'e.g. 1' : 'e.g. 250'} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Divide by</label>
                      <select value={splitBasis} onChange={(e) => setSplitBasis(e.target.value as 'value' | 'quantity' | 'equal')} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded">
                        <option value="value">Value (CNY × qty)</option>
                        <option value="quantity">Quantity</option>
                        <option value="equal">Equal</option>
                      </select>
                    </div>
                  </div>
                  <table className="w-full text-xs border-collapse mb-4">
                    <thead><tr className="bg-gray-100 text-gray-700">
                      <th className="text-left px-2 py-1 border">Item</th><th className="text-right px-2 py-1 border">Qty</th><th className="text-right px-2 py-1 border">CNY</th><th className="text-right px-2 py-1 border">Share</th><th className="text-right px-2 py-1 border">{splitField === 'cbm' ? 'CBM' : 'Kg'}</th>
                    </tr></thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.id}>
                          <td className="px-2 py-1 border">{r.description || '-'}</td>
                          <td className="px-2 py-1 border text-right">{r.qty}</td>
                          <td className="px-2 py-1 border text-right">{r.unit_price_cny}</td>
                          <td className="px-2 py-1 border text-right">{(ws[i] / sum * 100).toFixed(1)}%</td>
                          <td className="px-2 py-1 border text-right font-medium">{total > 0 ? (total * ws[i] / sum).toFixed(4) : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowSplit(false)} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                    <button onClick={applySplit} disabled={total <= 0 || saving} className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-40">Apply split</button>
                  </div>
                </div>
              </div>
            );
          })()}

          {showImportModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl p-5 w-full max-w-md">
                <h3 className="font-semibold text-gray-900 mb-1">Import from Packing List</h3>
                <p className="text-sm text-gray-500 mb-4">Batch {activeBatch}</p>
                <p className="text-sm text-gray-600 mb-4">
                  Imports packing list items for this batch that are not yet in the costing sheet.
                  Unit prices are pulled from linked purchase bills.
                </p>
                <div className="bg-gray-50 rounded p-3 mb-4 space-y-1">
                  <p className="text-sm text-gray-700">
                    <strong>{batchPackingItems.length}</strong> items in Batch {activeBatch} packing list
                  </p>
                  <p className="text-sm text-gray-700">
                    <strong>{batchRecords.length}</strong> already in costing sheet
                  </p>
                  <p className="text-sm text-teal-700 font-medium">
                    <strong>{newItemsCount}</strong> new items to import
                  </p>
                </div>
                <div className="flex justify-end space-x-2">
                  <button
                    onClick={() => setShowImportModal(false)}
                    className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={importFromPackingList}
                    disabled={newItemsCount === 0}
                    className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
                  >
                    Import {newItemsCount} Items
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Table */}
          {filteredRecords.length > 0 ? (
            <div className="border border-gray-400 bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse" style={{ minWidth: '1200px' }}>
                  <thead>
                    <tr className="bg-slate-900 text-white">
                      <th className="px-1 py-1.5 text-center border border-slate-700" style={{ width: '28px' }}>
                        <input
                          type="checkbox"
                          title="Select all visible rows"
                          checked={filteredRecords.length > 0 && filteredRecords.every(r => selectedIds.has(r.id))}
                          onChange={(e) => setSelectedIds(e.target.checked ? new Set(filteredRecords.map(r => r.id)) : new Set())}
                        />
                      </th>
                      <th className="px-2 py-1.5 text-left font-semibold border border-slate-700" style={{ minWidth: '160px' }}>Description</th>
                      <th className="px-1 py-1.5 text-center font-semibold border border-slate-700" style={{ minWidth: '50px' }}>QTY</th>
                      <th className="px-1 py-1.5 text-center font-semibold border border-slate-700" style={{ minWidth: '40px' }}>Unit</th>
                      <th className="px-1 py-1.5 text-center font-semibold border border-slate-700" style={{ minWidth: '55px' }}>Wt KG</th>
                      <th className="px-1 py-1.5 text-center font-semibold border border-slate-700" style={{ minWidth: '50px' }}>CBM</th>
                      <th className="px-1 py-1.5 text-center font-semibold border border-slate-700 bg-blue-800" style={{ minWidth: '65px' }}>CNY</th>
                      <th className="px-1 py-1.5 text-center font-semibold border border-slate-700 bg-blue-800" style={{ minWidth: '75px' }}>LKR</th>
                      <th className="px-1 py-1.5 text-center font-semibold border border-slate-700" style={{ minWidth: '65px' }}>Type</th>
                      <th className="px-1 py-1.5 text-center font-semibold border border-slate-700" style={{ minWidth: '50px' }}>Basis</th>
                      <th className="px-1 py-1.5 text-center font-semibold border border-slate-700 bg-amber-600" style={{ minWidth: '80px' }}>Duty Rate</th>
                      <th className="px-1 py-1.5 text-center font-semibold border border-slate-700 bg-amber-600" style={{ minWidth: '70px' }}>Duty/U</th>
                      <th className="px-1 py-1.5 text-center font-semibold border border-slate-700 bg-green-700" style={{ minWidth: '75px' }}>Landed</th>
                      <th className="px-1 py-1.5 text-center font-semibold border border-slate-700 bg-teal-600" style={{ minWidth: '80px' }}>Selling</th>
                      <th className="px-1 py-1.5 text-center font-semibold border border-slate-700 bg-teal-600" style={{ minWidth: '70px' }}>Profit/U</th>
                      <th className="px-1 py-1.5 text-center font-semibold border border-slate-700 bg-green-700" style={{ minWidth: '85px' }}>Tot Landed</th>
                      <th className="px-1 py-1.5 text-center font-semibold border border-slate-700 bg-teal-600" style={{ minWidth: '80px' }}>Tot Sales</th>
                      <th className="px-1 py-1.5 text-center font-semibold border border-slate-700 bg-teal-600" style={{ minWidth: '80px' }}>Tot Profit</th>
                      <th className="px-1 py-1.5 text-center font-semibold border border-slate-700" style={{ minWidth: '30px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.map((record, idx) => (
                      <tr key={record.id} className={`${selectedIds.has(record.id) ? 'bg-amber-50' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-teal-50`}>
                        <td className="px-1 py-1.5 text-center border border-gray-300">
                          <input type="checkbox" checked={selectedIds.has(record.id)} onChange={() => toggleSelect(record.id)} />
                        </td>
                        {/* Description */}
                        <td
                          className={`px-2 py-1.5 border border-gray-300 cursor-pointer hover:bg-teal-100 ${
                            editingCell?.id === record.id && editingCell?.field === 'description' ? 'p-0' : ''
                          }`}
                          onClick={() => handleCellClick(record.id, 'description', record.description)}
                        >
                          {editingCell?.id === record.id && editingCell?.field === 'description' ? (
                            <input
                              ref={inputRef}
                              type="text"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              className="w-full h-full px-2 py-1 border-2 border-blue-500 outline-none text-xs"
                              onBlur={() => commitEdit(record.id, 'description')}
                              onKeyDown={(e) => handleKeyDown(e, record.id, 'description')}
                            />
                          ) : (
                            <span className="font-medium text-gray-900">{record.description || '-'}</span>
                          )}
                        </td>
                        {/* QTY */}
                        <td
                          className={`px-2 py-1.5 text-center border border-gray-300 cursor-pointer hover:bg-teal-100 ${
                            editingCell?.id === record.id && editingCell?.field === 'qty' ? 'p-0' : ''
                          }`}
                          onClick={() => handleCellClick(record.id, 'qty', record.qty)}
                        >
                          {editingCell?.id === record.id && editingCell?.field === 'qty' ? (
                            <input
                              ref={inputRef}
                              type="number"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              className="w-full h-full px-1 py-1 text-center border-2 border-blue-500 outline-none text-xs"
                              onBlur={() => commitEdit(record.id, 'qty')}
                              onKeyDown={(e) => handleKeyDown(e, record.id, 'qty')}
                            />
                          ) : record.qty}
                        </td>
                        {/* Unit */}
                        <td
                          className={`px-2 py-1.5 text-center border border-gray-300 cursor-pointer hover:bg-teal-100 ${
                            editingCell?.id === record.id && editingCell?.field === 'unit' ? 'p-0' : ''
                          }`}
                          onClick={() => handleCellClick(record.id, 'unit', record.unit)}
                        >
                          {editingCell?.id === record.id && editingCell?.field === 'unit' ? (
                            <input
                              ref={inputRef}
                              type="text"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              className="w-full h-full px-1 py-1 text-center border-2 border-blue-500 outline-none text-xs"
                              onBlur={() => commitEdit(record.id, 'unit')}
                              onKeyDown={(e) => handleKeyDown(e, record.id, 'unit')}
                            />
                          ) : record.unit}
                        </td>
                        {/* Weight KG */}
                        <td
                          className={`px-2 py-1.5 text-right border border-gray-300 cursor-pointer hover:bg-teal-100 ${
                            editingCell?.id === record.id && editingCell?.field === 'weight_kg' ? 'p-0' : ''
                          }`}
                          onClick={() => handleCellClick(record.id, 'weight_kg', record.weight_kg)}
                        >
                          {editingCell?.id === record.id && editingCell?.field === 'weight_kg' ? (
                            <input
                              ref={inputRef}
                              type="number"
                              step="0.01"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              className="w-full h-full px-1 py-1 text-right border-2 border-blue-500 outline-none text-xs"
                              onBlur={() => commitEdit(record.id, 'weight_kg')}
                              onKeyDown={(e) => handleKeyDown(e, record.id, 'weight_kg')}
                            />
                          ) : record.weight_kg > 0 ? record.weight_kg.toFixed(2) : '-'}
                        </td>
                        {/* CBM */}
                        <td
                          className={`px-2 py-1.5 text-right border border-gray-300 cursor-pointer hover:bg-teal-100 ${
                            editingCell?.id === record.id && editingCell?.field === 'cbm' ? 'p-0' : ''
                          }`}
                          onClick={() => handleCellClick(record.id, 'cbm', record.cbm)}
                        >
                          {editingCell?.id === record.id && editingCell?.field === 'cbm' ? (
                            <input
                              ref={inputRef}
                              type="number"
                              step="0.001"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              className="w-full h-full px-1 py-1 text-right border-2 border-blue-500 outline-none text-xs"
                              onBlur={() => commitEdit(record.id, 'cbm')}
                              onKeyDown={(e) => handleKeyDown(e, record.id, 'cbm')}
                            />
                          ) : record.cbm > 0 ? record.cbm.toFixed(3) : '-'}
                        </td>
                        {/* CNY */}
                        <td
                          className={`px-2 py-1.5 text-right border border-gray-300 cursor-pointer hover:bg-teal-100 bg-teal-50 ${
                            editingCell?.id === record.id && editingCell?.field === 'unit_price_cny' ? 'p-0' : ''
                          }`}
                          onClick={() => handleCellClick(record.id, 'unit_price_cny', record.unit_price_cny)}
                        >
                          {editingCell?.id === record.id && editingCell?.field === 'unit_price_cny' ? (
                            <input
                              ref={inputRef}
                              type="number"
                              step="0.01"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              className="w-full h-full px-1 py-1 text-right border-2 border-blue-500 outline-none text-xs"
                              onBlur={() => commitEdit(record.id, 'unit_price_cny')}
                              onKeyDown={(e) => handleKeyDown(e, record.id, 'unit_price_cny')}
                            />
                          ) : record.unit_price_cny > 0 ? record.unit_price_cny.toFixed(2) : '-'}
                        </td>
                        {/* LKR (calculated) */}
                        <td className="px-2 py-1.5 text-right border border-gray-300 bg-teal-50 font-medium">
                          {record.unit_price_lkr > 0 ? record.unit_price_lkr.toFixed(2) : '-'}
                        </td>
                        {/* Type */}
                        <td className="px-2 py-1.5 text-center border border-gray-300">
                          <select
                            value={record.type}
                            onChange={(e) => updateCell(record.id, 'type', e.target.value)}
                            className="w-full px-1 py-0.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                          >
                            <option value="RESALE">RESALE</option>
                            <option value="FACTORY">FACTORY</option>
                          </select>
                        </td>
                        {/* Duty Basis */}
                        <td className="px-2 py-1.5 text-center border border-gray-300">
                          <select
                            value={record.duty_basis}
                            onChange={(e) => updateCell(record.id, 'duty_basis', e.target.value)}
                            className="w-full px-1 py-0.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                          >
                            <option value="CBM">CBM</option>
                            <option value="KG">KG</option>
                            <option value="PCS">PCS</option>
                          </select>
                        </td>
                        {/* Duty Rate */}
                        <td
                          className={`px-2 py-1.5 text-right border border-gray-300 cursor-pointer hover:bg-amber-100 bg-amber-50 ${
                            editingCell?.id === record.id && editingCell?.field === 'duty_rate' ? 'p-0' : ''
                          }`}
                          onClick={() => handleCellClick(record.id, 'duty_rate', record.duty_rate)}
                        >
                          {editingCell?.id === record.id && editingCell?.field === 'duty_rate' ? (
                            <input
                              ref={inputRef}
                              type="number"
                              step="0.01"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              className="w-full h-full px-1 py-1 text-right border-2 border-blue-500 outline-none text-xs"
                              onBlur={() => commitEdit(record.id, 'duty_rate')}
                              onKeyDown={(e) => handleKeyDown(e, record.id, 'duty_rate')}
                            />
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <span>{record.duty_rate > 0 ? record.duty_rate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</span>
                              {record.duty_rate > 0 && (
                                <span className="text-[10px] text-amber-600 font-normal">/{record.duty_basis}</span>
                              )}
                            </div>
                          )}
                        </td>
                        {/* Duty/Unit (calculated) */}
                        <td className="px-1 py-1.5 text-right border border-gray-300 bg-amber-50 font-medium">
                          {record.duty_per_unit > 0 ? record.duty_per_unit.toFixed(2) : '-'}
                        </td>
                        {/* Landed (calculated) */}
                        <td className="px-1 py-1.5 text-right border border-gray-300 bg-green-50 font-semibold text-green-800">
                          {record.landed_cost_per_unit > 0 ? record.landed_cost_per_unit.toFixed(2) : '-'}
                        </td>
                        {/* Selling Price */}
                        <td
                          className={`px-1 py-1.5 text-right border border-gray-300 cursor-pointer hover:bg-teal-100 bg-teal-50 ${
                            editingCell?.id === record.id && editingCell?.field === 'selling_price' ? 'p-0' : ''
                          } ${record.type === 'FACTORY' ? 'opacity-50' : ''}`}
                          onClick={() => record.type === 'RESALE' && handleCellClick(record.id, 'selling_price', record.selling_price)}
                        >
                          {editingCell?.id === record.id && editingCell?.field === 'selling_price' ? (
                            <input
                              ref={inputRef}
                              type="number"
                              step="0.01"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              className="w-full h-full px-1 py-1 text-right border-2 border-blue-500 outline-none text-xs"
                              onBlur={() => commitEdit(record.id, 'selling_price')}
                              onKeyDown={(e) => handleKeyDown(e, record.id, 'selling_price')}
                            />
                          ) : record.type === 'RESALE' ? (
                            record.selling_price > 0 ? record.selling_price.toFixed(2) : '-'
                          ) : 'N/A'}
                        </td>
                        {/* Profit/Unit (calculated) */}
                        <td className={`px-2 py-1.5 text-right border border-gray-300 bg-teal-50 font-medium ${
                          record.profit_per_unit < 0 ? 'text-red-600' : 'text-teal-700'
                        } ${record.type === 'FACTORY' ? 'opacity-50' : ''}`}>
                          {record.type === 'RESALE' ? (record.profit_per_unit !== 0 ? record.profit_per_unit.toFixed(2) : '-') : 'N/A'}
                        </td>
                        {/* Total Landed (calculated) */}
                        <td className="px-2 py-1.5 text-right border border-gray-300 bg-green-50 font-semibold text-green-800">
                          {record.total_landed_cost > 0 ? record.total_landed_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                        </td>
                        {/* Total Sales (calculated) */}
                        <td className={`px-2 py-1.5 text-right border border-gray-300 bg-teal-50 font-medium ${record.type === 'FACTORY' ? 'opacity-50' : ''}`}>
                          {record.type === 'RESALE' ? (record.total_sales > 0 ? record.total_sales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-') : 'N/A'}
                        </td>
                        {/* Total Profit (calculated) */}
                        <td className={`px-2 py-1.5 text-right border border-gray-300 bg-teal-50 font-semibold ${
                          record.total_profit < 0 ? 'text-red-600' : 'text-teal-700'
                        } ${record.type === 'FACTORY' ? 'opacity-50' : ''}`}>
                          {record.type === 'RESALE' ? (record.total_profit !== 0 ? record.total_profit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-') : 'N/A'}
                        </td>
                        {/* Delete */}
                        <td className="px-1 py-1.5 text-center border border-gray-300">
                          <button
                            onClick={() => deleteRecord(record.id)}
                            className="p-0.5 text-red-500 hover:bg-red-50 rounded transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-900 text-white font-bold">
                      <td colSpan={15} className="px-2 py-2 text-right border border-slate-700">TOTALS:</td>
                      <td className="px-2 py-2 text-right border border-slate-700 bg-green-700">
                        {totals.totalLanded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-2 py-2 text-right border border-slate-700 bg-teal-600">
                        {totals.totalSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className={`px-2 py-2 text-right border border-slate-700 ${totals.totalProfit < 0 ? 'bg-red-600' : 'bg-teal-600'}`}>
                        {totals.totalProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-2 py-2 border border-slate-700"></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
              <Calculator className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-gray-500 text-sm">No costing records for Batch {activeBatch}</p>
              <p className="text-xs text-gray-400 mt-1">
                {newItemsCount > 0
                  ? `Click "Import from PL (${newItemsCount})" above to import packing list items`
                  : 'Add rows manually or import from packing list'}
              </p>
            </div>
          )}

          <div className="bg-teal-50 border border-blue-100 rounded-lg p-3 text-xs text-teal-800">
            <div className="flex items-center space-x-1 mb-1">
              <Calculator className="w-3.5 h-3.5" />
              <span className="font-medium">Calculation Guide:</span>
            </div>
            <ul className="space-y-0.5 ml-4 list-disc">
              <li><strong>Unit Price LKR</strong> = Unit Price CNY x CNY Rate</li>
              <li><strong>Duty per Unit</strong>: CBM basis = (Duty Rate x CBM) / QTY | KG basis = (Duty Rate x Weight) / QTY | PCS = Duty Rate</li>
              <li><strong>Landed Cost</strong> = Unit Price LKR + Duty per Unit</li>
              <li><strong>Profit</strong> = Selling Price - Landed Cost (RESALE only)</li>
            </ul>
          </div>
        </>
      )}
    </div>
      {showPrintView && (
        <CostingDutyPrint
          records={filteredRecords}
          batchNumber={activeBatch}
          onClose={() => setShowPrintView(false)}
        />
      )}
    </>
  );
}
