import { X, Printer, FileDown } from 'lucide-react';
import { saveAsPdf } from '../lib/pdfUtils';
import { companyFor } from '../lib/company';

/* One costing line as the Costing screen holds it.
   Shipping per unit = the item's charge from Shipping -> Charges divided by its quantity. */
export interface CostingPrintLine {
  id: string;
  pl_no: string;
  description: string;
  qty: number;
  unit: string;
  unit_price_cny: number;
  cny_rate: number;
  unit_price_lkr: number;
  charge_per_unit: number;
  charge_basis: string;
  landed_cost_per_unit: number;
  selling_price: number;
  profit_per_unit: number;
  total_landed_cost: number;
  total_sales: number;
  total_profit: number;
  type: 'RESALE' | 'FACTORY';
}

export interface CostingSummary {
  lines: number;
  itemsCost: number;      // sum of cost LKR x qty
  shipping: number;       // sum of shipping per unit x qty
  landed: number;         // sum of total landed
  sales: number;          // RESALE lines with a selling price
  factory: number;        // FACTORY lines at landed cost
  profit: number;         // RESALE lines with a selling price
  margin: number;         // profit / sales, %
  unpriced: number;       // RESALE lines without a selling price yet
  unpricedLanded: number;
}

/** One rule for the whole batch: the screen, the Excel file and the print all use it. */
export function summarizeCosting(lines: CostingPrintLine[]): CostingSummary {
  const s: CostingSummary = { lines: lines.length, itemsCost: 0, shipping: 0, landed: 0, sales: 0, factory: 0, profit: 0, margin: 0, unpriced: 0, unpricedLanded: 0 };
  for (const r of lines) {
    s.itemsCost += r.unit_price_lkr * r.qty;
    s.shipping += r.charge_per_unit * r.qty;
    s.landed += r.total_landed_cost;
    if (r.type === 'FACTORY') {
      s.factory += r.total_landed_cost;
    } else if (r.selling_price > 0) {
      s.sales += r.total_sales;
      s.profit += r.total_profit;
    } else {
      s.unpriced++;
      s.unpricedLanded += r.total_landed_cost;
    }
  }
  s.margin = s.sales > 0 ? (s.profit / s.sales) * 100 : 0;
  return s;
}

export const fmt2 = (n: number) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt0 = (n: number) => Math.round(Number(n) || 0).toLocaleString('en-US');

interface CostingDutyPrintProps {
  records: CostingPrintLine[];
  summary: CostingSummary;
  batchNumber: string;
  book?: string | null;
  isShipment?: boolean;
  onClose: () => void;
}

