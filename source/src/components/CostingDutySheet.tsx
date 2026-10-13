import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Calculator, RefreshCw, Plus, Trash2, Download, Search, X, History, ChevronDown, Printer, AlertTriangle, CheckCircle2, Truck } from 'lucide-react';
import * as XLSX from 'xlsx';
import ChangeHistory from './ChangeHistory';
import CostingDutyPrint, { summarizeCosting, fmt0, fmt2 } from './CostingDutyPrint';
import type { CostingPrintLine } from './CostingDutyPrint';
import { fetchAllPages, selectByIds } from '../lib/fetchAll';
import { syncCostingCharges, loadItemCharges } from '../lib/costingCharges';
import type { ItemCharge } from '../lib/costingCharges';

/* Costing: landed per unit = (CNY price x rate) + shipping per unit.
   Shipping per unit comes from Shipping -> Charges (charge of the item / its qty), copied onto the
   costing line by syncCostingCharges(). Lines not from a packing list can have a MANUAL charge.
   The database trigger works out cost LKR, landed, profit and totals; we always keep the row it returns. */

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
  weight_kg: number;   // kept in the data (used by Shipping), not shown here
  cbm: number;
  unit_price_cny: number;
  cny_rate: number;
  unit_price_lkr: number;
  type: 'RESALE' | 'FACTORY';
  duty_per_unit: number;
  charge_per_unit: number;
  charge_basis: string;
  landed_cost_per_unit: number;
  selling_price: number;
  profit_per_unit: number;
  total_landed_cost: number;
  total_sales: number;
  total_profit: number;
  book: string | null;
  created_at: string;
}

interface ShipInfo { id: string; actual_charges: number; agent_invoice: number; other_charges: number }

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

/** A database row -> a costing line. Before item-charges-costing.sql, charge_per_unit is missing: use duty_per_unit. */
function parseRow(row: Record<string, unknown>): CostingRecord {
  const hasCharge = row.charge_per_unit !== undefined && row.charge_per_unit !== null;
  return {
    id: String(row.id),
    batch_number: (row.batch_number as string) || '',
    packing_list_item_id: (row.packing_list_item_id as string) || null,
    description: (row.description as string) || '',
    qty: num(row.qty),
    unit: (row.unit as string) || '',
    weight_kg: num(row.weight_kg),
    cbm: num(row.cbm),
    unit_price_cny: num(row.unit_price_cny),
    cny_rate: num(row.cny_rate),
    unit_price_lkr: num(row.unit_price_lkr),
    type: row.type === 'FACTORY' ? 'FACTORY' : 'RESALE',
    duty_per_unit: num(row.duty_per_unit),
    charge_per_unit: hasCharge ? num(row.charge_per_unit) : num(row.duty_per_unit),
    charge_basis: (row.charge_basis as string) || (hasCharge || !num(row.duty_per_unit) ? '' : 'OLD'),
    landed_cost_per_unit: num(row.landed_cost_per_unit),
    selling_price: num(row.selling_price),
    profit_per_unit: num(row.profit_per_unit),
    total_landed_cost: num(row.total_landed_cost),
    total_sales: num(row.total_sales),
    total_profit: num(row.total_profit),
    book: (row.book as string) ?? null,
    created_at: (row.created_at as string) || '',
  };
}

function sortBatches(batches: string[]): string[] {
  return [...batches].sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ''), 10);
    const numB = parseInt(b.replace(/\D/g, ''), 10);
    if (!isNaN(numA) && !isNaN(numB)) return numB - numA;
    return b.localeCompare(a);
  });
}

