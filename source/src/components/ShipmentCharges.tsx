import { useEffect, useMemo, useState } from 'react';
import { X, Check, Send, AlertTriangle, History } from 'lucide-react';
import ChangeHistory from './ChangeHistory';
import { supabase } from '../lib/supabase';
import { fetchAllPages } from '../lib/fetchAll';
import { loadItemCharges, refreshShipmentCharges } from '../lib/costingCharges';
import type { ItemCharge } from '../lib/costingCharges';

/* Shipping charges for one shipment (v109): only the BULK amount — what the agent billed for the whole shipment.
   "Save & post" puts it into the agent's account (one line per shipment).
   The charge on each item is put in Costing (type + rate per item); this screen shows how much of the bulk
   amount is already on the items, per packing list, and the difference. */

export interface ChargeShipment {
  id: string; shipment_no: string; default_basis?: string | null;
  rate_cbm?: number | null; rate_kg?: number | null; rate_pcs?: number | null;
  agent_id?: string | null; other_charges?: number | null; agent_invoice?: number | null; eta?: string | null;
}
interface Agent { id: string; name: string; phone: string | null; is_active: boolean }
interface Item { id: string; item_name: string; quantity: number; weight_kg: number; cbm: number; packing_list_no: string }
interface PL { key: string; items: Item[]; kg: number; cbm: number; charged: number; noCharge: number }

const n0 = (v: number) => Math.round(v).toLocaleString('en-US');
const n2 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n3 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const num = (s: string) => { const v = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(v) ? v : 0; };
const today = () => new Date().toISOString().slice(0, 10);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Supabase / network errors in plain English. */
function plain(msg: string): string {
  const m = (msg || '').toLowerCase();
  if (m.includes('failed to fetch') || m.includes('network')) return 'No connection to the database — check the internet and try again.';
  if (m.includes('row-level security') || m.includes('permission denied')) return 'You are not allowed to change this (this login or book is locked).';
  if (m.includes('all books')) return 'Switch to one book (not "All books") to save charges.';
  if (m.includes('closed') || m.includes('collection')) return `This book does not accept changes: ${msg}`;
  return `Could not save: ${msg}`;
}

