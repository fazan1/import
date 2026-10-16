import { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Trash2, X, Check, CreditCard, Search, Printer } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { openingBal } from '../lib/book';
import { custKey, onAccountByCustomer, netOpening } from '../lib/receivables';
import { fetchAllPages } from '../lib/fetchAll';
import { esc } from '../lib/html';
import { moveToRecycleBin } from '../lib/recycleBin';
import { companyFor } from '../lib/company';

interface SalesInvoice {
  id: string;
  invoice_number: string;
  customer_id: string | null;
  customer_name: string;
  total_amount: number;
  amount_paid: number;
  amount_due: number;
  status: string;
}

interface Customer {
  id: string;
  name: string;
  opening_balance: number;
}

type ChequeStatus = 'pending' | 'realised' | 'returned';

interface SalesPayment {
  id: string;
  payment_number: string | null;
  payment_date: string;
  sales_invoice_id: string | null;
  customer_id: string | null;
  customer_name: string;
  amount: number;
  payment_mode: string;
  reference_number: string | null;
  notes: string | null;
  cheque_number: string | null;
  bank_name: string | null;
  cheque_date: string | null;
  cheque_status: ChequeStatus;
  created_at: string;
  book?: string | null;
  busy_sales_invoices?: { invoice_number: string; total_amount: number; amount_due: number } | null;
}

interface BusySalesPaymentsProps {
  preselectedInvoiceId?: string | null;
  onClearPreselection?: () => void;
}

const lkr = (n: number) => `LKR ${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// 'YYYY-MM-DD' is read as a LOCAL date (new Date('YYYY-MM-DD') is UTC midnight and can show the day before)
const fmtDate = (d: string | null) => (d ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00` : d).toLocaleDateString('en-GB') : '');
// today's LOCAL date (toISOString() is UTC: before 5:30 am in Sri Lanka it gives yesterday)
const localToday = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

function formatPaymentMode(mode: string): string {
  switch (mode) {
    case 'cash': return 'Cash';
    case 'cheque': return 'Cheque';
    case 'bank_transfer': return 'Bank Transfer';
    case 'online': return 'Online';
    default: return mode;
  }
}

