import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAllPages } from '../lib/fetchAll';
import { esc } from '../lib/html';
import { companyFor } from '../lib/company';
import { Package, ChevronDown, ChevronRight, Search, Printer, X, Building2, FileDown } from 'lucide-react';
import { saveAsPdf } from '../lib/pdfUtils';

interface BatchItem {
  item_name: string;
  quantity: number;
  unit: string;
  unit_price_cny: number;
  total_cny: number;
  unit_price_lkr: number;
  total_lkr: number;
  supplier_name: string;
}

interface SupplierInfo {
  name: string;
  weight_kg: number;
  cbm: number;
}

interface BatchGroup {
  batch_number: string;
  items: BatchItem[];
  total_quantity: number;
  total_amount_cny: number;
  suppliers: string[];
  supplierDetails: SupplierInfo[];
}

export default function BatchInvoice() {
  const [batchGroups, setBatchGroups] = useState<BatchGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadBatchData();
  }, []);

  async function loadBatchData() {
    setLoading(true);

    // Always read bills directly so the book switch applies (the old database function ignored the book).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = { data: null as any[] | null, error: { message: 'use book-aware query' } as { message: string } | null };
    void supabase;

    if (error) {
      // every page (Supabase stops at 1000 rows per call)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: fallbackData, error: fallbackError } = await fetchAllPages<any>(() => supabase
        .from('purchase_bills')
        .select(`
          batch_number,
          exchange_rate,
          purchase_bill_items (item_name, quantity_received, unit_price_cny),
          purchase_orders (
            total_weight_kg,
            total_cbm,
            suppliers (name),
            purchase_order_items (
              item_name,
              quantity,
              unit,
              unit_price_cny
            )
          )
        `)
        .not('batch_number', 'is', null)
        .order('batch_number')
        .order('id'));

      if (fallbackError) {
        console.error('Error loading batch data:', fallbackError);
        alert('Batch Invoice could not load bills: ' + fallbackError);
        setLoading(false);
        return;
      }

      const grouped: Record<string, BatchGroup> = {};

      for (const bill of fallbackData || []) {
        const batchNum = bill.batch_number || 'Unknown';
        type Po = { suppliers: { name: string } | { name: string }[] | null, total_weight_kg: number, total_cbm: number, purchase_order_items: Array<{ item_name: string, quantity: number, unit: string, unit_price_cny: number }> };
        const poRaw = bill.purchase_orders as unknown as Po | Po[] | null;
        const po = Array.isArray(poRaw) ? poRaw[0] : poRaw;

        if (!po) continue;

        const sup = Array.isArray(po.suppliers) ? po.suppliers[0] : po.suppliers;
        const supplierName = sup?.name || 'Unknown Supplier';
        const poItems = po.purchase_order_items || [];
        // prefer what was actually billed; fall back to the PO lines
        const billed = (bill.purchase_bill_items as unknown as Array<{ item_name: string; quantity_received: number; unit_price_cny: number }> | null) || [];
        const unitOf = (name: string) => poItems.find((x) => x.item_name === name)?.unit || 'PCS';
        const items = billed.length ? billed.map((x) => ({ item_name: x.item_name, quantity: x.quantity_received, unit: unitOf(x.item_name), unit_price_cny: x.unit_price_cny })) : poItems;
        const weightKg = Number(po.total_weight_kg) || 0;
        const cbm = Number(po.total_cbm) || 0;

        if (!grouped[batchNum]) {
          grouped[batchNum] = {
            batch_number: batchNum,
            items: [],
            total_quantity: 0,
            total_amount_cny: 0,
            suppliers: [],
            supplierDetails: [],
          };
        }

        if (!grouped[batchNum].suppliers.includes(supplierName)) {
          grouped[batchNum].suppliers.push(supplierName);
          grouped[batchNum].supplierDetails.push({
            name: supplierName,
            weight_kg: weightKg,
            cbm: cbm
          });
        } else {
          const existingSupplier = grouped[batchNum].supplierDetails.find(s => s.name === supplierName);
          if (existingSupplier) {
            existingSupplier.weight_kg += weightKg;
            existingSupplier.cbm += cbm;
          }
        }

        for (const item of items) {
          const qty = Number(item.quantity) || 0;
          const unitPriceCny = Number(item.unit_price_cny) || 0;
          const totalCny = qty * unitPriceCny;

          grouped[batchNum].items.push({
            item_name: item.item_name,
            quantity: qty,
            unit: item.unit || 'PCS',
            unit_price_cny: unitPriceCny,
            total_cny: totalCny,
            unit_price_lkr: 0,
            total_lkr: 0,
            supplier_name: supplierName,
          });

          grouped[batchNum].total_quantity += qty;
          grouped[batchNum].total_amount_cny += totalCny;
        }
      }

      const sortedGroups = Object.values(grouped).sort((a, b) => {
        const numA = parseInt(a.batch_number.replace(/\D/g, '')) || 0;
        const numB = parseInt(b.batch_number.replace(/\D/g, '')) || 0;
        return numB - numA;
      });

      setBatchGroups(sortedGroups);
      setLoading(false);
      return;
    }

    const grouped: Record<string, BatchGroup> = {};

    for (const row of data || []) {
      const batchNum = row.batch_number || 'Unknown';

      if (!grouped[batchNum]) {
        grouped[batchNum] = {
          batch_number: batchNum,
          items: [],
          total_quantity: 0,
          total_amount_cny: 0,
          suppliers: [],
          supplierDetails: [],
        };
      }

      if (!grouped[batchNum].suppliers.includes(row.supplier_name)) {
        grouped[batchNum].suppliers.push(row.supplier_name);
        grouped[batchNum].supplierDetails.push({
          name: row.supplier_name,
          weight_kg: Number(row.weight_kg) || 0,
          cbm: Number(row.cbm) || 0
        });
      }

      const qty = Number(row.quantity) || 0;
      const unitPriceCny = Number(row.unit_price_cny) || 0;
      const totalCny = qty * unitPriceCny;

      grouped[batchNum].items.push({
        item_name: row.item_name,
        quantity: qty,
        unit: row.unit || 'PCS',
        unit_price_cny: unitPriceCny,
        total_cny: totalCny,
        unit_price_lkr: 0,
        total_lkr: 0,
        supplier_name: row.supplier_name,
      });

      grouped[batchNum].total_quantity += qty;
      grouped[batchNum].total_amount_cny += totalCny;
    }

    const sortedGroups = Object.values(grouped).sort((a, b) => {
      const numA = parseInt(a.batch_number.replace(/\D/g, '')) || 0;
      const numB = parseInt(b.batch_number.replace(/\D/g, '')) || 0;
      return numB - numA;
    });

    setBatchGroups(sortedGroups);
    setLoading(false);
  }

  function toggleBatch(batchNumber: string) {
    setExpandedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(batchNumber)) {
        next.delete(batchNumber);
      } else {
        next.add(batchNumber);
      }
      return next;
    });
  }

  function formatCurrency(amount: number) {
    return new Intl.NumberFormat('en-LK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  async function saveBatchPdf(batch: BatchGroup) {
    const tempDiv = document.createElement('div');
    tempDiv.id = 'batch-pdf-temp';
    tempDiv.style.position = 'absolute';
    tempDiv.style.left = '-9999px';
    tempDiv.style.top = '0';
    tempDiv.style.width = '800px';
    tempDiv.innerHTML = `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <div style="font-weight: bold; font-size: 14px;">${esc(companyFor().name)}</div>
        <h1 style="color: #1a365d; margin-bottom: 5px;">BATCH ${esc(batch.batch_number)}</h1>
        <div style="color: #666; margin-bottom: 20px;">
          <p>Suppliers: ${batch.suppliers.map(esc).join(', ')}</p>
          <p>Total Items: ${batch.items.length} · Printed ${new Date().toLocaleDateString('en-GB')}</p>
        </div>
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
          <thead>
            <tr>
              <th style="background: #1a365d; color: white; padding: 10px; text-align: left; font-size: 12px;">FULL DESCRIPTION OF GOODS</th>
              <th style="background: #1a365d; color: white; padding: 10px; text-align: right; font-size: 12px;">QTY</th>
              <th style="background: #1a365d; color: white; padding: 10px; text-align: left; font-size: 12px;">UNIT OF MEASURE</th>
              <th style="background: #1a365d; color: white; padding: 10px; text-align: right; font-size: 12px;">UNIT PRICE (CNY)</th>
              <th style="background: #1a365d; color: white; padding: 10px; text-align: right; font-size: 12px;">TOTAL (CNY)</th>
            </tr>
          </thead>
          <tbody>
            ${batch.items.map((item, idx) => `
              <tr style="background: ${idx % 2 === 0 ? '#fff' : '#f9f9f9'};">
                <td style="padding: 8px 10px; border-bottom: 1px solid #ddd; font-size: 12px;">${esc(item.item_name)}</td>
                <td style="padding: 8px 10px; border-bottom: 1px solid #ddd; font-size: 12px; text-align: right;">${formatCurrency(item.quantity)}</td>
                <td style="padding: 8px 10px; border-bottom: 1px solid #ddd; font-size: 12px;">${esc(item.unit)}</td>
                <td style="padding: 8px 10px; border-bottom: 1px solid #ddd; font-size: 12px; text-align: right;">${formatCurrency(item.unit_price_cny)}</td>
                <td style="padding: 8px 10px; border-bottom: 1px solid #ddd; font-size: 12px; text-align: right;">${formatCurrency(item.total_cny)}</td>
              </tr>
            `).join('')}
            <tr style="background: #e8f4f8; font-weight: bold;">
              <td style="padding: 10px; border-top: 2px solid #1a365d; font-size: 12px;">TOTAL</td>
              <td style="padding: 10px; border-top: 2px solid #1a365d; font-size: 12px; text-align: right;">${formatCurrency(batch.total_quantity)}</td>
              <td style="padding: 10px; border-top: 2px solid #1a365d;"></td>
              <td style="padding: 10px; border-top: 2px solid #1a365d;"></td>
              <td style="padding: 10px; border-top: 2px solid #1a365d; font-size: 12px; text-align: right;">${formatCurrency(batch.total_amount_cny)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    document.body.appendChild(tempDiv);
    await saveAsPdf('batch-pdf-temp', `Batch_${batch.batch_number}_Invoice.pdf`);
    document.body.removeChild(tempDiv);
  }

  function printBatch(batch: BatchGroup) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert('Allow pop-ups to print'); return; }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Batch ${esc(batch.batch_number)} Invoice</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          h1 { color: #1a365d; margin-bottom: 5px; }
          .header-info { color: #666; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th { background: #1a365d; color: white; padding: 10px; text-align: left; font-size: 12px; }
          td { padding: 8px 10px; border-bottom: 1px solid #ddd; font-size: 12px; }
          tr:nth-child(even) { background: #f9f9f9; }
          .text-right { text-align: right; }
          .total-row { background: #e8f4f8 !important; font-weight: bold; }
          .total-row td { border-top: 2px solid #1a365d; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div style="font-weight: bold; font-size: 14px;">${esc(companyFor().name)}</div>
        <h1>BATCH ${esc(batch.batch_number)}</h1>
        <div class="header-info">
          <p>Suppliers: ${batch.suppliers.map(esc).join(', ')}</p>
          <p>Total Items: ${batch.items.length} · Printed ${new Date().toLocaleDateString('en-GB')}</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>FULL DESCRIPTION OF GOODS</th>
              <th class="text-right">QTY</th>
              <th>UNIT OF MEASURE</th>
              <th class="text-right">UNIT PRICE (CNY)</th>
              <th class="text-right">TOTAL (CNY)</th>
            </tr>
          </thead>
          <tbody>
            ${batch.items.map(item => `
              <tr>
                <td>${esc(item.item_name)}</td>
                <td class="text-right">${formatCurrency(item.quantity)}</td>
                <td>${esc(item.unit)}</td>
                <td class="text-right">${formatCurrency(item.unit_price_cny)}</td>
                <td class="text-right">${formatCurrency(item.total_cny)}</td>
              </tr>
            `).join('')}
            <tr class="total-row">
              <td>TOTAL</td>
              <td class="text-right">${formatCurrency(batch.total_quantity)}</td>
              <td></td>
              <td></td>
              <td class="text-right">${formatCurrency(batch.total_amount_cny)}</td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  }

  const allSuppliers = [...new Set(batchGroups.flatMap(b => b.suppliers))].sort();

  const filteredBatches = batchGroups.filter((batch) => {
    const matchesSearch = batch.batch_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      batch.suppliers.some(s => s.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesSupplier = !supplierFilter || batch.suppliers.includes(supplierFilter);
    return matchesSearch && matchesSupplier;
  });

  const totalBatches = filteredBatches.length;
  const totalItems = filteredBatches.reduce((sum, b) => sum + b.items.length, 0);
  const grandTotal = filteredBatches.reduce((sum, b) => sum + b.total_amount_cny, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Batch Invoices</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-teal-100 rounded-lg">
              <Package className="w-5 h-5 text-teal-700" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Batches</p>
              <p className="text-xl font-bold text-gray-900">{totalBatches}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-teal-100 rounded-lg">
              <Package className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Items</p>
              <p className="text-xl font-bold text-gray-900">{totalItems}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <Package className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Grand Total (CNY)</p>
              <p className="text-xl font-bold text-gray-900">{formatCurrency(grandTotal)}</p>
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
              placeholder="Search batch number or supplier..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-gray-400" />
            <select
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            >
              <option value="">All Suppliers</option>
              {allSuppliers.map(supplier => (
                <option key={supplier} value={supplier}>{supplier}</option>
              ))}
            </select>
          </div>
          {(searchTerm || supplierFilter) && (
            <button
              onClick={() => {
                setSearchTerm('');
                setSupplierFilter('');
              }}
              className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {filteredBatches.map((batch) => (
          <div key={batch.batch_number} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-visible">
            <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 bg-gray-50 border-b border-gray-200 overflow-visible">
              <button
                onClick={() => toggleBatch(batch.batch_number)}
                className="flex items-center space-x-3 flex-1 min-w-0"
              >
                {expandedBatches.has(batch.batch_number) ? (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0 text-left">
                  <span className="font-bold text-teal-700 text-lg">BATCH {batch.batch_number}</span>
                  <span className="px-2 py-0.5 bg-teal-100 text-teal-700 text-sm rounded-full">
                    {batch.items.length} items
                  </span>
                  <span className="text-sm text-gray-500">
                    ({batch.supplierDetails.map((supplier, idx) => (
                      <span key={supplier.name} className="relative group/supplier inline-block">
                        <span className="cursor-help underline decoration-dotted underline-offset-2 hover:text-teal-700 transition-colors">
                          {supplier.name}
                        </span>
                        {idx < batch.supplierDetails.length - 1 && ', '}
                        <span className="pointer-events-none absolute left-0 top-full mt-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover/supplier:opacity-100 transition-opacity duration-200 z-[9999] whitespace-nowrap shadow-xl" style={{ minWidth: '140px' }}>
                          <span className="font-semibold block text-center border-b border-gray-700 pb-1 mb-1">{supplier.name}</span>
                          <span className="block">Weight: {supplier.weight_kg.toFixed(2)} KG</span>
                          <span className="block">CBM: {supplier.cbm.toFixed(3)}</span>
                          <span className="absolute left-4 bottom-full w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[6px] border-b-gray-900"></span>
                        </span>
                      </span>
                    ))})
                  </span>
                </div>
              </button>
              <div className="flex items-center space-x-4">
                <span className="font-bold text-gray-900">{formatCurrency(batch.total_amount_cny)} CNY</span>
                <button
                  onClick={() => saveBatchPdf(batch)}
                  className="p-2 text-gray-500 hover:text-teal-700 hover:bg-teal-50 rounded-lg transition-colors"
                  title="Save as PDF"
                >
                  <FileDown className="w-5 h-5" />
                </button>
                <button
                  onClick={() => printBatch(batch)}
                  className="p-2 text-gray-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                  title="Print Batch Invoice"
                >
                  <Printer className="w-5 h-5" />
                </button>
              </div>
            </div>

            {expandedBatches.has(batch.batch_number) && (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-slate-900">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider">
                        Full Description of Goods
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-white uppercase tracking-wider">
                        Qty
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider">
                        Unit of Measure
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-white uppercase tracking-wider">
                        Unit Price
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-white uppercase tracking-wider">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {batch.items.map((item, idx) => (
                      <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-4 py-2 text-sm text-gray-900">{item.item_name}</td>
                        <td className="px-4 py-2 text-sm text-gray-900 text-right">{formatCurrency(item.quantity)}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{item.unit}</td>
                        <td className="px-4 py-2 text-sm text-gray-900 text-right">{formatCurrency(item.unit_price_cny)}</td>
                        <td className="px-4 py-2 text-sm text-gray-900 text-right">{formatCurrency(item.total_cny)}</td>
                      </tr>
                    ))}
                    <tr className="bg-teal-50 font-semibold">
                      <td className="px-4 py-3 text-sm text-gray-900 border-t-2 border-blue-200">TOTAL</td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right border-t-2 border-blue-200">{formatCurrency(batch.total_quantity)}</td>
                      <td className="px-4 py-3 border-t-2 border-blue-200"></td>
                      <td className="px-4 py-3 border-t-2 border-blue-200"></td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right border-t-2 border-blue-200">{formatCurrency(batch.total_amount_cny)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}

        {filteredBatches.length === 0 && (
          <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
            <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No batch invoices found</p>
            <p className="text-sm text-gray-400 mt-1">Create purchase bills with batch numbers to see them here</p>
          </div>
        )}
      </div>
    </div>
  );
}
