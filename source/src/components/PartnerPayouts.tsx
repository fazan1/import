import { useEffect, useMemo, useRef, useState } from 'react';
import { Handshake, RefreshCw, Trash2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchAllPages } from '../lib/fetchAll';
import { moveToRecycleBin } from '../lib/recycleBin';

// Partner payouts for DOUBLE sales invoices.
// Owner's rule: the partner is paid only out of what the customer has already paid.
//   owed to partner   = partner's profit share (+ the cost, when the partner paid the cost)
//   can pay now       = owed x (customer paid / invoice total) - already paid to the partner

interface DoubleInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string | null;
  customer_name: string | null;
  partner_name: string | null;
  total_amount: number | null;
  amount_paid: number | null;
  total_cost: number | null;
  partner_profit: number | null;
  partner_gets_cost?: boolean | null;
}

interface Payout {
  id: string;
  sales_invoice_id: string | null;
  invoice_number: string | null;
  partner_name: string;
  payout_date: string;
  amount: number;
  payment_mode: string | null;
  note: string | null;
  book?: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const lkr = (n: number) => `LKR ${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const showDate = (d: string | null | undefined) => { if (!d) return '-'; const [y, m, day] = d.slice(0, 10).split('-'); return `${day}/${m}/${y}`; };
const partnerOf = (i: DoubleInvoice) => (i.partner_name || '').trim() || '(no partner name)';

export default function PartnerPayouts() {
  const [invoices, setInvoices] = useState<DoubleInvoice[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [partnerFilter, setPartnerFilter] = useState('');
  const [showSettled, setShowSettled] = useState(false);
  const [payFor, setPayFor] = useState<string | null>(null);
  const [form, setForm] = useState({ amount: '', date: todayLocal(), mode: 'cash', note: '' });
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  async function load() {
    setLoading(true);
    const [inv, pay] = await Promise.all([
      fetchAllPages<DoubleInvoice>(() => supabase.from('busy_sales_invoices').select('*').eq('invoice_type', 'double').order('invoice_date', { ascending: false }).order('id')),
      fetchAllPages<Payout>(() => supabase.from('sl_partner_payouts').select('*').order('payout_date').order('id')),
    ]);
    if (inv.error) alert('Could not load the double invoices: ' + inv.error);
    setInvoices(inv.data);
    if (pay.error) {
      if (/sl_partner_payouts|does not exist|schema cache/i.test(pay.error)) setSetupNeeded(true);
      else alert('Could not load partner payments: ' + pay.error);
      setPayouts([]);
    } else {
      setSetupNeeded(false);
      setPayouts(pay.data);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => invoices.map((i) => {
    const total = Number(i.total_amount) || 0;
    const custPaid = Number(i.amount_paid) || 0;
    const ratio = total > 0 ? Math.min(1, Math.max(0, custPaid / total)) : 0;
    const owed = r2((Number(i.partner_profit) || 0) + (i.partner_gets_cost ? Number(i.total_cost) || 0 : 0));
    const earned = r2(owed * ratio);
    const list = payouts.filter((p) => p.sales_invoice_id === i.id);
    const paid = r2(list.reduce((s, p) => s + (Number(p.amount) || 0), 0));
    return { inv: i, partner: partnerOf(i), total, custPaid, ratio, owed, earned, paid, list,
      canPay: Math.max(0, r2(earned - paid)), still: Math.max(0, r2(owed - paid)) };
  }), [invoices, payouts]);

  const partners = useMemo(() => [...new Set(rows.map((r) => r.partner))].sort(), [rows]);
  const shown = rows.filter((r) => (!partnerFilter || r.partner === partnerFilter) && (showSettled || r.still > 0.009));
  const byPartner = partners.map((name) => {
    const rs = rows.filter((r) => r.partner === name);
    const sum = (f: (r: typeof rows[number]) => number) => r2(rs.reduce((s, r) => s + f(r), 0));
    return { name, owed: sum((r) => r.owed), earned: sum((r) => r.earned), paid: sum((r) => r.paid), canPay: sum((r) => r.canPay), still: sum((r) => r.still) };
  }).filter((p) => !partnerFilter || p.name === partnerFilter);
  const tot = (f: (p: typeof byPartner[number]) => number) => r2(byPartner.reduce((s, p) => s + f(p), 0));

  function openPay(id: string, canPay: number) {
    setPayFor(id);
    setForm({ amount: canPay > 0 ? String(canPay) : '', date: todayLocal(), mode: 'cash', note: '' });
  }

  async function savePayout(r: typeof rows[number]) {
    if (savingRef.current) return;
    const amount = r2(parseFloat(form.amount) || 0);
    if (amount <= 0) { alert('Type the amount you paid the partner.'); return; }
    if (amount > r.canPay + 0.009) {
      alert(`You can pay ${r.partner} at most ${lkr(r.canPay)} now.\n\nThe customer has paid ${lkr(r.custPaid)} of ${lkr(r.total)} (${Math.round(r.ratio * 100)}%), so only that part of the partner's ${lkr(r.owed)} is collected. Record the customer's payment first.`);
      return;
    }
    savingRef.current = true; setSaving(true);
    const { error } = await supabase.from('sl_partner_payouts').insert({
      sales_invoice_id: r.inv.id,
      invoice_number: r.inv.invoice_number,
      partner_name: r.partner,
      payout_date: form.date || todayLocal(),
      amount,
      payment_mode: form.mode,
      note: form.note.trim() || null,
    });
    savingRef.current = false; setSaving(false);
    if (error) { alert('Could not save the partner payment: ' + error.message); return; }
    setPayFor(null);
    load();
  }

  async function deletePayout(p: Payout) {
    if (!confirm(`Delete the payment of ${lkr(p.amount)} to ${p.partner_name} on ${showDate(p.payout_date)}?`)) return;
    const res = await moveToRecycleBin({
      source_table: 'sl_partner_payouts', source_id: p.id, record_data: p as unknown as Record<string, unknown>,
      display_name: `Partner payment ${p.partner_name} - ${p.invoice_number || ''} - ${lkr(p.amount)}`, portal: 'sl',
    });
    if (!res.success) { alert('Could not move it to the Recycle Bin: ' + (res.error || '')); return; }
    const { error } = await supabase.from('sl_partner_payouts').delete().eq('id', p.id);
    if (error) alert('Could not delete: ' + error.message);
    load();
  }

  async function toggleCost(i: DoubleInvoice) {
    const next = !i.partner_gets_cost;
    const msg = next
      ? `Did ${partnerOf(i)} pay the cost (${lkr(Number(i.total_cost) || 0)}) for ${i.invoice_number}?\n\nThen you owe them the cost + their profit share, paid as the customer pays.`
      : `Remove the cost from what you owe ${partnerOf(i)} for ${i.invoice_number}? (You paid the cost.)`;
    if (!confirm(msg)) return;
    const { error } = await supabase.from('busy_sales_invoices').update({ partner_gets_cost: next }).eq('id', i.id);
    if (error) { alert('Could not save: ' + error.message); return; }
    setInvoices((list) => list.map((x) => (x.id === i.id ? { ...x, partner_gets_cost: next } : x)));
  }

  if (loading) return <div className="p-8 text-center text-gray-500">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Handshake className="w-6 h-6" /> Partner Payouts</h1>
          <p className="text-sm text-gray-500">Double invoices: pay the partner only from what the customer has paid.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50"><RefreshCw className="w-4 h-4" /> Refresh</button>
      </div>

      {setupNeeded && (
        <div className="p-4 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-900">
          One-time setup needed: run <b>partner-payouts.sql</b> in Supabase (main project) to record partner payments.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['Partner share (all)', tot((p) => p.owed), ''],
          ['Collected for partner', tot((p) => p.earned), 'customer has paid this part'],
          ['Paid to partner', tot((p) => p.paid), ''],
          ['Can pay now', tot((p) => p.canPay), 'collected, not yet paid'],
        ].map(([label, val, sub]) => (
          <div key={label as string} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
            <div className="text-lg md:text-xl font-semibold text-gray-900 mt-1">{lkr(val as number)}</div>
            {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
          </div>
        ))}
      </div>

      {byPartner.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase">
              <th className="text-left px-4 py-2">Partner</th><th className="text-right px-4 py-2">Share</th><th className="text-right px-4 py-2">Collected</th>
              <th className="text-right px-4 py-2">Paid</th><th className="text-right px-4 py-2">Can pay now</th><th className="text-right px-4 py-2">Still to pay</th>
            </tr></thead>
            <tbody>{byPartner.map((p) => (
              <tr key={p.name} className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-4 py-2 text-right">{lkr(p.owed)}</td>
                <td className="px-4 py-2 text-right">{lkr(p.earned)}</td>
                <td className="px-4 py-2 text-right">{lkr(p.paid)}</td>
                <td className="px-4 py-2 text-right font-semibold text-green-700">{lkr(p.canPay)}</td>
                <td className="px-4 py-2 text-right text-gray-700">{lkr(p.still)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <select value={partnerFilter} onChange={(e) => setPartnerFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
          <option value="">All partners</option>
          {partners.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showSettled} onChange={(e) => setShowSettled(e.target.checked)} /> Show fully paid
        </label>
      </div>

      {shown.length === 0 && (
        <div className="p-8 text-center text-gray-500 bg-white rounded-xl border border-gray-200">
          {invoices.length === 0 ? 'No Double invoices yet. Make a Sales Invoice with type "Double" and a partner.' : 'Nothing left to pay to partners.'}
        </div>
      )}

      <div className="space-y-3">
        {shown.map((r) => (
          <div key={r.inv.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900">{r.inv.invoice_number} — {r.inv.customer_name || '-'}</div>
                <div className="text-xs text-gray-500">{showDate(r.inv.invoice_date)} · Partner: <b>{r.partner}</b></div>
              </div>
              <button
                onClick={() => (payFor === r.inv.id ? setPayFor(null) : openPay(r.inv.id, r.canPay))}
                disabled={setupNeeded || r.canPay <= 0}
                className="px-3 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed"
                title={r.canPay <= 0 ? 'Nothing collected for the partner yet' : 'Record a payment to the partner'}
              >Pay partner</button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
              <div><div className="text-xs text-gray-500">Customer paid</div><div>{lkr(r.custPaid)} <span className="text-xs text-gray-400">of {lkr(r.total)} ({Math.round(r.ratio * 100)}%)</span></div></div>
              <div><div className="text-xs text-gray-500">Partner share{r.inv.partner_gets_cost ? ' + cost' : ''}</div><div>{lkr(r.owed)}</div></div>
              <div><div className="text-xs text-gray-500">Paid to partner</div><div>{lkr(r.paid)}</div></div>
              <div><div className="text-xs text-gray-500">Can pay now</div><div className="font-semibold text-green-700">{lkr(r.canPay)}</div></div>
              <div><div className="text-xs text-gray-500">Still to pay</div><div>{lkr(r.still)}</div></div>
            </div>

            <label className="flex items-center gap-2 text-xs text-gray-600 w-fit cursor-pointer">
              <input type="checkbox" checked={!!r.inv.partner_gets_cost} onChange={() => toggleCost(r.inv)} disabled={setupNeeded} />
              Partner paid the cost ({lkr(Number(r.inv.total_cost) || 0)}) — then I owe cost + share
            </label>

            {payFor === r.inv.id && (
              <div className="p-3 rounded-lg border border-gray-200 bg-gray-50 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Pay {r.partner} (max {lkr(r.canPay)})</div>
                  <button onClick={() => setPayFor(null)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="Amount" className="min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} className="min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                    <option value="cash">Cash</option><option value="bank">Bank transfer</option><option value="cheque">Cheque</option>
                  </select>
                  <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Note (optional)" className="min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <button onClick={() => savePayout(r)} disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save payment'}</button>
              </div>
            )}

            {r.list.length > 0 && (
              <div className="border-t border-gray-100 pt-2 space-y-1">
                {r.list.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-gray-600">{showDate(p.payout_date)} · {p.payment_mode || '-'}{p.note ? ` · ${p.note}` : ''}</span>
                    <span className="flex items-center gap-2"><b>{lkr(p.amount)}</b>
                      <button onClick={() => deletePayout(p)} className="p-1 text-gray-400 hover:text-red-500" title="Delete (to Recycle Bin)"><Trash2 className="w-4 h-4" /></button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
