import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { moveToRecycleBin } from '../lib/recycleBin';
import { Package, Plus, Check, Clock, Truck, CircleCheck as CheckCircle, Search, RefreshCw, Trash2, X, FileText, Calendar, ChevronDown, History, ChevronRight, Building2, CircleAlert as AlertCircle } from 'lucide-react';

interface PLInputRecord {
  id: string;
  purchase_bill_id: string | null;
  date: string;
  supplier_name: string;
  shipper_name: string;
  packing_list_no: string;
  batch_number: string | null;
  expected: boolean;
  received: boolean;
  entered_in_register: boolean;
  status: string;
  notes: string;
}

interface PurchaseBill {
  id: string;
  bill_date: string;
  batch_number: string;
  po_number: string;
  supplier_name: string;
  items_count?: number;
}

interface BillBatchGroup {
  canonicalBatch: string;
  rawBatches: string[];
  bills: PurchaseBill[];
  dateFrom: string;
  dateTo: string;
  supplierNames: string[];
}

// Only plain-number batches ("02" and "2") count as the same batch.
// Shipment numbers like LCL-2610-01 and FCL-2610-01 must stay separate, so they are compared as whole text.
function normalizeBatchNum(b: string): number {
  const t = b.trim();
  return /^\d+$/.test(t) ? parseInt(t, 10) : NaN;
}

// for ordering only: newest (highest digits) first, then by text
function sortBatches(batches: string[]): string[] {
  const digits = (x: string) => parseInt(x.replace(/\D/g, ''), 10);
  return [...batches].sort((a, b) => {
    const numA = digits(a);
    const numB = digits(b);
    if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numB - numA;
    return b.localeCompare(a);
  });
}

function batchesAreSame(a: string, b: string): boolean {
  const nA = normalizeBatchNum(a);
  const nB = normalizeBatchNum(b);
  if (!isNaN(nA) && !isNaN(nB)) return nA === nB;
  return a === b;
}

function canonicalizeBatch(batches: string[]): string {
  // prefer the padded form (e.g. "02" over "2")
  const sorted = [...batches].sort((a, b) => b.length - a.length || b.localeCompare(a));
  return sorted[0];
}

