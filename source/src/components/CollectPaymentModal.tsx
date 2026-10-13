import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X, DollarSign, CreditCard, Building2, Banknote, Calendar, FileText, Loader as Loader2 } from 'lucide-react';

interface Invoice {
  id: string;
  voucher_no: string;
  date: string;
  total_amount: number;
  total_paid: number;
  sell_due: number;
}

interface CollectPaymentModalProps {
  customerName: string;
  customerId: string | null;
  invoices: Invoice[];
  openingBalance: number;
  onClose: () => void;
  onPaymentRecorded: () => void;
}

type PaymentMode = 'cash' | 'cheque' | 'bank_transfer' | 'online';

export default function CollectPaymentModal({
  customerName,
  customerId,
  invoices,
  openingBalance,
  onClose,
  onPaymentRecorded,
}: CollectPaymentModalProps) {
  const [selectedInvoice, setSelectedInvoice] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const ALL = '__all__';
  const OPENING = '__opening__';
  const selectedInvoiceData = invoices.find(inv => inv.id === selectedInvoice);
  const sortedInvoices = [...invoices].filter(i => i.sell_due > 0).sort((a, b) => a.date.localeCompare(b.date));
  const totalDue = sortedInvoices.reduce((t, i) => t + i.sell_due, 0);
  const maxAmount = selectedInvoice === ALL ? totalDue + openingBalance : selectedInvoiceData ? selectedInvoiceData.sell_due : openingBalance;

  // Preview of how a bulk amount will be split, oldest invoice first
  function allocate(total: number) {
    let left = total;
    const parts: { inv: Invoice; amount: number }[] = [];
    for (const inv of sortedInvoices) {
      if (left <= 0) break;
      const a = Math.min(inv.sell_due, left);
      parts.push({ inv, amount: a });
      left -= a;
    }
    return { parts, onAccount: Math.max(0, left) };
  }
  const bulkPreview = selectedInvoice === ALL && parseFloat(amount) > 0 ? allocate(parseFloat(amount)) : null;

  useEffect(() => {
    if (invoices.length === 1) {
      setSelectedInvoice(invoices[0].id);
    } else if (invoices.length > 1) {
      setSelectedInvoice(ALL);
    }
  }, [invoices]);

  function formatCurrency(amount: number) {
    return 'LKR ' + new Intl.NumberFormat('en-LK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const paymentAmount = parseFloat(amount);
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      setError('Please enter a valid payment amount');
      return;
    }

    if (!selectedInvoice && invoices.length > 0) {
      setError('Please select an invoice');
      return;
    }

    if (paymentAmount > maxAmount) {
      setError(`Payment amount cannot exceed ${formatCurrency(maxAmount)}`);
      return;
    }

    setSaving(true);

    // Generate payment number
    const today = new Date();
    const prefix = `PAY-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;
    const { data: lastPay } = await supabase
      .from('busy_sales_payments')
      .select('payment_number')
      .like('payment_number', `${prefix}%`)
      .order('payment_number', { ascending: false })
      .limit(1);
    const nextNum = lastPay && lastPay.length > 0 && lastPay[0].payment_number
      ? parseInt(lastPay[0].payment_number.split('-').pop() || '0') + 1
      : 1;
    const paymentNumber = `${prefix}-${String(nextNum).padStart(4, '0')}`;

    if (selectedInvoice === ALL) {
      // Bulk payment: split across invoices oldest first, remainder goes on account
      const { parts, onAccount } = allocate(paymentAmount);
      const base = {
        customer_id: customerId || null,
        customer_name: customerName,
        payment_date: paymentDate,
        payment_mode: paymentMode,
        reference_number: referenceNumber || null,
        cheque_number: paymentMode === 'cheque' ? referenceNumber || '' : '',
        cheque_status: 'realised',
      };
      const total = parts.length + (onAccount > 0 ? 1 : 0);
      const rows = parts.map((pt, i) => ({
        ...base,
        payment_number: `${prefix}-${String(nextNum + i).padStart(4, '0')}`,
        sales_invoice_id: pt.inv.id,
        amount: pt.amount,
        notes: `${notes ? notes + ' — ' : ''}Bulk payment ${formatCurrency(paymentAmount)} (${i + 1}/${total}) → ${pt.inv.voucher_no}`,
      }));
      if (onAccount > 0) {
        rows.push({
          ...base,
          payment_number: `${prefix}-${String(nextNum + parts.length).padStart(4, '0')}`,
          sales_invoice_id: null as unknown as string,
          amount: onAccount,
          notes: `${notes ? notes + ' — ' : ''}Bulk payment ${formatCurrency(paymentAmount)} (${total}/${total}) → on account`,
        });
      }
      if (rows.length === 0) {
        setError('Nothing to pay');
        setSaving(false);
        return;
      }
      const { error: insertError } = await supabase.from('busy_sales_payments').insert(rows);
      if (insertError) {
        setError('Failed to record payment: ' + insertError.message);
        setSaving(false);
        return;
      }
    } else if (selectedInvoice && selectedInvoice !== OPENING) {
      // Payment against a busy_sales_invoice — trigger will update amounts
      const { error: insertError } = await supabase
        .from('busy_sales_payments')
        .insert({
          payment_number: paymentNumber,
          sales_invoice_id: selectedInvoice,
          customer_id: customerId || null,
          customer_name: customerName,
          payment_date: paymentDate,
          amount: paymentAmount,
          payment_mode: paymentMode,
          reference_number: referenceNumber || null,
          cheque_number: paymentMode === 'cheque' ? referenceNumber || '' : '',
          cheque_status: 'realised',
          notes: notes || null,
        });

      if (insertError) {
        setError('Failed to record payment: ' + insertError.message);
        setSaving(false);
        return;
      }
    } else if (openingBalance > 0 && customerId) {
      // Payment against opening balance: recorded as an "on account" payment so there is a receipt
      // and history; Outstanding subtracts these from the opening balance.
      const { error: insertError } = await supabase
        .from('busy_sales_payments')
        .insert({
          payment_number: paymentNumber,
          sales_invoice_id: null,
          customer_id: customerId,
          customer_name: customerName,
          payment_date: paymentDate,
          amount: paymentAmount,
          payment_mode: paymentMode,
          reference_number: referenceNumber || null,
          cheque_number: paymentMode === 'cheque' ? referenceNumber || '' : '',
          cheque_status: 'realised',
          notes: notes || null,
        });

      if (insertError) {
        setError('Failed to record payment: ' + insertError.message);
        setSaving(false);
        return;
      }
    } else {
      setError('Nothing was saved: please choose an invoice, or this customer has no opening balance to pay.');
      setSaving(false);
      return;
    }

    setSaving(false);
    onPaymentRecorded();
    onClose();
  }

  function handlePayFullAmount() {
    setAmount(maxAmount.toString());
  }

  const paymentModes = [
    { value: 'cash', label: 'Cash', icon: Banknote },
    { value: 'cheque', label: 'Cheque', icon: FileText },
    { value: 'bank_transfer', label: 'Bank Transfer', icon: Building2 },
    { value: 'online', label: 'Online', icon: CreditCard },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-xl">
              <DollarSign className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Collect Payment</h2>
              <p className="text-sm text-gray-500">{customerName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
          {invoices.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Invoice
              </label>
              <select
                value={selectedInvoice}
                onChange={(e) => setSelectedInvoice(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
              >
                <option value="">Choose an invoice...</option>
                {invoices.length > 1 && (
                  <option value={ALL}>All invoices — oldest first ({sortedInvoices.length} invoices, due {formatCurrency(totalDue)})</option>
                )}
                {invoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.voucher_no} - Due: {formatCurrency(inv.sell_due)}
                  </option>
                ))}
                {openingBalance > 0 && (
                  <option value={OPENING}>Opening Balance - Due: {formatCurrency(openingBalance)}</option>
                )}
              </select>
            </div>
          )}

          {invoices.length === 0 && openingBalance > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <p className="text-sm text-orange-700">
                This payment will be applied to the opening balance of{' '}
                <span className="font-semibold">{formatCurrency(openingBalance)}</span>
              </p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Payment Amount
              </label>
              <button
                type="button"
                onClick={handlePayFullAmount}
                className="text-xs text-green-600 hover:text-green-700 font-medium"
              >
                Pay Full ({formatCurrency(maxAmount)})
              </button>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">
                LKR
              </span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                step="0.01"
                min="0"
                max={maxAmount}
                className="w-full pl-14 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-lg font-semibold"
                required
              />
            </div>
            {maxAmount > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                Maximum: {formatCurrency(maxAmount)}
              </p>
            )}
            {bulkPreview && (
              <div className="mt-2 bg-green-50 border border-green-200 rounded-lg p-3 text-xs space-y-1">
                <p className="font-semibold text-green-800">This will be split as:</p>
                {bulkPreview.parts.map((pt) => (
                  <div key={pt.inv.id} className="flex justify-between text-gray-700">
                    <span>{pt.inv.voucher_no} <span className="text-gray-400">({pt.inv.date})</span>{pt.amount >= pt.inv.sell_due ? <span className="ml-1 text-green-700">paid in full</span> : <span className="ml-1 text-amber-700">part — {formatCurrency(pt.inv.sell_due - pt.amount)} still due</span>}</span>
                    <span className="font-medium">{formatCurrency(pt.amount)}</span>
                  </div>
                ))}
                {bulkPreview.onAccount > 0 && (
                  <div className="flex justify-between text-teal-800"><span>On account (extra)</span><span className="font-medium">{formatCurrency(bulkPreview.onAccount)}</span></div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Payment Mode
            </label>
            <div className="grid grid-cols-4 gap-2">
              {paymentModes.map((mode) => {
                const Icon = mode.icon;
                return (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => setPaymentMode(mode.value as PaymentMode)}
                    className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-colors ${
                      paymentMode === mode.value
                        ? 'border-green-500 bg-green-50 text-green-700'
                        : 'border-gray-200 hover:border-gray-300 text-gray-600'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-xs font-medium">{mode.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Payment Date
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Reference #
              </label>
              <input
                type="text"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder={paymentMode === 'cheque' ? 'Cheque number' : 'Transaction ref'}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes about this payment..."
              rows={2}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 resize-none"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
        </form>

        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-2xl flex gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors font-medium bg-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="payment-form"
            disabled={saving}
            onClick={handleSubmit}
            className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Recording...
              </>
            ) : (
              <>
                <DollarSign className="w-4 h-4" />
                Record Payment
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
