import { useEffect, useMemo, useState } from 'react';
import { X, Check, Send, AlertTriangle, History } from 'lucide-react';
import ChangeHistory from './ChangeHistory';
import { supabase } from '../lib/supabase';
import { fetchAllPages, selectByIds } from '../lib/fetchAll';
import { loadItemCharges, refreshShipmentCharges, saveItemCharges, syncCostingCharges, chargeQty } from '../lib/costingCharges';
import type { ChargeBasis, ItemCharge } from '../lib/costingCharges';

/* Shipping charges for one shipment (v110), PER PACKING LIST:
   each PL shows its total kg / CBM / pieces from Packing List; the owner picks the type (KG / CBM / PCS) and types the rate.
   PL charge = PL total x rate; the shipment's bulk amount = all PL charges added up.
   On Save every item of the PL gets the same type and rate (item charge = its own kg / CBM / qty x rate), so Costing
   follows by itself. Items given a different charge in Costing (another type or rate, or Fixed) are left as they are.
   "Agent's invoice" is only typed when the agent billed a different total; it is then what is posted to the agent. */

type Basis = Exclude<ChargeBasis, 'FIXED'>;
const BASES: Basis[] = ['KG', 'CBM', 'PCS'];
export interface ChargeShipment {
  id: string; shipment_no: string; default_basis?: string | null;
  rate_cbm?: number | null; rate_kg?: number | null; rate_pcs?: number | null;
  agent_id?: string | null; other_charges?: number | null; agent_invoice?: number | null; eta?: string | null;
}
interface Agent { id: string; name: string; phone: string | null; is_active: boolean }
interface Item { id: string; item_name: string; quantity: number; weight_kg: number; cbm: number; packing_list_no: string; pl_input_id: string | null }
interface PL { key: string; plNo: string; bill: string; items: Item[]; kg: number; cbm: number; pcs: number }
interface Edit { basis: Basis | ''; rate: string }

