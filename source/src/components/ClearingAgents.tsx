import { useEffect, useMemo, useState } from 'react';
import { Truck, Plus, Pencil, Trash2, X, Check, ArrowLeft, Printer, Phone } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getBook, BOOK_ALL, isBookLocked } from '../lib/book';

/* Clearing / shipping agents: a simple list (name + phone) and an account per agent.
   Account lines are kept per book, so the shop's account never mixes with yours. */

interface Agent { id: string; name: string; phone: string | null; is_active: boolean }
interface Line { id: string; agent_id: string; entry_date: string; kind: 'charge' | 'payment'; amount: number; reference: string | null; payment_mode: string | null; note: string | null; shipment_id: string | null }

const rs = (v: number) => 'Rs ' + Math.round(v).toLocaleString('en-US');
const n0 = (v: number) => Math.round(v).toLocaleString('en-US');
const today = () => new Date().toISOString().slice(0, 10);
const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';
const MODES = ['Cash', 'Bank', 'Cheque', 'Online', 'Other'];

export default function ClearingAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [edit, setEdit] = useState<{ id?: string; name: string; phone: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [entry, setEntry] = useState<{ kind: 'charge' | 'payment'; entry_date: string; amount: string; payment_mode: string; reference: string; note: string } | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    const [a, l] = await Promise.all([
      supabase.from('clearing_agents').select('*').order('name'),
      supabase.from('agent_ledger').select('*').order('entry_date').order('created_at'),
    ]);
    if (a.error) { setMissing(true); setLoading(false); return; }
    setAgents((a.data ?? []) as Agent[]);
    setLines(((l.data ?? []) as Line[]).map((x) => ({ ...x, amount: Number(x.amount) || 0 })));
    setLoading(false);
  }

  const balanceOf = (id: string) => lines.filter((l) => l.agent_id === id).reduce((t, l) => t + (l.kind === 'charge' ? l.amount : -l.amount), 0);
  const shown = agents.filter((a) => showInactive || a.is_active);
  const totalOwed = shown.reduce((t, a) => t + Math.max(0, balanceOf(a.id)), 0);
  const book = getBook() === BOOK_ALL ? 'All books' : getBook();
  const locked = isBookLocked();   // shop login: can add agents, not change or delete them

  async function saveAgent() {
    if (!edit) return;
    const name = edit.name.trim();
    if (!name) { alert('Type the agent name'); return; }
    const row = { name, phone: edit.phone.trim() || null };
    const { error } = edit.id ? await supabase.from('clearing_agents').update(row).eq('id', edit.id) : await supabase.from('clearing_agents').insert(row);
    if (error) { alert(error.message); return; }
    setEdit(null); load();
  }
  async function toggleActive(a: Agent) {
    const { error } = await supabase.from('clearing_agents').update({ is_active: !a.is_active }).eq('id', a.id);
    if (error) alert(error.message); else load();
  }
  async function deleteAgent(a: Agent) {
    if (lines.some((l) => l.agent_id === a.id)) { alert('This agent has account entries. Untick "Active" instead — the history stays.'); return; }
    if (!confirm(`Delete ${a.name}?`)) return;
    const { error } = await supabase.from('clearing_agents').delete().eq('id', a.id);
    if (error) alert(error.message.includes('foreign key') ? 'This agent is used on a shipment or in another book. Untick "Active" instead.' : error.message); else load();
  }

  // ---------- one agent's account ----------
  const agent = agents.find((a) => a.id === openId) || null;
  const myLines = useMemo(() => {
    let bal = 0;
    return lines.filter((l) => l.agent_id === openId).map((l) => { bal += l.kind === 'charge' ? l.amount : -l.amount; return { ...l, bal }; });
  }, [lines, openId]);

  async function saveEntry() {
    if (!entry || !agent) return;
    const amount = Number(entry.amount);
    if (!(amount > 0)) { alert('Type an amount'); return; }
    const { error } = await supabase.from('agent_ledger').insert({
      agent_id: agent.id, entry_date: entry.entry_date, kind: entry.kind, amount,
      payment_mode: entry.kind === 'payment' ? entry.payment_mode : null,
      reference: entry.reference.trim() || null, note: entry.note.trim() || null,
    });
    if (error) { alert(error.message); return; }
    setEntry(null); load();
  }
  async function deleteLine(l: Line) {
    if (!confirm(`Delete this ${l.kind} of ${rs(l.amount)}?`)) return;
    const { error } = await supabase.from('agent_ledger').delete().eq('id', l.id);
    if (error) alert(error.message); else load();
  }
  function printStatement() {
    if (!agent) return;
    const w = window.open('', '_blank'); if (!w) return;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const owe = myLines.filter((l) => l.kind === 'charge').reduce((t, l) => t + l.amount, 0);
    const paid = myLines.filter((l) => l.kind === 'payment').reduce((t, l) => t + l.amount, 0);
    w.document.write(`<html><head><title>${esc(agent.name)} statement</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:28px}h2{margin:0}p{color:#555;margin:2px 0 14px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px}th{background:#f3f4f6;text-align:left;font-size:10px;text-transform:uppercase}.r{text-align:right}tfoot td{font-weight:bold;border-top:2px solid #333}</style></head><body>
      <h2>${esc(agent.name)} — account statement</h2><p>${agent.phone ? esc(agent.phone) + ' · ' : ''}${esc(book)} · printed ${today()}</p>
      <table><thead><tr><th>Date</th><th>Details</th><th class="r">Charge</th><th class="r">Paid</th><th class="r">Balance</th></tr></thead><tbody>
      ${myLines.map((l) => `<tr><td>${l.entry_date}</td><td>${esc([l.reference, l.payment_mode, l.note].filter(Boolean).join(' · '))}</td><td class="r">${l.kind === 'charge' ? n0(l.amount) : ''}</td><td class="r">${l.kind === 'payment' ? n0(l.amount) : ''}</td><td class="r">${n0(l.bal)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td></td><td>Total</td><td class="r">${n0(owe)}</td><td class="r">${n0(paid)}</td><td class="r">${n0(owe - paid)}</td></tr></tfoot></table>
      <p style="margin-top:14px">${owe - paid > 0 ? 'Balance we owe: Rs ' + n0(owe - paid) : owe - paid < 0 ? 'Advance with the agent: Rs ' + n0(paid - owe) : 'Account settled.'}</p>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (missing) return <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">Clearing agents are not set up yet — run <b>clearing-agents-setup.sql</b> in Supabase, then refresh.</div>;

  // ---------- account view ----------
  if (agent) {
    const bal = myLines.length ? myLines[myLines.length - 1].bal : 0;
    const owe = myLines.filter((l) => l.kind === 'charge').reduce((t, l) => t + l.amount, 0);
    const paid = myLines.filter((l) => l.kind === 'payment').reduce((t, l) => t + l.amount, 0);
    return (
      <div>
        <button onClick={() => setOpenId(null)} className="text-sm text-teal-700 flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" />All agents</button>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{agent.name}</h2>
            <p className="text-sm text-gray-500">{agent.phone ? <a href={`tel:${agent.phone}`} className="hover:underline">{agent.phone}</a> : 'No phone'} · {book}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setEntry({ kind: 'payment', entry_date: today(), amount: '', payment_mode: 'Bank', reference: '', note: '' })} className="px-3 py-2 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1.5"><Plus className="w-4 h-4" />Payment</button>
            <button onClick={() => setEntry({ kind: 'charge', entry_date: today(), amount: '', payment_mode: '', reference: '', note: '' })} className="px-3 py-2 border border-gray-300 bg-white rounded-lg text-sm flex items-center gap-1.5"><Plus className="w-4 h-4" />Charge</button>
            <button onClick={printStatement} className="px-3 py-2 border border-gray-300 bg-white rounded-lg text-sm flex items-center gap-1.5"><Printer className="w-4 h-4" />Statement</button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-white border border-gray-200 rounded-lg p-3"><div className="text-xs text-gray-500">Charged</div><div className="text-lg font-bold tabular-nums">{rs(owe)}</div></div>
          <div className="bg-white border border-gray-200 rounded-lg p-3"><div className="text-xs text-gray-500">Paid</div><div className="text-lg font-bold tabular-nums">{rs(paid)}</div></div>
          <div className={`border rounded-lg p-3 ${bal > 0.5 ? 'bg-rose-50 border-rose-200' : bal < -0.5 ? 'bg-sky-50 border-sky-200' : 'bg-green-50 border-green-200'}`}>
            <div className="text-xs text-gray-500">{bal > 0.5 ? 'We owe' : bal < -0.5 ? 'Advance with agent' : 'Settled'}</div>
            <div className="text-lg font-bold tabular-nums">{rs(Math.abs(bal))}</div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          {myLines.length === 0 ? <p className="p-6 text-sm text-gray-500">No entries yet. Shipment charges arrive here when you press “Post to agent account” in Shipping → Charges.</p> : (
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-[11px] uppercase text-gray-500"><tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Details</th><th className="px-3 py-2 text-right">Charge</th><th className="px-3 py-2 text-right">Paid</th><th className="px-3 py-2 text-right">Balance</th><th /></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {myLines.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">{l.entry_date}</td>
                    <td className="px-3 py-2 text-gray-700">{[l.reference, l.payment_mode, l.note].filter(Boolean).join(' · ') || (l.kind === 'charge' ? 'Charge' : 'Payment')}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.kind === 'charge' ? n0(l.amount) : ''}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-700">{l.kind === 'payment' ? n0(l.amount) : ''}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{n0(l.bal)}</td>
                    <td className="px-2 py-2 text-right"><button onClick={() => deleteLine(l)} className="p-1 text-gray-400 hover:text-red-600" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {entry && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEntry(null)}>
            <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-lg shadow-xl w-full max-w-md p-5">
              <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">{entry.kind === 'payment' ? `Pay ${agent.name}` : `Add a charge — ${agent.name}`}</h3><button onClick={() => setEntry(null)}><X className="w-5 h-5 text-gray-400" /></button></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500">Date</label><input type="date" className={input} value={entry.entry_date} onChange={(e) => setEntry({ ...entry, entry_date: e.target.value })} /></div>
                <div><label className="text-xs text-gray-500">Amount (Rs)</label><input type="number" inputMode="decimal" className={input} value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} autoFocus /></div>
                {entry.kind === 'payment' && <div><label className="text-xs text-gray-500">Paid by</label><select className={input} value={entry.payment_mode} onChange={(e) => setEntry({ ...entry, payment_mode: e.target.value })}>{MODES.map((m) => <option key={m}>{m}</option>)}</select></div>}
                <div className={entry.kind === 'payment' ? '' : 'col-span-2'}><label className="text-xs text-gray-500">{entry.kind === 'payment' ? 'Cheque / ref no.' : 'Reference (e.g. invoice no.)'}</label><input className={input} value={entry.reference} onChange={(e) => setEntry({ ...entry, reference: e.target.value })} /></div>
                <div className="col-span-2"><label className="text-xs text-gray-500">Note</label><input className={input} value={entry.note} onChange={(e) => setEntry({ ...entry, note: e.target.value })} /></div>
              </div>
              {entry.kind === 'charge' && <p className="text-[11px] text-gray-500 mt-2">Shipment charges are posted from Shipping → Charges. Use this only for extra charges not tied to a shipment.</p>}
              <div className="flex justify-end gap-2 mt-4"><button onClick={() => setEntry(null)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">Cancel</button><button onClick={saveEntry} className="px-4 py-1.5 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1"><Check className="w-4 h-4" />Save</button></div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---------- list view ----------
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Truck className="w-6 h-6 text-teal-600" />Clearing Agents</h2>
          <p className="text-sm text-gray-500">{book} · we owe agents <b>{rs(totalOwed)}</b></p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600 flex items-center gap-1.5"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show inactive</label>
          <button onClick={() => setEdit({ name: '', phone: '' })} className="px-3 py-2 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1.5"><Plus className="w-4 h-4" />Add agent</button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
        {shown.length === 0 && <p className="p-6 text-sm text-gray-500 text-center">No agents yet. Tap “Add agent”.</p>}
        {shown.map((a) => {
          const bal = balanceOf(a.id);
          return (
            <div key={a.id} className={`px-4 py-3 flex items-center gap-3 ${a.is_active ? '' : 'opacity-50'}`}>
              <button onClick={() => setOpenId(a.id)} className="flex-1 min-w-0 text-left">
                <div className="font-medium text-gray-900 truncate">{a.name}{!a.is_active && <span className="ml-2 text-[10px] uppercase bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Inactive</span>}</div>
                <div className="text-xs text-gray-500 flex items-center gap-1">{a.phone ? <><Phone className="w-3 h-3" />{a.phone}</> : 'No phone'}</div>
              </button>
              <button onClick={() => setOpenId(a.id)} className="text-right">
                <div className={`text-sm font-semibold tabular-nums ${bal > 0.5 ? 'text-rose-600' : bal < -0.5 ? 'text-sky-600' : 'text-green-700'}`}>{bal > 0.5 ? rs(bal) : bal < -0.5 ? `${rs(-bal)} adv.` : 'Settled'}</div>
                <div className="text-[11px] text-gray-400">open account →</div>
              </button>
              {!locked && <div className="flex items-center gap-1">
                <button onClick={() => setEdit({ id: a.id, name: a.name, phone: a.phone ?? '' })} className="p-1.5 text-gray-400 hover:text-teal-700" title="Edit"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => toggleActive(a)} className="p-1.5 text-gray-400 hover:text-gray-900 text-[11px]" title={a.is_active ? 'Make inactive' : 'Make active'}>{a.is_active ? 'Hide' : 'Show'}</button>
                <button onClick={() => deleteAgent(a)} className="p-1.5 text-gray-400 hover:text-red-600" title="Delete"><Trash2 className="w-4 h-4" /></button>
              </div>}
            </div>
          );
        })}
      </div>

      {edit && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEdit(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5">
            <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">{edit.id ? 'Edit agent' : 'Add agent'}</h3><button onClick={() => setEdit(null)}><X className="w-5 h-5 text-gray-400" /></button></div>
            <div className="space-y-3">
              <div><label className="text-xs text-gray-500">Name</label><input className={input} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus placeholder="e.g. Ruwan – Ocean Link" /></div>
              <div><label className="text-xs text-gray-500">Phone</label><input className={input} type="tel" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} placeholder="077 123 4567" /></div>
            </div>
            <div className="flex justify-end gap-2 mt-4"><button onClick={() => setEdit(null)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">Cancel</button><button onClick={saveAgent} className="px-4 py-1.5 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1"><Check className="w-4 h-4" />Save</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