export default function CostingDutyPrint({ records, summary, batchNumber, book, isShipment, onClose }: CostingDutyPrintProps) {
  const resaleRecords = records.filter(r => r.type === 'RESALE');
  const factoryRecords = records.filter(r => r.type === 'FACTORY');
  const company = companyFor(book);

  function handlePrint() {
    window.print();
  }

  function handleSavePdf() {
    saveAsPdf('costing-duty-content', `CostingSheet_Batch${batchNumber}.pdf`);
  }

  const th = 'border border-gray-600 p-1 text-right whitespace-nowrap';
  const td = 'border border-gray-300 p-1 text-right whitespace-nowrap';

  function renderTable(title: string, items: CostingPrintLine[], resale: boolean) {
    if (items.length === 0) return null;
    const sec = summarizeCosting(items);
    const lead = resale ? 13 : 10; // columns before "Total landed"

    return (
      <div className="mb-6">
        <h3 className="text-sm font-bold text-gray-800 mb-2 uppercase tracking-wide">{title}</h3>
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="bg-gray-800 text-white">
                <th className="border border-gray-600 p-1 text-center w-6">#</th>
                <th className="border border-gray-600 p-1 text-left">PL</th>
                <th className="border border-gray-600 p-1 text-left">Description</th>
                <th className={th}>Qty</th>
                <th className="border border-gray-600 p-1 text-center">Unit</th>
                <th className={th}>CNY</th>
                <th className={th}>Rate</th>
                <th className={th}>Cost LKR/U</th>
                <th className={th}>Shipping/U</th>
                <th className={th}>Landed/U</th>
                {resale && (
                  <>
                    <th className={th}>Sell/U</th>
                    <th className={th}>Profit/U</th>
                    <th className={th}>Margin</th>
                  </>
                )}
                <th className={th}>Total Landed</th>
                {resale && (
                  <>
                    <th className={th}>Total Sales</th>
                    <th className={th}>Total Profit</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((r, idx) => {
                const priced = r.selling_price > 0;
                const margin = priced ? (r.profit_per_unit / r.selling_price) * 100 : 0;
                return (
                  <tr key={r.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="border border-gray-300 p-1 text-center">{idx + 1}</td>
                    <td className="border border-gray-300 p-1 whitespace-nowrap">{r.pl_no || '-'}</td>
                    <td className="border border-gray-300 p-1">{r.description}</td>
                    <td className={td}>{r.qty.toLocaleString('en-US')}</td>
                    <td className="border border-gray-300 p-1 text-center">{r.unit}</td>
                    <td className={td}>{fmt2(r.unit_price_cny)}</td>
                    <td className={td}>{fmt2(r.cny_rate)}</td>
                    <td className={td}>{fmt2(r.unit_price_lkr)}</td>
                    <td className={td}>
                      {fmt2(r.charge_per_unit)}
                      {r.charge_basis && <span className="ml-1 text-[8px] text-gray-500">{r.charge_basis}</span>}
                    </td>
                    <td className={`${td} font-medium`}>{fmt2(r.landed_cost_per_unit)}</td>
                    {resale && (
                      <>
                        <td className={td}>{priced ? fmt2(r.selling_price) : '-'}</td>
                        <td className={`${td} ${r.profit_per_unit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{priced ? fmt2(r.profit_per_unit) : '-'}</td>
                        <td className={`${td} ${margin >= 0 ? 'text-green-700' : 'text-red-600'}`}>{priced ? `${margin.toFixed(1)}%` : '-'}</td>
                      </>
                    )}
                    <td className={`${td} font-medium`}>{fmt0(r.total_landed_cost)}</td>
                    {resale && (
                      <>
                        <td className={td}>{priced ? fmt0(r.total_sales) : '-'}</td>
                        <td className={`${td} font-medium ${r.total_profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{priced ? fmt0(r.total_profit) : '-'}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 font-bold">
                <td className="border border-gray-400 p-1" colSpan={lead}>TOTAL ({items.length} lines)</td>
                <td className="border border-gray-400 p-1 text-right whitespace-nowrap">{fmt0(sec.landed)}</td>
                {resale && (
                  <>
                    <td className="border border-gray-400 p-1 text-right whitespace-nowrap">{fmt0(sec.sales)}</td>
                    <td className={`border border-gray-400 p-1 text-right whitespace-nowrap ${sec.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt0(sec.profit)}</td>
                  </>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
        {resale && sec.sales > 0 && (
          <div className="text-xs text-gray-600 mt-1">
            Expected sales: LKR {fmt0(sec.sales)} | Margin: {sec.margin.toFixed(1)}%
            {sec.unpriced > 0 && ` | ${sec.unpriced} line${sec.unpriced === 1 ? '' : 's'} without a selling price (landed LKR ${fmt0(sec.unpricedLanded)}) not in profit`}
          </div>
        )}
      </div>
    );
  }

  const card = 'rounded-lg p-2 text-center border';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white shadow-2xl max-w-6xl w-full max-h-[95vh] overflow-hidden flex flex-col rounded-lg">
        <div className="flex items-center justify-between gap-2 p-3 border-b border-gray-200 print:hidden bg-gray-50">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 truncate">Costing Sheet - Batch {batchNumber}</h3>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleSavePdf}
              className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <FileDown className="w-4 h-4" />
              <span className="hidden sm:inline">Save PDF</span>
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors"
            >
              <Printer className="w-4 h-4" />
              <span className="hidden sm:inline">Print</span>
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
          <div className="p-4 sm:p-6 print:p-4" id="costing-duty-content" style={{ fontFamily: 'Arial, sans-serif' }}>
            <div className="text-center mb-5">
              <div className="text-base font-bold text-gray-900">{company.name}</div>
              {company.address && <div className="text-xs text-gray-500">{company.address}</div>}
              <h1 className="text-xl font-bold text-gray-900 mt-1">COSTING SHEET</h1>
              <div className="text-sm text-gray-600 mt-1">{isShipment ? 'Batch / Shipment' : 'Batch'}: {batchNumber}</div>
              <div className="text-xs text-gray-500">Date: {new Date().toLocaleDateString('en-GB')}</div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3 text-sm">
              <div className={`${card} bg-blue-50 border-blue-100`}>
                <p className="text-xs text-blue-700 font-medium">Items cost</p>
                <p className="font-bold text-blue-900">LKR {fmt0(summary.itemsCost)}</p>
              </div>
              <div className={`${card} bg-amber-50 border-amber-100`}>
                <p className="text-xs text-amber-700 font-medium">Shipping charges on items</p>
                <p className="font-bold text-amber-900">LKR {fmt0(summary.shipping)}</p>
              </div>
              <div className={`${card} bg-green-50 border-green-100`}>
                <p className="text-xs text-green-700 font-medium">Total landed</p>
                <p className="font-bold text-green-900">LKR {fmt0(summary.landed)}</p>
              </div>
              <div className={`${card} bg-teal-50 border-teal-100`}>
                <p className="text-xs text-teal-700 font-medium">Expected sales (resale)</p>
                <p className="font-bold text-teal-900">LKR {fmt0(summary.sales)}</p>
              </div>
              <div className={`${card} bg-purple-50 border-purple-100`}>
                <p className="text-xs text-purple-700 font-medium">To factory at landed</p>
                <p className="font-bold text-purple-900">LKR {fmt0(summary.factory)}</p>
              </div>
              <div className={`${card} ${summary.profit >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
                <p className={`text-xs font-medium ${summary.profit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>Expected profit</p>
                <p className={`font-bold ${summary.profit >= 0 ? 'text-emerald-900' : 'text-red-900'}`}>
                  LKR {fmt0(summary.profit)}{summary.sales > 0 ? ` (${summary.margin.toFixed(1)}%)` : ''}
                </p>
              </div>
            </div>
            <p className="text-[10px] text-gray-500 mb-5">
              {summary.lines} lines. Landed per unit = cost LKR (CNY price x rate) + shipping per unit (item charge from Shipping / qty).
              {summary.unpriced > 0 && ` ${summary.unpriced} resale line${summary.unpriced === 1 ? ' has' : 's have'} no selling price yet and ${summary.unpriced === 1 ? 'is' : 'are'} not in profit.`}
            </p>

            {renderTable('RESALE ITEMS', resaleRecords, true)}
            {renderTable('FACTORY USE ITEMS', factoryRecords, false)}
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
