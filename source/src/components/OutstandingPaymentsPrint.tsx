import { X, Printer, FileDown } from 'lucide-react';
import { saveAsPdf } from '../lib/pdfUtils';
import { companyFor } from '../lib/company';

interface BillDetail {
  id: string;
  bill_number: string;
  cnv_invoice_number: string | null;
  bill_date: string;
  due_date: string | null;
  status: string;
  amount_paid: number;
  total_amount: number;
  pending_amount: number;
  batch_number: string | null;
  po_number: string | null;
}

interface SupplierPayment {
  supplier_id: string;
  supplier_name: string;
  total_pending: number;
  total_paid: number;
  bills_count: number;
  oldest_bill_date: string;
  bills: BillDetail[];
  overpayment: number;
}

interface OutstandingPaymentsPrintProps {
  suppliers: SupplierPayment[];
  batchFilter?: string;
  onClose: () => void;
}

export default function OutstandingPaymentsPrint({ suppliers: allSuppliers, batchFilter, onClose }: OutstandingPaymentsPrintProps) {
  // only bills that still owe are printed, so every total below is the sum of the printed rows
  const suppliers = allSuppliers.map((s) => {
    const bills = s.bills.filter((b) => b.pending_amount > 0);
    return {
      ...s,
      bills,
      bills_count: bills.length,
      total_pending: bills.reduce((t, b) => t + b.pending_amount, 0),
      total_paid: bills.reduce((t, b) => t + b.amount_paid, 0),
      oldest_bill_date: bills.reduce((o, b) => (b.bill_date && b.bill_date < o ? b.bill_date : o), bills[0]?.bill_date ?? ''),
    };
  }).filter((s) => s.bills.length > 0);
  const totalPending = suppliers.reduce((sum, s) => sum + s.total_pending, 0);
  const totalPaid = suppliers.reduce((sum, s) => sum + s.total_paid, 0);
  const totalBills = suppliers.reduce((sum, s) => sum + s.bills_count, 0);

  function handlePrint() {
    window.print();
  }

  function handleSavePdf() {
    saveAsPdf('outstanding-payments-content', `Outstanding_Payments${batchFilter ? '_Batch' + batchFilter : ''}_${new Date().toISOString().split('T')[0]}.pdf`);
  }

  function formatCurrency(amount: number) {
    return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function getDaysAgo(dateStr: string) {
    const date = new Date(dateStr);
    if (!dateStr || isNaN(date.getTime())) return '-';
    const today = new Date();
    const diffTime = today.getTime() - date.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white shadow-2xl max-w-5xl w-full max-h-[95vh] overflow-hidden flex flex-col rounded-lg">
        <div className="flex items-center justify-between p-3 border-b border-gray-200 print:hidden bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-900">Outstanding Payments Report</h3>
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
          <div className="p-6 print:p-4" id="outstanding-payments-content" style={{ fontFamily: "'IBM Plex Sans', Arial, sans-serif" }}>
            <div className="text-center mb-5">
              <div className="text-base font-bold text-gray-900">{companyFor().name}</div>
              <h1 className="text-xl font-bold text-gray-900">SUPPLIER OUTSTANDING PAYMENTS</h1>
              {batchFilter && <div className="text-sm text-gray-600">Batch: {batchFilter}</div>}
              <div className="text-xs text-gray-500">As of: {new Date().toLocaleDateString('en-GB')}</div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-6 text-sm">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                <p className="text-xs text-amber-600 font-medium">Total Outstanding</p>
                <p className="text-lg font-bold text-amber-800">CNY {formatCurrency(totalPending)}</p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                <p className="text-xs text-green-600 font-medium">Paid on these bills</p>
                <p className="text-lg font-bold text-green-800">CNY {formatCurrency(totalPaid)}</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                <p className="text-xs text-blue-600 font-medium">Suppliers / Bills</p>
                <p className="text-lg font-bold text-blue-800">{suppliers.length} / {totalBills}</p>
              </div>
            </div>

            {suppliers.map((supplier) => (
              <div key={supplier.supplier_id} className="mb-5">
                <div className="flex items-center justify-between bg-gray-100 px-3 py-2 rounded-t-lg border border-gray-300">
                  <div>
                    <span className="font-bold text-gray-900">{supplier.supplier_name}</span>
                    <span className="text-xs text-gray-500 ml-3">
                      {supplier.bills_count} bill{supplier.bills_count > 1 ? 's' : ''} | Oldest: {getDaysAgo(supplier.oldest_bill_date)} days
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-amber-700">CNY {formatCurrency(supplier.total_pending)}</span>
                  </div>
                </div>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-300 p-1.5 text-left">Bill #</th>
                      <th className="border border-gray-300 p-1.5 text-left">Invoice #</th>
                      <th className="border border-gray-300 p-1.5 text-center">Date</th>
                      <th className="border border-gray-300 p-1.5 text-center">Batch</th>
                      <th className="border border-gray-300 p-1.5 text-center">Status</th>
                      <th className="border border-gray-300 p-1.5 text-right">Total</th>
                      <th className="border border-gray-300 p-1.5 text-right">Paid</th>
                      <th className="border border-gray-300 p-1.5 text-right">Pending</th>
                      <th className="border border-gray-300 p-1.5 text-center">Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supplier.bills.map((bill, idx) => (
                      <tr key={bill.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="border border-gray-300 p-1.5">{bill.bill_number}</td>
                        <td className="border border-gray-300 p-1.5">{bill.cnv_invoice_number || '-'}</td>
                        <td className="border border-gray-300 p-1.5 text-center">{bill.bill_date && !isNaN(new Date(bill.bill_date).getTime()) ? new Date(bill.bill_date).toLocaleDateString('en-GB') : '-'}</td>
                        <td className="border border-gray-300 p-1.5 text-center">{bill.batch_number || '-'}</td>
                        <td className="border border-gray-300 p-1.5 text-center capitalize">{bill.status}</td>
                        <td className="border border-gray-300 p-1.5 text-right">{formatCurrency(bill.total_amount)}</td>
                        <td className="border border-gray-300 p-1.5 text-right text-green-700">{formatCurrency(bill.amount_paid)}</td>
                        <td className="border border-gray-300 p-1.5 text-right font-medium text-amber-700">{formatCurrency(bill.pending_amount)}</td>
                        <td className="border border-gray-300 p-1.5 text-center">{getDaysAgo(bill.bill_date)}d</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-100 font-semibold">
                      <td className="border border-gray-300 p-1.5" colSpan={5}>Supplier total</td>
                      <td className="border border-gray-300 p-1.5 text-right">{formatCurrency(supplier.bills.reduce((t, b) => t + b.total_amount, 0))}</td>
                      <td className="border border-gray-300 p-1.5 text-right text-green-700">{formatCurrency(supplier.total_paid)}</td>
                      <td className="border border-gray-300 p-1.5 text-right text-amber-700">{formatCurrency(supplier.total_pending)}</td>
                      <td className="border border-gray-300 p-1.5"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ))}

            {suppliers.length === 0 && (
              <p className="text-center text-sm text-gray-500 py-8">Nothing outstanding for the bills shown.</p>
            )}

            <div className="mt-6 pt-4 border-t-2 border-gray-800">
              <div className="flex justify-between text-sm font-bold">
                <span>GRAND TOTAL OUTSTANDING:</span>
                <span className="text-amber-700">CNY {formatCurrency(totalPending)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #outstanding-payments-content, #outstanding-payments-content * { visibility: visible; }
          #outstanding-payments-content { position: absolute; left: 0; top: 0; width: 100%; padding: 20px !important; }
          .print\\:hidden { display: none !important; }
          @page { size: A4; margin: 10mm; }
        }
      `}</style>
    </div>
  );
}
