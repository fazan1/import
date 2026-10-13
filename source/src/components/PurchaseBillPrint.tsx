import { X, Printer, FileDown } from 'lucide-react';
import { saveAsPdf } from '../lib/pdfUtils';

interface BillItem {
  id: string;
  item_name: string;
  quantity_received: number;
  unit_price_cny: number;
}

interface Supplier {
  id: string;
  name: string;
  currency: string;
}

interface PurchaseBill {
  id: string;
  bill_number: string | null;
  cnv_invoice_number: string | null;
  batch_number: string | null;
  bill_date: string;
  due_date: string | null;
  status: string;
  exchange_rate: number;
  amount_paid: number;
  notes: string | null;
}

interface PurchaseBillPrintProps {
  bill: PurchaseBill;
  items: BillItem[];
  supplier: Supplier | null;
  onClose: () => void;
  companyName?: string;
  companyAddress?: string;
}

const numberToWords = (num: number): string => {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
                'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  if (num === 0) return 'Zero';

  const convertLessThanThousand = (n: number): string => {
    if (n === 0) return '';
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + ones[n % 10] : '');
    return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 !== 0 ? ' ' + convertLessThanThousand(n % 100) : '');
  };

  const intPart = Math.floor(num);

  if (intPart >= 10000000) {
    const crores = Math.floor(intPart / 10000000);
    const remainder = intPart % 10000000;
    return convertLessThanThousand(crores) + ' Crore' + (remainder > 0 ? ' ' + numberToWords(remainder) : '');
  }
  if (intPart >= 100000) {
    const lakhs = Math.floor(intPart / 100000);
    const remainder = intPart % 100000;
    return convertLessThanThousand(lakhs) + ' Lakh' + (remainder > 0 ? ' ' + numberToWords(remainder) : '');
  }
  if (intPart >= 1000) {
    const thousands = Math.floor(intPart / 1000);
    const remainder = intPart % 1000;
    return convertLessThanThousand(thousands) + ' Thousand' + (remainder > 0 ? ' ' + convertLessThanThousand(remainder) : '');
  }
  return convertLessThanThousand(intPart);
};

