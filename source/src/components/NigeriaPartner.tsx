import { useEffect, useMemo, useState } from 'react';
import { Handshake, RefreshCw, Copy, Printer, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchAllPages } from '../lib/fetchAll';
import { moveToRecycleBin } from '../lib/recycleBin';
import { expenseBoth } from './NigeriaExpenses';
import { ngPrint } from '../lib/ngPrint';

/* NIGERIA — Partner account (owner + partner, Nov 2026). The partner runs the shop and keeps the stock himself; no sale-by-sale
   entry. ONE account: everything he was given, valued at SELLING price, minus the money he has sent.
   Rule for profit: the money that comes in first pays back OUR COST (goods at China cost + every expense). Only what comes in
   ABOVE the cost is profit, and only that can be pulled out. */

interface NgItem { id: string; name: string; specification: string | null; finish: string | null; cost_rmb: number; sell_naira: number | null }
interface NgMove { item_id: string; kind: 'in' | 'out' | 'adjust'; entry_date: string; quantity: number; cost_rmb: number | null; reference: string | null }
interface NgExpense { entry_date: string; category: string; amount: number; currency: string; rate: number | null; reference: string | null }
interface NgRemit { id: string; rec_date: string; amount_ngn: number; method: string | null; reference: string | null; note: string | null }