export default function ShipmentCharges({ shipment, onClose, onSaved }: { shipment: ChargeShipment; onClose: () => void; onSaved: () => void }) {
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);       // clearing agents tables missing
  const [loadErr, setLoadErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [charges, setCharges] = useState<Map<string, ItemCharge>>(new Map());
  const [agentId, setAgentId] = useState<string>(shipment.agent_id || '');
  const [bulk, setBulk] = useState<string>(shipment.agent_invoice ? String(shipment.agent_invoice) : '');
  const [posted, setPosted] = useState<{ id: string; amount: number; agent_id: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [didSave, setDidSave] = useState(false);
  // the Shipping list is refreshed when this window closes (refreshing it earlier would reset this window)
  const close = () => { if (didSave) onSaved(); onClose(); };

  useEffect(() => {
    (async () => {
      const [ag, led] = await Promise.all([
        supabase.from('clearing_agents').select('*').order('name'),
        supabase.from('agent_ledger').select('id, amount, agent_id').eq('shipment_id', shipment.id).eq('kind', 'charge'),
      ]);
      if (ag.error || led.error) { setMissing(true); setLoading(false); return; }
      setAgents((ag.data ?? []) as Agent[]);
      const l = (led.data ?? [])[0] as { id: string; amount: number; agent_id: string } | undefined;
      if (l) setPosted({ id: l.id, amount: Number(l.amount) || 0, agent_id: l.agent_id });

      // item charges are brought up to date with Packing List first (kg / CBM may have changed)
      await refreshShipmentCharges(shipment.id);
      const ch = await loadItemCharges(shipment.id);
      if (ch.error && !/does not exist|schema cache/i.test(ch.error)) { setLoadErr(`Could not load the item charges: ${ch.error}`); setLoading(false); return; }
      setCharges(ch.map);

      type PRaw = { id: string; item_name: string | null; quantity: number | null; weight_kg: number | null; cbm: number | null; packing_list_no: string | null };
      const pi = await fetchAllPages<PRaw>(() => supabase.from('packing_list_items')
        .select('id, item_name, quantity, weight_kg, cbm, packing_list_no').eq('batch_number', shipment.shipment_no).order('id'));
      if (pi.error) { setLoadErr(`Could not load the packing list items: ${pi.error}`); setLoading(false); return; }
      setItems(pi.data.map((p) => ({ id: p.id, item_name: p.item_name || '—', quantity: Number(p.quantity) || 0, weight_kg: Number(p.weight_kg) || 0, cbm: Number(p.cbm) || 0, packing_list_no: p.packing_list_no || '' })));
      setLoading(false);
    })().catch((err) => { setLoadErr(plain((err as Error).message).replace(/^Could not save: /, 'Could not load: ')); setLoading(false); });
  }, [shipment.id, shipment.shipment_no]);

  const pls = useMemo<PL[]>(() => {
    const m = new Map<string, PL>();
    items.forEach((i) => {
      const k = i.packing_list_no || '—';
      const p = m.get(k) ?? { key: k, items: [], kg: 0, cbm: 0, charged: 0, noCharge: 0 };
      const c = charges.get(i.id);
      p.items.push(i); p.kg += i.weight_kg; p.cbm += i.cbm;
      if (c && c.amount > 0) p.charged += c.amount; else p.noCharge++;
      m.set(k, p);
    });
    return [...m.values()].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  }, [items, charges]);

  const onItems = useMemo(() => pls.reduce((t, p) => t + p.charged, 0), [pls]);
  const noCharge = useMemo(() => pls.reduce((t, p) => t + p.noCharge, 0), [pls]);
  const bulkV = num(bulk);
  const diff = bulkV - onItems;
  const agent = agents.find((a) => a.id === agentId) || null;

  async function save(post: boolean) {
    setMsg(''); setOkMsg('');
    if (post && !agentId) { setMsg('Pick the agent first.'); return; }
    if (post && !(bulkV > 0)) { setMsg('Type the bulk amount (the agent’s invoice total) first.'); return; }
    setSaving(true);
    try {
      // the shipment: bulk amount = the agent's invoice total = the shipment's charges
      const up: Record<string, unknown> = { agent_id: agentId || null, agent_invoice: bulkV, actual_charges: r2(bulkV > 0 ? bulkV : onItems + (Number(shipment.other_charges) || 0)) };
      if (agent) up.forwarder = agent.name;
      const { error: e3 } = await supabase.from('shipments').update(up).eq('id', shipment.id);
      if (e3) throw new Error(e3.message);

      // the agent's account (one line per shipment)
      if (post) {
        const line = { agent_id: agentId, amount: r2(bulkV), reference: `Shipment ${shipment.shipment_no}`, note: `Bulk charges · ${items.length} item${items.length === 1 ? '' : 's'}`, shipment_id: shipment.id, kind: 'charge' as const };
        if (posted?.id) {
          const { error: e4 } = await supabase.from('agent_ledger').update(line).eq('id', posted.id);
          if (e4) throw new Error(e4.message);
          setPosted({ id: posted.id, amount: line.amount, agent_id: agentId });
        } else {
          const { data: ins, error: e4 } = await supabase.from('agent_ledger').insert({ ...line, entry_date: today() }).select('id').single();
          if (e4) throw new Error(e4.message);
          setPosted({ id: (ins as { id: string } | null)?.id ?? '', amount: line.amount, agent_id: agentId });
        }
      }
      setDidSave(true);
      setOkMsg(post ? `Saved and posted Rs ${n0(bulkV)} to ${agent?.name ?? 'the agent'}.` : 'Saved.');
    } catch (err) {
      setMsg(plain((err as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-end sm:items-center justify-center sm:p-4" onClick={() => !saving && close()}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white sm:rounded-xl shadow-xl w-full max-w-3xl h-[100dvh] sm:h-auto sm:max-h-[92vh] flex flex-col">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between gap-2">
          <div><h3 className="font-semibold text-gray-900">Shipping charges — {shipment.shipment_no}</h3><p className="text-xs text-gray-500">Type the bulk amount the agent billed for this shipment. Put the charge on each item in <b>Costing</b>.</p></div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setHistoryOpen(true)} className="text-xs px-2 py-1 border border-gray-300 rounded flex items-center gap-1 text-gray-700"><History className="w-3.5 h-3.5" />History</button>
            <button onClick={close} className="text-gray-400"><X className="w-5 h-5" /></button>
          </div>
        </div>
        {historyOpen && <ChangeHistory batch={shipment.shipment_no} onClose={() => setHistoryOpen(false)} />}

        <div className="p-3 sm:p-5 overflow-y-auto flex-1 min-w-0">
          {loading ? <p className="text-sm text-gray-500">Loading…</p> : missing ? (
            <p className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900">Run <b>clearing-agents-setup.sql</b> in Supabase first, then refresh.</p>
          ) : loadErr ? (
            <p className="text-sm bg-rose-50 border border-rose-200 rounded-lg p-3 text-rose-700">{loadErr}</p>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Clearing agent</label>
                  <select className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                    <option value="">— pick the agent —</option>
                    {agents.filter((a) => a.is_active || a.id === agentId).map((a) => <option key={a.id} value={a.id}>{a.name}{a.phone ? ` · ${a.phone}` : ''}</option>)}
                  </select>
                  {agents.length === 0 && <p className="text-[11px] text-amber-700 mt-1">No agents yet — add one in Masters → Clearing Agents.</p>}
                </div>
                <div>
                  <label className="text-xs text-gray-500">Bulk amount — the agent’s invoice total (Rs)</label>
                  <input className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base font-semibold text-right tabular-nums" inputMode="decimal" value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="0" />
                </div>
              </div>
              {posted && <div className="text-xs bg-green-50 border border-green-200 rounded-lg px-3 py-2 mt-3 text-green-800">Posted to {agents.find((a) => a.id === posted.agent_id)?.name ?? 'agent'}: Rs {n0(posted.amount)}. Posting again updates that line.</div>}

              {/* check: how much of the bulk amount is on the items (set in Costing) */}
              <div className={`rounded-lg p-3 text-sm mt-4 ${bulkV <= 0 ? 'bg-gray-50 border border-gray-200' : Math.abs(diff) < 1 ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div><div className="text-[11px] text-gray-500">Bulk</div><div className="font-bold tabular-nums">Rs {n0(bulkV)}</div></div>
                  <div><div className="text-[11px] text-gray-500">On items (Costing)</div><div className="font-bold tabular-nums">Rs {n0(onItems)}</div></div>
                  <div><div className="text-[11px] text-gray-500">Difference</div><div className="font-bold tabular-nums">{bulkV <= 0 ? '—' : Math.abs(diff) < 1 ? <><Check className="w-4 h-4 inline" /> 0</> : `Rs ${n0(Math.abs(diff))}`}</div></div>
                </div>
                {bulkV > 0 && Math.abs(diff) >= 1 && (
                  <p className="text-[11px] mt-2 text-center"><AlertTriangle className="w-3.5 h-3.5 inline mr-1" />{diff > 0 ? `Rs ${n0(diff)} of the bulk amount is not on any item yet.` : `Items carry Rs ${n0(-diff)} MORE than the bulk amount.`} Fix it in Costing.</p>
                )}
                {noCharge > 0 && <p className="text-[11px] mt-1 text-center text-amber-700">{noCharge} item{noCharge === 1 ? ' has' : 's have'} no charge yet.</p>}
              </div>

              {items.length === 0 ? (
                <p className="text-sm bg-gray-50 border border-gray-200 rounded-lg p-3 text-gray-600 mt-4">No packing list items for this shipment yet — import them in PL Input / Packing List first.</p>
              ) : (
                <div className="border border-gray-200 rounded-lg mt-4 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-[11px] uppercase text-gray-500">
                      <tr><th className="px-3 py-2 text-left">Packing list</th><th className="px-3 py-2 text-right">Kg</th><th className="px-3 py-2 text-right hidden sm:table-cell">CBM</th><th className="px-3 py-2 text-right">On items (Rs)</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pls.map((p) => (
                        <tr key={p.key}>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-gray-900">PL {p.key} <span className="font-normal text-gray-500 text-xs">· {p.items.length} item{p.items.length === 1 ? '' : 's'}</span></div>
                            {p.noCharge > 0 && <div className="text-[11px] text-amber-700">{p.noCharge} without a charge</div>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{n2(p.kg)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600 hidden sm:table-cell">{n3(p.cbm)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">{p.charged > 0 ? n0(p.charged) : <span className="text-amber-600">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                      <tr><td className="px-3 py-2" colSpan={2}>On items</td><td className="hidden sm:table-cell" /><td className="px-3 py-2 text-right tabular-nums">Rs {n0(onItems)}</td></tr>
                    </tfoot>
                  </table>
                </div>
              )}
              <p className="text-[11px] text-gray-500 mt-2">To put the charge on each item: open <b>Costing → Batch {shipment.shipment_no}</b>, choose KG / CBM / PCS / Fixed and type the rate. Kg and CBM come from Packing List.</p>
              {msg && <p className="text-sm text-red-600 mt-3">{msg}</p>}
              {okMsg && <p className="text-sm text-green-700 mt-3"><Check className="w-4 h-4 inline mr-1" />{okMsg}</p>}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex flex-wrap justify-end gap-2">
          <button onClick={close} disabled={saving} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">{okMsg ? 'Close' : 'Cancel'}</button>
          {!loading && !missing && !loadErr && <>
            <button onClick={() => save(false)} disabled={saving} className="px-4 py-2 text-sm border border-teal-600 text-teal-700 rounded-lg disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => save(true)} disabled={saving || !(bulkV > 0)} className="px-4 py-2 text-sm bg-teal-600 text-white rounded-lg flex items-center gap-1.5 disabled:opacity-50"><Send className="w-4 h-4" />{saving ? 'Saving…' : `Save & post Rs ${n0(bulkV)} to agent`}</button>
          </>}
        </div>
      </div>
    </div>
  );
}