export default function BusySalesPayments({ preselectedInvoiceId, onClearPreselection }: BusySalesPaymentsProps) {
  const [payments, setPayments] = useState<SalesPayment[]>([]);
  const [unpaidInvoices, setUnpaidInvoices] = useState<SalesInvoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [modeFilter, setModeFilter] = useState<'all' | 'cheques'>('all');

  // form
  const [kind, setKind] = useState<'invoice' | 'account'>('invoice');
  const [selectedInvoice, setSelectedInvoice] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [paymentDate, setPaymentDate] = useState(localToday());
  const [amount, setAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [notes, setNotes] = useState('');
  const savingRef = useRef(false); // double-click guard: state updates too late to stop a second click

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (preselectedInvoiceId && unpaidInvoices.length > 0) {
      const invoice = unpaidInvoices.find(inv => inv.id === preselectedInvoiceId);
      if (invoice) {
        setKind('invoice');
        handleSelectInvoice(preselectedInvoiceId);
        setShowForm(true);
        if (onClearPreselection) onClearPreselection();
      }
    }
  }, [preselectedInvoiceId, unpaidInvoices]);

  async function loadData() {
    setLoading(true);
    // fetchAllPages: no 1000-row cut-off (current book only, applied automatically); display order is sorted below
    const [paymentsRes, invoicesRes, customersRes] = await Promise.all([
      fetchAllPages<SalesPayment>(() => supabase
        .from('busy_sales_payments')
        .select('*, busy_sales_invoices (invoice_number, total_amount, amount_due)')
        .order('id')),
      fetchAllPages<SalesInvoice & { invoice_date?: string }>(() => supabase
        .from('busy_sales_invoices')
        .select('id, invoice_number, invoice_date, customer_id, customer_name, total_amount, amount_paid, amount_due, status')
        .neq('status', 'paid')
        .gt('amount_due', 0)
        .order('id')),
      fetchAllPages<Customer>(() => supabase.from('customers').select('id, name, opening_balance').order('id')),
    ]);
    const loadErr = paymentsRes.error || invoicesRes.error || customersRes.error;
    if (loadErr) alert(`Could not load sales payments: ${loadErr}`);
    setPayments([...paymentsRes.data].sort((a, b) => (b.payment_date || '').localeCompare(a.payment_date || '') || (b.created_at || '').localeCompare(a.created_at || '')));
    setUnpaidInvoices([...invoicesRes.data].sort((a, b) => (b.invoice_date || '').localeCompare(a.invoice_date || '')));
    setCustomers([...customersRes.data].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    setLoading(false);
  }

  async function generatePaymentNumber(): Promise<string> {
    const today = new Date();
    const prefix = `PAY-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;
    const { data } = await supabase
      .from('busy_sales_payments')
      .select('payment_number')
      .like('payment_number', `${prefix}%`)
      .order('payment_number', { ascending: false })
      .limit(1);
    let nextNum = 1;
    if (data && data.length > 0 && data[0].payment_number) {
      nextNum = parseInt(data[0].payment_number.split('-').pop() || '0') + 1;
    }
    return `${prefix}-${String(nextNum).padStart(4, '0')}`;
  }

  const selectedInvoiceData = useMemo(() => unpaidInvoices.find(i => i.id === selectedInvoice) || null, [unpaidInvoices, selectedInvoice]);
  const selectedCustomerData = useMemo(() => customers.find(c => c.id === selectedCustomer) || null, [customers, selectedCustomer]);

  // on-account money already received per customer (key = custKey(name); excludes returned cheques) — same rule as Customer Outstanding
  const onAccount = useMemo(() => onAccountByCustomer(payments), [payments]);

  function handleSelectInvoice(invoiceId: string) {
    setSelectedInvoice(invoiceId);
    const invoice = unpaidInvoices.find(inv => inv.id === invoiceId);
    setAmount(invoice ? String(invoice.amount_due) : '');
  }

  function resetForm() {
    setShowForm(false);
    setKind('invoice');
    setSelectedInvoice('');
    setSelectedCustomer('');
    setPaymentDate(localToday());
    setAmount('');
    setPaymentMode('cash');
    setReferenceNumber('');
    setChequeNumber('');
    setBankName('');
    setNotes('');
  }

  const isCheque = paymentMode === 'cheque';
  const canSave =
    parseFloat(amount) > 0 &&
    (kind === 'invoice' ? !!selectedInvoiceData : !!selectedCustomerData) &&
    (!isCheque || chequeNumber.trim().length > 0) &&
    !saving;

  async function handleSave() {
    if (!canSave || savingRef.current) return;
    const paymentAmount = parseFloat(amount);
    if (kind === 'invoice' && selectedInvoiceData && paymentAmount > selectedInvoiceData.amount_due + 0.005) {
      alert('Payment amount cannot exceed amount due');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    if (kind === 'invoice') {
      // re-read the balance: another screen/device may have taken a payment since this list loaded
      const { data: fresh, error: freshErr } = await supabase.from('busy_sales_invoices').select('amount_due').eq('id', selectedInvoice).maybeSingle();
      if (freshErr || !fresh || paymentAmount > Number(fresh.amount_due) + 0.005) {
        alert(freshErr ? `Could not check the invoice balance: ${freshErr.message}` : !fresh ? 'This invoice was not found (deleted?).' : `Payment amount cannot exceed amount due (now LKR ${Number(fresh.amount_due).toLocaleString()}).`);
        savingRef.current = false;
        setSaving(false);
        loadData();
        return;
      }
    }
    let error: { code?: string; message: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) { // receipt number taken at the same moment -> next number
    const paymentNumber = await generatePaymentNumber();
    ({ error } = await supabase.from('busy_sales_payments').insert({
      payment_number: paymentNumber,
      sales_invoice_id: kind === 'invoice' ? selectedInvoice : null,
      customer_id: kind === 'invoice' ? selectedInvoiceData?.customer_id || null : selectedCustomer,
      customer_name: kind === 'invoice' ? selectedInvoiceData?.customer_name : selectedCustomerData?.name,
      payment_date: paymentDate,
      amount: paymentAmount,
      payment_mode: paymentMode,
      reference_number: isCheque ? chequeNumber.trim() : referenceNumber.trim() || null,
      cheque_number: isCheque ? chequeNumber.trim() : '',
      bank_name: isCheque ? bankName.trim() : '',
      cheque_status: 'realised',
      notes: notes.trim() || null,
    }));
    if (!error || error.code !== '23505') break;
    }
    if (error) {
      console.error('Error creating payment:', error);
      alert(`Could not save payment: ${error.message}`);
      savingRef.current = false;
      setSaving(false);
      return;
    }
    savingRef.current = false;
    setSaving(false);
    resetForm();
    loadData();
  }

  async function handleDeletePayment(id: string) {
    if (!confirm('Delete this payment? Any invoice balance will be restored. It will be moved to the Recycle Bin.')) return;
    const p = payments.find(x => x.id === id);
    if (!p) return;
    const bin = await moveToRecycleBin({
      source_table: 'busy_sales_payments',
      source_id: id,
      record_data: p,
      display_name: `Payment ${p.payment_number || ''} - ${p.customer_name} - ${lkr(Number(p.amount) || 0)}`,
      portal: 'sl',
    });
    if (!bin.success) {
      alert('Failed to move to recycle bin: ' + bin.error);
      return;
    }
    const { error } = await supabase.from('busy_sales_payments').delete().eq('id', id);
    if (error) {
      console.error('Error deleting payment:', error);
      alert(`Could not delete payment: ${error.message}`);
    }
    loadData();
  }

  function printReceipt(p: SalesPayment) {
    const w = window.open('', '_blank', 'width=720,height=900');
    if (!w) { alert('Could not open the receipt window. Please allow pop-ups for this site and try again.'); return; }
    const co = companyFor(p.book); // shop-book receipts print BLINE Traders, not HDR & CO
    const applied = p.sales_invoice_id ? `Invoice ${p.busy_sales_invoices?.invoice_number || ''}` : 'On account (opening balance)';
    const modeLine = p.payment_mode === 'cheque'
      ? `Cheque No. ${p.cheque_number || p.reference_number || ''}${p.bank_name ? ` · ${p.bank_name}` : ''}`
      : `${formatPaymentMode(p.payment_mode)}${p.reference_number ? ` · Ref ${p.reference_number}` : ''}`;
    w.document.write(`<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"><title>Receipt ${esc(p.payment_number || '')}</title>
<style>
 body{font-family:'IBM Plex Sans',Arial,sans-serif;color:#111;margin:0;padding:32px;}
 .box{max-width:640px;margin:0 auto;border:1px solid #ccc;padding:28px 32px;}
 h1{font-size:22px;margin:0;} .addr{color:#555;font-size:12px;margin-top:2px;}
 .title{font-size:18px;font-weight:700;letter-spacing:2px;margin:20px 0 4px;} .no{color:#555;font-size:12px;}
 table{width:100%;border-collapse:collapse;margin-top:18px;font-size:14px;}
 td{padding:8px 0;border-bottom:1px solid #eee;vertical-align:top;} td:first-child{color:#555;width:38%;}
 .amt{font-size:24px;font-weight:700;margin-top:18px;}
 .foot{margin-top:40px;display:flex;justify-content:space-between;font-size:12px;color:#555;}
 .sig{border-top:1px solid #999;padding-top:6px;width:200px;text-align:center;}
 @media print{body{padding:0}.box{border:0}}
</style></head><body><div class="box">
 <h1>${esc(co.name)}</h1><div class="addr">${esc(co.address)}</div>
 <div class="title">PAYMENT RECEIPT</div><div class="no">${esc(p.payment_number || '')} · ${fmtDate(p.payment_date)}</div>
 <table>
  <tr><td>Received from</td><td><strong>${esc(p.customer_name || '')}</strong></td></tr>
  <tr><td>Applied to</td><td>${esc(applied)}</td></tr>
  <tr><td>Payment mode</td><td>${esc(modeLine)}</td></tr>
  ${p.notes ? `<tr><td>Notes</td><td>${esc(p.notes)}</td></tr>` : ''}
 </table>
 <div class="amt">${lkr(p.amount)}</div>
 <div class="foot"><div>Printed ${new Date().toLocaleString('en-GB')}</div><div class="sig">Authorised signature</div></div>
</div><script>window.onload=function(){window.print();}</script></body></html>`);
    w.document.close();
  }

  function getPaymentModeBadge(mode: string) {
    switch (mode) {
      case 'cash': return 'bg-green-100 text-green-800';
      case 'cheque': return 'bg-teal-100 text-teal-800';
      case 'bank_transfer': return 'bg-cyan-100 text-cyan-800';
      case 'online': return 'bg-teal-100 text-teal-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  }

  const filteredPayments = payments
    .filter(p => modeFilter === 'all' || p.payment_mode === 'cheque')
    .filter(p => {
      const q = searchTerm.trim().toLowerCase();
      if (!q) return true;
      return (
        (p.customer_name || '').toLowerCase().includes(q) ||
        p.payment_number?.toLowerCase().includes(q) ||
        p.busy_sales_invoices?.invoice_number?.toLowerCase().includes(q) ||
        (p.cheque_number || '').toLowerCase().includes(q) ||
        (p.reference_number || '').toLowerCase().includes(q)
      );
    });

  const totalReceived = payments.filter(p => p.cheque_status !== 'returned').reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-teal-600"></div>
      </div>
    );
  }

  const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Sales Payments</h2>
          <p className="text-sm text-gray-500 mt-1">
            Total received: <span className="font-semibold text-green-600">{lkr(totalReceived)}</span>
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-600 rounded-lg hover:from-teal-600 hover:to-cyan-700 transition-all shadow-lg"
        >
          <Plus className="w-4 h-4" />
          <span>Record Payment</span>
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Record Payment</h3>

          <div className="flex rounded-lg border border-gray-300 overflow-hidden mb-5 w-fit">
            <button type="button" onClick={() => setKind('invoice')} className={`px-4 py-2 text-sm font-medium ${kind === 'invoice' ? 'bg-teal-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>Against invoice</button>
            <button type="button" onClick={() => setKind('account')} className={`px-4 py-2 text-sm font-medium ${kind === 'account' ? 'bg-teal-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>On account (opening balance)</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {kind === 'invoice' ? (
              <>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Invoice *</label>
                  <select value={selectedInvoice} onChange={(e) => handleSelectInvoice(e.target.value)} className={input}>
                    <option value="">Select invoice...</option>
                    {unpaidInvoices.map(invoice => (
                      <option key={invoice.id} value={invoice.id}>
                        {invoice.invoice_number} - {invoice.customer_name} | Due: LKR {Number(invoice.amount_due || 0).toLocaleString()}
                      </option>
                    ))}
                  </select>
                  {unpaidInvoices.length === 0 && <p className="text-xs text-gray-500 mt-1">No unpaid invoices. Use "On account" for money against opening balances.</p>}
                </div>
                {selectedInvoiceData && (
                  <div className="md:col-span-2 p-4 bg-teal-50 border border-blue-200 rounded-lg">
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div><span className="text-teal-700 font-medium">Invoice Total:</span><p className="text-blue-900 font-semibold">LKR {Number(selectedInvoiceData.total_amount || 0).toLocaleString()}</p></div>
                      <div><span className="text-green-700 font-medium">Amount Paid:</span><p className="text-green-900 font-semibold">LKR {Number(selectedInvoiceData.amount_paid || 0).toLocaleString()}</p></div>
                      <div><span className="text-red-700 font-medium">Amount Due:</span><p className="text-red-900 font-semibold">LKR {Number(selectedInvoiceData.amount_due || 0).toLocaleString()}</p></div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Customer *</label>
                  <select value={selectedCustomer} onChange={(e) => setSelectedCustomer(e.target.value)} className={input}>
                    <option value="">Select customer...</option>
                    {customers.map(c => {
                      const left = netOpening(c.name, c.opening_balance, onAccount);
                      return (
                        <option key={c.id} value={c.id}>
                          {c.name}{openingBal(c.opening_balance) > 0 ? ` | Opening bal. left: LKR ${Math.max(0, left).toLocaleString()}` : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
                {selectedCustomerData && (
                  <div className="md:col-span-2 p-4 bg-teal-50 border border-blue-200 rounded-lg text-sm">
                    <span className="text-teal-700 font-medium">Opening balance:</span> LKR {openingBal(selectedCustomerData.opening_balance).toLocaleString()}
                    <span className="mx-2 text-blue-300">|</span>
                    <span className="text-green-700 font-medium">Received on account:</span> LKR {(onAccount.get(custKey(selectedCustomerData.name)) || 0).toLocaleString()}
                    <span className="mx-2 text-blue-300">|</span>
                    <span className="text-red-700 font-medium">Still owed:</span> LKR {Math.max(0, netOpening(selectedCustomerData.name, selectedCustomerData.opening_balance, onAccount)).toLocaleString()}
                  </div>
                )}
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date</label>
              <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className={input} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (LKR) *</label>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={input} placeholder="0.00" min="0" step="0.01" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Mode</label>
              <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className={input}>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="online">Online</option>
              </select>
            </div>

            {isCheque ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cheque Number *</label>
                  <input type="text" value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} className={input} placeholder="e.g. 123456" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bank</label>
                  <input type="text" value={bankName} onChange={(e) => setBankName(e.target.value)} className={input} placeholder="e.g. Commercial Bank" />
                </div>
              </>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reference Number</label>
                <input type="text" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} className={input} placeholder="Transaction ID / slip no" />
              </div>
            )}

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className={input} placeholder="Optional notes" />
            </div>
          </div>

          <div className="flex justify-end space-x-3">
            <button onClick={resetForm} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
              <X className="w-4 h-4 inline mr-1" />Cancel
            </button>
            <button onClick={handleSave} disabled={!canSave} className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <Check className="w-4 h-4 inline mr-1" />{saving ? 'Saving...' : 'Record Payment'}
            </button>
          </div>
        </div>
      )}

      {unpaidInvoices.length > 0 && !showForm && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h4 className="font-medium text-amber-800 mb-2">Outstanding Invoices</h4>
          <div className="flex flex-wrap gap-2">
            {unpaidInvoices.slice(0, 5).map(invoice => (
              <button key={invoice.id} onClick={() => { setKind('invoice'); handleSelectInvoice(invoice.id); setShowForm(true); }} className="px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-sm hover:bg-amber-100 transition-colors">
                <span className="font-medium text-amber-900">{invoice.invoice_number}</span>
                <span className="text-amber-700 ml-2">LKR {Number(invoice.amount_due || 0).toLocaleString()}</span>
              </button>
            ))}
            {unpaidInvoices.length > 5 && <span className="px-3 py-1.5 text-sm text-amber-600">+{unpaidInvoices.length - 5} more</span>}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-4 border-b border-gray-200 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500" placeholder="Search by customer, payment no, invoice or cheque number..." />
          </div>
          <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
            {([['all', 'All'], ['cheques', 'Cheques']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setModeFilter(v)} className={`px-3 py-1.5 ${modeFilter === v ? 'bg-gray-800 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>{l}</button>
            ))}
          </div>
        </div>

        {filteredPayments.length === 0 ? (
          <div className="p-12 text-center">
            <CreditCard className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">{searchTerm ? 'No payments match your search.' : 'No payments recorded yet.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Payment #', 'Date', 'Customer', 'Applied to', 'Mode / Cheque'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">{h}</th>
                  ))}
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Amount</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredPayments.map((payment) => (
                  <tr key={payment.id} className={`hover:bg-gray-50 transition-colors ${payment.cheque_status === 'returned' ? 'bg-red-50/40' : ''}`}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{payment.payment_number || '-'}</span>
                      {payment.notes && <p className="text-xs text-gray-500 truncate max-w-[180px]">{payment.notes}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtDate(payment.payment_date)}</td>
                    <td className="px-4 py-3 text-gray-900">{payment.customer_name}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {payment.sales_invoice_id ? payment.busy_sales_invoices?.invoice_number || '-' : <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">On account</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getPaymentModeBadge(payment.payment_mode)}`}>{formatPaymentMode(payment.payment_mode)}</span>
                      {payment.payment_mode === 'cheque' ? (
                        <div className="text-xs text-gray-600 mt-1">
                          No. <span className="font-medium">{payment.cheque_number || payment.reference_number || '—'}</span>
                          {payment.bank_name ? ` · ${payment.bank_name}` : ''}
                        </div>
                      ) : payment.reference_number ? (
                        <p className="text-xs text-gray-500 mt-1">Ref: {payment.reference_number}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-semibold ${payment.cheque_status === 'returned' ? 'text-red-500 line-through' : 'text-green-600'}`}>{lkr(payment.amount)}</span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => printReceipt(payment)} className="p-2 text-gray-400 hover:text-gray-800 hover:bg-gray-100 rounded-lg" title="Print receipt"><Printer className="w-4 h-4" /></button>
                      <button onClick={() => handleDeletePayment(payment.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Delete Payment"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
