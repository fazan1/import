import { X, Printer } from 'lucide-react';
import { type ProductLine, type LineCalc } from './ImportCostTables';

interface ImportCostPrintProps {
  show: boolean;
  onClose: () => void;
  lines: ProductLine[];
  calcs: LineCalc[];
  buyCurrency: string;
  exchangeRate: number;
  seafreight: number;
  totalImportCost: number;
  importTaxPercent: number | null;
  allocMode: 'kg' | 'cbm';
  customerName: string;
  reference: string;
  totals: { extraCosts: number; totalLanded: number; importCost: number; sell: number; profit: number };
}

export default function ImportCostPrint({
  show,
  onClose,
  lines,
  calcs,
  buyCurrency,
  exchangeRate,
  seafreight,
  totalImportCost,
  importTaxPercent,
  allocMode,
  customerName,
  reference,
  totals,
}: ImportCostPrintProps) {
  if (!show) return null;

  const activeLines = lines.filter((l, i) => l.code.trim() !== '' || (l.buyPrice ?? 0) > 0 || calcs[i].landedCostEx > 0);
  const activeCalcs = activeLines.map((l) => calcs[lines.indexOf(l)]);

  const fmt = (v: number) =>
    v === 0
      ? '-'
      : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const grandTotalWeight = activeLines.reduce((s, l) => s + (l.weight ?? 0) * (l.qty ?? 0), 0);
  const grandTotalCbm = activeLines.reduce((s, l) => s + (l.cubic ?? 0), 0);
  const totalQty = activeLines.reduce((s, l) => s + (l.qty ?? 0), 0);
  const totalProductCNY = activeLines.reduce((s, l) => s + (l.buyPrice ?? 0) * (l.qty ?? 0), 0);
  const totalProductLKR = activeLines.reduce((s, l) => s + (l.buyPrice ?? 0) * exchangeRate * (l.qty ?? 0), 0);
  const totalAlloc = activeCalcs.reduce((s, c) => s + c.totalAlloc, 0);

  function handlePrint() {
    window.print();
  }

  return (
    <div className="fixed inset-0 z-[100] bg-white overflow-auto">
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #import-cost-print-content, #import-cost-print-content * {
            visibility: visible;
          }
          #import-cost-print-content {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 5mm !important;
            font-size: 9pt !important;
            line-height: 1.3 !important;
          }
          #import-cost-print-content table {
            page-break-inside: avoid;
          }
          .no-print {
            display: none !important;
          }
          @page {
            size: A4 landscape;
            margin: 5mm 7mm;
          }
        }
      `}</style>

      <div className="no-print sticky top-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm z-10">
        <h2 className="text-lg font-bold text-gray-800">Import Cost Calculation - Print Preview</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Print Document
          </button>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="p-4 max-w-[1400px] mx-auto" id="import-cost-print-content" style={{ fontSize: '9pt', lineHeight: '1.3' }}>
        {/* Header */}
        <div className="text-center mb-1 border-b border-gray-800 pb-1">
          <h1 className="text-base font-black text-gray-900 uppercase tracking-wider">Import Cost Calculation Sheet</h1>
          <div className="flex justify-center items-center gap-4 mt-0.5 text-[10pt] text-gray-700">
            {customerName && <span className="font-semibold">Customer: <span className="text-gray-900">{customerName}</span></span>}
            {reference && <span className="font-semibold">Ref: <span className="text-gray-900">{reference}</span></span>}
            <span className="font-semibold">Date: <span className="text-gray-900">{new Date().toLocaleDateString('en-GB')}</span></span>
          </div>
        </div>

        {/* Configuration Summary - Inline */}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-1 text-[9pt] py-1 border-b border-gray-300">
          <span><strong>Currency:</strong> {buyCurrency}</span>
          <span><strong>Rate:</strong> 1 {buyCurrency} = {fmt(exchangeRate)} LKR</span>
          <span><strong>Seafreight:</strong> {fmt(seafreight)}</span>
          <span><strong>Import Costs:</strong> {fmt(totalImportCost)}</span>
          <span><strong>Extra Costs:</strong> {fmt(totals.extraCosts)}</span>
          <span><strong>Alloc:</strong> {allocMode === 'cbm' ? 'CBM' : 'Weight'} ({allocMode === 'cbm' ? `${grandTotalCbm.toFixed(2)} M3` : `${grandTotalWeight.toLocaleString()} KG`})</span>
          {importTaxPercent !== null && importTaxPercent > 0 && <span><strong>Import Tax:</strong> {importTaxPercent}%</span>}
        </div>

        {/* Combined Product + Cost Breakdown Table */}
        <table className="w-full border-collapse text-[9pt] mb-1">
          <thead>
            <tr className="bg-gray-200">
              <th className="border border-gray-400 px-1 py-0.5 text-left font-bold text-gray-800">#</th>
              <th className="border border-gray-400 px-1 py-0.5 text-left font-bold text-gray-800">Code</th>
              <th className="border border-gray-400 px-1 py-0.5 text-right font-bold text-gray-800">Buy ({buyCurrency})</th>
              <th className="border border-gray-400 px-1 py-0.5 text-center font-bold text-gray-800">Qty</th>
              <th className="border border-gray-400 px-1 py-0.5 text-right font-bold text-gray-800">{allocMode === 'cbm' ? 'CBM' : 'Wt'}</th>
              <th className="border border-gray-400 px-1 py-0.5 text-right font-bold text-gray-800">Tot {allocMode === 'cbm' ? 'CBM' : 'Wt'}</th>
              <th className="border border-gray-400 px-1 py-0.5 text-right font-bold text-gray-800">Buy LKR</th>
              <th className="border border-gray-400 px-1 py-0.5 text-right font-bold text-gray-800">Ship/U</th>
              <th className="border border-gray-400 px-1 py-0.5 text-right font-bold text-gray-800">Alloc</th>
              <th className="border border-gray-400 px-1 py-0.5 text-right font-bold text-white bg-teal-700">Land/U</th>
              <th className="border border-gray-400 px-1 py-0.5 text-right font-bold text-white bg-amber-700">Land Tot</th>
              <th className="border border-gray-400 px-1 py-0.5 text-center font-bold text-gray-800">Mrg%</th>
              <th className="border border-gray-400 px-1 py-0.5 text-right font-bold text-white bg-blue-700">Sell/U</th>
              <th className="border border-gray-400 px-1 py-0.5 text-right font-bold text-gray-800">Sell Tot</th>
              <th className="border border-gray-400 px-1 py-0.5 text-right font-bold text-white bg-emerald-700">Profit</th>
              <th className="border border-gray-400 px-1 py-0.5 text-center font-bold text-gray-800">P%</th>
            </tr>
          </thead>
          <tbody>
            {activeLines.map((line, i) => {
              const c = activeCalcs[i];
              const weightTotal = (line.weight ?? 0) * (line.qty ?? 0);
              const profitPct = c.landedCostEx > 0 && c.sellTotal > 0 ? (c.profitTotal / c.landedTotal) * 100 : 0;
              return (
                <tr key={line.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="border border-gray-300 px-1 py-0.5 text-center text-gray-600">{i + 1}</td>
                  <td className="border border-gray-300 px-1 py-0.5 font-semibold text-gray-900 max-w-[120px] truncate">{line.code || '-'}</td>
                  <td className="border border-gray-300 px-1 py-0.5 text-right">{line.buyPrice ? fmt(line.buyPrice) : '-'}</td>
                  <td className="border border-gray-300 px-1 py-0.5 text-center">{line.qty ?? '-'}</td>
                  <td className="border border-gray-300 px-1 py-0.5 text-right">
                    {allocMode === 'cbm' ? (line.cubic ? line.cubic.toFixed(3) : '-') : (line.weight ?? '-')}
                  </td>
                  <td className="border border-gray-300 px-1 py-0.5 text-right">
                    {allocMode === 'cbm' ? (line.cubic ? line.cubic.toFixed(3) : '-') : (weightTotal > 0 ? weightTotal.toLocaleString() : '-')}
                  </td>
                  <td className="border border-gray-300 px-1 py-0.5 text-right">{fmt(c.buyPriceLocal)}</td>
                  <td className="border border-gray-300 px-1 py-0.5 text-right">{fmt(c.extraCosts)}</td>
                  <td className="border border-gray-300 px-1 py-0.5 text-right font-semibold">{fmt(c.totalAlloc)}</td>
                  <td className="border border-gray-300 px-1 py-0.5 text-right font-bold text-teal-800 bg-teal-50">{fmt(c.landedCostEx)}</td>
                  <td className="border border-gray-300 px-1 py-0.5 text-right font-bold text-amber-800 bg-amber-50">{fmt(c.landedTotal)}</td>
                  <td className="border border-gray-300 px-1 py-0.5 text-center">
                    {line.marginPercent ? `${line.marginPercent}%` : (line.sellPrice && c.landedCostEx > 0 ? `${(((line.sellPrice - c.landedCostEx) / c.landedCostEx) * 100).toFixed(1)}%` : '-')}
                  </td>
                  <td className="border border-gray-300 px-1 py-0.5 text-right font-bold text-blue-900 bg-blue-50">{c.sellPerUnit > 0 ? fmt(c.sellPerUnit) : '-'}</td>
                  <td className="border border-gray-300 px-1 py-0.5 text-right">{c.sellTotal > 0 ? fmt(c.sellTotal) : '-'}</td>
                  <td className={`border border-gray-300 px-1 py-0.5 text-right font-bold ${c.profitTotal >= 0 ? 'text-emerald-800 bg-emerald-50' : 'text-red-700 bg-red-50'}`}>
                    {c.sellTotal > 0 ? fmt(c.profitTotal) : '-'}
                  </td>
                  <td className={`border border-gray-300 px-1 py-0.5 text-center font-semibold ${profitPct >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {c.sellTotal > 0 ? `${profitPct.toFixed(1)}%` : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-200 font-bold border-t-2 border-gray-500">
              <td className="border border-gray-400 px-1 py-0.5" colSpan={2}>TOTALS</td>
              <td className="border border-gray-400 px-1 py-0.5 text-right">{fmt(totalProductCNY)}</td>
              <td className="border border-gray-400 px-1 py-0.5 text-center">{totalQty}</td>
              <td className="border border-gray-400 px-1 py-0.5 text-right">
                {allocMode === 'cbm' ? grandTotalCbm.toFixed(2) : grandTotalWeight.toLocaleString()}
              </td>
              <td className="border border-gray-400 px-1 py-0.5 text-right">
                {allocMode === 'cbm' ? grandTotalCbm.toFixed(2) : grandTotalWeight.toLocaleString()}
              </td>
              <td className="border border-gray-400 px-1 py-0.5 text-right">{fmt(totalProductLKR)}</td>
              <td className="border border-gray-400 px-1 py-0.5"></td>
              <td className="border border-gray-400 px-1 py-0.5 text-right">{fmt(totalAlloc)}</td>
              <td className="border border-gray-400 px-1 py-0.5"></td>
              <td className="border border-gray-400 px-1 py-0.5 text-right text-amber-800">{fmt(totals.totalLanded)}</td>
              <td className="border border-gray-400 px-1 py-0.5"></td>
              <td className="border border-gray-400 px-1 py-0.5"></td>
              <td className="border border-gray-400 px-1 py-0.5 text-right">{fmt(totals.sell)}</td>
              <td className={`border border-gray-400 px-1 py-0.5 text-right ${totals.profit >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>{fmt(totals.profit)}</td>
              <td className={`border border-gray-400 px-1 py-0.5 text-center ${totals.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                {totals.sell > 0 ? `${((totals.profit / totals.sell) * 100).toFixed(1)}%` : '-'}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Financial Summary - Compact inline */}
        <div className="flex gap-2 text-[9pt] mt-4">
          <table className="border-collapse flex-1">
            <tbody>
              <tr className="bg-gray-50">
                <td className="border border-gray-300 px-1.5 py-0.5 font-semibold text-gray-700">Product Cost ({buyCurrency})</td>
                <td className="border border-gray-300 px-1.5 py-0.5 text-right font-bold">{fmt(totalProductCNY)}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-1.5 py-0.5 font-semibold text-gray-700">Product Cost (LKR)</td>
                <td className="border border-gray-300 px-1.5 py-0.5 text-right font-bold">{fmt(totalProductLKR)}</td>
              </tr>
              <tr className="bg-gray-50">
                <td className="border border-gray-300 px-1.5 py-0.5 font-semibold text-gray-700">Seafreight</td>
                <td className="border border-gray-300 px-1.5 py-0.5 text-right font-bold">{fmt(seafreight)}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-1.5 py-0.5 font-semibold text-gray-700">Import Costs</td>
                <td className="border border-gray-300 px-1.5 py-0.5 text-right font-bold">{fmt(totalImportCost)}</td>
              </tr>
              <tr className="bg-amber-50">
                <td className="border border-gray-400 px-1.5 py-0.5 font-bold text-amber-900">Extra Costs Total</td>
                <td className="border border-gray-400 px-1.5 py-0.5 text-right font-bold text-amber-900">{fmt(totals.extraCosts)}</td>
              </tr>
            </tbody>
          </table>
          <table className="border-collapse flex-1">
            <tbody>
              <tr className="bg-gray-50">
                <td className="border border-gray-300 px-1.5 py-0.5 font-semibold text-gray-700">Allocation Distributed</td>
                <td className="border border-gray-300 px-1.5 py-0.5 text-right font-bold">{fmt(totalAlloc)}</td>
              </tr>
              <tr className="bg-blue-50">
                <td className="border border-gray-400 px-1.5 py-0.5 font-bold text-blue-900">Total Landed Cost</td>
                <td className="border border-gray-400 px-1.5 py-0.5 text-right font-black text-blue-900">{fmt(totals.totalLanded)}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-1.5 py-0.5 font-semibold text-gray-700">Avg Landed/Unit</td>
                <td className="border border-gray-300 px-1.5 py-0.5 text-right font-bold">{totalQty > 0 ? fmt(totals.totalLanded / totalQty) : '-'}</td>
              </tr>
              <tr className="bg-gray-50">
                <td className="border border-gray-300 px-1.5 py-0.5 font-semibold text-gray-700">Sales Value</td>
                <td className="border border-gray-300 px-1.5 py-0.5 text-right font-bold">{fmt(totals.sell)}</td>
              </tr>
              <tr className={totals.profit >= 0 ? 'bg-emerald-50' : 'bg-red-50'}>
                <td className={`border border-gray-400 px-1.5 py-0.5 font-bold ${totals.profit >= 0 ? 'text-emerald-900' : 'text-red-800'}`}>Profit ({totals.sell > 0 ? `${((totals.profit / totals.sell) * 100).toFixed(1)}%` : '-'})</td>
                <td className={`border border-gray-400 px-1.5 py-0.5 text-right font-black ${totals.profit >= 0 ? 'text-emerald-900' : 'text-red-800'}`}>{fmt(totals.profit)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-400 pt-1 mt-1 text-[8pt] text-gray-500 flex justify-between">
          <span>Generated: {new Date().toLocaleString('en-GB')}</span>
          <span>{buyCurrency} Rate: {fmt(exchangeRate)} | Products: {activeLines.length} | Alloc: {allocMode.toUpperCase()}</span>
        </div>
      </div>
    </div>
  );
}