const n0 = (v: number) => (isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—');
const showDate = (d: string) => { const [y, m, day] = d.slice(0, 10).split('-'); return `${day}/${m}/${y}`; };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const label = (i: NgItem) => [i.name, i.specification, i.finish].filter(Boolean).join(' ');
const OUT = ['Partner payout', 'Owner withdrawal'];

export default function NigeriaPartner() {
  const [items, setItems] = useState<NgItem[]>([]);
  const [moves, setMoves] = useState<NgMove[]>([]);
  const [expenses, setExpenses] = useState<NgExpense[]>([]);
  const [remits, setRemits] = useState<NgRemit[]>([]);
  const [rate, setRate] = useState(0);
  const [share, setShare] = useState(0);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ date: string; amount: string; method: string; note: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [it, mv, ex, rm, se, sp] = await Promise.all([
      fetchAllPages<NgItem>(() => supabase.from('ng_items').select('id, name, specification, finish, cost_rmb, sell_naira').order('name')),
      fetchAllPages<NgMove>(() => supabase.from('ng_stock').select('item_id, kind, entry_date, quantity, cost_rmb, reference').order('entry_date')),
      fetchAllPages<NgExpense>(() => supabase.from('ng_expenses').select('entry_date, category, amount, currency, rate, reference')),
      fetchAllPages<NgRemit>(() => supabase.from('ng_remittances').select('id, rec_date, amount_ngn, method, reference, note').order('rec_date', { ascending: false }).order('created_at', { ascending: false })),
      supabase.from('ng_settings').select('value').eq('key', 'rate').maybeSingle(),
      supabase.from('ng_settings').select('value').eq('key', 'partner').maybeSingle(),
    ]);
    if (it.error || mv.error) alert('Could not load: ' + (it.error || mv.error));
    setItems((it.data || []).map((r) => ({ ...r, cost_rmb: Number(r.cost_rmb) || 0, sell_naira: r.sell_naira == null ? null : Number(r.sell_naira) })));
    setMoves((mv.data || []).map((m) => ({ ...m, quantity: Number(m.quantity) || 0, cost_rmb: m.cost_rmb == null ? null : Number(m.cost_rmb) })));
    setExpenses((ex.data || []).map((e) => ({ ...e, amount: Number(e.amount) || 0, rate: e.rate == null ? null : Number(e.rate) })));
    setRemits((rm.data || []).map((r) => ({ ...r, amount_ngn: Number(r.amount_ngn) || 0 })));
    setRate(Number((se.data?.value as { naira_per_rmb?: number } | undefined)?.naira_per_rmb) || 0);
    setShare(Number((sp.data?.value as { share_pct?: number } | undefined)?.share_pct) || 0);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const D = useMemo(() => {
    const itemOf = (id: string) => items.find((i) => i.id === id);
    // what he was given = everything received into stock, plus / minus the adjustments (short, damaged, found)
    const given: Record<string, { it: NgItem | undefined; qty: number; rmb: number }> = {};
    const byRef: Record<string, { ref: string; qty: number; sell: number; rmb: number }> = {};
    moves.filter((m) => m.kind === 'in' || m.kind === 'adjust').forEach((m) => {
      const it = itemOf(m.item_id); const g = (given[m.item_id] ||= { it, qty: 0, rmb: 0 });
      g.qty += m.quantity; g.rmb += m.kind === 'in' ? (m.cost_rmb ?? m.quantity * (it?.cost_rmb || 0)) : m.quantity * (it?.cost_rmb || 0);
      const ref = m.kind === 'in' ? (m.reference || 'No reference') : 'Adjustments';
      const r = (byRef[ref] ||= { ref, qty: 0, sell: 0, rmb: 0 });
      r.qty += m.quantity; r.sell += m.quantity * (it?.sell_naira || 0); r.rmb += m.kind === 'in' ? (m.cost_rmb ?? m.quantity * (it?.cost_rmb || 0)) : m.quantity * (it?.cost_rmb || 0);
    });
    const lines = Object.values(given).filter((g) => Math.abs(g.qty) > 1e-9).map((g) => ({ ...g, price: g.it?.sell_naira || 0, sell: g.qty * (g.it?.sell_naira || 0) })).sort((a, b) => b.sell - a.sell);
    const noPrice = lines.filter((l) => !l.price);
    const goodsSell = lines.reduce((t, l) => t + l.sell, 0);
    const goodsRmb = lines.reduce((t, l) => t + l.rmb, 0);
    const goodsCost = rate ? goodsRmb * rate : NaN;
    const ngn = (e: NgExpense) => { const b = expenseBoth(e, rate); return isFinite(b.ngn) ? b.ngn : 0; };
    const exp = expenses.filter((e) => !OUT.includes(e.category)).reduce((t, e) => t + ngn(e), 0);
    const expByRef: Record<string, number> = {}; expenses.filter((e) => !OUT.includes(e.category) && e.reference).forEach((e) => { expByRef[e.reference!] = (expByRef[e.reference!] || 0) + ngn(e); });
    const cost = (isFinite(goodsCost) ? goodsCost : 0) + exp;
    const received = remits.reduce((t, r) => t + r.amount_ngn, 0);
    const partnerOut = expenses.filter((e) => e.category === 'Partner payout').reduce((t, e) => t + ngn(e), 0);
    const ownerOut = expenses.filter((e) => e.category === 'Owner withdrawal').reduce((t, e) => t + ngn(e), 0);
    const profitIn = Math.max(0, received - cost);           // money in above the cost = profit actually in hand
    const costLeft = Math.max(0, cost - received);
    const canPull = profitIn - partnerOut - ownerOut;
    const pShare = profitIn * (share / 100), oShare = profitIn - pShare;
    return { lines, noPrice, goodsSell, goodsCost, exp, cost, received, balance: goodsSell - received, profitIn, costLeft, partnerOut, ownerOut, canPull, pShare, oShare, expected: goodsSell - cost,
      refs: Object.values(byRef).map((r) => ({ ...r, cost: (rate ? r.rmb * rate : 0) + (expByRef[r.ref] || 0) })).sort((a, b) => b.sell - a.sell) };
  }, [items, moves, expenses, remits, rate, share]);

  async function save() {
    if (!form || saving) return;
    const amt = parseFloat(form.amount.replace(/,/g, ''));
    if (!isFinite(amt) || amt <= 0) { alert('Type the amount in Naira.'); return; }
    setSaving(true);
    const { error } = await supabase.from('ng_remittances').insert({ rec_date: form.date, amount_ngn: amt, method: form.method || null, note: form.note.trim() || null });
    setSaving(false);
    if (error) { alert('Could not save: ' + (/ng_remittances|does not exist|schema cache/i.test(error.message) ? 'run nigeria-remittances.sql in Supabase once.' : error.message)); return; }
    setForm(null); load();
  }
  async function remove(r: NgRemit) {
    if (!confirm(`Delete the ₦${n0(r.amount_ngn)} received on ${showDate(r.rec_date)}? It goes to the Recycle Bin.`)) return;
    const res = await moveToRecycleBin({ source_table: 'ng_remittances', source_id: r.id, record_data: r as unknown as Record<string, unknown>, display_name: `NG money from partner ₦${n0(r.amount_ngn)} ${showDate(r.rec_date)}`, portal: 'sl' });
    if (!res.success) { alert('Could not move it to the Recycle Bin: ' + (res.error || '')); return; }
    const { error } = await supabase.from('ng_remittances').delete().eq('id', r.id);
    if (error) { alert('Could not delete: ' + error.message); return; }
    load();
  }

  const pct = D.cost > 0 ? Math.min(100, (D.received / D.cost) * 100) : 0;
  const text = () => [
    `*NG PARTNER ACCOUNT — ${showDate(today())}*`,
    `Goods given (at selling price): ₦${n0(D.goodsSell)}`,
    `Money received: ₦${n0(D.received)}`,
    `*Still to come: ₦${n0(D.balance)}*`,
    '',
    `Our cost (goods + duty + expenses): ₦${n0(D.cost)}`,
    D.costLeft > 0 ? `Cost not covered yet — ₦${n0(D.costLeft)} more to recover before any profit` : `Cost fully covered. Profit received so far: ₦${n0(D.profitIn)}`,
    D.costLeft > 0 ? '' : `Already pulled out: ₦${n0(D.partnerOut + D.ownerOut)} · can pull out now: ₦${n0(D.canPull)}`,
    `Profit when everything is paid: ₦${n0(D.expected)}`,
    '',
    '*Money received*',
    ...remits.slice(0, 30).map((r) => `${showDate(r.rec_date)}  ₦${n0(r.amount_ngn)}${r.method ? ' ' + r.method : ''}${r.note ? ' — ' + r.note : ''}`),
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  async function copy() { const t = text(); try { await navigator.clipboard.writeText(t); alert('Copied — paste it into WhatsApp.'); } catch { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); alert('Copied — paste it into WhatsApp.'); } }
  function print() {
    ngPrint('Partner account — NG', `As at ${showDate(today())} · still to come ₦${n0(D.balance)} · rate ₦${rate || '—'} / RMB`, [
      { title: 'The account', head: ['', '₦'], right: [1], rows: [['Goods given, at selling price', n0(D.goodsSell)], ['Money received', n0(D.received)], ['Still to come', n0(D.balance)], ['Our cost (goods + duty + expenses)', n0(D.cost)], [D.costLeft > 0 ? 'Cost still to recover' : 'Profit received so far', n0(D.costLeft > 0 ? D.costLeft : D.profitIn)], ['Profit when everything is paid', n0(D.expected)]] },
      { title: 'Goods given', head: ['Item', 'Quantity', 'Selling price ₦', 'Value ₦'], right: [1, 2, 3], rows: D.lines.map((l) => [l.it ? label(l.it) : '?', n0(l.qty), l.price ? n0(l.price) : 'no price', n0(l.sell)]), total: ['Total', '', '', n0(D.goodsSell)] },
      { title: 'Money received', head: ['Date', 'How', 'Note', '₦'], right: [3], rows: remits.map((r) => [showDate(r.rec_date), r.method || '', r.note || r.reference || '', n0(r.amount_ngn)]), total: ['Total', '', '', n0(D.received)] },
    ], 'Rule: money received first pays back our cost; only what comes in above the cost is profit.');
  }

  const Tile = ({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: string }) => <div className="bg-white border border-gray-200 rounded-lg p-4"><div className="text-xs text-gray-500 font-mono uppercase tracking-wider">{k}</div><div className={`text-2xl font-bold mt-1 font-mono ${tone || ''}`}>{v}</div>{sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}</div>;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><Handshake className="w-6 h-6" /> Partner account</h1><p className="text-sm text-gray-600">Everything he holds, at selling price, less the money he has sent. No sale-by-sale entry.</p></div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setForm({ date: today(), amount: '', method: 'Bank', note: '' })} className="px-3 py-2 bg-[#e8552a] text-white rounded-lg text-sm font-semibold flex items-center gap-1"><Plus className="w-4 h-4" /> Money received</button>
          <button onClick={copy} className="px-3 py-2 border border-gray-300 bg-white rounded-lg text-sm flex items-center gap-1"><Copy className="w-4 h-4" /> Copy statement</button>
          <button onClick={print} className="px-3 py-2 border border-gray-300 bg-white rounded-lg text-sm flex items-center gap-1"><Printer className="w-4 h-4" /> Print / PDF</button>
          <button onClick={load} className="px-3 py-2 border border-gray-300 bg-white rounded-lg text-sm" aria-label="Refresh"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
      </div>

      {form && (
        <div className="bg-white border-2 border-[#111] rounded-lg p-4 mb-4">
          <div className="font-semibold mb-3">Money received from the partner</div>
          <div className="grid sm:grid-cols-4 gap-3">
            <label className="text-sm">Date<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" /></label>
            <label className="text-sm">Amount (₦)<input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="e.g. 2000000" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 font-mono" /></label>
            <label className="text-sm">How<select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2">{['Bank', 'USDT', 'Cash', 'Other'].map((m) => <option key={m}>{m}</option>)}</select></label>
            <label className="text-sm">Note<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" /></label>
          </div>
          {parseFloat(form.amount) > 0 && <div className="text-sm text-gray-600 mt-2">Still to come after this: <b>₦{n0(D.balance - parseFloat(form.amount.replace(/,/g, '')))}</b></div>}
          <div className="flex gap-2 mt-3"><button onClick={save} disabled={saving} className="px-4 py-2 bg-[#111] text-white rounded-lg text-sm font-semibold disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button><button onClick={() => setForm(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button></div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile k="Goods given (selling price)" v={`₦${n0(D.goodsSell)}`} sub={`${D.lines.length} items`} />
        <Tile k="Money received" v={`₦${n0(D.received)}`} sub={`${remits.length} payments`} tone="text-green-700" />
        <Tile k="Still to come" v={`₦${n0(D.balance)}`} sub="goods he holds + cash not yet sent" tone="text-[#e8552a]" />
        <Tile k="Our cost" v={`₦${n0(D.cost)}`} sub={`goods ₦${n0(D.goodsCost)} + duty & expenses ₦${n0(D.exp)}`} />
      </div>
      {!rate && <div className="mt-3 text-sm text-red-700 border border-red-300 bg-red-50 rounded-lg p-3">No exchange rate is set, so the goods cost cannot be turned into Naira. Set the default rate in Expenses NG.</div>}
      {D.noPrice.length > 0 && <div className="mt-3 text-sm text-amber-800 border border-amber-400 bg-amber-50 rounded-lg p-3">{D.noPrice.length} item(s) have no selling price and count as ₦0 here: {D.noPrice.map((l) => (l.it ? label(l.it) : '?')).join(', ')}. Set the price in Items NG.</div>}

      <div className="bg-white border border-gray-200 rounded-lg p-4 mt-4">
        <div className="font-semibold">Cost first, then profit</div>
        <p className="text-sm text-gray-600">The money that comes in pays back our cost first. Only what comes in above the cost is profit to pull out.</p>
        <div className="h-4 bg-[#f4f3f1] rounded mt-3 overflow-hidden"><div className={`h-full ${D.costLeft > 0 ? 'bg-[#e8552a]' : 'bg-green-600'}`} style={{ width: `${pct}%` }} /></div>
        <div className="flex justify-between text-xs text-gray-600 mt-1 font-mono"><span>received ₦{n0(D.received)}</span><span>cost ₦{n0(D.cost)}</span></div>
        {D.costLeft > 0
          ? <div className="mt-3 text-[15px]"><b className="text-[#e8552a]">Cost not covered yet.</b> ₦{n0(D.costLeft)} more must come in before there is any profit to pull out ({n0(pct)}% of the cost is back).</div>
          : <div className="mt-3 text-[15px]"><b className="text-green-700">Cost fully covered.</b> Profit received so far: <b>₦{n0(D.profitIn)}</b>. Already pulled out ₦{n0(D.partnerOut + D.ownerOut)} → <b>can pull out now ₦{n0(D.canPull)}</b>.</div>}
        {D.costLeft <= 0 && share > 0 && <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <div className="bg-[#f4f3f1] rounded-lg p-3 text-sm">Partner {share}%: ₦{n0(D.pShare)} − pulled out ₦{n0(D.partnerOut)} = <b>₦{n0(D.pShare - D.partnerOut)}</b></div>
          <div className="bg-[#f4f3f1] rounded-lg p-3 text-sm">Owner {100 - share}%: ₦{n0(D.oShare)} − pulled out ₦{n0(D.ownerOut)} = <b>₦{n0(D.oShare - D.ownerOut)}</b></div>
        </div>}
        <div className="text-sm text-gray-600 mt-3">Profit when everything is paid: <b className="text-[#111]">₦{n0(D.expected)}</b>. A pull-out is recorded in Expenses NG as "Partner payout" or "Owner withdrawal"{share ? '' : '; the share % is set in Profit NG'}.</div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 font-semibold border-b">Money received</div>
          <table className="w-full text-sm"><thead><tr className="bg-[#111] text-white"><th className="text-left p-2">Date</th><th className="text-left p-2">How / note</th><th className="text-right p-2">₦</th><th className="p-2 w-8" /></tr></thead>
            <tbody>{remits.map((r) => <tr key={r.id} className="border-b border-gray-100"><td className="p-2 whitespace-nowrap">{showDate(r.rec_date)}</td><td className="p-2">{[r.method, r.note || r.reference].filter(Boolean).join(' — ')}</td><td className="p-2 text-right font-mono">{n0(r.amount_ngn)}</td><td className="p-2"><button onClick={() => remove(r)} aria-label="Delete" className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button></td></tr>)}
              {!remits.length && <tr><td colSpan={4} className="p-4 text-center text-gray-500">{loading ? 'Loading…' : 'No money recorded yet.'}</td></tr>}
              {remits.length > 0 && <tr className="font-bold"><td className="p-2" colSpan={2}>Total</td><td className="p-2 text-right font-mono">{n0(D.received)}</td><td /></tr>}</tbody></table>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 font-semibold border-b">Goods given, by shipment</div>
          <table className="w-full text-sm"><thead><tr className="bg-[#111] text-white"><th className="text-left p-2">Shipment</th><th className="text-right p-2">Pieces</th><th className="text-right p-2">At selling price ₦</th><th className="text-right p-2">Our cost ₦</th></tr></thead>
            <tbody>{D.refs.map((r) => <tr key={r.ref} className="border-b border-gray-100"><td className="p-2">{r.ref}</td><td className="p-2 text-right font-mono">{n0(r.qty)}</td><td className="p-2 text-right font-mono">{n0(r.sell)}</td><td className="p-2 text-right font-mono">{n0(r.cost)}</td></tr>)}
              {!D.refs.length && <tr><td colSpan={4} className="p-4 text-center text-gray-500">{loading ? 'Loading…' : 'No goods in stock yet.'}</td></tr>}</tbody></table>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mt-4">
        <div className="px-4 py-3 font-semibold border-b">Goods given, by item</div>
        <table className="w-full text-sm"><thead><tr className="bg-[#111] text-white"><th className="text-left p-2">Item</th><th className="text-right p-2">Quantity</th><th className="text-right p-2">Selling price ₦</th><th className="text-right p-2">Value ₦</th></tr></thead>
          <tbody>{D.lines.map((l, k) => <tr key={k} className="border-b border-gray-100"><td className="p-2">{l.it ? label(l.it) : '?'}</td><td className="p-2 text-right font-mono">{n0(l.qty)}</td><td className={`p-2 text-right font-mono ${l.price ? '' : 'text-amber-700'}`}>{l.price ? n0(l.price) : 'no price'}</td><td className="p-2 text-right font-mono">{n0(l.sell)}</td></tr>)}
            {D.lines.length > 0 && <tr className="font-bold"><td className="p-2" colSpan={3}>Total</td><td className="p-2 text-right font-mono">{n0(D.goodsSell)}</td></tr>}</tbody></table>
      </div>
    </div>
  );
}
