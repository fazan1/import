import { X, Printer, FileDown } from 'lucide-react';
import { saveAsPdf } from '../lib/pdfUtils';
import { companyFor } from '../lib/company';

interface CostingRecord {
  id: string;
  batch_number: string;
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

interface CostingDutyPrintProps {
  records: CostingRecord[];
  batchNumber: string;
  onClose: () => void;
}

export default function CostingDutyPrint({ records, batchNumber, onClose }: CostingDutyPrintProps) {
  const resaleRecords = records.filter(r => r.type === 'RESALE');
  const factoryRecords = records.filter(r => r.type === 'FACTORY');

  const totalLandedCost = records.reduce((sum, r) => sum + (r.total_landed_cost || 0), 0);
  const totalSales = resaleRecords.reduce((sum, r) => sum + (r.total_sales || 0), 0);
  const totalProfit = resaleRecords.reduce((sum, r) => sum + (r.total_profit || 0), 0);
  // weight_kg and cbm are already the line totals (from the packing list / split), not per piece
  const totalWeight = records.reduce((sum, r) => sum + (r.weight_kg || 0), 0);
  const totalCbm = records.reduce((sum, r) => sum + (r.cbm || 0), 0);
  const company = companyFor((records[0] as { book?: string | null } | undefined)?.book);

  function handlePrint() {
    window.print();
  }

  function handleSavePdf() {
    saveAsPdf('costing-duty-content', `CostingSheet_Batch${batchNumber}.pdf`);
  }

  function formatNum(n: number, decimals = 2) {
    return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function renderTable(title: string, items: CostingRecord[]) {
    if (items.length === 0) return null;
    const sectionLanded = items.reduce((sum, r) => sum + (r.total_landed_cost || 0), 0);
    const sectionSales = items.reduce((sum, r) => sum + (r.total_sales || 0), 0);
    const sectionProfit = items.reduce((sum, r) => sum + (r.total_profit || 0), 0);

    return (
      <div className="mb-6">
        <h3 className="text-sm font-bold text-gray-800 mb-2 uppercase tracking-wide">{title}</h3>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-800 text-white">
              <th className="border border-gray-600 p-1.5 text-center w-8">#</th>
              <th className="border border-gray-600 p-1.5 text-left">Description</th>
              <th className="border border-gray-600 p-1.5 text-right w-12">Qty</th>
              <th className="border border-gray-600 p-1.5 text-right w-16">CNY</th>
              <th className="border border-gray-600 p-1.5 text-right w-14">Rate</th>
              <th className="border border-gray-600 p-1.5 text-right w-16">LKR</th>
              <th className="border border-gray-600 p-1.5 text-center w-12">Basis</th>
              <th className="border border-gray-600 p-1.5 text-right w-16">Duty/U</th>
              <th className="border border-gray-600 p-1.5 text-right w-18">Landed/U</th>
              {title === 'RESALE ITEMS' && (
                <>
                  <th className="border border-gray-600 p-1.5 text-right w-16">Sell/U</th>
                  <th className="border border-gray-600 p-1.5 text-right w-16">Profit/U</th>
                </>
              )}
              <th className="border border-gray-600 p-1.5 text-right w-20">Total Landed</th>
              {title === 'RESALE ITEMS' && (
                <th className="border border-gray-600 p-1.5 text-right w-20">Total Profit</th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((record, idx) => (
              <tr key={record.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="border border-gray-300 p-1.5 text-center">{idx + 1}</td>
                <td className="border border-gray-300 p-1.5">{record.description}</td>
                <td className="border border-gray-300 p-1.5 text-right">{record.qty}</td>
                <td className="border border-gray-300 p-1.5 text-right">{formatNum(record.unit_price_cny)}</td>
                <td className="border border-gray-300 p-1.5 text-right">{formatNum(record.cny_rate)}</td>
                <td className="border border-gray-300 p-1.5 text-right">{formatNum(record.unit_price_lkr)}</td>
                <td className="border border-gray-300 p-1.5 text-center">{record.duty_basis}</td>
                <td className="border border-gray-300 p-1.5 text-right">{formatNum(record.duty_per_unit)}</td>
                <td className="border border-gray-300 p-1.5 text-right">{formatNum(record.landed_cost_per_unit)}</td>
                {title === 'RESALE ITEMS' && (
                  <>
                    <td className="border border-gray-300 p-1.5 text-right">{formatNum(record.selling_price)}</td>
                    <td className={`border border-gray-300 p-1.5 text-right ${record.profit_per_unit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {formatNum(record.profit_per_unit)}
                    </td>
                  </>
                )}
                <td className="border border-gray-300 p-1.5 text-right font-medium">{formatNum(record.total_landed_cost)}</td>
                {title === 'RESALE ITEMS' && (
                  <td className={`border border-gray-300 p-1.5 text-right font-medium ${record.total_profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {formatNum(record.total_profit)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 font-bold text-xs">
              <td className="border border-gray-400 p-1.5" colSpan={title === 'RESALE ITEMS' ? 11 : 9}>TOTAL</td>
              <td className="border border-gray-400 p-1.5 text-right">{formatNum(sectionLanded)}</td>
              {title === 'RESALE ITEMS' && (
                <td className={`border border-gray-400 p-1.5 text-right ${sectionProfit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                  {formatNum(sectionProfit)}
                </td>
              )}
            </tr>
          </tfoot>
        </table>
        {title === 'RESALE ITEMS' && sectionSales > 0 && (
          <div className="text-xs text-gray-600 mt-1">
            Expected Sales: LKR {formatNum(sectionSales)} | Margin: {((sectionProfit / sectionSales) * 100).toFixed(1)}%
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white shadow-2xl max-w-6xl w-full max-h-[95vh] overflow-hidden flex flex-col rounded-lg">
        <div className="flex items-center justify-between p-3 border-b border-gray-200 print:hidden bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-900">Costing & Duty Sheet - Batch {batchNumber}</h3>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleSavePdf}
              className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <FileDown className="w-4 h-4" />
              <span>Save PDF</span>
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors"
            >
              <Printer className="w-4 h-4" />
              <span>Print</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-white print:overflow-visible">
          <div className="p-6 print:p-4" id="costing-duty-content" style={{ fontFamily: 'Arial, sans-serif' }}>
            <div className="text-center mb-5">
              <div className="text-base font-bold text-gray-900">{company.name}</div>
              <h1 className="text-xl font-bold text-gray-900">COSTING & DUTY SHEET</h1>
              <div className="text-sm text-gray-600 mt-1">Batch: {batchNumber}</div>
              <div className="text-xs text-gray-500">Generated: {new Date().toLocaleDateString('en-GB')}</div>
            </div>

            <div className="grid grid-cols-4 gap-3 mb-6 text-sm">
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <p className="text-xs text-blue-600 font-medium">Total Items</p>
                <p className="text-lg font-bold text-blue-800">{records.length}</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-3 text-center">
                <p className="text-xs text-amber-600 font-medium">Total Landed Cost</p>
                <p className="text-lg font-bold text-amber-800">LKR {formatNum(totalLandedCost)}</p>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-xs text-green-600 font-medium">Expected Sales</p>
                <p className="text-lg font-bold text-green-800">LKR {formatNum(totalSales)}</p>
              </div>
              <div className={`${totalProfit >= 0 ? 'bg-emerald-50' : 'bg-red-50'} rounded-lg p-3 text-center`}>
                <p className={`text-xs font-medium ${totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>Expected Profit</p>
                <p className={`text-lg font-bold ${totalProfit >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>LKR {formatNum(totalProfit)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6 text-xs text-gray-600">
              <div>Total Weight: {formatNum(totalWeight)} KG</div>
              <div>Total CBM: {formatNum(totalCbm, 4)}</div>
            </div>

            {renderTable('RESALE ITEMS', resaleRecords)}
            {renderTable('FACTORY USE ITEMS', factoryRecords)}
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #costing-duty-content, #costing-duty-content * { visibility: visible; }
          #costing-duty-content { position: absolute; left: 0; top: 0; width: 100%; padding: 15px !important; }
          .print\\:hidden { display: none !important; }
          @page { size: A4 landscape; margin: 8mm; }
        }
      `}</style>
    </div>
  );
}
