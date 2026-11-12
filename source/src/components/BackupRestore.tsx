import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, Upload, HardDriveDownload } from 'lucide-react';
import { supabase, fromAllBooksForBackup } from '../lib/supabase';
import { BOOKED_TABLES, BOOK_OLD } from '../lib/book';

// Every table in the database, in load order (referenced tables first).
const TABLES = [
  'alibaba_products', 'construction_suppliers', 'customers', 'financial_records', 'financial_targets',
  'import_calculations', 'import_settings', 'items', 'packing_lists', 'recycle_bin', 'sl_partners', 'suppliers',
  'busy_sales_orders', 'calls', 'interactions', 'item_batch_stock', 'purchase_orders', 'sales_invoices',
  'busy_sales_invoices', 'busy_sales_order_items', 'customer_payments', 'purchase_bills', 'purchase_order_items',
  'so_po_links', 'busy_sales_invoice_items', 'busy_sales_payments', 'pl_input', 'purchase_bill_items',
  'purchase_payments', 'packing_list_items', 'costing_duty_sheet',
  'shipments', 'factory_problems', 'factory_problem_media', 'factory_supplier_answers', 'factory_steps',
  // added in v96 (were missing from the backup)
  'investors', 'investor_ledger', 'clearing_agents', 'shipment_charges', 'agent_ledger', 'book_settings',
  'growth_months', 'capital_savings',
  'ep_categories', 'ep_deposits', 'ep_expenses', 'ep_tallies', 'ep_moves',
  'wh_locations', 'wh_products', 'wh_stock', 'wh_notes', 'wh_note_lines',
  // added in v196 (were missing from the backup): restored client-side with upsert (EXTRA_RESTORE), not by bulk_import
  'capital_charity', 'capital_settings', 'shipment_item_charges', 'shipment_pl_charges', 'sl_partner_payouts',
  'factory_setting_chats', 'trade_businesses', 'trade_contacts', 'trade_saved_searches', 'trade_contacts_archive',
  'stock_items', 'stock_import_history', 'stock_import_details', 'import_calculations_archive',
  // export only (written by the database itself)
  'change_log', 'backup_log',
];
const EXTRA_RESTORE = new Set(['capital_charity', 'capital_settings', 'shipment_item_charges', 'shipment_pl_charges', 'sl_partner_payouts',
  'factory_setting_chats', 'trade_businesses', 'trade_contacts', 'trade_saved_searches', 'trade_contacts_archive',
  'stock_items', 'stock_import_history', 'stock_import_details', 'import_calculations_archive']);
const EXPORT_ONLY = new Set(['change_log', 'backup_log']);

