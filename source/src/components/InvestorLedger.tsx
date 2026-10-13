import { useEffect, useMemo, useState } from 'react';
import { Landmark, Plus, Printer, Download, Pencil, Trash2, X, Check, Banknote } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { esc } from '../lib/html';
import { getBook, BOOK_ALL, MAIN_BOOKS } from '../lib/book';

interface Investor { id: string; name: string; phone: string | null; is_active: boolean; }
interface Line {
  id: string; investor_id: string; entry_date: string; kind: 'supplier_payment' | 'settlement' | 'manual' | 'opening';
  direction: 'owe' | 'paid'; rmb: number | null; rate: number | null; lkr: number; purchase_payment_id: string | null;
  purchase_bill_id: string | null; reference: string | null; note: string | null; payment_mode: string | null;
}
const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm';
const rs = (n: number) => n.toLocaleString('en-LK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const yen = (n: number) => '¥' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtD = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
const KIND: Record<Line['kind'], string> = { supplier_payment: 'Bill payment', settlement: 'Paid to investor', manual: 'Manual', opening: 'Opening balance' };
const MODES = ['BANK', 'CASH', 'CHEQUE', 'OTHER'];
const COMPANY = 'HDR & CO';

type Draft = { id?: string; entry_date: string; direction: 'owe' | 'paid'; currency: 'RMB' | 'LKR'; rmb: string; rate: string; lkr: string; reference: string; note: string; payment_mode: string; kind: Line['kind'] };

export default function InvestorLedger() {
  const [investor, setInvestor] = useState<Investor | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [month, setMonth] = useState<string>('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);
  async function load() {
    // OLD + LCL 2026 share the original investor (book = null); any other book has its own investor
    const b = getBook();
    const own = b !== BOOK_ALL && !MAIN_BOOKS.includes(b);
    let q = supabase.from('investors').select('*').eq('is_active', true);
    q = own ? q.eq('book', b) : q.is('book', null);
    let { data: inv } = await q.order('created_at').limit(1).maybeSingle();
    if (!inv && own) {
      const made = await supabase.from('investors').insert({ name: 'Investor', is_active: true, book: b }).select('*').single();
      inv = made.data;
    }
    setInvestor(inv as Investor | null);
    if (inv) {
      const { data } = await supabase.from('investor_ledger').select('*').eq('investor_id', inv.id).order('entry_date').order('created_at');
      setLines(((data ?? []) as Line[]).map((l) => ({ ...l, lkr: Number(l.lkr), rmb: l.rmb == null ? null : Number(l.rmb), rate: l.rate == null ? null : Number(l.rate) })));
    }
    setLoading(false);
  }

  const months = useMemo(() => Array.from(new Set(lines.map((l) => l.entry_date.slice(0, 7)))).sort().reverse(), [lines]);
  const withBal = useMemo(() => { let b = 0; return lines.map((l) => { b += l.direction === 'owe' ? l.lkr : -l.lkr; return { ...l, bal: b }; }); }, [lines]);
  const shown = month === 'all' ? withBal : withBal.filter((l) => l.entry_date.startsWith(month));
  const balance = withBal.length ? withBal[withBal.length - 1].bal : 0;
  const totOwe = lines.filter((l) => l.direction === 'owe').reduce((t, l) => t + l.lkr, 0);
  const totPaid = lines.filter((l) => l.direction === 'paid').reduce((t, l) => t + l.lkr, 0);
  const totRmb = lines.filter((l) => l.direction === 'owe').reduce((t, l) => t + (l.rmb ?? 0), 0);
  const mOwe = shown.filter((l) => l.direction === 'owe').reduce((t, l) => t + l.lkr, 0);
  const mPaid = shown.filter((l) => l.direction === 'paid').reduce((t, l) => t + l.lkr, 0);
  const lastRate = [...lines].reverse().find((l) => l.rate && l.rate > 0)?.rate ?? 0;

  function newDraft(kind: 'settlement' | 'manual' | 'opening'): Draft {
    return { entry_date: new Date().toISOString().slice(0, 10), direction: kind === 'settlement' ? 'paid' : 'owe', currency: kind === 'opening' ? 'LKR' : kind === 'settlement' ? 'LKR' : 'RMB', rmb: '', rate: lastRate ? String(lastRate) : '', lkr: '', reference: '', note: '', payment_mode: 'BANK', kind };
  }
  function editDraft(l: Line): Draft {
    return { id: l.id, entry_date: l.entry_date, direction: l.direction, currency: l.rmb != null ? 'RMB' : 'LKR', rmb: l.rmb != null ? String(l.rmb) : '', rate: l.rate != null ? String(l.rate) : '', lkr: String(l.lkr), reference: l.reference ?? '', note: l.note ?? '', payment_mode: l.payment_mode ?? 'BANK', kind: l.kind };
  }
  const draftLkr = (d: Draft) => d.currency === 'RMB' ? (parseFloat(d.rmb) || 0) * (parseFloat(d.rate) || 0) : parseFloat(d.lkr) || 0;

  async function saveDraft() {
    if (!draft || !investor) return;
    const lkr = draftLkr(draft);
    if (lkr <= 0) { alert(draft.currency === 'RMB' ? 'Enter RMB amount and rate' : 'Enter LKR amount'); return; }
    const row = {
      investor_id: investor.id, entry_date: draft.entry_date, kind: draft.kind, direction: draft.direction,
      rmb: draft.currency === 'RMB' ? parseFloat(draft.rmb) : null, rate: draft.currency === 'RMB' ? parseFloat(draft.rate) : null, lkr,
      reference: draft.reference.trim() || null, note: draft.note.trim() || null, payment_mode: draft.direction === 'paid' ? draft.payment_mode : null,
    };
    const { error } = draft.id
      ? await supabase.from('investor_ledger').update(row).eq('id', draft.id)
      : await supabase.from('investor_ledger').insert(row);
    if (error) { alert(error.message); return; }
    setDraft(null); load();
  }
  async function del(l: Line) {
    if (l.purchase_payment_id) {
      alert('This line is a supplier payment on bill ' + (l.reference ?? '') + '. It can only be removed from the bill itself (Outstanding Pay or the bill page → Payments). Here you can edit its date, amount or rate.');
      return;
    }
    if (!confirm('Delete this line?')) return;
    const { error } = await supabase.from('investor_ledger').delete().eq('id', l.id);
    if (error) alert(error.message);
    load();
  }
  async function saveName() { if (!investor || !rename?.trim()) return; await supabase.from('investors').update({ name: rename.trim() }).eq('id', investor.id); setRename(null); load(); }

  function exportExcel() {
    const ws = XLSX.utils.json_to_sheet(withBal.map((l) => ({ Date: l.entry_date, Type: KIND[l.kind], Reference: l.reference, Note: l.note, RMB: l.rmb ?? '', Rate: l.rate ?? '', 'LKR owed': l.direction === 'owe' ? l.lkr : '', 'LKR paid': l.direction === 'paid' ? l.lkr : '', Balance: l.bal })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Ledger'); XLSX.writeFile(wb, `investor-ledger-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }
  function print() {
    const rows = shown.map((l) => `<tr><td>${fmtD(l.entry_date)}</td><td>${KIND[l.kind]}</td><td>${esc(l.reference ?? '')}</td><td>${esc(l.note ?? '')}</td><td class="r">${l.rmb != null ? yen(l.rmb) : ''}</td><td class="r">${l.rate ?? ''}</td><td class="r">${l.direction === 'owe' ? rs(l.lkr) : ''}</td><td class="r">${l.direction === 'paid' ? rs(l.lkr) : ''}</td><td class="r">${rs(l.bal)}</td></tr>`).join('');
    const w = window.open('', '_blank'); if (!w) return;
    w.document.write(`<html><head><title>Investor statement</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px}h1{font-size:18px;margin:0}h2{font-size:14px;margin:2px 0 12px;color:#555}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #ccc;padding:5px 6px;text-align:left}th{background:#f3f4f6}.r{text-align:right}.tot td{font-weight:bold;background:#f9fafb}.bal{margin-top:16px;font-size:14px;font-weight:bold}.sig{margin-top:40px;display:flex;justify-content:space-between}.sig div{width:40%;border-top:1px solid #333;padding-top:4px;text-align:center}</style></head><body>
      <h1>${COMPANY} — Investor statement</h1><h2>${esc(investor?.name ?? '')} · ${month === 'all' ? 'All entries' : esc(month)} · printed ${new Date().toLocaleDateString('en-GB')}</h2>
      <table><thead><tr><th>Date</th><th>Type</th><th>Ref</th><th>Note</th><th class="r">RMB</th><th class="r">Rate</th><th class="r">LKR owed</th><th class="r">LKR paid</th><th class="r">Balance</th></tr></thead><tbody>${rows}
      <tr class="tot"><td colspan="6">Totals (${month === 'all' ? 'all' : esc(month)})</td><td class="r">${rs(mOwe)}</td><td class="r">${rs(mPaid)}</td><td></td></tr></tbody></table>
      <p class="bal">Balance owed to ${esc(investor?.name ?? 'investor')} as at ${new Date().toLocaleDateString('en-GB')}: Rs ${rs(balance)}</p>
      <div class="sig"><div>${COMPANY}</div><div>${esc(investor?.name ?? 'Investor')} — confirmed</div></div>
      <script>window.print()</script></body></html>`);
    w.document.close();
  }

  if (loading) return <div className="p-6 text-gray-500">Loading…</div>;
  if (!investor) return <div className="p-6 text-gray-500">No investor set up yet — run investor-setup.sql first.</div>;

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Landmark className="w-6 h-6 text-teal-600" />Investor Ledger</h2>
          {rename === null ? <p className="text-sm text-gray-500">{investor.name} <button onClick={() => setRename(investor.name)} className="text-teal-700 hover:underline ml-1">rename</button></p>
            : <div className="flex gap-1 mt-1"><input className={`${input} w-56 py-1`} value={rename} onChange={(e) => setRename(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveName()} autoFocus /><button onClick={saveName} className="px-2 bg-teal-600 text-white rounded text-xs">OK</button><button onClick={() => setRename(null)} className="px-2 border rounded text-xs">Cancel</button></div>}
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setDraft(newDraft('settlement'))} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-teal-600 text-white hover:bg-teal-700"><Banknote className="w-4 h-4" />Pay investor</button>
          <button onClick={() => setDraft(newDraft('manual'))} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border border-gray-300 bg-white hover:bg-gray-50"><Plus className="w-4 h-4" />Manual line</button>
          <button onClick={print} className="p-2 rounded-xl border border-gray-300 bg-white hover:bg-gray-50" title="Print statement"><Printer className="w-4 h-4" /></button>
          <button onClick={exportExcel} className="p-2 rounded-xl border border-gray-300 bg-white hover:bg-gray-50" title="Excel"><Download className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className={`rounded-xl p-4 border ${balance > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}><div className="text-xs text-gray-500">Owed to investor</div><div className={`text-2xl font-bold ${balance > 0 ? 'text-red-700' : 'text-green-700'}`}>Rs {rs(balance)}</div></div>
        <div className="rounded-xl p-4 border border-gray-200 bg-white"><div className="text-xs text-gray-500">He funded (total)</div><div className="text-xl font-bold text-gray-900">{yen(totRmb)}</div><div className="text-xs text-gray-500">= Rs {rs(totOwe)}</div></div>
        <div className="rounded-xl p-4 border border-gray-200 bg-white"><div className="text-xs text-gray-500">You paid him (total)</div><div className="text-xl font-bold text-gray-900">Rs {rs(totPaid)}</div></div>
        <div className="rounded-xl p-4 border border-gray-200 bg-white"><div className="text-xs text-gray-500">Last rate</div><div className="text-xl font-bold text-gray-900">{lastRate || '—'}</div><div className="text-xs text-gray-500">Rs per ¥</div></div>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <select className="px-3 py-2 border border-gray-300 rounded-lg text-sm" value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="all">All months</option>{months.map((m) => <option key={m} value={m}>{new Date(m + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</option>)}
        </select>
        {month !== 'all' && <span className="text-sm text-gray-600">This month: owed Rs {rs(mOwe)} · paid Rs {rs(mPaid)}</span>}
        {!lines.some((l) => l.kind === 'opening') && <button onClick={() => setDraft(newDraft('opening'))} className="text-sm px-3 py-1.5 border border-teal-300 text-teal-800 bg-teal-50 rounded-lg hover:bg-teal-100">+ Opening balance</button>}
      </div>

      <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase"><tr><th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Ref / note</th><th className="text-right px-3 py-2">RMB</th><th className="text-right px-3 py-2">Rate</th><th className="text-right px-3 py-2 text-red-700">Owed</th><th className="text-right px-3 py-2 text-green-700">Paid</th><th className="text-right px-3 py-2">Balance</th><th className="w-16"></th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {shown.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-500">No entries yet. Bill payments appear here automatically; use "Pay investor" when you settle.</td></tr>}
            {shown.map((l) => (
              <tr key={l.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 whitespace-nowrap">{fmtD(l.entry_date)}</td>
                <td className="px-3 py-2"><div className="flex items-center gap-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${l.kind === 'supplier_payment' ? 'bg-teal-100 text-teal-800' : l.kind === 'settlement' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>{KIND[l.kind]}</span>{l.reference && <span className="font-medium">{l.reference}</span>}</div>{l.note && <div className="text-xs text-gray-500">{l.note}{l.payment_mode ? ` · ${l.payment_mode}` : ''}</div>}</td>
                <td className="px-3 py-2 text-right">{l.rmb != null ? yen(l.rmb) : ''}</td>
                <td className="px-3 py-2 text-right text-gray-500">{l.rate || ''}</td>
                <td className="px-3 py-2 text-right text-red-700">{l.direction === 'owe' ? rs(l.lkr) : ''}</td>
                <td className="px-3 py-2 text-right text-green-700">{l.direction === 'paid' ? rs(l.lkr) : ''}</td>
                <td className="px-3 py-2 text-right font-medium">{rs(l.bal)}</td>
                <td className="px-2 py-2 text-right whitespace-nowrap"><button onClick={() => setDraft(editDraft(l))} className="p-1 text-gray-400 hover:text-teal-700"><Pencil className="w-3.5 h-3.5" /></button>{!l.purchase_payment_id && <button onClick={() => del(l)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-2">Owed = investor paid a supplier (RMB × rate). Paid = you settled in LKR. Balance is in LKR. Bill-payment lines (blue) can be edited here but only deleted from the bill itself. Editing their rate also updates the bill's exchange rate.</p>

      {draft && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDraft(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">{draft.id ? 'Edit line' : draft.kind === 'settlement' ? 'Pay investor' : draft.kind === 'opening' ? 'Opening balance' : 'Manual line'}</h3><button onClick={() => setDraft(null)} className="p-1 text-gray-400"><X className="w-5 h-5" /></button></div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500">Date</label><input type="date" className={input} value={draft.entry_date} onChange={(e) => setDraft({ ...draft, entry_date: e.target.value })} /></div>
                {draft.kind !== 'settlement' && draft.kind !== 'supplier_payment' && (
                  <div><label className="text-xs text-gray-500">Direction</label><select className={input} value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value as 'owe' | 'paid' })}><option value="owe">He paid / we owe</option><option value="paid">We paid him</option></select></div>
                )}
              </div>
              <div className="flex gap-2">
                {(['RMB', 'LKR'] as const).map((c) => <button key={c} type="button" onClick={() => setDraft({ ...draft, currency: c })} className={`px-3 py-1.5 rounded-full text-sm border ${draft.currency === c ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300'}`}>{c}</button>)}
              </div>
              {draft.currency === 'RMB' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs text-gray-500">RMB</label><input type="number" inputMode="decimal" className={`${input} text-lg`} value={draft.rmb} onChange={(e) => setDraft({ ...draft, rmb: e.target.value })} autoFocus /></div>
                  <div><label className="text-xs text-gray-500">Rate (Rs per ¥)</label><input type="number" inputMode="decimal" className={`${input} text-lg`} value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} /></div>
                </div>
              ) : (
                <div><label className="text-xs text-gray-500">LKR</label><input type="number" inputMode="decimal" className={`${input} text-lg`} value={draft.lkr} onChange={(e) => setDraft({ ...draft, lkr: e.target.value })} autoFocus /></div>
              )}
              <div className="text-sm bg-gray-50 rounded-lg px-3 py-2">= <b>Rs {rs(draftLkr(draft))}</b> {draft.direction === 'owe' ? 'added to what you owe' : 'reduces what you owe'}</div>
              {draft.direction === 'paid' && <div><label className="text-xs text-gray-500">Mode</label><select className={input} value={draft.payment_mode} onChange={(e) => setDraft({ ...draft, payment_mode: e.target.value })}>{MODES.map((m) => <option key={m}>{m}</option>)}</select></div>}
              {draft.kind === 'opening' && <p className="text-xs text-gray-500">Balance you owed him before the system started. Choose LKR and type the amount; date it the day the ledger starts.</p>}
              <div><label className="text-xs text-gray-500">Reference</label><input className={input} value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} placeholder="bill no., bank ref, cheque no." /></div>
              <div><label className="text-xs text-gray-500">Note</label><input className={input} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-2 mt-4"><button onClick={() => setDraft(null)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">Cancel</button><button onClick={saveDraft} className="px-4 py-1.5 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1"><Check className="w-4 h-4" />Save</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
