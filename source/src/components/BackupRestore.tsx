import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, Upload, HardDriveDownload } from 'lucide-react';
import { supabase } from '../lib/supabase';

// Every table in the database, in load order (referenced tables first).
const TABLES = [
  'alibaba_products', 'construction_suppliers', 'customers', 'financial_records', 'financial_targets',
  'import_calculations', 'import_settings', 'items', 'packing_lists', 'recycle_bin', 'sl_partners', 'suppliers',
  'busy_sales_orders', 'calls', 'interactions', 'item_batch_stock', 'purchase_orders', 'sales_invoices',
  'busy_sales_invoices', 'busy_sales_order_items', 'customer_payments', 'purchase_bills', 'purchase_order_items',
  'so_po_links', 'busy_sales_invoice_items', 'busy_sales_payments', 'pl_input', 'purchase_bill_items',
  'purchase_payments', 'packing_list_items', 'costing_duty_sheet',
  'shipments', 'factory_problems', 'factory_problem_media', 'factory_supplier_answers', 'factory_steps',
];

// Sheet names used by the older "full-data-export" spreadsheet, so those files import too.
const SHEET_ALIASES: Record<string, string> = {
  'Customers': 'customers', 'Call Logs': 'calls', 'Sales Orders': 'busy_sales_orders',
  'Sales Order Items': 'busy_sales_order_items', 'Sales Invoices': 'busy_sales_invoices',
  'Sales Invoice Items': 'busy_sales_invoice_items', 'Sales Payments': 'busy_sales_payments',
  'Customer Payments': 'customer_payments', 'Suppliers': 'suppliers', 'Purchase Orders': 'purchase_orders',
  'Purchase Order Items': 'purchase_order_items', 'Purchase Bills': 'purchase_bills',
  'Purchase Bill Items': 'purchase_bill_items', 'Purchase Payments': 'purchase_payments',
  'Items Master': 'items', 'PL Input': 'pl_input', 'Packing List Items': 'packing_list_items',
  'Costing & Duty Sheet': 'costing_duty_sheet', 'Financial Records': 'financial_records',
  'Financial Targets': 'financial_targets', 'Import Calculations': 'import_calculations',
  'Recycle Bin': 'recycle_bin', 'Packing Lists': 'packing_lists', 'SO-PO Links': 'so_po_links',
  'Import Settings': 'import_settings', 'Alibaba Products': 'alibaba_products',
};

type Row = Record<string, unknown>;

function sheetNameFor(table: string) {
  return table.length > 31 ? table.slice(0, 31) : table; // Excel sheet-name limit
}

function tableForSheet(name: string): string | null {
  if (TABLES.includes(name)) return name;
  if (SHEET_ALIASES[name]) return SHEET_ALIASES[name];
  const byPrefix = TABLES.find((t) => sheetNameFor(t) === name);
  return byPrefix ?? null;
}

// Turn a spreadsheet cell back into something Postgres accepts.
function cleanValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '' || s.toUpperCase() === 'NULL') return null;
    if (s === 'TRUE') return true;
    if (s === 'FALSE') return false;
    return s;
  }
  return v;
}

export default function BackupRestore() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  async function exportAll() {
    setExporting(true);
    setLog([]);
    try {
      const wb = XLSX.utils.book_new();
      let total = 0;
      for (const table of TABLES) {
        const rows: Row[] = [];
        // page through in case a table grows large
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase.from(table).select('*').range(from, from + 999);
          if (error) throw new Error(`${table}: ${error.message}`);
          if (!data || data.length === 0) break;
          rows.push(...(data as Row[]));
          if (data.length < 1000) break;
        }
        // json/array columns become text so they survive the spreadsheet round-trip
        const flat = rows.map((r) => {
          const o: Row = {};
          for (const [k, v] of Object.entries(r)) {
            o[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
          }
          return o;
        });
        const ws = XLSX.utils.json_to_sheet(flat.length ? flat : [{}]);
        XLSX.utils.book_append_sheet(wb, ws, sheetNameFor(table));
        total += rows.length;
        setLog((l) => [...l, `${table}: ${rows.length} rows`]);
      }
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `backup-${stamp}.xlsx`);
      setLog((l) => [...l, `Done — ${total} rows exported.`]);
    } catch (e) {
      setLog((l) => [...l, `Export failed: ${(e as Error).message}`]);
    } finally {
      setExporting(false);
    }
  }

  async function importFile(file: File) {
    setImporting(true);
    setLog([`Reading ${file.name}…`]);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const payload: Record<string, Row[]> = {};
      const skipped: string[] = [];

      for (const sheet of wb.SheetNames) {
        const table = tableForSheet(sheet);
        if (!table) { skipped.push(sheet); continue; }
        const raw = XLSX.utils.sheet_to_json<Row>(wb.Sheets[sheet], { defval: null, raw: true });
        const rows = raw
          .map((r) => {
            const o: Row = {};
            for (const [k, v] of Object.entries(r)) {
              if (!k || k.startsWith('__EMPTY')) continue;
              o[k] = cleanValue(v);
            }
            return o;
          })
          .filter((r) => Object.values(r).some((v) => v !== null));
        if (rows.length) payload[table] = rows;
      }

      if (skipped.length) setLog((l) => [...l, `Ignored sheets: ${skipped.join(', ')}`]);
      const tableCount = Object.keys(payload).length;
      if (!tableCount) throw new Error('No recognised tables found in this file.');
      setLog((l) => [...l, `Importing ${tableCount} tables…`]);

      const { data, error } = await supabase.rpc('bulk_import', { p_data: payload });
      if (error) throw new Error(error.message);

      const result = (data ?? {}) as Record<string, number>;
      let inserted = 0;
      for (const table of TABLES) {
        if (table in result) {
          inserted += result[table];
          setLog((l) => [...l, `${table}: ${result[table]} new rows (${payload[table]?.length ?? 0} in file)`]);
        }
      }
      setLog((l) => [...l, `Done — ${inserted} rows added. Rows that already existed were left unchanged.`]);
    } catch (e) {
      setLog((l) => [...l, `Import failed: ${(e as Error).message}`]);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const busy = exporting || importing;

  return (
    <div className="bg-teal-50 border border-blue-200 rounded-lg p-6">
      <div className="flex items-start space-x-4">
        <div className="bg-teal-100 rounded-full p-3 flex-shrink-0">
          <HardDriveDownload className="w-6 h-6 text-teal-700" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-blue-900 mb-2">Backup &amp; Restore</h3>
          <p className="text-sm text-teal-700 mb-4">
            Export every table to one Excel file, or load a backup into this database. Importing only adds
            rows that don't already exist, so it is safe to run more than once.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={exportAll}
              disabled={busy}
              className="flex items-center space-x-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition-colors font-medium disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span>{exporting ? 'Exporting…' : 'Export all data'}</span>
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="flex items-center space-x-2 px-4 py-2 bg-white border border-teal-300 hover:bg-teal-100 text-teal-800 rounded-lg transition-colors font-medium disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              <span>{importing ? 'Importing…' : 'Import data (.xlsx)'}</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importFile(f);
              }}
            />
          </div>
          {log.length > 0 && (
            <pre className="mt-4 bg-white border border-blue-200 rounded-lg p-3 text-xs text-gray-700 max-h-64 overflow-auto whitespace-pre-wrap">
              {log.join('\n')}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