// A table that does not exist in this database is skipped (not every site has every page).
const isMissingTable = (msg: string) => /does not exist|could not find the table|schema cache/i.test(msg);

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
  const [lastAuto, setLastAuto] = useState<{ taken_at: string; tables: number; rows: number; bytes: number; ok: boolean; note: string | null; where: string | null } | null | 'none' | 'nosetup'>(null);
  useEffect(() => {
    fromAllBooksForBackup('backup_log').select('*').order('taken_at', { ascending: false }).limit(1).then(({ data, error }: { data: typeof lastAuto extends infer T ? T[] : never; error: { message: string } | null }) => {
      if (error) { setLastAuto('nosetup'); return; }
      setLastAuto(data && data.length ? (data[0] as Exclude<typeof lastAuto, null | string>) : 'none');
    });
  }, []);

  async function exportAll(format: 'json' | 'xlsx' = 'json') {
    setExporting(true);
    setLog([]);
    try {
      const wb = XLSX.utils.book_new();
      const dump: Record<string, Row[]> = {};
      let total = 0, cut = 0;
      const unreadable: string[] = [];
      for (const table of TABLES) {
        const rows: Row[] = [];
        // EVERY book is saved (not only the one you are in); each row keeps its own "book" column,
        // so on restore every record goes back into its own book — nothing is mixed.
        let missing = false;
        let ordered = true;
        for (let from = 0; ; from += 1000) {
          let q = fromAllBooksForBackup(table).select('*');
          if (ordered) q = q.order('id'); // stable pages: no row skipped or repeated
          const { data, error } = await q.range(from, from + 999);
          if (error && ordered && /column .*id/i.test(error.message)) { ordered = false; from -= 1000; continue; }
          if (error && isMissingTable(error.message)) { missing = true; break; }
          if (error && /permission denied/i.test(error.message)) { setLog((l) => [...l, `${table}: this login cannot read it — skipped (run backup-read-access.sql once)`]); missing = true; unreadable.push(table); break; }
          if (error) throw new Error(`${table}: ${error.message}`);
          if (!data || data.length === 0) break;
          rows.push(...(data as Row[]));
          if (data.length < 1000) break;
        }
        if (missing) { if (!unreadable.includes(table)) setLog((l) => [...l, `${table}: not in this database — skipped`]); continue; }
        // json/array columns become text so they survive the spreadsheet round-trip
        dump[table] = rows;
        if (format === 'xlsx') {
          // Excel cannot hold more than 32,767 characters in one cell: long text is cut in the spreadsheet (the JSON file keeps it whole)
          const flat = rows.map((r) => {
            const o: Row = {};
            for (const [k, v] of Object.entries(r)) {
              let t = v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
              if (typeof t === 'string' && t.length > 32000) { t = t.slice(0, 32000) + '…[cut]'; cut++; }
              o[k] = t;
            }
            return o;
          });
          const ws = XLSX.utils.json_to_sheet(flat.length ? flat : [{}]);
          XLSX.utils.book_append_sheet(wb, ws, sheetNameFor(table));
        }
        total += rows.length;
        // show how many rows of each book went into the file
        let perBook = '';
        if (BOOKED_TABLES.has(table) && rows.length) {
          const n: Record<string, number> = {};
          rows.forEach((r) => { const b = (r.book as string) || 'NO BOOK'; n[b] = (n[b] || 0) + 1; });
          perBook = ' (' + Object.entries(n).map(([b, c]) => `${b} ${c}`).join(', ') + ')';
        }
        setLog((l) => [...l, `${table}: ${rows.length} rows${perBook}`]);
      }
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === 'xlsx') {
        XLSX.writeFile(wb, `backup-all-books-${stamp}.xlsx`);
        if (cut) setLog((l) => [...l, `${cut} long text cells were cut to fit Excel — use "Export all data" (JSON) for a complete backup.`]);
      } else {
        const blob = new Blob([JSON.stringify({ taken_at: new Date().toISOString(), tables: dump })], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `backup-all-books-${stamp}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }
      setLog((l) => [...l, `Done — ${total} rows exported.${unreadable.length ? ` NOT included (no read access): ${unreadable.join(', ')} — run backup-read-access.sql once and export again.` : ''}`]);
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
      const payload: Record<string, Row[]> = {};
      const skipped: string[] = [];
      const isJson = /\.json$/i.test(file.name);
      const wb = isJson ? null : XLSX.read(buf, { type: 'array', cellDates: true });
      if (isJson) {
        // the nightly file from /api/backup: { taken_at, tables: { name: rows[] } }
        const doc = JSON.parse(new TextDecoder().decode(buf)) as { taken_at?: string; tables?: Record<string, Row[]> };
        const tabs = doc.tables || (doc as unknown as Record<string, Row[]>);
        for (const [table, rows] of Object.entries(tabs)) {
          if (!TABLES.includes(table) || EXPORT_ONLY.has(table) || table === 'app_users') { skipped.push(table); continue; }
          if (Array.isArray(rows) && rows.length) payload[table] = rows as Row[];
        }
        if (doc.taken_at) setLog((l) => [...l, `Backup taken ${new Date(doc.taken_at!).toLocaleString('en-GB')}`]);
      }

      for (const sheet of wb ? wb.SheetNames : []) {
        const table = tableForSheet(sheet);
        if (!table) { skipped.push(sheet); continue; }
        if (EXPORT_ONLY.has(table)) { skipped.push(sheet); continue; }
        const raw = XLSX.utils.sheet_to_json<Row>(wb!.Sheets[sheet], { defval: null, raw: true });
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

      // Never let a restored record fall into the wrong book. A row without a book comes from a
      // backup made before the books were split — everything from that time is the OLD book.
      let tagged = 0;
      for (const [table, rows] of Object.entries(payload)) {
        if (!BOOKED_TABLES.has(table)) continue;
        rows.forEach((r) => {
          if (r.book) return;
          // a deleted record in the Recycle Bin goes with the book of that record
          let own: unknown = null;
          if (table === 'recycle_bin') { try { const d = typeof r.record_data === 'string' ? JSON.parse(r.record_data) : r.record_data; own = d?.book; } catch { /* not JSON */ } }
          r.book = (typeof own === 'string' && own) || BOOK_OLD; tagged++;
        });
      }
      if (tagged) setLog((l) => [...l, `${tagged} rows had no book (backup from before the books were split) — they go into ${BOOK_OLD}.`]);
      const tableCount = Object.keys(payload).length;
      if (!tableCount) throw new Error('No recognised tables found in this file.');
      setLog((l) => [...l, `Importing ${tableCount} tables…`]);

      // the newer tables are restored here with upsert (rows that exist are left as they are); the rest go through bulk_import
      const extra: Record<string, Row[]> = {};
      for (const t of Object.keys(payload)) if (EXTRA_RESTORE.has(t)) { extra[t] = payload[t]; delete payload[t]; }
      let extraAdded = 0;
      for (const [table, rows] of Object.entries(extra)) {
        let added = 0;
        for (let i = 0; i < rows.length; i += 500) {
          const chunk = rows.slice(i, i + 500);
          const { data: up, error: upErr } = await fromAllBooksForBackup(table).upsert(chunk, { onConflict: 'id', ignoreDuplicates: true }).select('id');
          if (upErr) { setLog((l) => [...l, `${table}: ${upErr.message}`]); break; }
          added += (up || []).length;
        }
        extraAdded += added;
        setLog((l) => [...l, `${table}: ${added} new rows (${rows.length} in file)`]);
      }
      if (!Object.keys(payload).length) { setLog((l) => [...l, `Done — ${extraAdded} rows added. Rows that already existed were left unchanged.`]); return; }

      const { data, error } = await supabase.rpc('bulk_import', { p_data: payload });
      if (error) {
        if (/collection-only|closed/i.test(error.message)) throw new Error(error.message + '\nNothing was imported. To restore OLD documents, the OLD book must be open for the import (ask for the SQL line).');
        throw new Error(error.message);
      }

      const result = (data ?? {}) as Record<string, number>;
      let inserted = extraAdded;
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
            Export every table of every book to one backup file (.json — each record keeps its own book), or load a backup
            into this database. Importing only adds rows that don't already exist, and every row goes back into its
            own book, so it is safe to run more than once.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => exportAll('json')}
              disabled={busy}
              className="flex items-center space-x-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition-colors font-medium disabled:opacity-50"
              title="Complete backup file (.json) — the one to keep and to restore from"
            >
              <Download className="w-4 h-4" />
              <span>{exporting ? 'Exporting…' : 'Export all data'}</span>
            </button>
            <button
              onClick={() => exportAll('xlsx')}
              disabled={busy}
              className="flex items-center space-x-2 px-4 py-2 bg-white border border-teal-300 hover:bg-teal-100 text-teal-800 rounded-lg transition-colors font-medium disabled:opacity-50"
              title="Spreadsheet for reading — long text is cut at Excel's 32,767-character limit"
            >
              <Download className="w-4 h-4" />
              <span>Excel (for reading)</span>
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="flex items-center space-x-2 px-4 py-2 bg-white border border-teal-300 hover:bg-teal-100 text-teal-800 rounded-lg transition-colors font-medium disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              <span>{importing ? 'Importing…' : 'Import data (.xlsx or .json)'}</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importFile(f);
              }}
            />
          </div>
          <div className="mt-4 text-xs text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-2">
            <b>Automatic nightly backup</b> (copied to your private GitHub repository every night at 03:00 Sri Lanka time):{' '}
            {lastAuto === null ? 'checking…'
              : lastAuto === 'nosetup' ? <span className="text-amber-700">not switched on yet — run backup-log.sql and set the Vercel keys (see User Manual → Backup).</span>
              : lastAuto === 'none' ? <span className="text-amber-700">no run recorded yet — check the Vercel keys and the cron.</span>
              : lastAuto.ok ? <span className="text-green-700">OK — {new Date(lastAuto.taken_at).toLocaleString('en-GB')}, {lastAuto.tables} tables, {lastAuto.rows.toLocaleString()} rows, {(lastAuto.bytes / 1048576).toFixed(1)} MB → {lastAuto.where}</span>
              : <span className="text-red-700">FAILED {new Date(lastAuto.taken_at).toLocaleString('en-GB')}: {lastAuto.note}</span>}
            {lastAuto && typeof lastAuto === 'object' && lastAuto.ok && (Date.now() - new Date(lastAuto.taken_at).getTime()) > 2 * 86400000 && <span className="text-red-700"> — more than 2 days old, check Vercel.</span>}
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
