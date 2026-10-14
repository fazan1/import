import { X, Printer, FileDown } from 'lucide-react';
import { saveAsPdf } from '../lib/pdfUtils';
import { companyFor } from '../lib/company';

interface PackingListItem {
  id: string;
  item_name: string;
  quantity: number;
  unit: string;
  no_of_pkgs: number;
  cbm: number;
  weight_kg: number;
}

interface PackingList {
  id: string;
  packing_list_no: string;
  supplier_name: string;
  status: string;
  date: string;
  batch_number: string | null;
  total_cartons: number;
  total_cbm: number;
  total_weight: number;
  items: PackingListItem[];
}

interface SupplierShipments {
  supplier_name: string;
  total_shipments: number;
  total_cartons: number;
  total_cbm: number;
  packing_lists: PackingList[];
}

interface ShipmentHistoryPrintProps {
  shipments: SupplierShipments[];
  batchFilter?: string;
  totals: { shipments: number; cartons: number; cbm: number; weight: number };
  onClose: () => void;
}

export default function ShipmentHistoryPrint({ shipments, batchFilter, totals, onClose }: ShipmentHistoryPrintProps) {
  function handlePrint() {
    window.print();
  }

  function handleSavePdf() {
    saveAsPdf('shipment-history-content', `ShipmentHistory${batchFilter ? '_Batch' + batchFilter : ''}_${new Date().toISOString().split('T')[0]}.pdf`);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white shadow-2xl max-w-5xl w-full max-h-[95vh] overflow-hidden flex flex-col rounded-lg">
        <div className="flex items-center justify-between p-3 border-b border-gray-200 print:hidden bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-900">Shipment History Report</h3>
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
          <div className="p-6 print:p-4" id="shipment-history-content" style={{ fontFamily: "'IBM Plex Sans', Arial, sans-serif" }}>
            <div className="text-center mb-5">
              <div className="text-base font-bold text-gray-900">{companyFor().name}</div>
              <h1 className="text-xl font-bold text-gray-900">SHIPMENT HISTORY</h1>
              {batchFilter && <div className="text-sm text-gray-600">Batch: {batchFilter}</div>}
              <div className="text-xs text-gray-500">Generated: {new Date().toLocaleDateString('en-GB')}</div>
            </div>

            <div className="grid grid-cols-4 gap-3 mb-6 text-sm">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                <p className="text-xs text-blue-600 font-medium">Total Shipments</p>
                <p className="text-lg font-bold text-blue-800">{totals.shipments}</p>
              </div>
              <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 text-center">
                <p className="text-xs text-teal-600 font-medium">Total Cartons</p>
                <p className="text-lg font-bold text-teal-800">{totals.cartons.toLocaleString()}</p>
              </div>
              <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-3 text-center">
                <p className="text-xs text-cyan-600 font-medium">Total CBM</p>
                <p className="text-lg font-bold text-cyan-800">{totals.cbm.toFixed(3)}</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                <p className="text-xs text-amber-600 font-medium">Total Weight</p>
                <p className="text-lg font-bold text-amber-800">{totals.weight.toFixed(2)} KG</p>
              </div>
            </div>

            {shipments.map((supplier) => (
              <div key={supplier.supplier_name} className="mb-5">
                <div className="bg-gray-100 px-3 py-2 rounded-t-lg border border-gray-300">
                  <span className="font-bold text-gray-900">{supplier.supplier_name}</span>
                  <span className="text-xs text-gray-500 ml-3">
                    {supplier.total_shipments} shipment{supplier.total_shipments > 1 ? 's' : ''} | {supplier.total_cartons} cartons | {supplier.total_cbm.toFixed(3)} CBM
                  </span>
                </div>

                {supplier.packing_lists.map((pl) => (
                  <div key={pl.id} className="border-x border-b border-gray-300">
                    <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
                      <div className="flex items-center gap-3 text-xs">
                        <span className="font-medium">PL# {pl.packing_list_no}</span>
                        {pl.batch_number && <span className="text-gray-500">Batch: {pl.batch_number}</span>}
                        {pl.date && <span className="text-gray-500">{new Date(pl.date).toLocaleDateString('en-GB')}</span>}
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          pl.status === 'received' ? 'bg-green-100 text-green-700' :
                          pl.status === 'shipped' ? 'bg-cyan-100 text-cyan-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>{pl.status}</span>
                      </div>
                      <div className="text-xs text-gray-600">
                        {pl.total_cartons} pkgs | {pl.total_weight.toFixed(2)} KG | {pl.total_cbm.toFixed(4)} CBM
                      </div>
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-white">
                          <th className="p-1.5 text-left border-b border-gray-200 pl-6">Item</th>
                          <th className="p-1.5 text-right border-b border-gray-200 w-16">Qty</th>
                          <th className="p-1.5 text-center border-b border-gray-200 w-14">Unit</th>
                          <th className="p-1.5 text-right border-b border-gray-200 w-14">Pkgs</th>
                          <th className="p-1.5 text-right border-b border-gray-200 w-20">Weight</th>
                          <th className="p-1.5 text-right border-b border-gray-200 w-16">CBM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pl.items.map((item, idx) => (
                          <tr key={item.id} className={idx % 2 === 0 ? '' : 'bg-gray-50'}>
                            <td className="p-1.5 pl-6">{item.item_name}</td>
                            <td className="p-1.5 text-right">{Number(item.quantity || 0).toLocaleString()}</td>
                            <td className="p-1.5 text-center">{item.unit}</td>
                            <td className="p-1.5 text-right">{item.no_of_pkgs || '-'}</td>
                            <td className="p-1.5 text-right">{item.weight_kg > 0 ? item.weight_kg.toFixed(2) : '-'}</td>
                            <td className="p-1.5 text-right">{item.cbm > 0 ? item.cbm.toFixed(4) : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #shipment-history-content, #shipment-history-content * { visibility: visible; }
          #shipment-history-content { position: absolute; left: 0; top: 0; width: 100%; padding: 20px !important; }
          .print\\:hidden { display: none !important; }
          @page { size: A4; margin: 10mm; }
        }
      `}</style>
    </div>
  );
}
