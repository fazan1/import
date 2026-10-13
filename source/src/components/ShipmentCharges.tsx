import { useEffect, useMemo, useState } from 'react';
import { X, Check, Send, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';

/* Shipping charges for one shipment: each bill gets a type (CBM / KG / PCS / Fixed),
   a qty (taken from its packing list) and a rate. Other charges are split by share.
   "Post to agent account" puts the invoice into the agent's ledger (one line per shipment). */

type Basis = 'CBM' | 'KG' | 'PCS' | 'FIXED';
export interface ChargeShipment {
  id: string; shipment_no: string; default_basis?: string | null;
  rate_cbm?: number | null; rate_kg?: number | null; rate_pcs?: number | null;
  agent_id?: string | null; other_charges?: number | null; agent_invoice?: number | null; eta?: string | null;
}
interface Agent { id: string; name: string; phone: string | null; is_active: boolean }
interface BillRow { id: string; no: string; supplier: string; cbm: number; kg: number; pcs: number }
interface Edit { basis: Basis; qty: string; rate: string; fixed: string }

const BASES: Basis[] = ['CBM', 'KG', 'PCS', 'FIXED'];
const n0 = (v: number) => Math.round(v).toLocaleString('en-US');
const num = (s: string) => { const v = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(v) ? v : 0; };
const today = () => new Date().toISOString().slice(0, 10);
const cell = 'w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-right tabular-nums';

export default function ShipmentCharges({ shipment, onClose, onSaved }: { shipment: ChargeShipment; onClose: () => void; onSaved: () => void }) {
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [bills, setBills] = useState<BillRow[]>([]);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [agentId, setAgentId] = useState<string>(shipment.agent_id || '');
  const [other, setOther] = useState<string>(shipment.other_charges ? String(shipment.other_charges) : '');
  const [invoice, setInvoice] = useState<string>(shipment.agent_invoice ? String(shipment.agent_invoice) : '');
  const [posted, setPosted] = useState<{ id: string; amount: number; agent_id: string } | null>(null);
  const [msg, setMsg] = useState('');

  const defaultRate = (b: Basis) => b === 'CBM' ? shipment.rate_cbm : b === 'KG' ? shipment.rate_kg : b === 'PCS' ? shipment.rate_pcs : 0;
  const autoQty = (r: BillRow, b: Basis) => b === 'CBM' ? r.cbm : b === 'KG' ? r.kg : b === 'PCS' ? r.pcs : 0;
  const fmtQty = (v: number, b: Basis) => (b === 'CBM' ? (Math.round(v * 1000) / 1000) : Math.round(v * 100) / 100).toString();

  useEffect(() => {
    (async () => {
      const [ag, bl, ch, led] = await Promise.all([
        supabase.from('clearing_agents').select('*').order('name'),
        supabase.from('purchase_bills').select('id, bill_number, cnv_invoice_number, purchase_orders(suppliers(name))').eq('batch_number', shipment.shipment_no),
        supabase.from('shipment_charges').select('*').eq('shipment_id', shipment.id),
        supabase.from('agent_ledger').select('id, amount, agent_id').eq('shipment_id', shipment.id).eq('kind', 'charge'),
      ]);
      if (ag.error || ch.error || led.error) { setMissing(true); setLoading(false); return; }
      setAgents((ag.data ?? []) as Agent[]);
      type BRaw = { id: string; bill_number: string | null; cnv_invoice_number: string | null; purchase_orders: { suppliers: { name: string } | null } | null };
      const braw = (bl.data ?? []) as unknown as BRaw[];
      const ids = braw.map((b) => b.id);
      // packing list totals per bill (through PL Input)
      const tot: Record<string, { cbm: number; kg: number; pcs: number }> = {};
      if (ids.length) {
        const { data: pls } = await supabase.from('pl_input').select('id, purchase_bill_id').in('purchase_bill_id', ids);
        const plToBill: Record<string, string> = {};
        (pls ?? []).forEach((p: { id: string; purchase_bill_id: string | null }) => { if (p.purchase_bill_id) plToBill[p.id] = p.purchase_bill_id; });
        const plIds = Object.keys(plToBill);
        if (plIds.length) {
          const { data: items } = await supabase.from('packing_list_items').select('pl_input_id, cbm, weight_kg, no_of_pkgs').in('pl_input_id', plIds);
          const pkgs: Record<string, number> = {};
          (items ?? []).forEach((i: { pl_input_id: string | null; cbm: number | null; weight_kg: number | null; no_of_pkgs: number | null }) => {
            const b = i.pl_input_id ? plToBill[i.pl_input_id] : null; if (!b) return;
            const t = tot[b] ?? (tot[b] = { cbm: 0, kg: 0, pcs: 0 });
            t.cbm += Number(i.cbm) || 0; t.kg += Number(i.weight_kg) || 0;
            // packages are saved on every line of a packing list: count them once per packing list
            const pl = i.pl_input_id as string; pkgs[pl] = Math.max(pkgs[pl] || 0, Number(i.no_of_pkgs) || 0);
          });
          Object.entries(pkgs).forEach(([pl, n]) => { const b = plToBill[pl]; if (b && tot[b]) tot[b].pcs += n; });
        }
      }
      const rows: BillRow[] = braw.map((b) => ({ id: b.id, no: b.bill_number || b.cnv_invoice_number || '—', supplier: b.purchase_orders?.suppliers?.name || '—', ...(tot[b.id] ?? { cbm: 0, kg: 0, pcs: 0 }) }));
      setBills(rows);
      const saved = new Map(((ch.data ?? []) as { purchase_bill_id: string; basis: Basis; qty: number; rate: number; amount: number }[]).map((c) => [c.purchase_bill_id, c]));
      const start = (['CBM', 'KG', 'PCS'].includes(String(shipment.default_basis)) ? shipment.default_basis : 'CBM') as Basis;
      const e: Record<string, Edit> = {};
      rows.forEach((r) => {
        const s = saved.get(r.id);
        if (s) e[r.id] = { basis: s.basis, qty: String(Number(s.qty) || 0), rate: String(Number(s.rate) || ''), fixed: s.basis === 'FIXED' ? String(Number(s.amount) || '') : '' };
        else e[r.id] = { basis: start, qty: fmtQty(autoQty(r, start), start), rate: defaultRate(start) ? String(defaultRate(start)) : '', fixed: '' };
      });
      setEdits(e);
      const l = (led.data ?? [])[0] as { id: string; amount: number; agent_id: string } | undefined;
      if (l) setPosted({ id: l.id, amount: Number(l.amount) || 0, agent_id: l.agent_id });
      setLoading(false);
    })();
  }, [shipment.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const amountOf = (id: string) => { const e = edits[id]; if (!e) return 0; return e.basis === 'FIXED' ? num(e.fixed) : num(e.qty) * num(e.rate); };
  const freight = useMemo(() => bills.reduce((t, b) => t + amountOf(b.id), 0), [bills, edits]); // eslint-disable-line react-hooks/exhaustive-deps
  const otherV = num(other);
  const shareOf = (id: string) => (otherV <= 0 || bills.length === 0 ? 0 : freight > 0 ? otherV * (amountOf(id) / freight) : otherV / bills.length);
  const total = freight + otherV;
  const invoiceV = num(invoice);
  const diff = invoiceV > 0 ? invoiceV - total : 0;
  const agent = agents.find((a) => a.id === agentId) || null;
  const postAmount = invoiceV > 0 ? invoiceV : total;

  function setBasis(r: BillRow, b: Basis) {
    const cur = edits[r.id];
    // keep a rate already used for this type elsewhere in the shipment, else the shipment's default
    const used = Object.values(edits).find((x) => x.basis === b && num(x.rate) > 0)?.rate;
    setEdits({ ...edits, [r.id]: { basis: b, qty: b === 'FIXED' ? '' : fmtQty(autoQty(r, b), b), rate: b === 'FIXED' ? '' : (used ?? (defaultRate(b) ? String(defaultRate(b)) : '')), fixed: b === 'FIXED' ? (cur.fixed || String(Math.round(amountOf(r.id)) || '')) : '' } });
  }
  const setField = (id: string, f: keyof Edit, v: string) => setEdits({ ...edits, [id]: { ...edits[id], [f]: v } });
  function applyRateToAll(b: Basis, rate: string) {
    const next = { ...edits };
    Object.keys(next).forEach((k) => { if (next[k].basis === b) next[k] = { ...next[k], rate }; });
    setEdits(next);
  }

  async function save(post: boolean) {
    setMsg('');
    if (post && !agentId) { setMsg('Pick the agent first.'); return; }
    if (post && !(postAmount > 0)) { setMsg('Nothing to post — enter the charges or the agent’s invoice.'); return; }
    setSaving(true);
    try {
      // 1. per bill charges
      const rows = bills.map((b) => { const e = edits[b.id]; return { shipment_id: shipment.id, purchase_bill_id: b.id, basis: e.basis, qty: e.basis === 'FIXED' ? 0 : num(e.qty), rate: e.basis === 'FIXED' ? 0 : num(e.rate), amount: Math.round(amountOf(b.id) * 100) / 100 }; });
      if (rows.length) {
        const { error } = await supabase.from('shipment_charges').upsert(rows, { onConflict: 'shipment_id,purchase_bill_id' });
        if (error) throw new Error(error.message);
      }
      // bills taken out of the shipment: drop their old charge lines.
      // Only bills of THIS book that moved away — a bill of another book (not listed here) keeps its charge.
      const keep = new Set(bills.map((b) => b.id));
      const { data: oldCh, error: e1 } = await supabase.from('shipment_charges').select('purchase_bill_id').eq('shipment_id', shipment.id);
      if (e1) throw new Error(e1.message);
      const gone = [...new Set((oldCh ?? []).map((c: { purchase_bill_id: string }) => c.purchase_bill_id))].filter((id) => !keep.has(id));
      if (gone.length) {
        const { data: mine, error: e1b } = await supabase.from('purchase_bills').select('id').in('id', gone);
        if (e1b) throw new Error(e1b.message);
        const drop = (mine ?? []).map((b: { id: string }) => b.id);
        if (drop.length) {
          const { error: e2 } = await supabase.from('shipment_charges').delete().eq('shipment_id', shipment.id).in('purchase_bill_id', drop);
          if (e2) throw new Error(e2.message);
        }
      }
      // 2. the shipment itself
      const up: Record<string, unknown> = { agent_id: agentId || null, other_charges: otherV, agent_invoice: invoiceV, actual_charges: Math.round((invoiceV > 0 ? invoiceV : total) * 100) / 100 };
      if (agent) up.forwarder = agent.name;
      const { error: e3 } = await supabase.from('shipments').update(up).eq('id', shipment.id);
      if (e3) throw new Error(e3.message);
      // 3. the agent's account
      if (post) {
        const line = { agent_id: agentId, amount: Math.round(postAmount * 100) / 100, reference: `Shipment ${shipment.shipment_no}`, note: `${bills.length} bill${bills.length === 1 ? '' : 's'}`, shipment_id: shipment.id, kind: 'charge' as const };
        const { error: e4 } = posted
          ? await supabase.from('agent_ledger').update(line).eq('id', posted.id)
          : await supabase.from('agent_ledger').insert({ ...line, entry_date: today() });
        if (e4) throw new Error(e4.message);
        setPosted({ id: posted?.id ?? '', amount: line.amount, agent_id: agentId });
      }
      onSaved();
      onClose();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={() => !saving && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white sm:rounded-xl shadow-xl w-full max-w-4xl h-[100dvh] sm:h-auto sm:max-h-[92vh] flex flex-col">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div><h3 className="font-semibold text-gray-900">Shipping charges — {shipment.shipment_no}</h3><p className="text-xs text-gray-500">Pick the type for each bill and type the rate. Qty comes from the packing list.</p></div>
          <button onClick={onClose} className="text-gray-400"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {loading ? <p className="text-sm text-gray-500">Loading…</p> : missing ? (
            <p className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900">Run <b>clearing-agents-setup.sql</b> in Supabase first, then refresh.</p>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-xs text-gray-500">Clearing agent</label>
                  <select className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                    <option value="">— pick the agent —</option>
                    {agents.filter((a) => a.is_active || a.id === agentId).map((a) => <option key={a.id} value={a.id}>{a.name}{a.phone ? ` · ${a.phone}` : ''}</option>)}
                  </select>
                  {agents.length === 0 && <p className="text-[11px] text-amber-700 mt-1">No agents yet — add one in Masters → Clearing Agents.</p>}
                </div>
                {posted && <div className="text-xs bg-green-50 border border-green-200 rounded-lg px-3 py-2 self-end text-green-800">Posted to {agents.find((a) => a.id === posted.agent_id)?.name ?? 'agent'}: Rs {n0(posted.amount)}. Posting again updates that line.</div>}
              </div>

              {bills.length === 0 ? <p className="text-sm text-gray-500">No bills in this shipment yet. Add bills to {shipment.shipment_no} first (Edit shipment).</p> : (
                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead className="bg-gray-50 text-[11px] uppercase text-gray-500">
                      <tr><th className="px-3 py-2 text-left">Bill</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Rate (Rs)</th><th className="px-3 py-2 text-right">Freight</th><th className="px-3 py-2 text-right">+ Other</th><th className="px-3 py-2 text-right">Total</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {bills.map((b) => {
                        const e = edits[b.id]; if (!e) return null;
                        const a = amountOf(b.id), sh = shareOf(b.id);
                        const noPl = e.basis !== 'FIXED' && autoQty(b, e.basis) === 0;
                        return (
                          <tr key={b.id}>
                            <td className="px-3 py-2"><div className="font-medium text-gray-900">{b.no}</div><div className="text-[11px] text-gray-500">{b.supplier} · {b.cbm.toFixed(2)} CBM · {n0(b.kg)} kg · {n0(b.pcs)} pkgs</div></td>
                            <td className="px-3 py-2">
                              <select value={e.basis} onChange={(ev) => setBasis(b, ev.target.value as Basis)} className="px-2 py-1.5 border border-gray-300 rounded text-sm">
                                {BASES.map((x) => <option key={x} value={x}>{x === 'FIXED' ? 'Fixed' : x}</option>)}
                              </select>
                            </td>
                            <td className="px-3 py-2 w-28">{e.basis === 'FIXED' ? <span className="block text-right text-gray-400">—</span> : <><input className={cell} inputMode="decimal" value={e.qty} onChange={(ev) => setField(b.id, 'qty', ev.target.value)} />{noPl && <div className="text-[10px] text-amber-600 text-right">no packing list qty</div>}</>}</td>
                            <td className="px-3 py-2 w-32">{e.basis === 'FIXED'
                              ? <input className={cell} inputMode="decimal" placeholder="amount" value={e.fixed} onChange={(ev) => setField(b.id, 'fixed', ev.target.value)} />
                              : <input className={cell} inputMode="decimal" value={e.rate} onChange={(ev) => setField(b.id, 'rate', ev.target.value)} onBlur={(ev) => { if (num(ev.target.value) > 0 && Object.values(edits).some((x) => x.basis === e.basis && !num(x.rate))) applyRateToAll(e.basis, ev.target.value); }} />}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{n0(a)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-500">{sh ? n0(sh) : '—'}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold">{n0(a + sh)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                      <tr><td className="px-3 py-2" colSpan={4}>Total</td><td className="px-3 py-2 text-right tabular-nums">{n0(freight)}</td><td className="px-3 py-2 text-right tabular-nums">{otherV ? n0(otherV) : '—'}</td><td className="px-3 py-2 text-right tabular-nums">Rs {n0(total)}</td></tr>
                    </tfoot>
                  </table>
                </div>
              )}

              <div className="grid sm:grid-cols-3 gap-3 mt-4">
                <div><label className="text-xs text-gray-500">Other charges (DO, clearing, transport) — Rs</label><input className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-right" inputMode="decimal" value={other} onChange={(e) => setOther(e.target.value)} placeholder="0" /><p className="text-[11px] text-gray-400 mt-0.5">Split across the bills by their share.</p></div>
                <div><label className="text-xs text-gray-500">Agent’s invoice total — Rs</label><input className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-right" inputMode="decimal" value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder={n0(total)} /><p className="text-[11px] text-gray-400 mt-0.5">What the agent actually billed.</p></div>
                <div className={`rounded-lg p-3 text-sm ${invoiceV <= 0 ? 'bg-gray-50' : Math.abs(diff) < 1 ? 'bg-green-50 text-green-800' : 'bg-rose-50 text-rose-700'}`}>
                  {invoiceV <= 0 ? <>Calculated: <b>Rs {n0(total)}</b><div className="text-[11px] text-gray-500">Type the agent’s invoice to compare.</div></>
                    : Math.abs(diff) < 1 ? <><Check className="w-4 h-4 inline mr-1" />Matches the invoice</>
                    : <><AlertTriangle className="w-4 h-4 inline mr-1" />Difference <b>Rs {n0(Math.abs(diff))}</b><div className="text-[11px]">{diff > 0 ? 'Agent billed MORE than calculated' : 'Agent billed LESS than calculated'}</div></>}
                </div>
              </div>
              {msg && <p className="text-sm text-red-600 mt-3">{msg}</p>}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex flex-wrap justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">Cancel</button>
          {!loading && !missing && <>
            <button onClick={() => save(false)} disabled={saving} className="px-4 py-2 text-sm border border-teal-600 text-teal-700 rounded-lg disabled:opacity-50">Save</button>
            <button onClick={() => save(true)} disabled={saving || bills.length === 0} className="px-4 py-2 text-sm bg-teal-600 text-white rounded-lg flex items-center gap-1.5 disabled:opacity-50"><Send className="w-4 h-4" />{saving ? 'Saving…' : `Save & post Rs ${n0(postAmount)} to agent`}</button>
          </>}
        </div>
      </div>
    </div>
  );
}