const BASIS_TAG: Record<string, string> = {
  KG: 'bg-sky-100 text-sky-800',
  CBM: 'bg-indigo-100 text-indigo-800',
  PCS: 'bg-teal-100 text-teal-800',
  FIXED: 'bg-gray-200 text-gray-700',
  MANUAL: 'bg-amber-100 text-amber-800',
  OLD: 'bg-gray-100 text-gray-500',
  NONE: 'bg-red-100 text-red-700',
};

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
  const [globalCnyRate, setGlobalCnyRate] = useState(0);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showBatchHistory, setShowBatchHistory] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // null = not checked yet; false = item-charges-costing.sql not run (no charge_per_unit column)
  const [chargeCols, setChargeCols] = useState<boolean | null>(null);
  // shipping check for the open batch
  const [shipLoaded, setShipLoaded] = useState(false);
  const [shipInfo, setShipInfo] = useState<ShipInfo | null>(null);
  const [itemCharges, setItemCharges] = useState<Map<string, ItemCharge>>(new Map());
  const [shipError, setShipError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const batchToken = useRef('');

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell]);

  // New batch: CNY rate, clear filters
  useEffect(() => {
    if (!activeBatch) return;
    const batchRecs = records.filter(r => (r.batch_number || '') === activeBatch);
    if (batchRecs.length > 0 && batchRecs[0].cny_rate > 0) {
      setGlobalCnyRate(batchRecs[0].cny_rate);
    } else {
      // New or unrated batch: carry over the rate from the latest batch that has one
      const lastRated = [...records].reverse().find(r => r.cny_rate > 0);
      setGlobalCnyRate(lastRated ? lastRated.cny_rate : 0);
    }
    setSelectedIds(new Set());
    setSelectedPlNo('');
    setSearchTerm('');
    setTypeFilter('');
    setSyncMsg('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBatch]);

  // New batch (once we know whether the charge columns exist): bring the shipping charges in, then load the check
  useEffect(() => {
    if (!activeBatch || chargeCols === null) return;
    const token = activeBatch;
    batchToken.current = token;
    setShipLoaded(false);
    setShipInfo(null);
    setItemCharges(new Map());
    setShipError('');
    (async () => {
      if (chargeCols) {
        const { updated, error } = await syncCostingCharges(token);
        if (batchToken.current !== token) return;
        if (error) setShipError(`Could not bring the shipping charges in: ${error}`);
        else if (updated > 0) await loadRecords();
      }
      if (batchToken.current !== token) return;
      await loadShipmentCheck(token);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBatch, chargeCols]);

  async function loadShipmentCheck(batch: string) {
    let ship: ShipInfo | null = null;
    let err = '';
    const full = await supabase.from('shipments').select('id, actual_charges, agent_invoice, other_charges').eq('shipment_no', batch).maybeSingle();
    if (full.error) {
      // older database without the agent invoice columns
      const basic = await supabase.from('shipments').select('id, actual_charges').eq('shipment_no', batch).maybeSingle();
      if (basic.error) err = `Could not read the shipment: ${basic.error.message}`;
      else if (basic.data) ship = { id: basic.data.id, actual_charges: num(basic.data.actual_charges), agent_invoice: 0, other_charges: 0 };
    } else if (full.data) {
      ship = { id: full.data.id, actual_charges: num(full.data.actual_charges), agent_invoice: num(full.data.agent_invoice), other_charges: num(full.data.other_charges) };
    }
    let map = new Map<string, ItemCharge>();
    if (ship && chargeCols) {
      const res = await loadItemCharges(ship.id);
      if (res.error) err = err || `Could not read the item charges from Shipping: ${res.error}`;
      map = res.map;
    }
    if (batchToken.current !== batch) return;
    setShipInfo(ship);
    setItemCharges(map);
    if (err) setShipError(prev => prev || err);
    setShipLoaded(true);
  }

  async function updateFromShipping() {
    if (!activeBatch) return;
    setSyncing(true);
    setSyncMsg('');
    const { updated, error } = await syncCostingCharges(activeBatch);
    if (error) {
      alert(`Could not bring the shipping charges in.\n\n${error}`);
    } else {
      setShipError('');
      await loadRecords();
      setSyncMsg(updated > 0 ? `${updated} line${updated === 1 ? '' : 's'} updated from Shipping` : 'Already up to date');
    }
    await loadShipmentCheck(activeBatch);
    setSyncing(false);
  }

  async function checkChargeColumns() {
    const { error } = await supabase.from('costing_duty_sheet').select('id, charge_per_unit, charge_basis').limit(1);
    if (error && /charge_(per_unit|basis)/i.test(error.message)) setChargeCols(false);
    else setChargeCols(true);
  }

  async function loadData() {
    setLoading(true);
    await Promise.all([checkChargeColumns(), loadRecords(), loadPackingItems()]);
    setLoading(false);
  }

  async function loadRecords() {
    const { data, error } = await fetchAllPages<Record<string, unknown>>(() =>
      supabase.from('costing_duty_sheet').select('*').order('id'));
    if (error) {
      alert(`Could not load the costing lines.\n\n${error}`);
      return;
    }
    const parsed = data.map(parseRow).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    setRecords(parsed);
  }

  async function loadPackingItems() {
    const { data: items, error: plError } = await fetchAllPages<PackingListItem>(() =>
      supabase.from('packing_list_items')
        .select('id, batch_number, packing_list_no, item_name, quantity, unit, weight_kg, cbm, purchase_bill_item_id')
        .order('id'));
    if (plError) {
      alert(`Could not load the packing list items.\n\n${plError}`);
      return;
    }
    items.sort((a, b) => String(a.packing_list_no || '').localeCompare(String(b.packing_list_no || ''), undefined, { numeric: true }));
    setPackingItems(items);

    // CNY prices from the linked purchase bill lines
    const billItemIds = items.filter(i => i.purchase_bill_item_id).map(i => i.purchase_bill_item_id as string);
    if (billItemIds.length > 0) {
      const { data: billItems, error: billError } = await selectByIds<PurchaseBillItem>('purchase_bill_items', 'id, unit_price_cny', 'id', billItemIds);
      if (billError) {
        alert(`Could not load the purchase bill prices.\n\n${billError}`);
      } else {
        const map: Record<string, PurchaseBillItem> = {};
        billItems.forEach(item => { map[item.id] = { id: item.id, unit_price_cny: num(item.unit_price_cny) }; });
        setBillItemsMap(map);
      }
    }

    // Batches: packing list items plus every shipment created in Shipping
    const batchSet = new Set<string>();
    items.forEach(i => { if (i.batch_number) batchSet.add(i.batch_number); });
    const { data: ships, error: shErr } = await fetchAllPages<{ shipment_no: string }>(() =>
      supabase.from('shipments').select('id, shipment_no').order('id'));
    if (shErr) alert(`Could not load the shipments list.\n\n${shErr}`);
    ships.forEach(sh => { if (sh.shipment_no) batchSet.add(sh.shipment_no); });
    const sorted = sortBatches(Array.from(batchSet));
    setAllBatches(sorted);

    setActiveBatch(prev => {
      if (prev && batchSet.has(prev)) return prev;
      return sorted[0] || '';
    });
  }

  async function importFromPackingList() {
    const batchPL = packingItems.filter(i => (i.batch_number || '') === activeBatch);
    if (batchPL.length === 0) {
      alert(`No packing list rows exist for ${activeBatch} yet.\nGo to Packing List, open the ${activeBatch} tab and create the rows from the bills first.`);
      setShowImportModal(false);
      return;
    }

    const existing = new Set(
      records.filter(r => r.packing_list_item_id && (r.batch_number || '') === activeBatch).map(r => r.packing_list_item_id)
    );
    const newItems = batchPL.filter(i => !existing.has(i.id));
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
        selling_price: 0,
      };
    });

    setSaving(true);
    const { error } = await supabase.from('costing_duty_sheet').insert(toInsert);
    if (error) {
      setSaving(false);
      alert(`Could not import the packing list items.\n\n${error.message}`);
      return;
    }
    setShowImportModal(false);
    if (chargeCols) {
      const res = await syncCostingCharges(activeBatch);
      if (res.error) alert(`Items imported, but the shipping charges could not be brought in.\n\n${res.error}`);
    }
    await loadRecords();
    await loadShipmentCheck(activeBatch);
    setSaving(false);
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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
      selling_price: 0,
    });
    if (error) {
      alert(`Could not add a row.\n\n${error.message}`);
      return;
    }
    loadRecords();
  }

  async function deleteRecord(id: string) {
    if (!confirm('Delete this row?')) return;
    const { error } = await supabase.from('costing_duty_sheet').delete().eq('id', id);
    if (error) { alert(`Could not delete the row.\n\n${error.message}`); return; }
    setRecords(prev => prev.filter(r => r.id !== id));
    setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  }

  async function deleteSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} selected row${ids.length === 1 ? '' : 's'}?`)) return;
    setSaving(true);
    for (let i = 0; i < ids.length; i += 150) {
      const { error } = await supabase.from('costing_duty_sheet').delete().in('id', ids.slice(i, i + 150));
      if (error) {
        alert(`Could not delete the selected rows.\n\n${error.message}`);
        break;
      }
    }
    setSelectedIds(new Set());
    await loadRecords();
    setSaving(false);
  }

  async function updateCell(id: string, patch: Record<string, number | string>) {
    // show the change at once so selects don't jump back
    setRecords(prev => prev.map(r => r.id === id ? { ...r, ...patch } as CostingRecord : r));
    setEditingCell(null);

    setSaving(true);
    const { data, error } = await supabase
      .from('costing_duty_sheet')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      alert(`Could not save the change.\n\n${error.message}`);
      await loadRecords();
    } else if (data) {
      // the database works out cost LKR, landed, profit and totals: keep its row
      const updated = parseRow(data as Record<string, unknown>);
      setRecords(prev => prev.map(r => r.id === id ? updated : r));
    }
    setSaving(false);
  }

  async function updateGlobalCnyRate(rate: number) {
    const batchRecs = records.filter(r => (r.batch_number || '') === activeBatch);
    setGlobalCnyRate(rate);
    if (batchRecs.length === 0) return;
    if (batchRecs.every(r => r.cny_rate === rate)) return;

    setRecords(prev => prev.map(r => (r.batch_number || '') === activeBatch ? { ...r, cny_rate: rate } : r));
    setSaving(true);
    const ids = batchRecs.map(r => r.id);
    const updatedMap: Record<string, CostingRecord> = {};
    let failed = '';
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await supabase.from('costing_duty_sheet').update({ cny_rate: rate }).in('id', ids.slice(i, i + 150)).select();
      if (error) { failed = error.message; break; }
      (data || []).forEach((row: Record<string, unknown>) => { const p = parseRow(row); updatedMap[p.id] = p; });
    }
    if (failed) {
      alert(`Could not save the CNY rate.\n\n${failed}`);
      await loadRecords();
    } else {
      setRecords(prev => prev.map(r => updatedMap[r.id] ?? r));
    }
    setSaving(false);
  }

  function canEditShipping(r: CostingRecord) {
    return !r.packing_list_item_id && chargeCols === true;
  }

  function handleCellClick(r: CostingRecord, field: string, currentValue: string | number) {
    const editableFields = ['description', 'qty', 'unit', 'unit_price_cny', 'selling_price', 'charge_per_unit'];
    if (!editableFields.includes(field)) return;
    if (field === 'charge_per_unit' && !canEditShipping(r)) return;
    setEditingCell({ id: r.id, field });
    setEditingValue(String(currentValue));
  }

  function commitEdit(id: string, field: string) {
    if (!editingCell || editingCell.id !== id || editingCell.field !== field) return;
    const isNumeric = ['qty', 'unit_price_cny', 'selling_price', 'charge_per_unit'].includes(field);
    const value = isNumeric ? parseFloat(editingValue.replace(/,/g, '')) || 0 : editingValue;
    const current = records.find(r => r.id === id);
    if (current && (current as unknown as Record<string, unknown>)[field] === value) { setEditingCell(null); return; }
    if (field === 'charge_per_unit') updateCell(id, { charge_per_unit: value, charge_basis: 'MANUAL' });
    else updateCell(id, { [field]: value });
  }

  function handleKeyDown(e: React.KeyboardEvent, id: string, field: string) {
    if (e.key === 'Enter') commitEdit(id, field);
    else if (e.key === 'Escape') setEditingCell(null);
  }

  // ---------- derived data ----------
  const batchRecords = records.filter(r => (r.batch_number || '') === activeBatch);
  const batchPackingItems = packingItems.filter(i => (i.batch_number || '') === activeBatch);
  const uniquePlNos = [...new Set(batchPackingItems.map(i => i.packing_list_no))];
  const existingPlItemIds = new Set(batchRecords.filter(r => r.packing_list_item_id).map(r => r.packing_list_item_id as string));
  const newItemsCount = batchPackingItems.filter(i => !existingPlItemIds.has(i.id)).length;
  const plItemMap = new Map(packingItems.map(p => [p.id, p]));
  const plNoOf = (r: CostingRecord) => (r.packing_list_item_id ? plItemMap.get(r.packing_list_item_id)?.packing_list_no || '' : '');

  const byPl = (a: CostingRecord, b: CostingRecord) => {
    const plA = plNoOf(a), plB = plNoOf(b);
    if (plA !== plB) return plA.localeCompare(plB, undefined, { numeric: true });
    return a.description.localeCompare(b.description);
  };
  const sortedBatch = [...batchRecords].sort(byPl);

  const filtersOn = !!(searchTerm || selectedPlNo || typeFilter);
  const filteredRecords = sortedBatch.filter(r => {
    const matchesSearch = r.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesPlNo = !selectedPlNo || plNoOf(r) === selectedPlNo;
    const matchesType = !typeFilter || r.type === typeFilter;
    return matchesSearch && matchesPlNo && matchesType;
  });

  const toLine = (r: CostingRecord): CostingPrintLine => ({
    id: r.id, pl_no: plNoOf(r), description: r.description, qty: r.qty, unit: r.unit,
    unit_price_cny: r.unit_price_cny, cny_rate: r.cny_rate, unit_price_lkr: r.unit_price_lkr,
    charge_per_unit: r.charge_per_unit, charge_basis: r.charge_basis, landed_cost_per_unit: r.landed_cost_per_unit,
    selling_price: r.selling_price, profit_per_unit: r.profit_per_unit, total_landed_cost: r.total_landed_cost,
    total_sales: r.total_sales, total_profit: r.total_profit, type: r.type,
  });
  const batchLines = sortedBatch.map(toLine);
  const summary = summarizeCosting(batchLines);           // WHOLE batch, never the filtered rows
  const shown = summarizeCosting(filteredRecords.map(toLine));
  const batchBook = batchRecords.find(r => r.book)?.book ?? null;

  // shipping check
  const itemChargeTotal = [...itemCharges.values()].reduce((s, c) => s + c.amount, 0);
  const target = shipInfo
    ? shipInfo.agent_invoice > 0 ? { amount: shipInfo.agent_invoice, label: 'agent invoice' }
      : shipInfo.actual_charges > 0 ? { amount: shipInfo.actual_charges, label: 'shipment charges' }
      : { amount: itemChargeTotal, label: 'item charges in Shipping' }
    : null;
  const diff = target ? summary.shipping - target.amount : 0;
  const matches = !!target && target.amount > 0 && Math.abs(diff) < 1;
  const noChargeLines = shipInfo && chargeCols
    ? sortedBatch.filter(r => r.packing_list_item_id && !itemCharges.has(r.packing_list_item_id))
    : [];
  const chargedNotInCosting = shipInfo
    ? [...itemCharges.keys()].filter(id => !existingPlItemIds.has(id) && plItemMap.has(id)).length
    : 0;
  const hasCharge = (r: CostingRecord) => !r.packing_list_item_id || !shipInfo || !chargeCols || itemCharges.has(r.packing_list_item_id);

  function exportToExcel() {
    const s = summary;
    const wsData: (string | number)[][] = [
      [`COSTING SHEET - Batch ${activeBatch}`],
      [`CNY Rate: ${globalCnyRate}`, '', `Date: ${new Date().toLocaleDateString('en-GB')}`],
      [],
      ['Items cost', Math.round(s.itemsCost), '', 'Expected sales (resale)', Math.round(s.sales)],
      ['Shipping charges on items', Math.round(s.shipping), '', 'To factory at landed', Math.round(s.factory)],
      ['Total landed', Math.round(s.landed), '', 'Expected profit', Math.round(s.profit), `Margin ${s.margin.toFixed(1)}%`],
      [],
      ['PL No', 'Description', 'Qty', 'Unit', 'Price CNY', 'Rate', 'Cost LKR/unit', 'Shipping/unit', 'Basis', 'Landed/unit', 'Selling price', 'Profit/unit', 'Margin %', 'Total landed', 'Total sales', 'Total profit', 'Type'],
    ];
    const headerRow = wsData.length - 1;
    const r2 = (n: number) => Math.round(n * 100) / 100;

    batchLines.forEach(r => {
      const priced = r.type === 'RESALE' && r.selling_price > 0;
      wsData.push([
        r.pl_no, r.description, r.qty, r.unit,
        r2(r.unit_price_cny), r.cny_rate, r2(r.unit_price_lkr), r2(r.charge_per_unit), r.charge_basis,
        r2(r.landed_cost_per_unit),
        priced ? r2(r.selling_price) : '', priced ? r2(r.profit_per_unit) : '',
        priced ? Math.round((r.profit_per_unit / r.selling_price) * 1000) / 10 : '',
        Math.round(r.total_landed_cost), priced ? Math.round(r.total_sales) : '', priced ? Math.round(r.total_profit) : '',
        r.type,
      ]);
    });

    wsData.push([]);
    wsData.push(['', 'TOTALS', '', '', '', '', '', '', '', '', '', '', '', Math.round(s.landed), Math.round(s.sales), Math.round(s.profit), '']);

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [
      { wch: 8 }, { wch: 32 }, { wch: 8 }, { wch: 7 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 8 },
      { wch: 12 }, { wch: 12 }, { wch: 11 }, { wch: 9 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 9 },
    ];
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 16 } }];

    const headerStyle = { fill: { fgColor: { rgb: '1A365D' } }, font: { color: { rgb: 'FFFFFF' }, bold: true }, alignment: { horizontal: 'center' } };
    const priceColStyle = { fill: { fgColor: { rgb: '1E40AF' } }, font: { color: { rgb: 'FFFFFF' }, bold: true } };
    const shipColStyle = { fill: { fgColor: { rgb: 'D97706' } }, font: { color: { rgb: 'FFFFFF' }, bold: true } };
    const landedColStyle = { fill: { fgColor: { rgb: '047857' } }, font: { color: { rgb: 'FFFFFF' }, bold: true } };
    const salesColStyle = { fill: { fgColor: { rgb: '0D9488' } }, font: { color: { rgb: 'FFFFFF' }, bold: true } };
    if (ws['A1']) ws['A1'].s = { font: { bold: true, sz: 16 }, alignment: { horizontal: 'center' } };

    const headerColors: Record<number, object> = {
      4: priceColStyle, 5: priceColStyle, 6: priceColStyle,
      7: shipColStyle, 8: shipColStyle,
      9: landedColStyle, 10: salesColStyle, 11: salesColStyle, 12: salesColStyle,
      13: landedColStyle, 14: salesColStyle, 15: salesColStyle,
    };
    for (let c = 0; c < 17; c++) {
      const cell = XLSX.utils.encode_cell({ r: headerRow, c });
      if (ws[cell]) ws[cell].s = headerColors[c] || headerStyle;
    }
    const totalRow = wsData.length - 1;
    for (let c = 0; c < 17; c++) {
      const cell = XLSX.utils.encode_cell({ r: totalRow, c });
      if (ws[cell]) ws[cell].s = c === 13 ? landedColStyle : c >= 14 && c <= 15 ? salesColStyle : headerStyle;
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Costing Sheet');
    XLSX.writeFile(wb, `costing_batch${activeBatch}_${new Date().toISOString().split('T')[0]}.xlsx`);
  }

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

  // one editable text/number cell
  function editable(r: CostingRecord, field: string, value: string | number, display: React.ReactNode, cls: string, opts: { type?: 'text' | 'number'; align?: 'left' | 'center' | 'right'; step?: string; disabled?: boolean } = {}) {
    const isEditing = editingCell?.id === r.id && editingCell?.field === field;
    const align = opts.align || 'right';
    return (
      <td
        className={`px-2 py-1.5 border border-gray-300 text-${align} ${opts.disabled ? '' : 'cursor-pointer hover:bg-teal-100'} ${isEditing ? 'p-0' : ''} ${cls}`}
        onClick={() => !opts.disabled && !isEditing && handleCellClick(r, field, value)}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            type={opts.type || 'number'}
            step={opts.step}
            inputMode={opts.type === 'text' ? undefined : 'decimal'}
            value={editingValue}
            onChange={(e) => setEditingValue(e.target.value)}
            className={`w-full h-full px-1 py-1 text-${align} border-2 border-blue-500 outline-none text-xs`}
            onBlur={() => commitEdit(r.id, field)}
            onKeyDown={(e) => handleKeyDown(e, r.id, field)}
          />
        ) : display}
      </td>
    );
  }

  const thBase = 'px-1 py-1.5 text-center font-semibold border border-slate-700 whitespace-nowrap';

  return (
    <>
      {historyOpen && activeBatch && <ChangeHistory batch={activeBatch} onClose={() => setHistoryOpen(false)} />}
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Costing Sheet</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {saving && <span className="text-sm text-teal-700">Saving...</span>}
          <button
            onClick={async () => { await loadData(); if (activeBatch && chargeCols !== null) loadShipmentCheck(activeBatch); }}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            onClick={exportToExcel}
            disabled={batchRecords.length === 0}
            className="flex items-center space-x-1 px-3 py-1.5 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>Export</span>
          </button>
          <button
            onClick={() => setShowPrintView(true)}
            disabled={batchRecords.length === 0}
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
              {selectedIds.size > 0 && (
                <button
                  onClick={deleteSelected}
                  className="flex items-center space-x-1 px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete ({selectedIds.size})</span>
                </button>
              )}
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
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
                      isActive ? 'border-slate-900 bg-slate-900/5' : 'border-gray-200 hover:border-slate-900 hover:bg-gray-50'
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
                        <div className="h-1.5 rounded-full bg-teal-500 transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
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
          {chargeCols === false && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 text-amber-900 rounded-lg px-4 py-2 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Run <strong>item-charges-costing.sql</strong> in Supabase to bring shipping charges per item. Until then the shipping column shows the old duty per unit.</span>
            </div>
          )}

          {globalCnyRate <= 0 && batchRecords.length > 0 && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-300 text-red-800 rounded-lg px-4 py-2 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>CNY rate is 0 for this batch, so landed cost shows shipping only. Enter the rate below to include the item cost.</span>
            </div>
          )}

          {/* Batch summary (whole batch) */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Calculator className="w-4 h-4 text-teal-700" />
              Batch {activeBatch} summary
              <span className="text-xs font-normal text-gray-500">({summary.lines} line{summary.lines === 1 ? '' : 's'})</span>
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                <p className="text-[11px] font-medium text-blue-700">Items cost</p>
                <p className="text-base font-bold text-blue-900 tabular-nums">Rs {fmt0(summary.itemsCost)}</p>
              </div>
              <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
                <p className="text-[11px] font-medium text-amber-700">Shipping charges on items</p>
                <p className="text-base font-bold text-amber-900 tabular-nums">Rs {fmt0(summary.shipping)}</p>
              </div>
              <div className="rounded-lg border border-green-100 bg-green-50 px-3 py-2">
                <p className="text-[11px] font-medium text-green-700">Total landed</p>
                <p className="text-base font-bold text-green-900 tabular-nums">Rs {fmt0(summary.landed)}</p>
              </div>
              <div className="rounded-lg border border-teal-100 bg-teal-50 px-3 py-2">
                <p className="text-[11px] font-medium text-teal-700">Expected sales (resale)</p>
                <p className="text-base font-bold text-teal-900 tabular-nums">Rs {fmt0(summary.sales)}</p>
              </div>
              <div className="rounded-lg border border-purple-100 bg-purple-50 px-3 py-2">
                <p className="text-[11px] font-medium text-purple-700">To factory at landed</p>
                <p className="text-base font-bold text-purple-900 tabular-nums">Rs {fmt0(summary.factory)}</p>
              </div>
              <div className={`rounded-lg border px-3 py-2 ${summary.profit >= 0 ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                <p className={`text-[11px] font-medium ${summary.profit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>Expected profit</p>
                <p className={`text-base font-bold tabular-nums ${summary.profit >= 0 ? 'text-emerald-900' : 'text-red-900'}`}>
                  Rs {fmt0(summary.profit)}
                  {summary.sales > 0 && <span className="ml-1 text-xs font-semibold">({summary.margin.toFixed(1)}%)</span>}
                </p>
              </div>
            </div>
            {summary.unpriced > 0 && (
              <p className="mt-2 text-xs text-gray-500">
                {summary.unpriced} resale line{summary.unpriced === 1 ? ' has' : 's have'} no selling price yet (landed Rs {fmt0(summary.unpricedLanded)}) and {summary.unpriced === 1 ? 'is' : 'are'} not in sales or profit.
              </p>
            )}

            {/* Shipping check */}
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5 text-sm">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                  {!shipLoaded ? (
                    <p className="text-xs text-gray-400">Checking shipping charges...</p>
                  ) : !shipInfo ? (
                    <p className="flex items-start gap-1.5 text-gray-600 text-xs">
                      <Truck className="w-4 h-4 flex-shrink-0 text-gray-400" />
                      <span>Batch {activeBatch} is not a Shipping record yet. Shipping charges come from Shipping &rarr; Charges once the shipment exists.</span>
                    </p>
                  ) : target && target.amount > 0 ? (
                    <p className={`flex items-start gap-1.5 ${matches ? 'text-green-700' : 'text-amber-700'}`}>
                      {matches ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                      <span>
                        Shipping charges in costing: <strong>Rs {fmt0(summary.shipping)}</strong> of <strong>Rs {fmt0(target.amount)}</strong> ({target.label})
                        {matches ? ' ✓' : ` — ${diff < 0 ? 'short by' : 'over by'} Rs ${fmt0(Math.abs(diff))}`}
                      </span>
                    </p>
                  ) : (
                    <p className="flex items-start gap-1.5 text-amber-700">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>No shipping charges entered for shipment {activeBatch} yet. Enter them per item in Shipping &rarr; Charges.</span>
                    </p>
                  )}
                  {shipInfo && target && target.label !== 'item charges in Shipping' && itemCharges.size > 0 && Math.abs(itemChargeTotal - target.amount) >= 1 && (
                    <p className="text-xs text-amber-700 ml-5">Item charges entered in Shipping add up to Rs {fmt0(itemChargeTotal)}.</p>
                  )}
                  {shipInfo && shipInfo.other_charges > 0 && (
                    <p className="text-xs text-gray-500 ml-5">Other charges on the shipment: Rs {fmt0(shipInfo.other_charges)}.</p>
                  )}
                </div>
                {chargeCols && (
                  <div className="flex items-center gap-2">
                    {syncMsg && <span className="text-xs text-gray-500">{syncMsg}</span>}
                    <button onClick={() => setHistoryOpen(true)} className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"><History className="w-3.5 h-3.5" />History</button>
                    <button
                      onClick={updateFromShipping}
                      disabled={syncing}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs text-teal-800 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 disabled:opacity-50"
                      title="Copy each item's charge from Shipping -> Charges onto its costing line"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                      Update from shipping
                    </button>
                  </div>
                )}
              </div>
              {noChargeLines.length > 0 && (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  <strong>{noChargeLines.length} item{noChargeLines.length === 1 ? ' has' : 's have'} no shipping charge</strong> &mdash; open Shipping &rarr; Charges.
                  <span className="text-amber-700">
                    {' '}{noChargeLines.slice(0, 8).map(r => `${plNoOf(r) ? `#${plNoOf(r)} ` : ''}${r.description || '(no name)'}`).join(', ')}
                    {noChargeLines.length > 8 ? `, and ${noChargeLines.length - 8} more` : ''}
                  </span>
                </div>
              )}
              {chargedNotInCosting > 0 && (
                <p className="text-xs text-amber-700">
                  {chargedNotInCosting} charged item{chargedNotInCosting === 1 ? ' is' : 's are'} not in this costing yet &mdash; use Import from PL.
                </p>
              )}
              {shipError && <p className="text-xs text-red-700">{shipError}</p>}
            </div>
          </div>

          {/* Filters & CNY Rate */}
          <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">CNY Rate:</label>
                <input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={globalCnyRate || ''}
                  onChange={(e) => setGlobalCnyRate(parseFloat(e.target.value) || 0)}
                  onBlur={(e) => updateGlobalCnyRate(parseFloat(e.target.value) || 0)}
                  className="w-24 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g. 45.50"
                />
                <span className="text-xs text-gray-500">LKR per CNY</span>
              </div>
              <div className="relative flex-1 min-w-[180px]">
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
              {filtersOn && (
                <button
                  onClick={() => { setSearchTerm(''); setSelectedPlNo(''); setTypeFilter(''); }}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                  Clear
                </button>
              )}
            </div>
            {filtersOn && (
              <p className="mt-2 text-xs text-gray-600">
                Showing {filteredRecords.length} of {batchRecords.length} lines (subtotal: landed Rs {fmt0(shown.landed)}, sales Rs {fmt0(shown.sales)}, profit Rs {fmt0(shown.profit)})
              </p>
            )}
          </div>

          {showImportModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg shadow-xl p-5 w-full max-w-md">
                <h3 className="font-semibold text-gray-900 mb-1">Import from Packing List</h3>
                <p className="text-sm text-gray-500 mb-4">Batch {activeBatch}</p>
                <p className="text-sm text-gray-600 mb-4">
                  Imports packing list items for this batch that are not yet in the costing sheet.
                  Unit prices are pulled from linked purchase bills; shipping charges from Shipping &rarr; Charges.
                </p>
                <div className="bg-gray-50 rounded p-3 mb-4 space-y-1">
                  <p className="text-sm text-gray-700"><strong>{batchPackingItems.length}</strong> items in Batch {activeBatch} packing list</p>
                  <p className="text-sm text-gray-700"><strong>{batchRecords.length}</strong> already in costing sheet</p>
                  <p className="text-sm text-teal-700 font-medium"><strong>{newItemsCount}</strong> new items to import</p>
                </div>
                <div className="flex justify-end space-x-2">
                  <button onClick={() => setShowImportModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={importFromPackingList}
                    disabled={newItemsCount === 0 || saving}
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
                <table className="w-full text-xs border-collapse" style={{ minWidth: '1380px' }}>
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
                      <th className={thBase} style={{ minWidth: '50px' }}>PL No</th>
                      <th className={`${thBase} text-left`} style={{ minWidth: '170px' }}>Description</th>
                      <th className={thBase} style={{ minWidth: '50px' }}>Qty</th>
                      <th className={thBase} style={{ minWidth: '40px' }}>Unit</th>
                      <th className={`${thBase} bg-blue-800`} style={{ minWidth: '65px' }}>Price CNY</th>
                      <th className={`${thBase} bg-blue-800`} style={{ minWidth: '50px' }}>Rate</th>
                      <th className={`${thBase} bg-blue-800`} style={{ minWidth: '80px' }}>Cost LKR/unit</th>
                      <th className={`${thBase} bg-amber-600`} style={{ minWidth: '95px' }}>Shipping/unit</th>
                      <th className={`${thBase} bg-green-700`} style={{ minWidth: '80px' }}>Landed/unit</th>
                      <th className={`${thBase} bg-teal-600`} style={{ minWidth: '80px' }}>Selling price</th>
                      <th className={`${thBase} bg-teal-600`} style={{ minWidth: '70px' }}>Profit/unit</th>
                      <th className={`${thBase} bg-teal-600`} style={{ minWidth: '55px' }}>Margin %</th>
                      <th className={`${thBase} bg-green-700`} style={{ minWidth: '90px' }}>Total landed</th>
                      <th className={`${thBase} bg-teal-600`} style={{ minWidth: '85px' }}>Total sales</th>
                      <th className={`${thBase} bg-teal-600`} style={{ minWidth: '85px' }}>Total profit</th>
                      <th className={thBase} style={{ minWidth: '75px' }}>Type</th>
                      <th className={thBase} style={{ minWidth: '30px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.map((record, idx) => {
                      const resale = record.type === 'RESALE';
                      const priced = resale && record.selling_price > 0;
                      const margin = priced ? (record.profit_per_unit / record.selling_price) * 100 : 0;
                      const charged = hasCharge(record);
                      const tag = !charged && record.charge_basis !== 'OLD' ? 'NONE' : record.charge_basis || (record.packing_list_item_id ? '' : (record.charge_per_unit > 0 ? 'MANUAL' : ''));
                      const shipEditable = canEditShipping(record);
                      return (
                        <tr key={record.id} className={`${selectedIds.has(record.id) ? 'bg-amber-50' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-teal-50`}>
                          <td className="px-1 py-1.5 text-center border border-gray-300">
                            <input type="checkbox" checked={selectedIds.has(record.id)} onChange={() => toggleSelect(record.id)} />
                          </td>
                          <td className="px-2 py-1.5 text-center border border-gray-300 text-gray-600 whitespace-nowrap">
                            {plNoOf(record) ? `#${plNoOf(record)}` : <span className="text-gray-400">manual</span>}
                          </td>
                          {editable(record, 'description', record.description,
                            <span className="font-medium text-gray-900">{record.description || '-'}</span>, '', { type: 'text', align: 'left' })}
                          {editable(record, 'qty', record.qty, record.qty.toLocaleString('en-US'), 'tabular-nums', { align: 'center' })}
                          {editable(record, 'unit', record.unit, record.unit, '', { type: 'text', align: 'center' })}
                          {editable(record, 'unit_price_cny', record.unit_price_cny,
                            record.unit_price_cny > 0 ? fmt2(record.unit_price_cny) : '-', 'bg-teal-50 tabular-nums', { step: '0.01' })}
                          <td className="px-2 py-1.5 text-right border border-gray-300 text-gray-600 tabular-nums">
                            {record.cny_rate > 0 ? fmt2(record.cny_rate) : '-'}
                          </td>
                          <td className="px-2 py-1.5 text-right border border-gray-300 bg-teal-50 font-medium tabular-nums">
                            {record.unit_price_lkr > 0 ? fmt2(record.unit_price_lkr) : '-'}
                          </td>
                          {editable(record, 'charge_per_unit', record.charge_per_unit,
                            <div className="flex items-center justify-end gap-1">
                              {tag && <span className={`px-1 rounded text-[9px] font-semibold leading-4 ${BASIS_TAG[tag] || 'bg-gray-100 text-gray-600'}`}>{tag}</span>}
                              <span className={tag === 'NONE' ? 'text-red-600' : ''}>{record.charge_per_unit > 0 ? fmt2(record.charge_per_unit) : '-'}</span>
                            </div>,
                            `bg-amber-50 font-medium tabular-nums ${shipEditable ? 'hover:bg-amber-100' : ''}`,
                            { step: '0.01', disabled: !shipEditable })}
                          <td className="px-2 py-1.5 text-right border border-gray-300 bg-green-50 font-semibold text-green-800 tabular-nums">
                            {record.landed_cost_per_unit > 0 ? fmt2(record.landed_cost_per_unit) : '-'}
                          </td>
                          {editable(record, 'selling_price', record.selling_price,
                            resale ? (record.selling_price > 0 ? fmt2(record.selling_price) : '-') : 'N/A',
                            `bg-teal-50 tabular-nums ${resale ? '' : 'opacity-50'}`, { step: '0.01', disabled: !resale })}
                          <td className={`px-2 py-1.5 text-right border border-gray-300 bg-teal-50 font-medium tabular-nums ${
                            record.profit_per_unit < 0 ? 'text-red-600' : 'text-teal-700'
                          } ${resale ? '' : 'opacity-50'}`}>
                            {resale ? (priced ? fmt2(record.profit_per_unit) : '-') : 'N/A'}
                          </td>
                          <td className={`px-2 py-1.5 text-right border border-gray-300 bg-teal-50 tabular-nums ${
                            margin < 0 ? 'text-red-600' : 'text-teal-700'
                          } ${resale ? '' : 'opacity-50'}`}>
                            {resale ? (priced ? `${margin.toFixed(1)}%` : '-') : 'N/A'}
                          </td>
                          <td className="px-2 py-1.5 text-right border border-gray-300 bg-green-50 font-semibold text-green-800 tabular-nums">
                            {record.total_landed_cost > 0 ? fmt0(record.total_landed_cost) : '-'}
                          </td>
                          <td className={`px-2 py-1.5 text-right border border-gray-300 bg-teal-50 font-medium tabular-nums ${resale ? '' : 'opacity-50'}`}>
                            {resale ? (priced ? fmt0(record.total_sales) : '-') : 'N/A'}
                          </td>
                          <td className={`px-2 py-1.5 text-right border border-gray-300 bg-teal-50 font-semibold tabular-nums ${
                            record.total_profit < 0 ? 'text-red-600' : 'text-teal-700'
                          } ${resale ? '' : 'opacity-50'}`}>
                            {resale ? (priced ? fmt0(record.total_profit) : '-') : 'N/A'}
                          </td>
                          <td className="px-2 py-1.5 text-center border border-gray-300">
                            <select
                              value={record.type}
                              onChange={(e) => updateCell(record.id, { type: e.target.value })}
                              className="w-full px-1 py-0.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                            >
                              <option value="RESALE">RESALE</option>
                              <option value="FACTORY">FACTORY</option>
                            </select>
                          </td>
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
                      );
                    })}
                    <tr className="bg-slate-900 text-white font-bold">
                      <td colSpan={13} className="px-2 py-2 text-right border border-slate-700">
                        {filtersOn ? `SHOWN LINES (${filteredRecords.length} of ${batchRecords.length}):` : 'TOTALS:'}
                      </td>
                      <td className="px-2 py-2 text-right border border-slate-700 bg-green-700 tabular-nums">{fmt0(shown.landed)}</td>
                      <td className="px-2 py-2 text-right border border-slate-700 bg-teal-600 tabular-nums">{fmt0(shown.sales)}</td>
                      <td className={`px-2 py-2 text-right border border-slate-700 tabular-nums ${shown.profit < 0 ? 'bg-red-600' : 'bg-teal-600'}`}>{fmt0(shown.profit)}</td>
                      <td colSpan={2} className="px-2 py-2 border border-slate-700"></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
              <Calculator className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-gray-500 text-sm">
                {batchRecords.length > 0 ? 'No lines match the filters' : `No costing records for Batch ${activeBatch}`}
              </p>
              {batchRecords.length === 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  {newItemsCount > 0
                    ? `Click "Import from PL (${newItemsCount})" above to import packing list items`
                    : 'Add rows manually or import from packing list'}
                </p>
              )}
            </div>
          )}

          <div className="bg-teal-50 border border-blue-100 rounded-lg p-3 text-xs text-teal-800">
            <div className="flex items-center space-x-1 mb-1">
              <Calculator className="w-3.5 h-3.5" />
              <span className="font-medium">How it is worked out:</span>
            </div>
            <ul className="space-y-0.5 ml-4 list-disc">
              <li><strong>Cost LKR/unit</strong> = Price CNY x CNY rate</li>
              <li><strong>Shipping/unit</strong> = the item's charge in Shipping &rarr; Charges / its qty (tag shows KG / CBM / PCS / FIXED; MANUAL for rows not from the packing list)</li>
              <li><strong>Landed/unit</strong> = Cost LKR/unit + Shipping/unit</li>
              <li><strong>Profit</strong> = Selling price - Landed (RESALE only); FACTORY goods count at landed cost</li>
            </ul>
          </div>
        </>
      )}
    </div>
      {showPrintView && (
        <CostingDutyPrint
          records={batchLines}
          summary={summary}
          batchNumber={activeBatch}
          book={batchBook}
          isShipment={!!shipInfo}
          onClose={() => setShowPrintView(false)}
        />
      )}
    </>
  );
}
