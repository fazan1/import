import { X, Printer, FileDown } from 'lucide-react';
import { saveAsPdf } from '../lib/pdfUtils';
import { companyFor } from '../lib/company';

interface PackingListItem {
  id: string;
  batch_number: string;
  packing_list_no: string;
  no_of_pkgs: number;
  item_name: string;
  quantity: number;
  unit: string;
  weight_kg: number;
  cbm: number;
  status: string;
  notes: string;
}

interface PackingListPrintProps {
  items: PackingListItem[];
  batchNumber: string;
  supplierName?: string;
  onClose: () => void;
}

export default function PackingListPrint({ items, batchNumber, supplierName, onClose }: PackingListPrintProps) {
  const company = companyFor((items[0] as { book?: string | null } | undefined)?.book);
  // Packages are entered once per PL number (on its first row), same as the screen — count them once
  const firstRowByPlNo = new Map<string, string>();
  items.forEach((item) => { if (!firstRowByPlNo.has(item.packing_list_no)) firstRowByPlNo.set(item.packing_list_no, item.id); });
  const isFirstOfPl = (item: PackingListItem) => firstRowByPlNo.get(item.packing_list_no) === item.id;
  const totalPkgs = items.reduce((sum, item) => sum + (isFirstOfPl(item) ? (item.no_of_pkgs || 0) : 0), 0);
  const totalQty = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
  const totalWeight = items.reduce((sum, item) => sum + (item.weight_kg || 0), 0);
  const totalCbm = items.reduce((sum, item) => sum + (item.cbm || 0), 0);

  const plNumbers = [...new Set(items.map(i => i.packing_list_no))];

  function handlePrint() {
    window.print();
  }

  function handleSavePdf() {
    saveAsPdf('packing-list-content', `PackingList_Batch${batchNumber}${supplierName ? '_' + supplierName : ''}.pdf`);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white shadow-2xl max-w-5xl w-full max-h-[95vh] overflow-hidden flex flex-col rounded-lg">
        <div className="flex items-center justify-between p-3 border-b border-gray-200 print:hidden bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-900">Packing List Preview</h3>
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
          <div className="p-6 print:p-4" id="packing-list-content" style={{ fontFamily: "'IBM Plex Sans', Arial, sans-serif" }}>
            <div className="text-center mb-6">
              <div className="text-lg font-bold text-gray-900">{company.name}</div>
              <div className="text-xs text-gray-600 mb-2">{company.address}</div>
              <h1 className="text-2xl font-bold text-gray-900">PACKING LIST</h1>
              <div className="text-sm text-gray-600 mt-1">Batch: {batchNumber}</div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
              <div className="space-y-1">
                {supplierName && (
                  <div><span className="font-semibold">Supplier:</span> {supplierName}</div>
                )}
                <div><span className="font-semibold">Packing List No(s):</span> {plNumbers.join(', ')}</div>
                <div><span className="font-semibold">Total Items:</span> {items.length}</div>
              </div>
              <div className="text-right space-y-1">
                <div><span className="font-semibold">Date:</span> {new Date().toLocaleDateString('en-GB')}</div>
                <div><span className="font-semibold">Total Packages:</span> {totalPkgs}</div>
              </div>
            </div>

            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-800 text-white">
                  <th className="border border-gray-600 p-2 text-center w-10">No.</th>
                  <th className="border border-gray-600 p-2 text-left">PL No.</th>
                  <th className="border border-gray-600 p-2 text-center w-16">Pkgs</th>
                  <th className="border border-gray-600 p-2 text-left">Description of Goods</th>
                  <th className="border border-gray-600 p-2 text-right w-20">Qty</th>
                  <th className="border border-gray-600 p-2 text-center w-16">Unit</th>
                  <th className="border border-gray-600 p-2 text-right w-24">Weight (KG)</th>
                  <th className="border border-gray-600 p-2 text-right w-20">CBM</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={item.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="border border-gray-300 p-2 text-center">{index + 1}</td>
                    <td className="border border-gray-300 p-2">{item.packing_list_no}</td>
                    <td className="border border-gray-300 p-2 text-center">{isFirstOfPl(item) ? (item.no_of_pkgs || '-') : ''}</td>
                    <td className="border border-gray-300 p-2">{item.item_name}</td>
                    <td className="border border-gray-300 p-2 text-right">{Number(item.quantity || 0).toLocaleString()}</td>
                    <td className="border border-gray-300 p-2 text-center">{item.unit}</td>
                    <td className="border border-gray-300 p-2 text-right">{item.weight_kg > 0 ? item.weight_kg.toFixed(2) : '-'}</td>
                    <td className="border border-gray-300 p-2 text-right">{item.cbm > 0 ? item.cbm.toFixed(4) : '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 font-bold">
                  <td className="border border-gray-400 p-2 text-center" colSpan={2}>TOTAL</td>
                  <td className="border border-gray-400 p-2 text-center">{totalPkgs}</td>
                  <td className="border border-gray-400 p-2"></td>
                  <td className="border border-gray-400 p-2 text-right">{totalQty.toLocaleString()}</td>
                  <td className="border border-gray-400 p-2"></td>
                  <td className="border border-gray-400 p-2 text-right">{totalWeight.toFixed(2)}</td>
                  <td className="border border-gray-400 p-2 text-right">{totalCbm.toFixed(4)}</td>
                </tr>
              </tfoot>
            </table>

            <div className="mt-8 grid grid-cols-2 text-sm">
              <div>
                <p className="font-semibold mb-1">Remarks:</p>
                <div className="border-b border-gray-400 w-48 mt-8"></div>
              </div>
              <div className="text-right">
                <p className="font-semibold mb-1">Authorized Signature:</p>
                <div className="border-b border-gray-400 w-48 ml-auto mt-8"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #packing-list-content, #packing-list-content * { visibility: visible; }
          #packing-list-content { position: absolute; left: 0; top: 0; width: 100%; padding: 20px !important; }
          .print\\:hidden { display: none !important; }
          @page { size: A4 landscape; margin: 10mm; }
        }
      `}</style>
    </div>
  );
}
