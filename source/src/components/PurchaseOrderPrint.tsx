import { useEffect, useState } from 'react';
import { X, Printer, FileDown } from 'lucide-react';
import { saveAsPdf } from '../lib/pdfUtils';
import { supabase } from '../lib/supabase';
import { companyFor } from '../lib/company';

interface POItem {
  id: string;
  item_name: string;
  quantity: number;
  unit_price_cny: number;
  unit: string;
  weight_kg: number;
  cbm: number;
}

interface PurchaseOrder {
  id: string;
  order_date: string;
  status: string;
  notes: string | null;
  book?: string | null;
  total_weight_kg: number;
  total_cbm: number;
  suppliers?: { name: string; currency: string };
  purchase_order_items?: POItem[];
  purchase_bills?: {
    cnv_invoice_number: string | null;
    batch_number: string | null;
  }[];
  so_po_links?: {
    busy_sales_orders?: { order_number: string; customer_name: string } | null;
  }[];
}

interface PurchaseOrderPrintProps {
  orderId: string;
  onClose: () => void;
}

export default function PurchaseOrderPrint({ orderId, onClose }: PurchaseOrderPrintProps) {
  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  useEffect(() => {
    loadOrder();
  }, [orderId]);

  async function loadOrder() {
    const { data, error } = await supabase
      .from('purchase_orders')
      .select(`
        *,
        suppliers (name, currency),
        purchase_order_items (*),
        purchase_bills (cnv_invoice_number, batch_number),
        so_po_links (
          busy_sales_orders (order_number, customer_name)
        )
      `)
      .eq('id', orderId)
      .maybeSingle();

    if (data) setOrder(data);
    else setLoadErr(error?.message || 'This purchase order was not found (it may belong to another book).');
    setLoading(false);
  }

  function handlePrint() {
    window.print();
  }

  function handleSavePdf() {
    saveAsPdf('purchase-order-content', `PO_${order?.suppliers?.name || 'document'}_${(order?.order_date || '').slice(0, 10)}.pdf`);
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-white border-t-transparent"></div>
      </div>
    );
  }

  // without this the pop-up vanished silently and the Print button for this PO did nothing until another PO was printed
  if (!order) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl p-6 max-w-sm w-full text-center space-y-4">
          <p className="text-sm text-gray-700">Could not open this purchase order for printing. {loadErr}</p>
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Close</button>
        </div>
      </div>
    );
  }

  const company = companyFor(order.book);
  const currency = order.suppliers?.currency || 'CNY';
  const items = order.purchase_order_items || [];
  const totalQty = items.reduce((s, i) => s + Number(i.quantity), 0);
  const totalValue = items.reduce((s, i) => s + Number(i.quantity) * (Number(i.unit_price_cny) || 0), 0);
  const totalWeight = items.reduce((s, i) => s + (Number(i.weight_kg) || 0), 0);
  const totalCbm = items.reduce((s, i) => s + (Number(i.cbm) || 0), 0);
  const bill = order.purchase_bills?.[0];
  const linkedSOs = order.so_po_links?.filter(l => l.busy_sales_orders) || [];

  return (
    <div className="print-root fixed inset-0 bg-black bg-opacity-60 flex items-start justify-center z-50 p-4 overflow-y-auto">
      {/* Screen-only controls */}
      <div className="no-print sticky top-4 z-10 flex justify-end gap-2 w-full max-w-3xl mb-3">
        <button
          onClick={handleSavePdf}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-lg transition-colors"
        >
          <FileDown className="w-4 h-4" />
          Save PDF
        </button>
        <button
          onClick={handlePrint}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 shadow-lg transition-colors"
        >
          <Printer className="w-4 h-4" />
          Print
        </button>
        <button
          onClick={onClose}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white rounded-lg hover:bg-gray-50 shadow-lg border border-gray-200 transition-colors"
        >
          <X className="w-4 h-4" />
          Close
        </button>
      </div>

      {/* Printable document */}
      <div
        id="purchase-order-content"
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl print:shadow-none print:rounded-none print:max-w-full"
        style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}
      >
        {/* Header */}
        <div className="p-8 pb-4 border-b-2 border-gray-900 print:p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-lg font-bold text-gray-900">{company.name}</p>
              <p className="text-gray-500 text-xs mb-2">{company.address}</p>
              <h1 className="text-3xl font-bold text-gray-900 tracking-tight">PURCHASE ORDER</h1>
              <p className="text-gray-500 mt-1 text-sm">CN Portal — Internal Document</p>
            </div>
            <div className="text-right space-y-1">
              {bill?.cnv_invoice_number && (
                <div>
                  <span className="text-xs text-gray-500 uppercase tracking-wide">CNV Invoice</span>
                  <p className="font-bold text-teal-700 text-lg">{bill.cnv_invoice_number}</p>
                </div>
              )}
              {bill?.batch_number && (
                <div>
                  <span className="text-xs text-gray-500 uppercase tracking-wide">Batch</span>
                  <p className="font-semibold text-gray-800">{bill.batch_number}</p>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 mt-6">
            <div className="space-y-1">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Supplier</p>
              <p className="text-xl font-bold text-gray-900">{order.suppliers?.name || '—'}</p>
              <p className="text-sm text-gray-500">Currency: {currency}</p>
            </div>
            <div className="space-y-1 text-right">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Order Details</p>
              <p className="text-sm text-gray-700">
                <span className="font-medium">Date:</span>{' '}
                {new Date(String(order.order_date).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                order.status === 'completed' ? 'bg-green-100 text-green-800' :
                order.status === 'shipped' ? 'bg-blue-100 text-blue-800' :
                'bg-amber-100 text-amber-800'
              }`}>
                {(order.status || 'pending').charAt(0).toUpperCase() + (order.status || 'pending').slice(1)}
              </span>
            </div>
          </div>

          {linkedSOs.length > 0 && (
            <div className="no-print mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">Linked Sales Orders</p>
              <div className="flex flex-wrap gap-2">
                {linkedSOs.map((link, i) => (
                  <span key={i} className="px-2.5 py-1 bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded-lg font-medium">
                    {link.busy_sales_orders!.order_number}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Items table */}
        <div className="p-8 pt-5 print:p-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-900 text-white">
                <th className="text-left px-3 py-2.5 rounded-tl-lg font-semibold">#</th>
                <th className="text-left px-3 py-2.5 font-semibold">Item Description</th>
                <th className="text-center px-3 py-2.5 font-semibold">Unit</th>
                <th className="text-right px-3 py-2.5 font-semibold">Qty</th>
                <th className="text-right px-3 py-2.5 font-semibold">Unit Price ({currency})</th>
                <th className="text-right px-3 py-2.5 font-semibold">Weight (KG)</th>
                <th className="text-right px-3 py-2.5 rounded-tr-lg font-semibold">Total ({currency})</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr
                  key={item.id}
                  className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                >
                  <td className="px-3 py-2.5 text-gray-500">{idx + 1}</td>
                  <td className="px-3 py-2.5 font-medium text-gray-900">{item.item_name}</td>
                  <td className="px-3 py-2.5 text-center text-gray-600">{item.unit}</td>
                  <td className="px-3 py-2.5 text-right text-gray-700">{Number(item.quantity).toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right text-gray-700">
                    {Number(item.unit_price_cny || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-500">
                    {Number(item.weight_kg) > 0 ? Number(item.weight_kg).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-gray-900">
                    {(Number(item.quantity) * Number(item.unit_price_cny || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-900 bg-gray-50 font-semibold">
                <td className="px-3 py-3 text-gray-700" colSpan={3}>TOTALS</td>
                <td className="px-3 py-3 text-right text-gray-900">{totalQty.toLocaleString()}</td>
                <td className="px-3 py-3"></td>
                <td className="px-3 py-3 text-right text-gray-700">
                  {totalWeight > 0 ? totalWeight.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                </td>
                <td className="px-3 py-3 text-right text-gray-900 text-base">
                  {currency} {totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
            </tfoot>
          </table>

          {/* Summary boxes */}
          <div className="mt-6 grid grid-cols-3 gap-4">
            <div className="border border-gray-200 rounded-lg p-4 text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total Items</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{items.length}</p>
            </div>
            <div className="border border-gray-200 rounded-lg p-4 text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total Weight</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {(order.total_weight_kg > 0 ? order.total_weight_kg : totalWeight) > 0
                  ? `${(order.total_weight_kg > 0 ? order.total_weight_kg : totalWeight).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KG`
                  : '—'}
              </p>
            </div>
            <div className="border border-gray-200 rounded-lg p-4 text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total CBM</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {(order.total_cbm > 0 ? order.total_cbm : totalCbm) > 0
                  ? (order.total_cbm > 0 ? order.total_cbm : totalCbm).toFixed(3)
                  : '—'}
              </p>
            </div>
          </div>

          {/* Grand total */}
          <div className="mt-4 flex justify-end">
            <div className="bg-gray-900 text-white rounded-xl px-8 py-4 text-right">
              <p className="text-xs uppercase tracking-widest text-gray-400 mb-1">Order Total</p>
              <p className="text-3xl font-bold">
                {currency} {totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          {order.notes && (
            <div className="mt-5 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Notes</p>
              <p className="text-sm text-amber-900">{order.notes}</p>
            </div>
          )}

          {/* Footer */}
          <div className="mt-8 pt-5 border-t border-gray-200 flex items-center justify-between text-xs text-gray-400">
            <span>Generated {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
            <span>CN Portal — Purchase Order</span>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #purchase-order-content, #purchase-order-content * { visibility: visible; }
          #purchase-order-content {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 20px !important;
          }
          .no-print,
          .no-print *,
          #purchase-order-content .no-print,
          #purchase-order-content .no-print * { display: none !important; visibility: hidden !important; }
          @page { size: A4; margin: 15mm; }
        }
      `}</style>
    </div>
  );
}
