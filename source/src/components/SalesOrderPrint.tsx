import { useEffect, useState } from 'react';
import { X, Printer, FileDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { saveAsPdf } from '../lib/pdfUtils';

interface SOItem {
  id: string;
  item_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
}

interface LinkedPO {
  id: string;
  purchase_order_id: string;
  purchase_orders?: {
    id: string;
    order_date: string;
    status: string;
    suppliers?: { name: string };
  };
}

interface LinkedInvoice {
  id: string;
  invoice_number: string;
  customer_name: string;
  invoice_date: string;
  total_amount: number;
  status: string;
}

interface SalesOrder {
  id: string;
  order_number: string;
  order_date: string;
  customer_name: string;
  status: string;
  notes: string | null;
  total_amount: number;
  deal_type: string;
  linked_invoice_id: string | null;
  busy_sales_order_items?: SOItem[];
  so_po_links?: LinkedPO[];
}

interface SalesOrderPrintProps {
  orderId: string;
  onClose: () => void;
}

export default function SalesOrderPrint({ orderId, onClose }: SalesOrderPrintProps) {
  const [order, setOrder] = useState<SalesOrder | null>(null);
  const [linkedInvoice, setLinkedInvoice] = useState<LinkedInvoice | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOrder();
  }, [orderId]);

  async function loadOrder() {
    const { data } = await supabase
      .from('busy_sales_orders')
      .select(`
        *,
        busy_sales_order_items (*),
        so_po_links (
          id,
          purchase_order_id,
          purchase_orders (
            id,
            order_date,
            status,
            suppliers (name)
          )
        )
      `)
      .eq('id', orderId)
      .maybeSingle();

    if (data) {
      setOrder(data);
      if (data.linked_invoice_id) {
        const { data: inv } = await supabase
          .from('busy_sales_invoices')
          .select('id, invoice_number, customer_name, invoice_date, total_amount, status')
          .eq('id', data.linked_invoice_id)
          .maybeSingle();
        if (inv) setLinkedInvoice(inv);
      }
    }
    setLoading(false);
  }

  function handlePrint() {
    window.print();
  }

  function handleSavePdf() {
    saveAsPdf('sales-order-content', `SalesOrder_${order?.order_number || 'document'}.pdf`);
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-white border-t-transparent"></div>
      </div>
    );
  }

  if (!order) return null;

  const items = order.busy_sales_order_items || [];
  const totalQty = items.reduce((s, i) => s + Number(i.quantity), 0);
  const totalValue = items.reduce((s, i) => s + Number(i.total), 0);
  const isDouble = order.deal_type === 'double';
  const linkedPOs = order.so_po_links?.filter(l => l.purchase_orders) || [];

  const statusColors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800',
    confirmed: 'bg-blue-100 text-blue-800',
    invoiced: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
  };

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
        id="sales-order-content"
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl print:shadow-none print:rounded-none print:max-w-full"
        style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}
      >
        {/* Header */}
        <div className="p-8 pb-4 border-b-2 border-gray-900 print:p-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 tracking-tight">SALES ORDER</h1>
              <p className="text-gray-500 mt-1 text-sm">SL Portal — Sales Document</p>
            </div>
            <div className="text-right space-y-1">
              <div>
                <span className="text-xs text-gray-500 uppercase tracking-wide">Order No.</span>
                <p className="font-bold text-teal-700 text-lg">{order.order_number}</p>
              </div>
              {isDouble && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-800">
                  Double Deal
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 mt-6">
            <div className="space-y-1">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Customer</p>
              <p className="text-xl font-bold text-gray-900">{order.customer_name}</p>
            </div>
            <div className="space-y-1 text-right">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Order Details</p>
              <p className="text-sm text-gray-700">
                <span className="font-medium">Date:</span>{' '}
                {new Date(order.order_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColors[order.status] || 'bg-gray-100 text-gray-800'}`}>
                {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
              </span>
            </div>
          </div>

          {/* Linked invoice (double deal) */}
          {linkedInvoice && (
            <div className="no-print mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">Linked Invoice</p>
              <div className="flex items-center justify-between px-3 py-2 bg-teal-50 border border-teal-200 rounded-lg">
                <div>
                  <p className="font-semibold text-teal-800 text-sm">{linkedInvoice.invoice_number}</p>
                  <p className="text-xs text-teal-600">{linkedInvoice.customer_name}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-teal-800 text-sm">
                    LKR {Number(linkedInvoice.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-teal-600 capitalize">{linkedInvoice.status}</p>
                </div>
              </div>
            </div>
          )}

          {/* Linked POs */}
          {linkedPOs.length > 0 && (
            <div className="no-print mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">Linked Purchase Orders</p>
              <div className="flex flex-wrap gap-2">
                {linkedPOs.map((link, i) => (
                  <span key={i} className="px-2.5 py-1 bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded-lg font-medium">
                    {link.purchase_orders!.suppliers?.name} — {new Date(link.purchase_orders!.order_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
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
                <th className="text-right px-3 py-2.5 font-semibold">Unit Price (LKR)</th>
                <th className="text-right px-3 py-2.5 rounded-tr-lg font-semibold">Total (LKR)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-2.5 text-gray-500">{idx + 1}</td>
                  <td className="px-3 py-2.5 font-medium text-gray-900">{item.item_name}</td>
                  <td className="px-3 py-2.5 text-center text-gray-600">{item.unit}</td>
                  <td className="px-3 py-2.5 text-right text-gray-700">{Number(item.quantity).toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right text-gray-700">
                    {Number(item.unit_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-gray-900">
                    {Number(item.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-900 bg-gray-50 font-semibold">
                <td className="px-3 py-3 text-gray-700" colSpan={3}>TOTALS</td>
                <td className="px-3 py-3 text-right text-gray-900">{totalQty.toLocaleString()}</td>
                <td className="px-3 py-3"></td>
                <td className="px-3 py-3 text-right text-gray-900 text-base">
                  LKR {totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total Qty</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{totalQty.toLocaleString()}</p>
            </div>
            <div className="border border-gray-200 rounded-lg p-4 text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Deal Type</p>
              <p className="text-2xl font-bold text-gray-900 mt-1 capitalize">{order.deal_type}</p>
            </div>
          </div>

          {/* Grand total */}
          <div className="mt-4 flex justify-end">
            <div className="bg-gray-900 text-white rounded-xl px-8 py-4 text-right">
              <p className="text-xs uppercase tracking-widest text-gray-400 mb-1">Order Total</p>
              <p className="text-3xl font-bold">
                LKR {totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
            <span>SL Portal — Sales Order</span>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #sales-order-content, #sales-order-content * { visibility: visible; }
          #sales-order-content {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 20px !important;
          }
          .no-print,
          .no-print *,
          #sales-order-content .no-print,
          #sales-order-content .no-print * { display: none !important; visibility: hidden !important; }
          @page { size: A4; margin: 15mm; }
        }
      `}</style>
    </div>
  );
}