export default function PurchaseBillPrint({
  bill,
  items,
  supplier,
  onClose,
  companyName = 'HDR & CO',
  companyAddress = 'NO 149/5 New Chetty Street Col 11'
}: PurchaseBillPrintProps) {
  const now = new Date();
  const timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  const subtotal = items.reduce((sum, item) => sum + (item.quantity_received * item.unit_price_cny), 0);
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity_received, 0);
  const totalAmount = subtotal;
  const totalInWords = numberToWords(totalAmount) + ' Only';
  const currency = supplier?.currency || 'CNY';

  function handlePrint() {
    window.print();
  }

  function handleSavePdf() {
    saveAsPdf('purchase-bill-content', `Bill_${bill.cnv_invoice_number || bill.bill_number || 'document'}.pdf`);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white shadow-2xl max-w-4xl w-full max-h-[95vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-3 border-b border-gray-200 print:hidden bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-900">Purchase Bill Preview</h3>
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
          <div className="p-6 print:p-4" id="purchase-bill-content" style={{ fontFamily: 'Arial, sans-serif' }}>
            <div className="flex justify-between items-start mb-1">
              <div className="text-sm">
                <span className="font-medium">Bill No. :</span> {bill.bill_number || '-'}
                {bill.cnv_invoice_number && (
                  <span className="ml-4 font-bold text-base">{bill.cnv_invoice_number}</span>
                )}
              </div>
              <div className="text-sm italic">Original Copy</div>
            </div>

            <div className="text-center mb-4">
              <div className="text-lg font-medium">&lt;&lt; PURCHASE BILL &gt;&gt;</div>
              <div className="text-2xl font-bold">{companyName}</div>
              <div className="text-sm">{companyAddress}</div>
            </div>

            <div className="border border-black mb-0">
              <div className="grid grid-cols-2 border-b border-black">
                <div className="p-2 border-r border-black">
                  <div className="font-semibold italic">Supplier Details :</div>
                  <div className="text-base font-medium mt-1">{supplier?.name || 'Unknown Supplier'}</div>
                  <div className="mt-8">
                    <div className="text-sm">Batch No. <span className="ml-8">:</span> {bill.batch_number || '-'}</div>
                  </div>
                  <div className="mt-2">
                    <div className="text-sm">Currency <span className="ml-8">:</span> {currency}</div>
                  </div>
                </div>
                <div className="p-2">
                  <div className="grid grid-cols-3 gap-1 text-sm">
                    <div>CNV Inv. No.</div>
                    <div className="font-bold">: {bill.cnv_invoice_number || '-'}</div>
                    <div></div>
                    <div>Bill No.</div>
                    <div>: {bill.bill_number || '-'}</div>
                    <div></div>
                    <div>Dated</div>
                    <div>: {new Date(bill.bill_date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-')}</div>
                    <div>( {timeString} )</div>
                    <div>Due Date</div>
                    <div>: {bill.due_date ? new Date(bill.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-') : '-'}</div>
                    <div></div>
                  </div>
                </div>
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black bg-gray-100">
                    <th className="border-r border-black p-1 text-left w-10 font-semibold">S.N.</th>
                    <th className="border-r border-black p-1 text-left font-semibold">Description of Goods</th>
                    <th className="border-r border-black p-1 text-right w-16 font-semibold">Qty.</th>
                    <th className="border-r border-black p-1 text-left w-12 font-semibold">Unit</th>
                    <th className="border-r border-black p-1 text-right w-20 font-semibold">Price</th>
                    <th className="p-1 text-right w-28 font-semibold">Amount({currency})</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={item.id} className="border-b border-gray-300">
                      <td className="border-r border-black p-1 text-center">{index + 1}.</td>
                      <td className="border-r border-black p-1">{item.item_name}</td>
                      <td className="border-r border-black p-1 text-right">{item.quantity_received.toFixed(1)}</td>
                      <td className="border-r border-black p-1">PCS</td>
                      <td className="border-r border-black p-1 text-right">{item.unit_price_cny.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="p-1 text-right">{(item.quantity_received * item.unit_price_cny).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                  {Array.from({ length: Math.max(0, 15 - items.length) }).map((_, index) => (
                    <tr key={`empty-${index}`} className="border-b border-gray-200">
                      <td className="border-r border-black p-1">&nbsp;</td>
                      <td className="border-r border-black p-1">&nbsp;</td>
                      <td className="border-r border-black p-1">&nbsp;</td>
                      <td className="border-r border-black p-1">&nbsp;</td>
                      <td className="border-r border-black p-1">&nbsp;</td>
                      <td className="p-1">&nbsp;</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="border-t border-black">
                <div className="grid grid-cols-6 text-sm">
                  <div className="col-span-4 border-r border-black p-1"></div>
                  <div className="border-r border-black p-1 text-right font-medium">Total</div>
                  <div className="p-1 text-right font-medium">{subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
                <div className="grid grid-cols-6 text-sm border-t border-black">
                  <div className="col-span-4 border-r border-black p-1 text-center italic">Less : Discount</div>
                  <div className="border-r border-black p-1"></div>
                  <div className="p-1 text-right">0.00</div>
                </div>
                <div className="grid grid-cols-6 text-sm border-t border-black font-bold">
                  <div className="col-span-2 border-r border-black p-2 text-center">Grand Total</div>
                  <div className="col-span-2 border-r border-black p-2 text-center">{totalQuantity.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} PCS</div>
                  <div className="col-span-2 p-2 text-right">{totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
              </div>
            </div>

            <div className="mt-2 text-sm">
              <div>{currency} {totalInWords}</div>
            </div>

            {bill.notes && (
              <div className="mt-2 text-sm">
                <span className="font-medium">Notes:</span> {bill.notes}
              </div>
            )}

            <div className="grid grid-cols-2 mt-4 border-t border-black pt-2">
              <div className="text-xs">
                <div className="font-semibold mb-1">Terms & Conditions</div>
                <div>E.& O.E.</div>
                <div>1. Please verify goods upon receipt.</div>
                <div>2. Payment due as per agreed terms.</div>
                <div>3. All disputes subject to local jurisdiction.</div>
              </div>
              <div className="text-right">
                <div className="text-sm mb-12">Authorized Signature :</div>
                <div className="font-bold">For {companyName}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #purchase-bill-content, #purchase-bill-content * {
            visibility: visible;
          }
          #purchase-bill-content {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 20px !important;
          }
          .print\\:hidden {
            display: none !important;
          }
          @page {
            size: A4;
            margin: 10mm;
          }
        }
      `}</style>
    </div>
  );
}