export default function PLInput() {
  const [records, setRecords] = useState<PLInputRecord[]>([]);
  const [allBatches, setAllBatches] = useState<string[]>([]);
  const [activeBatch, setActiveBatch] = useState<string>('');
  const [availableBills, setAvailableBills] = useState<PurchaseBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const importingRef = useRef(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [addFormStep, setAddFormStep] = useState<'batch' | 'bills'>('batch');
  const [addFormSelectedBatch, setAddFormSelectedBatch] = useState<BillBatchGroup | null>(null);
  const [selectedBillIds, setSelectedBillIds] = useState<Set<string>>(new Set());
  const [shipperName, setShipperName] = useState('');
  const [showManualForm, setShowManualForm] = useState(false);
  const [showBatchHistory, setShowBatchHistory] = useState(false);
  const [manualEntry, setManualEntry] = useState({
    supplier_name: '',
    shipper_name: '',
    date: new Date().toISOString().split('T')[0],
  });

  const [shipmentNos, setShipmentNos] = useState<string[]>([]);

  useEffect(() => {
    loadData();
    supabase.from('shipments').select('shipment_no').order('created_at', { ascending: false })
      .then(({ data }) => setShipmentNos((data || []).map((r: { shipment_no: string }) => r.shipment_no)));
  }, []);

  async function loadData() {
    setLoading(true);
    await Promise.all([loadAllRecords(), loadAvailableBills()]);
    setLoading(false);
  }

  async function loadAllRecords() {
    const { data, error } = await supabase
      .from('pl_input')
      .select('*')
      .order('date', { ascending: false });

    if (error) {
      console.error('Error loading PL Input records:', error);
      return;
    }

    const rows = data || [];
    setRecords(rows);

    // Group raw batch strings by their numeric value to get canonical forms
    const rawBatches = new Set<string>();
    rows.forEach((r) => {
      if (r.batch_number) rawBatches.add(r.batch_number);
    });

    // Build canonical batch list (merge "02" and "2" into one)
    const canonicalMap = new Map<number, string[]>();
    rawBatches.forEach((b) => {
      const n = normalizeBatchNum(b);
      if (!isNaN(n)) {
        const existing = canonicalMap.get(n) || [];
        canonicalMap.set(n, [...existing, b]);
      }
    });
    const canonicalBatches: string[] = [];
    canonicalMap.forEach((variants) => {
      canonicalBatches.push(canonicalizeBatch(variants));
    });
    // Also include non-numeric batches
    rawBatches.forEach((b) => {
      if (isNaN(normalizeBatchNum(b))) canonicalBatches.push(b);
    });

    const sorted = sortBatches(canonicalBatches);
    setAllBatches(sorted);

    setActiveBatch((prev) => {
      if (prev && prev !== '__unassigned__') {
        // Check if prev matches any canonical batch
        const stillExists = sorted.some((s) => batchesAreSame(s, prev));
        if (stillExists) return sorted.find((s) => batchesAreSame(s, prev)) || prev;
      }
      if (prev === '__unassigned__') return prev;
      return sorted[0] || '__unassigned__';
    });
  }

  async function loadAvailableBills() {
    const { data, error } = await supabase
      .from('purchase_bills')
      .select(`
        id,
        bill_date,
        batch_number,
        purchase_orders (
          id,
          suppliers (name)
        ),
        purchase_bill_items (id)
      `)
      .order('bill_date', { ascending: false });

    if (error) {
      console.error('Error loading purchase bills:', error);
      return;
    }

    const bills: PurchaseBill[] = (data || []).map((bill) => {
      const po = bill.purchase_orders as unknown as { id: string; suppliers: { name: string } };
      const items = bill.purchase_bill_items as unknown as { id: string }[];
      return {
        id: bill.id,
        bill_date: bill.bill_date,
        batch_number: bill.batch_number || '',
        po_number: bill.batch_number || '',
        supplier_name: po?.suppliers?.name || 'Unknown',
        items_count: items?.length || 0,
      };
    });

    setAvailableBills(bills);
  }

  async function addFromBills() {
    if (selectedBillIds.size === 0 || !addFormSelectedBatch) return;
    if (importingRef.current) return; // a double-click must not import the same bills twice
    importingRef.current = true; setImporting(true);
    try { await doAddFromBills(); } finally { importingRef.current = false; setImporting(false); }
  }

  async function doAddFromBills() {
    if (!addFormSelectedBatch) return;
    // a bill that is already in PL Input is never imported again
    const billsToAdd = availableBills.filter((b) => selectedBillIds.has(b.id) && !importedBillIds.has(b.id));
    if (billsToAdd.length === 0) { alert('These bills are already in PL Input.'); return; }
    const targetBatch = addFormSelectedBatch.canonicalBatch;

    // Count existing non-manual records in THIS batch only so numbering starts fresh per batch
    const existingInBatch = records.filter(
      (r) => !r.packing_list_no.startsWith('M') && r.batch_number && batchesAreSame(r.batch_number, targetBatch)
    ).length;

    const inserts = billsToAdd.map((bill, idx) => ({
      purchase_bill_id: bill.id,
      date: bill.bill_date,
      supplier_name: bill.supplier_name,
      shipper_name: shipperName,
      packing_list_no: String(existingInBatch + idx + 1),
      batch_number: bill.batch_number || null,
      expected: false,
      received: false,
      entered_in_register: false,
    }));

    const { data: inserted, error } = await supabase
      .from('pl_input')
      .insert(inserts)
      .select('id, packing_list_no, purchase_bill_id, batch_number');

    if (error) {
      console.error('Error adding PL Input:', error);
      alert('Could not import the bills: ' + error.message);
      return;
    }

    // Auto-create packing list items from the linked bill items
    if (inserted && inserted.length > 0) {
      const packingListRows: {
        batch_number: string;
        packing_list_no: string;
        pl_input_id: string;
        purchase_bill_item_id: string;
        item_name: string;
        quantity: number;
        unit: string;
        no_of_pkgs: number;
        weight_kg: number;
        cbm: number;
        status: string;
      }[] = [];

      for (const plRecord of inserted) {
        if (!plRecord.purchase_bill_id) continue;

        const { data: billItems } = await supabase
          .from('purchase_bill_items')
          .select('id, item_name, quantity_received, unit')
          .eq('purchase_bill_id', plRecord.purchase_bill_id);

        if (!billItems || billItems.length === 0) continue;

        for (const item of billItems) {
          packingListRows.push({
            batch_number: plRecord.batch_number || '',
            packing_list_no: plRecord.packing_list_no,
            pl_input_id: plRecord.id,
            purchase_bill_item_id: item.id,
            item_name: item.item_name,
            quantity: item.quantity_received ?? 0,
            unit: item.unit || 'PCS',
            no_of_pkgs: 0,
            weight_kg: 0,
            cbm: 0,
            status: 'Matched',
          });
        }
      }

      if (packingListRows.length > 0) {
        const { error: plError } = await supabase.from('packing_list_items').insert(packingListRows);
        if (plError) { console.error('Error creating packing list items:', plError); alert('The bills were added, but their packing list lines could not be created: ' + plError.message); }
      }
    }

    closeAddForm();
    loadAllRecords();
  }

  function closeAddForm() {
    setShowAddForm(false);
    setAddFormStep('batch');
    setAddFormSelectedBatch(null);
    setSelectedBillIds(new Set());
    setShipperName('');
  }

  async function addManualEntry() {
    if (!manualEntry.supplier_name) return;

    const manualRecords = records.filter((r) => r.packing_list_no.startsWith('M'));
    const maxManualNum = manualRecords.reduce((max, r) => {
      const num = parseInt(r.packing_list_no.slice(1), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    const nextManualNumber = `M${maxManualNum + 1}`;

    const { error } = await supabase.from('pl_input').insert({
      purchase_bill_id: null,
      date: manualEntry.date,
      supplier_name: manualEntry.supplier_name,
      shipper_name: manualEntry.shipper_name,
      packing_list_no: nextManualNumber,
      batch_number: activeBatch === '__unassigned__' ? null : activeBatch,
      expected: false,
      received: false,
      entered_in_register: false,
    });

    if (error) {
      console.error('Error adding manual PL Input:', error);
      return;
    }

    setShowManualForm(false);
    setManualEntry({
      supplier_name: '',
      shipper_name: '',
      date: new Date().toISOString().split('T')[0],
    });
    loadAllRecords();
  }

  async function updateCheckbox(id: string, field: 'expected' | 'received' | 'entered_in_register', value: boolean) {
    const record = records.find((r) => r.id === id);
    if (!record) return;

    const updates: Partial<PLInputRecord> = { [field]: value };

    if (field === 'expected' && !value) {
      updates.received = false;
      updates.entered_in_register = false;
    } else if (field === 'received' && !value) {
      updates.entered_in_register = false;
    } else if (field === 'received' && value && !record.expected) {
      updates.expected = true;
    } else if (field === 'entered_in_register' && value) {
      if (!record.expected) updates.expected = true;
      if (!record.received) updates.received = true;
    }

    const { error } = await supabase
      .from('pl_input')
      .update(updates)
      .eq('id', id);

    if (error) {
      console.error('Error updating record:', error);
      return;
    }

    loadAllRecords();
  }

  // Typing only updates the screen; the database is written when the field loses focus.
  function editLocal(id: string, field: 'shipper_name' | 'batch_number', value: string) {
    setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  async function updateShipperName(id: string, value: string) {
    const { error } = await supabase
      .from('pl_input')
      .update({ shipper_name: value })
      .eq('id', id);

    if (error) {
      console.error('Error updating shipper name:', error);
      return;
    }

    setRecords((prev) =>
      prev.map((r) => (r.id === id ? { ...r, shipper_name: value } : r))
    );
  }

  async function updateBatchNumber(id: string, value: string) {
    const { error } = await supabase
      .from('pl_input')
      .update({ batch_number: value || null })
      .eq('id', id);

    if (error) {
      console.error('Error updating batch number:', error);
      return;
    }

    setRecords((prev) =>
      prev.map((r) => (r.id === id ? { ...r, batch_number: value || null } : r))
    );
  }

  async function deleteRecord(id: string) {
    if (!confirm('Are you sure you want to delete this record? It will be moved to the Recycle Bin.')) return;

    const recordToDelete = records.find(r => r.id === id);
    if (!recordToDelete) return;

    const result = await moveToRecycleBin({
      source_table: 'pl_input',
      source_id: id,
      record_data: recordToDelete,
      display_name: `PL ${recordToDelete.packing_list_no} - ${recordToDelete.supplier_name}`,
      portal: 'cn',
    });

    if (!result.success) {
      alert('Failed to move to recycle bin: ' + result.error);
      return;
    }

    const { error } = await supabase
      .from('pl_input')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting record:', error);
      return;
    }

    loadAllRecords();
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'Complete':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircle className="w-3.5 h-3.5 mr-1" />
            Complete
          </span>
        );
      case 'Received':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-teal-100 text-teal-800">
            <Check className="w-3.5 h-3.5 mr-1" />
            Received
          </span>
        );
      case 'Expected':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
            <Truck className="w-3.5 h-3.5 mr-1" />
            Expected
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
            <Clock className="w-3.5 h-3.5 mr-1" />
            Pending
          </span>
        );
    }
  }

  // Filter records by active batch — treat "02" and "2" as same
  const batchRecords = records.filter((r) => {
    if (activeBatch === '__unassigned__') return !r.batch_number;
    if (!r.batch_number) return false;
    return batchesAreSame(r.batch_number, activeBatch);
  });

  // Group available bills by canonical batch for the two-step import modal
  const billBatchGroups: BillBatchGroup[] = (() => {
    const groupMap = new Map<number, BillBatchGroup>();
    const nonNumericGroups = new Map<string, BillBatchGroup>();

    availableBills.forEach((bill) => {
      if (!bill.batch_number) return;
      const n = normalizeBatchNum(bill.batch_number);

      if (!isNaN(n)) {
        if (!groupMap.has(n)) {
          groupMap.set(n, {
            canonicalBatch: bill.batch_number,
            rawBatches: [bill.batch_number],
            bills: [],
            dateFrom: bill.bill_date,
            dateTo: bill.bill_date,
            supplierNames: [],
          });
        }
        const group = groupMap.get(n)!;
        if (!group.rawBatches.includes(bill.batch_number)) {
          group.rawBatches.push(bill.batch_number);
          group.canonicalBatch = canonicalizeBatch(group.rawBatches);
        }
        group.bills.push(bill);
        if (bill.bill_date < group.dateFrom) group.dateFrom = bill.bill_date;
        if (bill.bill_date > group.dateTo) group.dateTo = bill.bill_date;
        if (!group.supplierNames.includes(bill.supplier_name)) {
          group.supplierNames.push(bill.supplier_name);
        }
      } else {
        const key = bill.batch_number;
        if (!nonNumericGroups.has(key)) {
          nonNumericGroups.set(key, {
            canonicalBatch: key,
            rawBatches: [key],
            bills: [],
            dateFrom: bill.bill_date,
            dateTo: bill.bill_date,
            supplierNames: [],
          });
        }
        const group = nonNumericGroups.get(key)!;
        group.bills.push(bill);
        if (bill.bill_date < group.dateFrom) group.dateFrom = bill.bill_date;
        if (bill.bill_date > group.dateTo) group.dateTo = bill.bill_date;
        if (!group.supplierNames.includes(bill.supplier_name)) {
          group.supplierNames.push(bill.supplier_name);
        }
      }
    });

    const allGroups: BillBatchGroup[] = [...groupMap.values(), ...nonNumericGroups.values()];
    return allGroups.sort((a, b) => {
      const nA = normalizeBatchNum(a.canonicalBatch);
      const nB = normalizeBatchNum(b.canonicalBatch);
      if (!isNaN(nA) && !isNaN(nB)) return nB - nA;
      return b.canonicalBatch.localeCompare(a.canonicalBatch);
    });
  })();

  // IDs already imported into pl_input
  const importedBillIds = new Set(records.map((r) => r.purchase_bill_id).filter(Boolean) as string[]);

  const uniqueSuppliers = [...new Set(batchRecords.map(r => r.supplier_name))].sort();

  const filteredRecords = batchRecords.filter((r) => {
    const matchesSearch =
      r.supplier_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.shipper_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.packing_list_no.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = !statusFilter || r.status === statusFilter;
    const matchesDate = !dateFilter || r.date === dateFilter;
    const matchesSupplier = !supplierFilter || r.supplier_name === supplierFilter;
    return matchesSearch && matchesStatus && matchesDate && matchesSupplier;
  });

  const stats = {
    total: batchRecords.length,
    pending: batchRecords.filter((r) => r.status === 'Pending').length,
    expected: batchRecords.filter((r) => r.status === 'Expected').length,
    received: batchRecords.filter((r) => r.status === 'Received').length,
    complete: batchRecords.filter((r) => r.status === 'Complete').length,
  };

  const batchSummary = allBatches.map((b) => {
    const batchRows = records.filter((r) => r.batch_number === b);
    const complete = batchRows.filter((r) => r.status === 'Complete').length;
    const dates = batchRows.map((r) => r.date).filter(Boolean).sort();
    return {
      batch: b,
      total: batchRows.length,
      complete,
      from: dates[0] || '',
      to: dates[dates.length - 1] || '',
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
    <div className="space-y-6">
      <datalist id="pl-shipment-list">{shipmentNos.map((n) => <option key={n} value={n} />)}</datalist>
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">PL Input</h2>
        <div className="flex items-center space-x-2">
          <button
            onClick={loadData}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowManualForm(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <FileText className="w-4 h-4" />
            <span>Add Manual</span>
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Add from Bill</span>
          </button>
        </div>
      </div>

      {/* Batch Selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-gray-500">Batch:</span>
        {allBatches.map((b) => (
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
        {records.some((r) => !r.batch_number) && (
          <button
            onClick={() => setActiveBatch('__unassigned__')}
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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gray-100 rounded-lg">
              <Package className="w-5 h-5 text-gray-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total</p>
              <p className="text-xl font-bold text-gray-900">{stats.total}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gray-100 rounded-lg">
              <Clock className="w-5 h-5 text-gray-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Pending</p>
              <p className="text-xl font-bold text-gray-900">{stats.pending}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Truck className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Expected</p>
              <p className="text-xl font-bold text-amber-600">{stats.expected}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-teal-100 rounded-lg">
              <Check className="w-5 h-5 text-teal-700" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Received</p>
              <p className="text-xl font-bold text-teal-700">{stats.received}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Complete</p>
              <p className="text-xl font-bold text-green-600">{stats.complete}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by supplier, shipper, or PL number..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
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
            {uniqueSuppliers.map(supplier => (
              <option key={supplier} value={supplier}>{supplier}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          >
            <option value="">All Status</option>
            <option value="Pending">Pending</option>
            <option value="Expected">Expected</option>
            <option value="Received">Received</option>
            <option value="Complete">Complete</option>
          </select>
          {(searchTerm || dateFilter || supplierFilter || statusFilter) && (
            <button
              onClick={() => {
                setSearchTerm('');
                setDateFilter('');
                setSupplierFilter('');
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
                <p className="text-sm text-gray-500">Select a batch to view its PL Input records</p>
              </div>
              <button onClick={() => setShowBatchHistory(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="space-y-3">
              {batchSummary.map((b) => {
                const pct = b.total > 0 ? Math.round((b.complete / b.total) * 100) : 0;
                const isActive = activeBatch === b.batch;
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
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        pct === 100 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {b.complete}/{b.total} Complete
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 mb-1.5">
                      <div
                        className={`h-1.5 rounded-full transition-all ${pct === 100 ? 'bg-green-500' : 'bg-amber-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {b.from && (
                      <p className="text-xs text-gray-400">
                        {new Date(b.from).toLocaleDateString()} — {new Date(b.to).toLocaleDateString()}
                      </p>
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

      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-teal-100 rounded-lg">
                  <FileText className="w-5 h-5 text-teal-700" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Add from Bill</h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${addFormStep === 'batch' ? 'bg-teal-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                      1 Select Batch
                    </span>
                    <ChevronRight className="w-3 h-3 text-gray-400" />
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${addFormStep === 'bills' ? 'bg-teal-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                      2 Select Bills
                    </span>
                  </div>
                </div>
              </div>
              <button onClick={closeAddForm} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 px-6 py-4">
              {addFormStep === 'batch' && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-500 mb-4">
                    Select the batch you want to import bills from.
                  </p>
                  {billBatchGroups.length === 0 && (
                    <div className="text-center py-10 text-gray-400">
                      <Package className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                      <p className="text-sm">No purchase bills found</p>
                    </div>
                  )}
                  {billBatchGroups.map((group) => {
                    const alreadyImported = group.bills.filter((b) => importedBillIds.has(b.id)).length;
                    const pending = group.bills.length - alreadyImported;
                    return (
                      <button
                        key={group.canonicalBatch}
                        onClick={() => {
                          setAddFormSelectedBatch(group);
                          setAddFormStep('bills');
                          setSelectedBillIds(new Set());
                        }}
                        className="w-full text-left px-4 py-3.5 rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-teal-50/50 transition-all group"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                              {group.canonicalBatch.replace(/\D/g, '') || group.canonicalBatch.slice(0, 2)}
                            </div>
                            <div>
                              <p className="font-semibold text-gray-900">Batch {group.canonicalBatch}</p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {group.supplierNames.slice(0, 2).join(', ')}
                                {group.supplierNames.length > 2 && ` +${group.supplierNames.length - 2} more`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <p className="text-sm font-semibold text-gray-900">{group.bills.length} bill{group.bills.length !== 1 ? 's' : ''}</p>
                              <p className="text-xs text-gray-500">
                                {pending > 0 ? (
                                  <span className="text-amber-600 font-medium">{pending} not imported</span>
                                ) : (
                                  <span className="text-green-600 font-medium">All imported</span>
                                )}
                              </p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors" />
                          </div>
                        </div>
                        {group.dateFrom && (
                          <p className="text-xs text-gray-400 mt-2 pl-13">
                            {new Date(group.dateFrom).toLocaleDateString()} — {new Date(group.dateTo).toLocaleDateString()}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {addFormStep === 'bills' && addFormSelectedBatch && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-4">
                    <button
                      onClick={() => { setAddFormStep('batch'); setSelectedBillIds(new Set()); }}
                      className="text-sm text-teal-700 hover:underline flex items-center gap-1"
                    >
                      ← Batch {addFormSelectedBatch.canonicalBatch}
                    </button>
                    <span className="text-gray-400">·</span>
                    <span className="text-sm text-gray-500">{addFormSelectedBatch.bills.length} bills</span>
                    {selectedBillIds.size > 0 && (
                      <>
                        <span className="text-gray-400">·</span>
                        <span className="text-sm font-medium text-teal-700">{selectedBillIds.size} selected</span>
                      </>
                    )}
                    <button
                      onClick={() => {
                        const notYetImported = addFormSelectedBatch.bills.filter((b) => !importedBillIds.has(b.id));
                        if (selectedBillIds.size === notYetImported.length) {
                          setSelectedBillIds(new Set());
                        } else {
                          setSelectedBillIds(new Set(notYetImported.map((b) => b.id)));
                        }
                      }}
                      className="ml-auto text-xs text-teal-700 hover:underline"
                    >
                      {selectedBillIds.size === addFormSelectedBatch.bills.filter((b) => !importedBillIds.has(b.id)).length
                        ? 'Deselect all'
                        : 'Select all'}
                    </button>
                  </div>

                  {addFormSelectedBatch.bills.map((bill) => {
                    const isImported = importedBillIds.has(bill.id);
                    const isSelected = selectedBillIds.has(bill.id);
                    return (
                      <div
                        key={bill.id}
                        onClick={() => {
                          if (isImported) return;
                          setSelectedBillIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(bill.id)) next.delete(bill.id);
                            else next.add(bill.id);
                            return next;
                          });
                        }}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                          isImported
                            ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                            : isSelected
                            ? 'border-blue-500 bg-teal-50 cursor-pointer'
                            : 'border-gray-200 hover:border-teal-300 hover:bg-teal-50/30 cursor-pointer'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          isImported
                            ? 'border-gray-300 bg-gray-100'
                            : isSelected
                            ? 'border-blue-500 bg-teal-500'
                            : 'border-gray-300'
                        }`}>
                          {isImported ? (
                            <Check className="w-3 h-3 text-gray-400" />
                          ) : isSelected ? (
                            <Check className="w-3 h-3 text-white" />
                          ) : null}
                        </div>
                        <div className="p-1.5 bg-gray-100 rounded-lg flex-shrink-0">
                          <Building2 className="w-4 h-4 text-gray-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{bill.supplier_name}</p>
                          <p className="text-xs text-gray-500">
                            {new Date(bill.bill_date).toLocaleDateString()}
                            {bill.items_count ? ` · ${bill.items_count} item${bill.items_count !== 1 ? 's' : ''}` : ''}
                          </p>
                        </div>
                        {isImported && (
                          <span className="flex items-center gap-1 text-xs text-green-600 font-medium bg-green-100 px-2 py-0.5 rounded-full flex-shrink-0">
                            <Check className="w-3 h-3" />
                            Imported
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {/* Shipper name field */}
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Shipper Name <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={shipperName}
                      onChange={(e) => setShipperName(e.target.value)}
                      placeholder="Enter shipper name..."
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  {selectedBillIds.size > 0 && (
                    <div className="flex items-center gap-2 p-3 bg-teal-50 rounded-lg border border-blue-200">
                      <AlertCircle className="w-4 h-4 text-teal-700 flex-shrink-0" />
                      <p className="text-xs text-teal-700">
                        {selectedBillIds.size} bill{selectedBillIds.size !== 1 ? 's' : ''} will be imported as Batch {addFormSelectedBatch.canonicalBatch}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            {addFormStep === 'bills' && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
                <button
                  onClick={() => { setAddFormStep('batch'); setSelectedBillIds(new Set()); }}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Back
                </button>
                <div className="flex items-center gap-3">
                  <button
                    onClick={closeAddForm}
                    className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={addFromBills}
                    disabled={selectedBillIds.size === 0 || importing}
                    className="flex items-center gap-2 px-5 py-2 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-4 h-4" />
                    Import {selectedBillIds.size > 0 ? `${selectedBillIds.size} Bill${selectedBillIds.size !== 1 ? 's' : ''}` : ''}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showManualForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Add Manual PL Entry</h3>
              <button
                onClick={() => setShowManualForm(false)}
                className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Use this for items being shipped along with your container from third parties.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Supplier / Source Name *
                </label>
                <input
                  type="text"
                  value={manualEntry.supplier_name}
                  onChange={(e) => setManualEntry({ ...manualEntry, supplier_name: e.target.value })}
                  placeholder="e.g. ABC Trading, Friend's Items..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Shipper Name
                </label>
                <input
                  type="text"
                  value={manualEntry.shipper_name}
                  onChange={(e) => setManualEntry({ ...manualEntry, shipper_name: e.target.value })}
                  placeholder="Enter shipper name..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date
                </label>
                <input
                  type="date"
                  value={manualEntry.date}
                  onChange={(e) => setManualEntry({ ...manualEntry, date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowManualForm(false);
                  setManualEntry({
                    supplier_name: '',
                    shipper_name: '',
                    date: new Date().toISOString().split('T')[0],
                  });
                }}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={addManualEntry}
                disabled={!manualEntry.supplier_name}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Entry
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-slate-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider">
                  Supplier
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider">
                  Batch
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider">
                  Shipper Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider">
                  Packing List No
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-white uppercase tracking-wider">
                  Expected
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-white uppercase tracking-wider">
                  Received
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-white uppercase tracking-wider">
                  In Register
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-white uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredRecords.map((record, idx) => (
                <tr key={record.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {new Date(record.date).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900 font-medium">
                    <div className="flex items-center space-x-2">
                      <span>{record.supplier_name}</span>
                      {!record.purchase_bill_id && (
                        <span className="inline-flex px-1.5 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded font-medium">
                          Manual
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      list="pl-shipment-list"
                      value={record.batch_number || ''}
                      onChange={(e) => editLocal(record.id, 'batch_number', e.target.value)}
                      onBlur={(e) => updateBatchNumber(record.id, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      placeholder="Pick shipment..."
                      title="Batch numbers come from Shipping. Pick one from the list; only type a name for old batches."
                      className={`w-full px-2 py-1 text-sm border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${record.batch_number && shipmentNos.length > 0 && !shipmentNos.includes(record.batch_number) ? 'border-amber-400 bg-amber-50' : 'border-gray-300'}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={record.shipper_name}
                      onChange={(e) => editLocal(record.id, 'shipper_name', e.target.value)}
                      onBlur={(e) => updateShipperName(record.id, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      placeholder="Enter shipper..."
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {record.packing_list_no}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={record.expected}
                      onChange={(e) => updateCheckbox(record.id, 'expected', e.target.checked)}
                      className="w-5 h-5 text-amber-600 border-gray-300 rounded focus:ring-amber-500 cursor-pointer"
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={record.received}
                      onChange={(e) => updateCheckbox(record.id, 'received', e.target.checked)}
                      className="w-5 h-5 text-teal-700 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={record.entered_in_register}
                      onChange={(e) => updateCheckbox(record.id, 'entered_in_register', e.target.checked)}
                      className="w-5 h-5 text-green-600 border-gray-300 rounded focus:ring-green-500 cursor-pointer"
                    />
                  </td>
                  <td className="px-4 py-3">
                    {getStatusBadge(record.status)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => deleteRecord(record.id)}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {filteredRecords.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                    <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p>No PL Input records found for Batch {activeBatch === '__unassigned__' ? '(Unassigned)' : activeBatch}</p>
                    <p className="text-sm text-gray-400 mt-1">Add records from purchase bills to track shipments</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-teal-50 border border-blue-200 rounded-xl p-4">
        <h4 className="font-medium text-blue-900 mb-2">Status Logic</h4>
        <ul className="text-sm text-teal-800 space-y-1">
          <li><span className="font-medium">Pending:</span> Nothing ticked</li>
          <li><span className="font-medium">Expected:</span> Expected only ticked</li>
          <li><span className="font-medium">Received:</span> Expected and Received ticked</li>
          <li><span className="font-medium">Complete:</span> All three ticked</li>
        </ul>
      </div>
    </div>
  );
}
