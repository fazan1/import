import { useEffect, useMemo, useState } from 'react';
import { X, Check, Send, AlertTriangle, History, Wallet } from 'lucide-react';
import ChangeHistory from './ChangeHistory';
import { supabase } from '../lib/supabase';
import { fetchAllPages, selectByIds } from '../lib/fetchAll';
import { loadItemCharges, loadPlCharges, refreshShipmentCharges, chargeQty, plKeyOf } from '../lib/costingCharges';
import type { ChargeBasis, ItemCharge, PlCharge } from '../lib/costingCharges';

/* Shipping charges for one shipment (v111) — the BULK side:
   each packing list shows its total kg / CBM / pcs from Packing List; the owner picks the type and types the rate
   (or a fixed amount). PL charge = PL total x rate; all PLs added up = the bulk amount, billed to the clearing agent.
   Costing has its OWN charge per item (typed in Costing); each PL shows what Costing has on it and the difference.
   "Agent's invoice" only when the agent billed a different total; then that is posted.
   The agent is paid from here (or from Masters -> Clearing Agents): payments go into the same agent account. */

export interface ChargeShipment {
  id: string; shipment_no: string; default_basis?: string | null;
  rate_cbm?: number | null; rate_kg?: number | null; rate_pcs?: number | null;
  agent_id?: string | null; other_charges?: number | null; agent_invoice?: number | null; eta?: string | null;
}
interface Agent { id: string; name: string; phone: string | null; is_active: boolean }
interface Item { id: string; item_name: string; quantity: number; weight_kg: number; cbm: number; packing_list_no: string; pl_input_id: string | null }
interface PL { key: string; plNo: string; plInput: string | null; bill: string; items: Item[]; kg: number; cbm: number; pcs: number }
interface Edit { basis: ChargeBasis; rate: string; fixed: string }
interface LedgerLine { id: string; agent_id: string; kind: 'charge' | 'payment'; amount: number; entry_date: string; payment_mode: string | null; reference: string | null }

