import { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Upload, FileSpreadsheet, X, CircleCheck as CheckCircle, CircleAlert as AlertCircle, Table } from 'lucide-react';
import * as XLSX from 'xlsx';

interface ImportSalesProps {
  onClose: () => void;
  onSuccess: () => void;
}

interface ImportRow {
  Action?: string;
  Date?: string;
  'Invoice No.'?: string;
  'Invoice No .'?: string;
  'Customer name'?: string;
  'Contact Number'?: string;
  Location?: string;
  'Payment Status'?: string;
  'Payment Method'?: string;
  'Total amount'?: number;
  'Total Paid'?: number;
  'Sell Due'?: number;
  'Total Items'?: number;
  'Added By'?: string;
}

export default function ImportSales({ onClose, onSuccess }: ImportSalesProps) {
  const [pasteData, setPasteData] = useState('');
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  const [viewMode, setViewMode] = useState<'upload' | 'spreadsheet'>('upload');
  const [spreadsheetData, setSpreadsheetData] = useState<any[]>([]);
  const tableRef = useRef<HTMLDivElement>(null);

  async function findOrCreateCustomer(name: string, phone: string | null) {
    if (!name) return null;

    if (phone) {
      const { data } = await supabase
        .from('customers')
        .select('id')
        .eq('phone', phone)
        .maybeSingle();

      if (data) return data.id;
    }

    const { data } = await supabase
      .from('customers')
      .select('id')
      .ilike('name', name)
      .maybeSingle();

    if (data) return data.id;

    const { data: newCustomer, error } = await supabase
      .from('customers')
      .insert([{
        name: name,
        phone: phone || null,
        notes: 'Auto-created from sales import',
      }])
      .select('id')
      .single();

    if (error || !newCustomer) return null;
    return newCustomer.id;
  }

  function parseDate(dateValue: any): string {
    const formatDateToString = (year: number, month: number, day: number): string => {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    };

    if (!dateValue) {
      const now = new Date();
      return formatDateToString(now.getFullYear(), now.getMonth() + 1, now.getDate());
    }

    // If it's a string, try to parse it first (most reliable)
    if (typeof dateValue === 'string') {
      const trimmed = dateValue.trim();

      // Try DD/MM/YYYY format (most common in exports)
      const ddmmyyyyMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
      if (ddmmyyyyMatch) {
        const [, day, month, year] = ddmmyyyyMatch;
        return formatDateToString(parseInt(year), parseInt(month), parseInt(day));
      }

      // Try YYYY-MM-DD format
      const yyyymmddMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
      if (yyyymmddMatch) {
        const [, year, month, day] = yyyymmddMatch;
        return formatDateToString(parseInt(year), parseInt(month), parseInt(day));
      }
    }

    // If it's an Excel serial number (number of days since 1900-01-01)
    if (typeof dateValue === 'number') {
      // Excel date serial numbers: days since 1900-01-01 (with leap year bug)
      // Excel incorrectly treats 1900 as a leap year
      // For dates after Feb 28, 1900, subtract 1 to correct
      const excelSerialDate = dateValue > 60 ? dateValue - 1 : dateValue;

      // Excel epoch is December 30, 1899 (day 0)
      // Use UTC to avoid timezone shifts
      const msPerDay = 24 * 60 * 60 * 1000;
      const excelEpochMs = Date.UTC(1899, 11, 30);
      const dateMs = excelEpochMs + (excelSerialDate * msPerDay);
      const date = new Date(dateMs);

      return formatDateToString(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    }

    // If it's already a Date object
    if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
      return formatDateToString(dateValue.getFullYear(), dateValue.getMonth() + 1, dateValue.getDate());
    }

    // Fallback: try to parse as string
    if (typeof dateValue === 'string') {
      const date = new Date(dateValue);
      if (!isNaN(date.getTime())) {
        return formatDateToString(date.getFullYear(), date.getMonth() + 1, date.getDate());
      }
    }

    // Final fallback to today's date
    const now = new Date();
    return formatDateToString(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  function normalizePaymentStatus(status: string): 'paid' | 'pending' | 'partial' | 'overdue' {
    const normalized = status?.toLowerCase() || 'pending';
    if (normalized.includes('paid') || normalized === 'completed') return 'paid';
    if (normalized.includes('partial')) return 'partial';
    if (normalized.includes('overdue') || normalized.includes('due')) return 'overdue';
    return 'pending';
  }

  function parseNumber(value: any): number {
    if (value === null || value === undefined || value === '') return 0;

    let str = String(value).trim();

    str = str.replace(/[₨₹$€£¥,\s]/g, '');

    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
  }

  function handleSpreadsheetPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');

    const lines = pastedText.trim().split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) return;

    const rows: any[] = [];
    const headers = [
      'Action', 'Date', 'Invoice No.', 'Customer name', 'Contact Number',
      'Location', 'Payment Status', 'Payment Method', 'Total amount',
      'Total Paid', 'Sell Due', 'Total Items', 'Added By'
    ];

    for (const line of lines) {
      const values = line.split('\t');
      const row: any = {};
      headers.forEach((header, index) => {
        row[header] = values[index]?.trim() || '';
      });
      rows.push(row);
    }

    setSpreadsheetData(rows);
  }

  function updateCell(rowIndex: number, column: string, value: string) {
    const newData = [...spreadsheetData];
    newData[rowIndex] = { ...newData[rowIndex], [column]: value };
    setSpreadsheetData(newData);
  }

  function addEmptyRow() {
    const headers = [
      'Action', 'Date', 'Invoice No.', 'Customer name', 'Contact Number',
      'Location', 'Payment Status', 'Payment Method', 'Total amount',
      'Total Paid', 'Sell Due', 'Total Items', 'Added By'
    ];
    const emptyRow: any = {};
    headers.forEach(header => {
      emptyRow[header] = '';
    });
    setSpreadsheetData([...spreadsheetData, emptyRow]);
  }

  function deleteRow(rowIndex: number) {
    const newData = spreadsheetData.filter((_, index) => index !== rowIndex);
    setSpreadsheetData(newData);
  }

  async function importSpreadsheetData() {
    if (spreadsheetData.length === 0) {
      alert('No data to import. Please paste data into the spreadsheet.');
      return;
    }
    await processImportData(spreadsheetData);
  }

  async function processImportData(rows: ImportRow[]) {
    setImporting(true);
    const errors: string[] = [];
    let success = 0;
    let failed = 0;
    let skipped = 0;

    if (rows.length === 0) {
      alert('No rows to import. Please check your data format.');
      setImporting(false);
      return;
    }

    const firstRowKeys = Object.keys(rows[0]);
    console.log('=== IMPORT DEBUG INFO ===');
    console.log('Total rows:', rows.length);
    console.log('Found columns:', firstRowKeys);
    console.log('Sample first row data:', rows[0]);
    console.log('========================');

    // Helper function to find value by flexible column name matching
    function getColumnValue(row: any, possibleNames: string[]): any {
      for (const name of possibleNames) {
        // Exact match
        if (row[name] !== undefined && row[name] !== null && row[name] !== '') {
          return row[name];
        }
        // Case-insensitive match
        const foundKey = Object.keys(row).find(k => k.toLowerCase() === name.toLowerCase());
        if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null && row[foundKey] !== '') {
          return row[foundKey];
        }
      }
      return null;
    }

    for (const row of rows) {
      try {
        // Try multiple variations of invoice number column
        // Preserve exact value including any leading zeros or special formatting
        const invoiceNoRaw = getColumnValue(row, [
          'Invoice No.',
          'Invoice No .',
          'Invoice No',
          'InvoiceNo',
          'Invoice',
          'Invoice Number'
        ]);
        const invoiceNo = invoiceNoRaw !== null && invoiceNoRaw !== undefined
          ? String(invoiceNoRaw).trim()
          : null;

        if (!invoiceNo) {
          skipped++;
          if (skipped === 1) {
            console.log('Skipping row without Invoice No:', row);
          }
          continue;
        }

        // Use flexible column matching for all fields
        const customerName = getColumnValue(row, ['Customer name', 'Customer', 'Customer Name', 'Name']);
        const contactNumber = getColumnValue(row, ['Contact Number', 'Contact', 'Phone', 'Mobile']);

        let customerId = null;
        if (customerName) {
          customerId = await findOrCreateCustomer(
            customerName,
            contactNumber || null
          );
        }

        const dateValue = getColumnValue(row, ['Date', 'Invoice Date']);
        const parsedDate = parseDate(dateValue);

        const invoiceData = {
          customer_id: customerId,
          action: getColumnValue(row, ['Action']) || '',
          date: parsedDate,
          invoice_no: invoiceNo,
          customer_name: customerName || '',
          contact_number: contactNumber || null,
          location: getColumnValue(row, ['Location', 'Address']) || '',
          payment_status: normalizePaymentStatus(getColumnValue(row, ['Payment Status', 'Status']) || 'pending'),
          payment_method: getColumnValue(row, ['Payment Method', 'Method']) || '',
          total_amount: parseNumber(getColumnValue(row, ['Total amount', 'Total Amount', 'Amount', 'Total'])),
          total_paid: parseNumber(getColumnValue(row, ['Total Paid', 'Paid', 'Paid Amount'])),
          sell_due: parseNumber(getColumnValue(row, ['Sell Due', 'Due', 'Due Amount'])),
          total_items: parseNumber(getColumnValue(row, ['Total Items', 'Items', 'Quantity'])),
          added_by: getColumnValue(row, ['Added By', 'Created By', 'User']) || '',
        };

        // Debug first row only
        if (success === 0 && failed === 0) {
          console.log('First invoice data:', {
            invoiceNo,
            dateValue,
            dateType: typeof dateValue,
            parsedDate,
            invoiceData
          });
        }

        const { error } = await supabase
          .from('sales_invoices')
          .upsert([invoiceData], { onConflict: 'invoice_no' });

        if (error) {
          errors.push(`Invoice ${invoiceNo}: ${error.message}`);
          failed++;
        } else {
          success++;
        }
      } catch (err: any) {
        errors.push(`Unexpected error: ${err.message}`);
        failed++;
      }
    }

    setImporting(false);

    if (success === 0 && failed === 0 && skipped > 0) {
      alert(
        `No data imported\n\n` +
        `All ${skipped} rows were skipped because they had no "Invoice No." value.\n\n` +
        `Found columns: ${firstRowKeys.join(', ')}\n\n` +
        `Please make sure your Excel file has a column named exactly "Invoice No." with values in it.`
      );
      return;
    }

    setResults({ success, failed, errors: errors.slice(0, 10) });

    if (success > 0) {
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 2000);
    }
  }

  async function handlePasteImport() {
    if (!pasteData.trim()) {
      alert('Please paste data first');
      return;
    }

    // Handle different line endings (Windows: \r\n, Unix: \n, Mac: \r)
    const lines = pasteData.trim().split(/\r?\n/).filter(line => line.trim().length > 0);

    console.log('=== PASTE DEBUG ===');
    console.log('Total lines:', lines.length);
    console.log('First line:', lines[0]);
    console.log('==================');

    if (lines.length < 2) {
      alert(
        `Invalid data format.\n\n` +
        `Found only ${lines.length} line(s).\n\n` +
        `Please paste data with:\n` +
        `1. Headers in the first row\n` +
        `2. At least one data row\n\n` +
        `TIP: Try using "Upload Excel File" instead - it's more reliable!`
      );
      return;
    }

    const rawHeaders = lines[0].split('\t');
    // Filter out empty headers
    const headers = rawHeaders.map(h => h.trim()).filter(h => h.length > 0);
    const rows: ImportRow[] = [];

    console.log('Raw headers:', rawHeaders);
    console.log('Filtered headers:', headers);

    if (headers.length === 0) {
      alert(
        `No valid headers found.\n\n` +
        `Make sure you're copying tab-separated data from Excel.\n\n` +
        `TIP: Try using "Upload Excel File" instead - it's more reliable!`
      );
      return;
    }

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split('\t');
      const row: any = {};

      headers.forEach((header, index) => {
        const value = values[index]?.trim();
        if (header && value) {
          row[header] = value;
        }
      });

      // Only add rows that have at least one value
      if (Object.keys(row).length > 0) {
        rows.push(row);
      }
    }

    if (rows.length === 0) {
      alert(
        `No valid data rows found.\n\n` +
        `Make sure you're copying the entire data range including values.\n\n` +
        `TIP: Try using "Upload Excel File" instead - it's more reliable!`
      );
      return;
    }

    await processImportData(rows);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = event.target?.result;
        if (!data) {
          alert('Failed to read file. Please try again.');
          return;
        }

        const workbook = XLSX.read(data, {
          type: 'array',
          cellDates: false,
          cellNF: false,
          cellText: false
        });

        if (workbook.SheetNames.length === 0) {
          alert('The Excel file has no sheets. Please check your file.');
          return;
        }

        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // Get raw data preserving original values
        const rawData = XLSX.utils.sheet_to_json(worksheet, {
          raw: true,
          defval: ''
        }) as any[];

        // Also get formatted text values for dates
        const formattedData = XLSX.utils.sheet_to_json(worksheet, {
          raw: false,
          defval: ''
        }) as any[];

        // Merge formatted dates into raw data
        rawData.forEach((row, idx) => {
          const dateKey = Object.keys(row).find(k => k.toLowerCase() === 'date');
          if (dateKey && formattedData[idx] && formattedData[idx][dateKey]) {
            // Use the formatted text representation of the date
            row[dateKey] = formattedData[idx][dateKey];
          }
        });

        // Now read invoice numbers specifically as text to preserve formatting
        const invoiceColIndex = Object.keys(rawData[0] || {}).findIndex(key =>
          key.toLowerCase().includes('invoice')
        );

        if (invoiceColIndex >= 0) {
          const colLetter = XLSX.utils.encode_col(invoiceColIndex);
          rawData.forEach((row, idx) => {
            const cellRef = `${colLetter}${idx + 2}`; // +2 because Excel is 1-indexed and we skip header
            const cell = worksheet[cellRef];
            if (cell) {
              // Force invoice number to be read as text
              const invoiceKey = Object.keys(row).find(k => k.toLowerCase().includes('invoice'));
              if (invoiceKey && cell.w) {
                // Use the formatted text value (cell.w) instead of the raw value
                row[invoiceKey] = cell.w;
              }
            }
          });
        }

        console.log('=== FILE UPLOAD DEBUG ===');
        console.log('File name:', file.name);
        console.log('File size:', file.size, 'bytes');
        console.log('Sheet name:', sheetName);
        console.log('Raw data length:', rawData.length);

        if (rawData.length === 0) {
          alert(
            'No data found in the Excel file.\n\n' +
            'Please make sure your Excel file has:\n' +
            '1. Headers in the first row\n' +
            '2. Data starting from the second row\n\n' +
            'Sheet found: "' + sheetName + '"'
          );
          return;
        }

        console.log('First row raw keys:', Object.keys(rawData[0]));
        console.log('First row raw data:', rawData[0]);
        console.log('First row invoice_no values:', rawData.slice(0, 5).map(r => r['Invoice No.'] || r['Invoice No .']));
        console.log('First row date values:', rawData.slice(0, 5).map(r => ({
          raw: r['Date'],
          type: typeof r['Date'],
          isDate: r['Date'] instanceof Date
        })));

        // Filter out Excel's auto-generated empty columns but keep all real data
        const cleanedData = rawData.map(row => {
          const cleaned: any = {};
          Object.keys(row).forEach(key => {
            const keyStr = String(key).trim();
            const value = row[key];

            // Skip only truly empty columns (like __EMPTY with no data)
            if (keyStr &&
                !keyStr.startsWith('__EMPTY') &&
                keyStr !== 'undefined' &&
                keyStr !== 'null') {
              cleaned[keyStr] = value;
            }
          });
          return cleaned;
        }).filter(row => {
          // Keep rows that have at least one non-empty value
          return Object.values(row).some(val => val !== null && val !== undefined && val !== '');
        });

        console.log('Cleaned data length:', cleanedData.length);
        if (cleanedData.length > 0) {
          console.log('Cleaned first row keys:', Object.keys(cleanedData[0]));
          console.log('Cleaned first row data:', cleanedData[0]);
        }
        console.log('========================');

        if (cleanedData.length === 0) {
          alert(
            'No valid data rows found in the Excel file.\n\n' +
            `Found ${rawData.length} row(s) but all were empty or invalid.\n\n` +
            'Please make sure your Excel file has data values, not just headers.'
          );
          return;
        }

        await processImportData(cleanedData);
      } catch (err: any) {
        console.error('File upload error:', err);
        alert('Error reading file: ' + err.message + '\n\nPlease make sure you uploaded a valid Excel file (.xlsx or .xls)');
      }
    };

    // Use readAsArrayBuffer instead of readAsBinaryString for better compatibility
    reader.readAsArrayBuffer(file);
  }

  const columns = [
    'Action', 'Date', 'Invoice No.', 'Customer name', 'Contact Number',
    'Location', 'Payment Status', 'Payment Method', 'Total amount',
    'Total Paid', 'Sell Due', 'Total Items', 'Added By'
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded shadow-xl max-w-7xl w-full max-h-[90vh] overflow-hidden flex flex-col border-2 border-gray-300">
        <div className="flex items-center justify-between p-4 bg-white border-b-2 border-gray-300">
          <div className="flex items-center space-x-2">
            <div className="bg-teal-500 rounded p-1.5">
              <Upload className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Import Sales Data</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {!results && (
          <div className="flex border-b-2 border-gray-300">
            <button
              onClick={() => setViewMode('upload')}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-all border-b-4 ${
                viewMode === 'upload'
                  ? 'text-gray-900 border-teal-500 bg-gray-50'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50 border-transparent'
              }`}
            >
              <Upload className="w-4 h-4 inline mr-2" />
              Upload File
            </button>
            <button
              onClick={() => setViewMode('spreadsheet')}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-all border-b-4 ${
                viewMode === 'spreadsheet'
                  ? 'text-gray-900 border-teal-500 bg-gray-50'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50 border-transparent'
              }`}
            >
              <Table className="w-4 h-4 inline mr-2" />
              Paste as Spreadsheet (500+ rows)
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          {!results && viewMode === 'upload' && (
            <div className="space-y-6">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8">
                <div className="text-center">
                  <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Upload Excel File</h3>
                  <p className="text-sm text-gray-500 mb-4">
                    Upload an Excel file with your sales data
                  </p>
                  <label className="inline-flex items-center px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600 cursor-pointer transition-colors">
                    <FileSpreadsheet className="w-5 h-5 mr-2" />
                    Choose File
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleFileUpload}
                      className="hidden"
                      disabled={importing}
                    />
                  </label>
                </div>
              </div>

              <div className="flex items-center">
                <div className="flex-1 border-t border-gray-300"></div>
                <span className="px-4 text-sm text-gray-500">OR</span>
                <div className="flex-1 border-t border-gray-300"></div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Paste Data (Tab-separated)
                </label>
                <textarea
                  value={pasteData}
                  onChange={(e) => setPasteData(e.target.value)}
                  placeholder="Paste your data here (copy from Excel/Sheets with headers)"
                  rows={10}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                  disabled={importing}
                />
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-gray-500">
                    Expected columns: Action, Date, Invoice No., Customer name, Contact Number, Location,
                    Payment Status, Payment Method, Total amount, Total Paid, Sell Due, Sell Return Due,
                    Shipping Status, Total Items, Added By
                  </p>
                </div>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={importing}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handlePasteImport}
                  disabled={importing || !pasteData.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-teal-500 rounded hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {importing ? 'Importing...' : 'Import Pasted Data'}
                </button>
              </div>
            </div>
          )}

          {!results && viewMode === 'spreadsheet' && (
            <div className="space-y-4">
              <div className="bg-teal-50 border border-teal-200 rounded p-4">
                <p className="text-sm text-gray-900 font-medium mb-2">How to use:</p>
                <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
                  <li>Copy your data from Excel (select all rows including data)</li>
                  <li>Click anywhere in the table below and press Ctrl+V (or Cmd+V on Mac)</li>
                  <li>Review the data and click "Import Data"</li>
                </ol>
              </div>

              <div
                ref={tableRef}
                onPaste={handleSpreadsheetPaste}
                tabIndex={0}
                className="border-2 border-teal-400 rounded overflow-auto max-h-[550px] focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white cursor-pointer"
              >
                {spreadsheetData.length === 0 ? (
                  <div className="p-12 text-center">
                    <Table className="w-16 h-16 text-teal-300 mx-auto mb-4" />
                    <p className="text-teal-600 font-semibold mb-2 text-lg">Click here and paste your data</p>
                    <p className="text-sm text-teal-600 mb-1">
                      Supports up to 1000 rows at once
                    </p>
                    <p className="text-xs text-gray-500">
                      Copy from Excel and press Ctrl+V (Cmd+V on Mac)
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-sm border-collapse">
                    <thead className="bg-gray-50 sticky top-0 z-10">
                      <tr>
                        <th className="px-2 py-2 text-left font-medium text-gray-700 border-b border-r w-12 bg-gray-50">#</th>
                        {columns.map((col) => (
                          <th key={col} className="px-3 py-2 text-left font-medium text-gray-700 border-b border-r whitespace-nowrap bg-gray-50 min-w-[120px]">
                            {col}
                          </th>
                        ))}
                        <th className="px-2 py-2 text-center font-medium text-gray-700 border-b w-16 bg-gray-50">Del</th>
                      </tr>
                    </thead>
                    <tbody>
                      {spreadsheetData.map((row, rowIndex) => (
                        <tr key={rowIndex} className="hover:bg-teal-50">
                          <td className="px-2 py-1 text-gray-500 border-b border-r text-center bg-gray-50 font-medium text-xs">{rowIndex + 1}</td>
                          {columns.map((col) => (
                            <td key={col} className="px-1 py-1 border-b border-r">
                              <input
                                type="text"
                                value={row[col] || ''}
                                onChange={(e) => updateCell(rowIndex, col, e.target.value)}
                                className="w-full px-2 py-1 text-sm border-0 focus:ring-1 focus:ring-blue-500 rounded bg-transparent"
                              />
                            </td>
                          ))}
                          <td className="px-2 py-1 border-b text-center">
                            <button
                              onClick={() => deleteRow(rowIndex)}
                              className="text-red-600 hover:text-red-800 text-xs"
                              title="Delete row"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {spreadsheetData.length > 0 && (
                <div className="flex items-center justify-between bg-gray-50 p-3 rounded-lg border border-gray-200">
                  <div className="flex items-center space-x-4">
                    <div className="text-sm">
                      <span className="font-semibold text-gray-900">{spreadsheetData.length}</span>
                      <span className="text-gray-600"> row{spreadsheetData.length !== 1 ? 's' : ''} loaded</span>
                    </div>
                    <button
                      type="button"
                      onClick={addEmptyRow}
                      className="px-3 py-1 text-sm font-medium text-teal-700 hover:text-teal-800 transition-colors"
                    >
                      + Add Row
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSpreadsheetData([])}
                    className="px-3 py-1 text-sm font-medium text-red-600 hover:text-red-800 transition-colors"
                  >
                    Clear All
                  </button>
                </div>
              )}

              <div className="flex justify-end space-x-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={importing}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={importSpreadsheetData}
                  disabled={importing || spreadsheetData.length === 0}
                  className="px-4 py-2 text-sm font-medium text-white bg-teal-500 rounded hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {importing ? 'Importing...' : `Import ${spreadsheetData.length} Row${spreadsheetData.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          )}

          {results && (
            <div className="space-y-4">
              <div className="flex items-center justify-center space-x-4 py-8">
                {results.success > 0 && (
                  <div className="text-center">
                    <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-2" />
                    <p className="text-2xl font-bold text-gray-900">{results.success}</p>
                    <p className="text-sm text-gray-600">Imported Successfully</p>
                  </div>
                )}
                {results.failed > 0 && (
                  <div className="text-center">
                    <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-2" />
                    <p className="text-2xl font-bold text-gray-900">{results.failed}</p>
                    <p className="text-sm text-gray-600">Failed</p>
                  </div>
                )}
                {results.success === 0 && results.failed === 0 && (
                  <div className="text-center">
                    <AlertCircle className="w-16 h-16 text-yellow-500 mx-auto mb-2" />
                    <p className="text-lg font-medium text-gray-900">No data imported</p>
                    <p className="text-sm text-gray-600">All rows were empty or invalid</p>
                  </div>
                )}
              </div>

              {results.errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <h4 className="font-medium text-red-900 mb-2">Errors:</h4>
                  <ul className="text-sm text-red-700 space-y-1">
                    {results.errors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                    {results.errors.length >= 10 && (
                      <li className="italic">... and more errors</li>
                    )}
                  </ul>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-white bg-teal-500 rounded hover:bg-teal-600 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