const n0 = (v: number) => Math.round(v).toLocaleString('en-US');
const n2 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });
const n3 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const num = (s: string) => { const v = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(v) ? v : 0; };
const today = () => new Date().toISOString().slice(0, 10);
const r2 = (v: number) => Math.round(v * 100) / 100;
const total = (p: PL, b: Basis) => (b === 'KG' ? p.kg : b === 'CBM' ? p.cbm : p.pcs);
const word = (b: Basis) => (b === 'KG' ? 'kg' : b === 'CBM' ? 'CBM' : 'pcs');

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
  const [billOf, setBillOf] = useState<Record<string, string>>({});   // pl_input id -> bill number
  const [charges, setCharges] = useState<Map<string, ItemCharge>>(new Map());
  const [edits, setEdits] = useState<Record<string, Edit>>({});       // per packing list
  const [agentId, setAgentId] = useState<string>(shipment.agent_id || '');
  const [invoice, setInvoice] = useState<string>(shipment.agent_invoice ? String(shipment.agent_invoice) : '');
  const [posted, setPosted] = useState<{ id: string; amount: number; agent_id: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [didSave, setDidSave] = useState(false);
  // the Shipping list is refreshed when this window closes (refreshing it earlier would reset this window)
  const close = () => { if (didSave) onSaved(); onClose(); };

  const defaultRate = (b: Basis) => Number(b === 'CBM' ? shipment.rate_cbm : b === 'KG' ? shipment.rate_kg : shipment.rate_pcs) || 0;
  const plKey = (i: Item) => `${i.pl_input_id ?? '-'}|${i.packing_list_no || '-'}`;

  async function load() {
    // item charges brought up to date with Packing List first (kg / CBM may have changed)
    await refreshShipmentCharges(shipment.id);
    const ch = await loadItemCharges(shipment.id);
    if (ch.error && !/does not exist|schema cache/i.test(ch.error)) throw new Error(`Could not load the item charges: ${ch.error}`);
    type PRaw = { id: string; item_name: string | null; quantity: number | null; weight_kg: number | null; cbm: number | null; packing_list_no: string | null; pl_input_id: string | null };
    const pi = await fetchAllPages<PRaw>(() => supabase.from('packing_list_items')
      .select('id, item_name, quantity, weight_kg, cbm, packing_list_no, pl_input_id').eq('batch_number', shipment.shipment_no).order('id'));
    if (pi.error) throw new Error(`Could not load the packing list items: ${pi.error}`);
    const rows: Item[] = pi.data.map((p) => ({ id: p.id, item_name: p.item_name || '—', quantity: Number(p.quantity) || 0, weight_kg: Number(p.weight_kg) || 0, cbm: Number(p.cbm) || 0, packing_list_no: p.packing_list_no || '', pl_input_id: p.pl_input_id }));
    return { map: ch.map, rows };
  }

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

      const { map, rows } = await load();
      setCharges(map); setItems(rows);

      // bill number of each PL Input (only shown when the shipment has more than one bill)
      const pl = await selectByIds<{ id: string; purchase_bill_id: string | null }>('pl_input', 'id, purchase_bill_id', 'id', rows.map((r) => r.pl_input_id || ''));
      const bl = await selectByIds<{ id: string; bill_number: string | null }>('purchase_bills', 'id, bill_number', 'id', pl.data.map((p) => p.purchase_bill_id || ''));
      const bn = new Map(bl.data.map((b) => [b.id, b.bill_number || '']));
      const bo: Record<string, string> = {};
      pl.data.forEach((p) => { if (p.purchase_bill_id) bo[p.id] = bn.get(p.purchase_bill_id) || ''; });
      setBillOf(bo);

      // each PL: the type and rate most of its items carry (else the shipment's default type)
      const start: Basis = (BASES as string[]).includes(String(shipment.default_basis)) ? (shipment.default_basis as Basis) : 'KG';
      const byPl = new Map<string, Item[]>();
      rows.forEach((i) => byPl.set(plKey(i), [...(byPl.get(plKey(i)) ?? []), i]));
      const e: Record<string, Edit> = {};
      byPl.forEach((its, k) => {
        const count = new Map<string, number>();
        its.forEach((i) => { const c = map.get(i.id); if (c && c.basis !== 'FIXED') { const kk = `${c.basis}|${c.rate}`; count.set(kk, (count.get(kk) || 0) + 1); } });
        const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (best) { const [b, r] = best.split('|'); e[k] = { basis: b as Basis, rate: Number(r) ? r : '' }; }
        else e[k] = { basis: start, rate: defaultRate(start) ? String(defaultRate(start)) : '' };
      });
      setEdits(e);
      setLoading(false);
    })().catch((err) => { setLoadErr(plain((err as Error).message).replace(/^Could not save: /, 'Could not load: ')); setLoading(false); });
  }, [shipment.id, shipment.shipment_no]); // eslint-disable-line react-hooks/exhaustive-deps

  const pls = useMemo<PL[]>(() => {
    const m = new Map<string, PL>();
    items.forEach((i) => {
      const k = plKey(i);
      const p = m.get(k) ?? { key: k, plNo: i.packing_list_no || '—', bill: i.pl_input_id ? billOf[i.pl_input_id] || '' : '', items: [], kg: 0, cbm: 0, pcs: 0 };
      p.items.push(i); p.kg += i.weight_kg; p.cbm += i.cbm; p.pcs += i.quantity; m.set(k, p);
    });
    return [...m.values()].sort((a, b) => a.bill.localeCompare(b.bill) || a.plNo.localeCompare(b.plNo, undefined, { numeric: true }));
  }, [items, billOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const manyBills = new Set(pls.map((p) => p.bill)).size > 1;

  /** the type + rate the PL had when it was loaded (the type + rate most of its items carry) */
  const loadedPl = useMemo(() => {
    const m = new Map<string, { basis: string; rate: number } | null>();
    pls.forEach((p) => {
      const count = new Map<string, number>();
      p.items.forEach((i) => { const c = charges.get(i.id); if (c && c.basis !== 'FIXED') { const kk = `${c.basis}|${c.rate}`; count.set(kk, (count.get(kk) || 0) + 1); } });
      const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      m.set(p.key, best ? { basis: best.split('|')[0], rate: Number(best.split('|')[1]) } : null);
    });
    return m;
  }, [pls, charges]); // eslint-disable-line react-hooks/exhaustive-deps
  /** false = the item was given its own charge in Costing (Fixed, or another type / rate than its PL): kept as it is */
  const follows = (i: Item, _e?: Edit) => {
    const c = charges.get(i.id); if (!c) return true;
    if (c.basis === 'FIXED') return false;
    const lp = loadedPl.get(plKey(i));
    return !!lp && c.basis === lp.basis && c.rate === lp.rate;
  };

  /** what the PL comes to: items following the PL at its type x rate, plus items with their own charge */
  const plAmount = (p: PL) => {
    const e = edits[p.key];
    return p.items.reduce((t, i) => {
      if (!follows(i, e)) return t + (charges.get(i.id)?.amount ?? 0);
      return t + (e && e.basis ? chargeQty(i, e.basis) * num(e.rate) : 0);
    }, 0);
  };
  const bulk = useMemo(() => pls.reduce((t, p) => t + plAmount(p), 0), [pls, edits, charges]); // eslint-disable-line react-hooks/exhaustive-deps
  const invoiceV = num(invoice);
  const postAmount = invoiceV > 0 ? invoiceV : bulk;
  const agent = agents.find((a) => a.id === agentId) || null;

  function setBasis(p: PL, b: Basis) {
    const used = Object.values(edits).find((x) => x.basis === b && num(x.rate) > 0)?.rate;
    setEdits({ ...edits, [p.key]: { basis: b, rate: used ?? (defaultRate(b) ? String(defaultRate(b)) : '') } });
  }
  const setRate = (p: PL, v: string) => setEdits({ ...edits, [p.key]: { ...edits[p.key], rate: v } });

  async function save(post: boolean) {
    setMsg(''); setOkMsg('');
    if (post && !agentId) { setMsg('Pick the agent first.'); return; }
    if (post && !(postAmount > 0)) { setMsg('Nothing to post — put a rate on the packing lists first.'); return; }
    setSaving(true);
    try {
      // 1. every item of each PL takes the PL's type and rate (items with their own charge from Costing are kept)
      const changes: { itemId: string; basis: ChargeBasis; rate: number }[] = [];
      pls.forEach((p) => {
        const e = edits[p.key];
        if (!e || !e.basis || !(num(e.rate) > 0)) return;
        p.items.forEach((i) => { if (follows(i, e)) changes.push({ itemId: i.id, basis: e.basis as Basis, rate: num(e.rate) }); });
      });
      const s1 = await saveItemCharges(shipment.id, changes);
      if (s1.error) throw new Error(s1.error);

      // 2. the shipment: agent's invoice only when typed (else the total of the packing lists)
      const up: Record<string, unknown> = { agent_id: agentId || null, agent_invoice: invoiceV };
      if (agent) up.forwarder = agent.name;
      const { error: e3 } = await supabase.from('shipments').update(up).eq('id', shipment.id);
      if (e3) throw new Error(e3.message);

      // 3. per-bill totals, shipment total, then Costing
      const s2 = await refreshShipmentCharges(shipment.id);
      if (s2.error) throw new Error(s2.error);
      const sync = await syncCostingCharges(shipment.shipment_no);

      // 4. the agent's account (one line per shipment)
      if (post) {
        const line = { agent_id: agentId, amount: r2(postAmount), reference: `Shipment ${shipment.shipment_no}`, note: `${pls.length} packing list${pls.length === 1 ? '' : 's'} · ${items.length} item${items.length === 1 ? '' : 's'}`, shipment_id: shipment.id, kind: 'charge' as const };
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
      const fresh = await load();
      setCharges(fresh.map); setItems(fresh.rows);
      setDidSave(true);
      if (sync.error) setMsg(`Saved, but Costing was not updated: ${plain(sync.error).replace(/^Could not save: /, '')}`);
      else setOkMsg(`Saved${post ? ` and posted Rs ${n0(postAmount)} to ${agent?.name ?? 'the agent'}` : ''} — ${sync.updated} costing line${sync.updated === 1 ? '' : 's'} updated.`);
    } catch (err) {
      setMsg(plain((err as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-end sm:items-center justify-center sm:p-4" onClick={() => !saving && close()}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white sm:rounded-xl shadow-xl w-full max-w-4xl h-[100dvh] sm:h-auto sm:max-h-[92vh] flex flex-col">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between gap-2">
          <div><h3 className="font-semibold text-gray-900">Shipping charges — {shipment.shipment_no}</h3><p className="text-xs text-gray-500">Kg / CBM / pieces come from Packing List. Pick the type and type the rate for each packing list — Costing follows.</p></div>
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
              <div className="mb-4">
                <label className="text-xs text-gray-500">Clearing agent</label>
                <select className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="">— pick the agent —</option>
                  {agents.filter((a) => a.is_active || a.id === agentId).map((a) => <option key={a.id} value={a.id}>{a.name}{a.phone ? ` · ${a.phone}` : ''}</option>)}
                </select>
                {agents.length === 0 && <p className="text-[11px] text-amber-700 mt-1">No agents yet — add one in Masters → Clearing Agents.</p>}
                {posted && <div className="text-xs bg-green-50 border border-green-200 rounded-lg px-3 py-2 mt-2 text-green-800">Posted to {agents.find((a) => a.id === posted.agent_id)?.name ?? 'agent'}: Rs {n0(posted.amount)}. Posting again updates that line.</div>}
              </div>

              {items.length === 0 ? (
                <p className="text-sm bg-gray-50 border border-gray-200 rounded-lg p-3 text-gray-600">No packing list items for this shipment yet — import them in PL Input / Packing List first.</p>
              ) : (
                <div className="space-y-2">
                  {pls.map((p) => {
                    const e = edits[p.key] ?? { basis: '', rate: '' };
                    const b = (e.basis || 'KG') as Basis;
                    const tot = total(p, b);
                    const own = p.items.filter((i) => !follows(i, e));
                    const noMetric = e.basis ? p.items.filter((i) => follows(i, e) && !(chargeQty(i, b) > 0)) : [];
                    const amt = plAmount(p);
                    return (
                      <div key={p.key} className="border border-gray-200 rounded-lg p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-gray-900">PL {p.plNo}{manyBills && p.bill ? <span className="font-normal text-gray-500 text-xs"> · Bill {p.bill}</span> : null} <span className="font-normal text-gray-500 text-xs">· {p.items.length} item{p.items.length === 1 ? '' : 's'}</span></div>
                            <div className="text-xs text-gray-600 tabular-nums mt-0.5">
                              <span className={b === 'KG' && e.basis ? 'font-bold text-gray-900' : ''}>{n2(p.kg)} kg</span> · <span className={b === 'CBM' && e.basis ? 'font-bold text-gray-900' : ''}>{n3(p.cbm)} CBM</span> · <span className={b === 'PCS' && e.basis ? 'font-bold text-gray-900' : ''}>{n2(p.pcs)} pcs</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0"><div className="text-[10px] text-gray-500">Charge</div><div className="font-bold tabular-nums text-gray-900">Rs {n0(amt)}</div></div>
                        </div>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                            {BASES.map((x) => (
                              <button key={x} type="button" onClick={() => setBasis(p, x)} className={`px-3 py-1.5 text-sm ${e.basis === x ? 'bg-teal-600 text-white' : 'bg-white text-gray-700'}`}>{x}</button>
                            ))}
                          </div>
                          <span className="text-sm text-gray-500">Rate Rs</span>
                          <input className="w-28 px-2 py-1.5 border border-gray-300 rounded text-sm text-right tabular-nums" inputMode="decimal" placeholder={`per ${word(b)}`} value={e.rate} onChange={(ev) => setRate(p, ev.target.value)} />
                          {e.basis && num(e.rate) > 0 && own.length === 0 && <span className="text-xs text-gray-500 tabular-nums">{n2(tot)} {word(b)} × {n0(num(e.rate))} = Rs {n0(tot * num(e.rate))}</span>}
                        </div>
                        {own.length > 0 && <p className="text-[11px] text-sky-800 bg-sky-50 border border-sky-100 rounded px-2 py-1 mt-2">Charged differently in Costing (kept): {own.map((i) => { const c = charges.get(i.id)!; return `${i.item_name} — ${c.basis === 'FIXED' ? 'Fixed' : `${c.basis} ${n0(c.rate)}`} = Rs ${n0(c.amount)}`; }).join('; ')}</p>}
                        {noMetric.length > 0 && <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">No {word(b)} in Packing List for: <b>{noMetric.map((i) => i.item_name).join(', ')}</b> — {noMetric.length === p.items.length ? 'nothing to charge until it is filled in.' : 'they carry nothing until it is filled in.'}</p>}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-3 mt-4">
                <div className="rounded-lg bg-teal-50 border border-teal-200 p-3">
                  <div className="text-[11px] text-teal-700">Bulk amount (all packing lists)</div>
                  <div className="text-xl font-bold tabular-nums text-teal-900">Rs {n0(bulk)}</div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Agent’s invoice — only if the agent billed a different total (Rs)</label>
                  <input className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-right tabular-nums" inputMode="decimal" value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="leave empty if the same" />
                  {invoiceV > 0 && Math.abs(invoiceV - bulk) >= 1 && <p className="text-[11px] text-amber-700 mt-0.5"><AlertTriangle className="w-3 h-3 inline mr-0.5" />Rs {n0(Math.abs(invoiceV - bulk))} {invoiceV > bulk ? 'more' : 'less'} than the packing lists — Rs {n0(invoiceV)} is posted to the agent; item costs use the packing-list rates.</p>}
                </div>
              </div>
              {msg && <p className="text-sm text-red-600 mt-3">{msg}</p>}
              {okMsg && <p className="text-sm text-green-700 mt-3"><Check className="w-4 h-4 inline mr-1" />{okMsg}</p>}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex flex-wrap justify-end gap-2">
          <button onClick={close} disabled={saving} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">{okMsg ? 'Close' : 'Cancel'}</button>
          {!loading && !missing && !loadErr && <>
            <button onClick={() => save(false)} disabled={saving} className="px-4 py-2 text-sm border border-teal-600 text-teal-700 rounded-lg disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => save(true)} disabled={saving || !(postAmount > 0)} className="px-4 py-2 text-sm bg-teal-600 text-white rounded-lg flex items-center gap-1.5 disabled:opacity-50"><Send className="w-4 h-4" />{saving ? 'Saving…' : `Save & post Rs ${n0(postAmount)} to agent`}</button>
          </>}
        </div>
      </div>
    </div>
  );
}