const BASES: ChargeBasis[] = ['KG', 'CBM', 'PCS', 'FIXED'];
const MODES = ['Bank', 'Cash', 'Cheque', 'Online', 'Other'];
const n0 = (v: number) => Math.round(v).toLocaleString('en-US');
const n2 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });
const n3 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const num = (s: string) => { const v = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(v) ? v : 0; };
const today = () => new Date().toISOString().slice(0, 10);
const r2 = (v: number) => Math.round(v * 100) / 100;
const totalOf = (p: PL, b: ChargeBasis) => (b === 'KG' ? p.kg : b === 'CBM' ? p.cbm : b === 'PCS' ? p.pcs : 0);
const word = (b: ChargeBasis) => (b === 'KG' ? 'kg' : b === 'CBM' ? 'CBM' : 'pcs');

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
  const [noPlTable, setNoPlTable] = useState(false);   // history-and-auto-charges.sql not run yet
  const [loadErr, setLoadErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [billOf, setBillOf] = useState<Record<string, string>>({});   // pl_input id -> bill number
  const [itemCharges, setItemCharges] = useState<Map<string, ItemCharge>>(new Map());
  const [plCharges, setPlCharges] = useState<Map<string, PlCharge>>(new Map());
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [agentId, setAgentId] = useState<string>(shipment.agent_id || '');
  const [invoice, setInvoice] = useState<string>(shipment.agent_invoice ? String(shipment.agent_invoice) : '');
  const [ledger, setLedger] = useState<LedgerLine[]>([]);
  const [pay, setPay] = useState<{ amount: string; entry_date: string; payment_mode: string; reference: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [didSave, setDidSave] = useState(false);
  // the Shipping list is refreshed when this window closes (refreshing it earlier would reset this window)
  const close = () => { if (didSave) onSaved(); onClose(); };

  const defaultRate = (b: ChargeBasis) => Number(b === 'CBM' ? shipment.rate_cbm : b === 'KG' ? shipment.rate_kg : b === 'PCS' ? shipment.rate_pcs : 0) || 0;

  async function loadLedger() {
    const { data, error } = await supabase.from('agent_ledger').select('id, agent_id, kind, amount, entry_date, payment_mode, reference').eq('shipment_id', shipment.id).order('entry_date');
    if (error) throw new Error(error.message);
    setLedger(((data ?? []) as LedgerLine[]).map((l) => ({ ...l, amount: Number(l.amount) || 0 })));
  }

  async function loadCharges() {
    const fr = await refreshShipmentCharges(shipment.id);           // kg / CBM may have changed in Packing List
    const [pc, ic] = await Promise.all([loadPlCharges(shipment.id), loadItemCharges(shipment.id)]);
    if (pc.missing) setNoPlTable(true);
    else if (pc.error) throw new Error(`Could not load the charges: ${pc.error}`);
    if (ic.error) throw new Error(`Could not load the costing charges: ${ic.error}`);
    if (fr.error && !pc.missing) setMsg(`The charges could not be brought up to date with Packing List: ${fr.error}`);
    setPlCharges(pc.map);
    setItemCharges(ic.map);
    return { pc: pc.map, ic: ic.map };
  }

  useEffect(() => {
    (async () => {
      const ag = await supabase.from('clearing_agents').select('*').order('name');
      if (ag.error) { setMissing(true); setLoading(false); return; }
      setAgents((ag.data ?? []) as Agent[]);
      try { await loadLedger(); } catch { setMissing(true); setLoading(false); return; }

      type PRaw = { id: string; item_name: string | null; quantity: number | null; weight_kg: number | null; cbm: number | null; packing_list_no: string | null; pl_input_id: string | null };
      const pi = await fetchAllPages<PRaw>(() => supabase.from('packing_list_items')
        .select('id, item_name, quantity, weight_kg, cbm, packing_list_no, pl_input_id').eq('batch_number', shipment.shipment_no).order('id'));
      if (pi.error) throw new Error(`Could not load the packing list items: ${pi.error}`);
      const rows: Item[] = pi.data.map((p) => ({ id: p.id, item_name: p.item_name || '—', quantity: Number(p.quantity) || 0, weight_kg: Number(p.weight_kg) || 0, cbm: Number(p.cbm) || 0, packing_list_no: p.packing_list_no || '', pl_input_id: p.pl_input_id }));
      setItems(rows);
      const { pc, ic } = await loadCharges();

      // bill number of each PL Input (shown when the shipment has more than one bill)
      const pl = await selectByIds<{ id: string; purchase_bill_id: string | null }>('pl_input', 'id, purchase_bill_id', 'id', rows.map((r) => r.pl_input_id || ''));
      const bl = await selectByIds<{ id: string; bill_number: string | null }>('purchase_bills', 'id, bill_number', 'id', pl.data.map((p) => p.purchase_bill_id || ''));
      const bn = new Map(bl.data.map((b) => [b.id, b.bill_number || '']));
      const bo: Record<string, string> = {};
      pl.data.forEach((p) => { if (p.purchase_bill_id) bo[p.id] = bn.get(p.purchase_bill_id) || ''; });
      setBillOf(bo);

      // each PL: its saved charge; else the type + rate most of its items carry in Costing; else the shipment's default
      const start: ChargeBasis = ['KG', 'CBM', 'PCS'].includes(String(shipment.default_basis)) ? (shipment.default_basis as ChargeBasis) : 'KG';
      const e: Record<string, Edit> = {};
      const keys = new Set(rows.map(plKeyOf));
      keys.forEach((k) => {
        const s = pc.get(k);
        if (s) { e[k] = { basis: s.basis, rate: s.basis === 'FIXED' ? '' : (s.rate ? String(s.rate) : ''), fixed: s.basis === 'FIXED' ? String(s.amount || '') : '' }; return; }
        const count = new Map<string, number>();
        rows.filter((i) => plKeyOf(i) === k).forEach((i) => { const c = ic.get(i.id); if (c && c.basis !== 'FIXED') { const kk = `${c.basis}|${c.rate}`; count.set(kk, (count.get(kk) || 0) + 1); } });
        const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (best) { const [b, r] = best.split('|'); e[k] = { basis: b as ChargeBasis, rate: Number(r) ? r : '', fixed: '' }; }
        else e[k] = { basis: start, rate: defaultRate(start) ? String(defaultRate(start)) : '', fixed: '' };
      });
      setEdits(e);
      setLoading(false);
    })().catch((err) => { setLoadErr(plain((err as Error).message).replace(/^Could not save: /, 'Could not load: ')); setLoading(false); });
  }, [shipment.id, shipment.shipment_no]); // eslint-disable-line react-hooks/exhaustive-deps

  const pls = useMemo<PL[]>(() => {
    const m = new Map<string, PL>();
    items.forEach((i) => {
      const k = plKeyOf(i);
      const p = m.get(k) ?? { key: k, plNo: i.packing_list_no || '—', plInput: i.pl_input_id, bill: i.pl_input_id ? billOf[i.pl_input_id] || '' : '', items: [], kg: 0, cbm: 0, pcs: 0 };
      p.items.push(i); p.kg += i.weight_kg; p.cbm += i.cbm; p.pcs += i.quantity; m.set(k, p);
    });
    return [...m.values()].sort((a, b) => a.bill.localeCompare(b.bill) || a.plNo.localeCompare(b.plNo, undefined, { numeric: true }));
  }, [items, billOf]);
  const manyBills = new Set(pls.map((p) => p.bill)).size > 1;

  const plAmount = (p: PL) => { const e = edits[p.key]; if (!e) return 0; return e.basis === 'FIXED' ? num(e.fixed) : totalOf(p, e.basis) * num(e.rate); };
  const costingOf = (p: PL) => p.items.reduce((t, i) => t + (itemCharges.get(i.id)?.amount ?? 0), 0);
  const bulk = pls.reduce((t, p) => t + plAmount(p), 0);
  const onItems = pls.reduce((t, p) => t + costingOf(p), 0);
  const invoiceV = num(invoice);
  const billAmount = invoiceV > 0 ? invoiceV : bulk;
  const agent = agents.find((a) => a.id === agentId) || null;
  const posted = ledger.find((l) => l.kind === 'charge') || null;
  const paid = ledger.filter((l) => l.kind === 'payment').reduce((t, l) => t + l.amount, 0);
  const toPay = (posted?.amount ?? 0) - paid;

  function setBasis(p: PL, b: ChargeBasis) {
    const used = Object.entries(edits).find(([k, x]) => k !== p.key && x.basis === b && num(x.rate) > 0)?.[1].rate;
    const cur = edits[p.key];
    setEdits({ ...edits, [p.key]: { basis: b, rate: b === 'FIXED' ? '' : (cur?.basis === b && cur.rate ? cur.rate : used ?? (defaultRate(b) ? String(defaultRate(b)) : '')), fixed: b === 'FIXED' ? (cur?.fixed || String(Math.round(plAmount(p)) || '')) : '' } });
  }
  const setField = (p: PL, f: 'rate' | 'fixed', v: string) => setEdits({ ...edits, [p.key]: { ...edits[p.key], [f]: v } });

  async function save(post: boolean) {
    setMsg(''); setOkMsg('');
    if (post && !agentId) { setMsg('Pick the agent first.'); return; }
    if (post && !(billAmount > 0)) { setMsg('Nothing to bill — put a rate on the packing lists first.'); return; }
    setSaving(true);
    try {
      // 1. the charge of each packing list (PLs with no rate / amount are not written)
      const rows: PlCharge[] = [];
      pls.forEach((p) => {
        const e = edits[p.key]; if (!e) return;
        const amt = plAmount(p);
        if (!(amt > 0) && !plCharges.has(p.key) && !(num(e.rate) > 0)) return;
        rows.push({ shipment_id: shipment.id, pl_key: p.key, pl_input_id: p.plInput, packing_list_no: p.plNo === '—' ? null : p.plNo, basis: e.basis,
          qty: e.basis === 'FIXED' ? 0 : Math.round(totalOf(p, e.basis) * 10000) / 10000, rate: e.basis === 'FIXED' ? 0 : num(e.rate), amount: r2(amt) });
      });
      if (rows.length) {
        const { error } = await supabase.from('shipment_pl_charges').upsert(rows, { onConflict: 'shipment_id,pl_key' });
        if (error) throw new Error(error.message);
      }

      // 2. the shipment: total billed = the agent's invoice when typed, else the packing lists
      // (same rule as refreshShipmentCharges: other charges are added when there is no agent's invoice)
      const up: Record<string, unknown> = { agent_id: agentId || null, agent_invoice: invoiceV, actual_charges: r2(invoiceV > 0 ? invoiceV : bulk + (Number(shipment.other_charges) || 0)) };
      if (agent) up.forwarder = agent.name;
      const { error: e3 } = await supabase.from('shipments').update(up).eq('id', shipment.id);
      if (e3) throw new Error(e3.message);

      // 3. bill the agent (one line per shipment; posting again updates it)
      if (post) {
        const line = { agent_id: agentId, amount: r2(billAmount), reference: `Shipment ${shipment.shipment_no}`, note: `${pls.length} packing list${pls.length === 1 ? '' : 's'}`, shipment_id: shipment.id, kind: 'charge' as const };
        if (posted) {
          const { error: e4 } = await supabase.from('agent_ledger').update(line).eq('id', posted.id);
          if (e4) throw new Error(e4.message);
        } else {
          const { error: e4 } = await supabase.from('agent_ledger').insert({ ...line, entry_date: today() });
          if (e4) throw new Error(e4.message);
        }
      }
      await loadCharges();
      await loadLedger();
      setDidSave(true);
      setOkMsg(post ? `Saved — Rs ${n0(billAmount)} billed to ${agent?.name ?? 'the agent'}.` : 'Saved.');
    } catch (err) {
      setMsg(plain((err as Error).message));
    } finally {
      setSaving(false);
    }
  }

  async function savePayment() {
    if (!pay) return;
    setMsg(''); setOkMsg('');
    const amount = num(pay.amount);
    if (!(amount > 0)) { setMsg('Type the amount paid.'); return; }
    const to = posted?.agent_id || agentId;
    if (!to) { setMsg('Pick the agent first.'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('agent_ledger').insert({ agent_id: to, kind: 'payment', amount: r2(amount), entry_date: pay.entry_date || today(), payment_mode: pay.payment_mode, reference: pay.reference || null, note: `Shipment ${shipment.shipment_no}`, shipment_id: shipment.id });
      if (error) throw new Error(error.message);
      await loadLedger();
      setPay(null); setDidSave(true);
      setOkMsg(`Payment of Rs ${n0(amount)} recorded.`);
    } catch (err) {
      setMsg(plain((err as Error).message));
    } finally {
      setSaving(false);
    }
  }

  const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';
  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-end sm:items-center justify-center sm:p-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-white sm:rounded-xl shadow-xl w-full max-w-4xl h-[100dvh] sm:h-auto sm:max-h-[92vh] flex flex-col">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between gap-2">
          <div><h3 className="font-semibold text-gray-900">Shipping charges — {shipment.shipment_no}</h3><ol className="text-xs text-gray-500 mt-0.5 space-y-0.5 list-decimal ml-4"><li>Total kg / CBM / pieces of each packing list come from <b>Packing List</b>.</li><li>Pick <b>KG</b> or <b>CBM</b> and type the agent’s <b>all-in rate</b> (freight + duty + clearing).</li><li>The <b>total bill</b> shows below — bill the agent, then make <b>Costing</b> and compare.</li></ol></div>
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
          ) : noPlTable ? (
            <p className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900">Run <b>history-and-auto-charges.sql</b> in Supabase once (MAIN project), then refresh — it adds the charge per packing list.</p>
          ) : (
            <>
              <div className="mb-4">
                <label className="text-xs text-gray-500">Clearing agent</label>
                <select className={input} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="">— pick the agent —</option>
                  {agents.filter((a) => a.is_active || a.id === agentId).map((a) => <option key={a.id} value={a.id}>{a.name}{a.phone ? ` · ${a.phone}` : ''}</option>)}
                </select>
                {agents.length === 0 && <p className="text-[11px] text-amber-700 mt-1">No agents yet — add one in Masters → Clearing Agents.</p>}
              </div>

              {items.length === 0 ? (
                <p className="text-sm bg-gray-50 border border-gray-200 rounded-lg p-3 text-gray-600">No packing list items for this shipment yet — import them in PL Input / Packing List first.</p>
              ) : (
                <div className="space-y-2">
                  {pls.map((p) => {
                    const e = edits[p.key] ?? { basis: 'KG' as ChargeBasis, rate: '', fixed: '' };
                    const amt = plAmount(p); const cost = costingOf(p); const d = amt - cost;
                    const tot = totalOf(p, e.basis);
                    return (
                      <div key={p.key} className="border border-gray-200 rounded-lg p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-gray-900">PL {p.plNo}{manyBills && p.bill ? <span className="font-normal text-gray-500 text-xs"> · Bill {p.bill}</span> : null} <span className="font-normal text-gray-500 text-xs">· {p.items.length} item{p.items.length === 1 ? '' : 's'}</span></div>
                            <div className="text-xs text-gray-600 tabular-nums mt-0.5">
                              <span className={e.basis === 'KG' ? 'font-bold text-gray-900' : ''}>{n2(p.kg)} kg</span> · <span className={e.basis === 'CBM' ? 'font-bold text-gray-900' : ''}>{n3(p.cbm)} CBM</span> · <span className={e.basis === 'PCS' ? 'font-bold text-gray-900' : ''}>{n2(p.pcs)} pcs</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0"><div className="text-[10px] text-gray-500">Charge</div><div className="font-bold tabular-nums text-gray-900">Rs {n0(amt)}</div></div>
                        </div>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                            {BASES.map((x) => (
                              <button key={x} type="button" onClick={() => setBasis(p, x)} className={`px-3 py-1.5 text-sm ${e.basis === x ? 'bg-teal-600 text-white' : 'bg-white text-gray-700'}`}>{x === 'FIXED' ? 'Fixed' : x}</button>
                            ))}
                          </div>
                          {e.basis === 'FIXED' ? (<>
                            <span className="text-sm text-gray-500">Amount Rs</span>
                            <input className="w-32 px-2 py-1.5 border border-gray-300 rounded text-sm text-right tabular-nums" inputMode="decimal" value={e.fixed} onChange={(ev) => setField(p, 'fixed', ev.target.value)} />
                          </>) : (<>
                            <span className="text-sm text-gray-500" title="all-in: freight + duty + clearing">All-in rate Rs</span>
                            <input className="w-28 px-2 py-1.5 border border-gray-300 rounded text-sm text-right tabular-nums" inputMode="decimal" placeholder={`per ${word(e.basis)}`} value={e.rate} onChange={(ev) => setField(p, 'rate', ev.target.value)} />
                            {num(e.rate) > 0 && <span className="text-xs text-gray-500 tabular-nums">{n2(tot)} {word(e.basis)} × {n2(num(e.rate))} = Rs {n0(amt)}</span>}
                          </>)}
                        </div>
                        {e.basis !== 'FIXED' && !(tot > 0) && <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">No {word(e.basis)} in Packing List for this packing list yet — fill it in there.</p>}
                        <div className={`text-[11px] mt-2 tabular-nums ${amt <= 0 ? 'text-gray-400' : Math.abs(d) < 1 ? 'text-green-700' : 'text-amber-700'}`}>
                          Costing: Rs {n0(cost)}{amt > 0 && (Math.abs(d) < 1 ? ' ✓ same' : ` · difference Rs ${n0(Math.abs(d))} ${d > 0 ? '(costing less)' : '(costing more)'}`)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* totals */}
              <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                <div className="rounded-lg bg-teal-50 border border-teal-200 p-2"><div className="text-[11px] text-teal-700">Total bill (all packing lists)</div><div className="text-lg font-bold tabular-nums text-teal-900">Rs {n0(bulk)}</div></div>
                <div className="rounded-lg bg-gray-50 border border-gray-200 p-2"><div className="text-[11px] text-gray-600">Costing (items)</div><div className="text-lg font-bold tabular-nums text-gray-900">Rs {n0(onItems)}</div></div>
                <div className={`rounded-lg border p-2 ${Math.abs(bulk - onItems) < 1 ? 'bg-green-50 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}><div className="text-[11px]">Difference</div><div className="text-lg font-bold tabular-nums">{Math.abs(bulk - onItems) < 1 ? <><Check className="w-4 h-4 inline" /> 0</> : `Rs ${n0(Math.abs(bulk - onItems))}`}</div></div>
              </div>
              <div className="mt-3">
                <label className="text-xs text-gray-500">Agent’s invoice — only if the agent’s bill is different (e.g. duty billed separately) (Rs)</label>
                <input className={`${input} text-right tabular-nums`} inputMode="decimal" value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="leave empty if the same as the bulk" />
                {invoiceV > 0 && Math.abs(invoiceV - bulk) >= 1 && <p className="text-[11px] text-amber-700 mt-0.5"><AlertTriangle className="w-3 h-3 inline mr-0.5" />Rs {n0(Math.abs(invoiceV - bulk))} {invoiceV > bulk ? 'more' : 'less'} than the packing lists — Rs {n0(invoiceV)} is billed to the agent.</p>}
              </div>

              {/* the agent's account for this shipment */}
              <div className="mt-4 border border-gray-200 rounded-lg p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-semibold text-gray-900 text-sm flex items-center gap-1.5"><Wallet className="w-4 h-4 text-teal-700" />Agent account — this shipment</div>
                  {posted && !pay && <button onClick={() => setPay({ amount: toPay > 0 ? String(r2(toPay)) : '', entry_date: today(), payment_mode: 'Bank', reference: '' })} className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm">Pay agent</button>}
                </div>
                {!posted ? <p className="text-xs text-gray-500 mt-1">Not billed yet — press “Save & bill agent” below.</p> : (
                  <div className="grid grid-cols-3 gap-2 mt-2 text-center text-sm">
                    <div><div className="text-[11px] text-gray-500">Billed</div><div className="font-semibold tabular-nums">Rs {n0(posted.amount)}</div></div>
                    <div><div className="text-[11px] text-gray-500">Paid</div><div className="font-semibold tabular-nums text-green-700">Rs {n0(paid)}</div></div>
                    <div><div className="text-[11px] text-gray-500">{toPay >= 0 ? 'Still to pay' : 'Paid extra'}</div><div className={`font-bold tabular-nums ${toPay > 0.5 ? 'text-rose-700' : 'text-green-700'}`}>Rs {n0(Math.abs(toPay))}</div></div>
                  </div>
                )}
                {posted && Math.abs(posted.amount - billAmount) >= 1 && <p className="text-[11px] text-amber-700 mt-2">Billed Rs {n0(posted.amount)}, but the charges now come to Rs {n0(billAmount)} — press “Save & bill agent” to update the bill.</p>}
                {ledger.filter((l) => l.kind === 'payment').length > 0 && (
                  <div className="mt-2 text-xs text-gray-600 space-y-0.5">
                    {ledger.filter((l) => l.kind === 'payment').map((l) => <div key={l.id} className="flex justify-between gap-2"><span>{new Date(l.entry_date).toLocaleDateString('en-GB')} · {[l.payment_mode, l.reference].filter(Boolean).join(' · ')}</span><span className="tabular-nums text-green-700">Rs {n0(l.amount)}</span></div>)}
                  </div>
                )}
                {pay && (
                  <div className="mt-3 grid grid-cols-2 gap-2 bg-gray-50 border border-gray-200 rounded-lg p-2">
                    <div><label className="text-[11px] text-gray-500">Amount (Rs)</label><input className={`${input} text-right`} inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
                    <div><label className="text-[11px] text-gray-500">Date</label><input type="date" className={input} value={pay.entry_date} onChange={(e) => setPay({ ...pay, entry_date: e.target.value })} /></div>
                    <div><label className="text-[11px] text-gray-500">Paid by</label><select className={input} value={pay.payment_mode} onChange={(e) => setPay({ ...pay, payment_mode: e.target.value })}>{MODES.map((m) => <option key={m}>{m}</option>)}</select></div>
                    <div><label className="text-[11px] text-gray-500">Cheque / ref no.</label><input className={input} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></div>
                    <div className="col-span-2 flex justify-end gap-2">
                      <button onClick={() => setPay(null)} disabled={saving} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg">Cancel</button>
                      <button onClick={savePayment} disabled={saving} className="px-3 py-1.5 text-sm bg-teal-600 text-white rounded-lg disabled:opacity-50">{saving ? 'Saving…' : 'Save payment'}</button>
                    </div>
                  </div>
                )}
              </div>
              {msg && <p className="text-sm text-red-600 mt-3">{msg}</p>}
              {okMsg && <p className="text-sm text-green-700 mt-3"><Check className="w-4 h-4 inline mr-1" />{okMsg}</p>}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex flex-wrap justify-end gap-2">
          <button onClick={close} disabled={saving} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">{okMsg ? 'Close' : 'Cancel'}</button>
          {!loading && !missing && !loadErr && !noPlTable && <>
            <button onClick={() => save(false)} disabled={saving} className="px-4 py-2 text-sm border border-teal-600 text-teal-700 rounded-lg disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => save(true)} disabled={saving || !(billAmount > 0)} className="px-4 py-2 text-sm bg-teal-600 text-white rounded-lg flex items-center gap-1.5 disabled:opacity-50"><Send className="w-4 h-4" />{saving ? 'Saving…' : `Save & bill agent Rs ${n0(billAmount)}`}</button>
          </>}
        </div>
      </div>
    </div>
  );
}
