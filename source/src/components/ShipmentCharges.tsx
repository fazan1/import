import { Fragment, useEffect, useMemo, useState } from 'react';
import { X, Check, Send, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchAllPages, selectByIds } from '../lib/fetchAll';
import { loadItemCharges, syncCostingCharges } from '../lib/costingCharges';
import type { ChargeBasis, ItemCharge } from '../lib/costingCharges';

/* Shipping charges for one shipment, PER PACKING LIST: each packing list (PL) gets a type (KG / CBM / PCS / Fixed),
   a qty (its kg / CBM / pieces from the packing list — the PL's weight and CBM are often typed on its first line only)
   and a rate. The PL's charge is shared by its items: a KG charge by each item's own weight, a CBM charge by each item's
   own CBM (when every item of the PL has it filled in in Packing List), otherwise by quantity.
   A PL that mixes bases (bolts per kg, hose per CBM) can be switched to "charge items separately".
   Each item's share is saved in shipment_item_charges; Costing divides it by the item's quantity (charge per unit).
   No spreading: "Other charges" are NOT put on any item.
   Per-bill totals are also written to shipment_charges (CN Reports reads those).
   "Post to agent account" puts the invoice into the agent's ledger (one line per shipment). */

type Basis = ChargeBasis;
export interface ChargeShipment {
  id: string; shipment_no: string; default_basis?: string | null;
  rate_cbm?: number | null; rate_kg?: number | null; rate_pcs?: number | null;
  agent_id?: string | null; other_charges?: number | null; agent_invoice?: number | null; eta?: string | null;
}
interface Agent { id: string; name: string; phone: string | null; is_active: boolean }
interface Item {
  id: string; item_name: string; quantity: number; unit: string; weight_kg: number; cbm: number; no_of_pkgs: number;
  packing_list_no: string; billId: string | null;
}
interface BillInfo { id: string; label: string; cnv: string; supplier: string }
interface Edit { basis: Basis; qty: string; rate: string; fixed: string }
interface PL { key: string; plNo: string; billId: string | null; items: Item[]; qty: number; kg: number; cbm: number }
interface Group { key: string; title: string; sub: string; billId: string | null; pls: PL[] }
const plKeyOf = (i: { billId: string | null; packing_list_no: string }) => `${i.billId ?? '-'}|${i.packing_list_no || '-'}`;

const BASES: Basis[] = ['KG', 'CBM', 'PCS', 'FIXED'];
const RATE_BASES: Basis[] = ['KG', 'CBM', 'PCS'];
const n0 = (v: number) => Math.round(v).toLocaleString('en-US');
const n2 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n3 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const nq = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });
const num = (s: string) => { const v = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(v) ? v : 0; };
const today = () => new Date().toISOString().slice(0, 10);
const r2 = (v: number) => Math.round(v * 100) / 100;
const cell = 'w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-right tabular-nums';
const SQL_NOTE = 'Run item-charges-costing.sql in Supabase once, then refresh.';

/** Supabase / network errors in plain English. */
function plain(msg: string): string {
  const m = (msg || '').toLowerCase();
  if (m.includes('shipment_item_charges') && (m.includes('does not exist') || m.includes('schema cache'))) return SQL_NOTE;
  if (m.includes('failed to fetch') || m.includes('network')) return 'No connection to the database — check the internet and try again.';
  if (m.includes('row-level security') || m.includes('permission denied')) return 'You are not allowed to change this (this login or book is locked).';
  if (m.includes('all books')) return 'Switch to one book (not "All books") to save charges.';
  if (m.includes('closed') || m.includes('collection')) return `This book does not accept changes: ${msg}`;
  return `Could not save: ${msg}`;
}
const isMissingTable = (msg: string | null | undefined) => !!msg && /does not exist|schema cache/i.test(msg) && /shipment_item_charges/i.test(msg);

export default function ShipmentCharges({ shipment, onClose, onSaved }: { shipment: ChargeShipment; onClose: () => void; onSaved: () => void }) {
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);       // clearing agents tables missing
  const [noItemTable, setNoItemTable] = useState(false); // shipment_item_charges missing
  const [loadErr, setLoadErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [bills, setBills] = useState<Record<string, BillInfo>>({});
  const [batchBillIds, setBatchBillIds] = useState<string[]>([]);
  const [savedCharges, setSavedCharges] = useState<Map<string, ItemCharge>>(new Map());
  const [edits, setEdits] = useState<Record<string, Edit>>({});      // per item (only used when a PL is charged item by item)
  const [plEdits, setPlEdits] = useState<Record<string, Edit>>({});  // per packing list
  const [split, setSplit] = useState<Record<string, boolean>>({});   // PL charged item by item
  const [bulk, setBulk] = useState<Record<string, string>>({});
  const [agentId, setAgentId] = useState<string>(shipment.agent_id || '');
  const [other, setOther] = useState<string>(shipment.other_charges ? String(shipment.other_charges) : '');
  const [invoice, setInvoice] = useState<string>(shipment.agent_invoice ? String(shipment.agent_invoice) : '');
  const [posted, setPosted] = useState<{ id: string; amount: number; agent_id: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const defaultRate = (b: Basis) => (b === 'CBM' ? shipment.rate_cbm : b === 'KG' ? shipment.rate_kg : b === 'PCS' ? shipment.rate_pcs : 0) || 0;
  const autoQty = (i: { cbm: number; weight_kg?: number; kg?: number; quantity?: number; qty?: number }, b: Basis) =>
    (b === 'CBM' ? i.cbm : b === 'KG' ? (i.weight_kg ?? i.kg ?? 0) : b === 'PCS' ? (i.quantity ?? i.qty ?? 0) : 0);
  const fmtQty = (v: number, b: Basis) => String(b === 'CBM' ? Math.round(v * 1000) / 1000 : Math.round(v * 100) / 100);

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

      // saved charges per item
      const ch = await loadItemCharges(shipment.id);
      if (ch.error) {
        if (isMissingTable(ch.error)) { setNoItemTable(true); setLoading(false); return; }
        setLoadErr(plain(ch.error).replace(/^Could not save: /, 'Could not load the charges: ')); setLoading(false); return;
      }
      setSavedCharges(ch.map);

      // packing list items of this shipment (current book only — automatic)
      type PRaw = { id: string; item_name: string | null; quantity: number | null; unit: string | null; weight_kg: number | null; cbm: number | null; no_of_pkgs: number | null; packing_list_no: string | null; pl_input_id: string | null };
      const pi = await fetchAllPages<PRaw>(() => supabase.from('packing_list_items')
        .select('id, item_name, quantity, unit, weight_kg, cbm, no_of_pkgs, packing_list_no, pl_input_id').eq('batch_number', shipment.shipment_no).order('id'));
      if (pi.error) { setLoadErr(`Could not load the packing list items: ${pi.error}`); setLoading(false); return; }

      // item -> PL Input -> bill
      const pl = await selectByIds<{ id: string; purchase_bill_id: string | null }>('pl_input', 'id, purchase_bill_id', 'id', pi.data.map((p) => p.pl_input_id || '').filter(Boolean));
      if (pl.error) { setLoadErr(`Could not load PL Input: ${pl.error}`); setLoading(false); return; }
      const plToBill: Record<string, string> = {};
      pl.data.forEach((p) => { if (p.purchase_bill_id) plToBill[p.id] = p.purchase_bill_id; });

      type BRaw = { id: string; bill_number: string | null; cnv_invoice_number: string | null; purchase_orders: { suppliers: { name: string } | null } | null };
      const billCols = 'id, bill_number, cnv_invoice_number, purchase_orders(suppliers(name))';
      const [bl, bb] = await Promise.all([
        selectByIds<BRaw>('purchase_bills', billCols, 'id', Object.values(plToBill)),
        fetchAllPages<{ id: string }>(() => supabase.from('purchase_bills').select('id').eq('batch_number', shipment.shipment_no).order('id')),
      ]);
      if (bl.error || bb.error) { setLoadErr(`Could not load the bills: ${bl.error || bb.error}`); setLoading(false); return; }
      const bm: Record<string, BillInfo> = {};
      bl.data.forEach((b) => { bm[b.id] = { id: b.id, label: b.bill_number || b.cnv_invoice_number || '—', cnv: b.bill_number && b.cnv_invoice_number && b.cnv_invoice_number !== b.bill_number ? b.cnv_invoice_number : '', supplier: b.purchase_orders?.suppliers?.name || '' }; });
      setBills(bm);
      setBatchBillIds(bb.data.map((b) => b.id));

      const rows: Item[] = pi.data.map((p) => {
        const billId = p.pl_input_id ? plToBill[p.pl_input_id] ?? null : null;
        return {
          id: p.id, item_name: p.item_name || '—', quantity: Number(p.quantity) || 0, unit: p.unit || '', weight_kg: Number(p.weight_kg) || 0,
          cbm: Number(p.cbm) || 0, no_of_pkgs: Number(p.no_of_pkgs) || 0, packing_list_no: p.packing_list_no || '',
          billId: billId && bm[billId] ? billId : null,
        };
      });
      rows.sort((a, b) => a.packing_list_no.localeCompare(b.packing_list_no) || a.item_name.localeCompare(b.item_name));
      setItems(rows);

      const start = (['CBM', 'KG', 'PCS'].includes(String(shipment.default_basis)) ? shipment.default_basis : 'KG') as Basis;
      const e: Record<string, Edit> = {};
      rows.forEach((i) => {
        const s = ch.map.get(i.id);
        if (s) e[i.id] = { basis: s.basis, qty: s.basis === 'FIXED' ? '' : String(s.qty || 0), rate: s.basis === 'FIXED' ? '' : (s.rate ? String(s.rate) : ''), fixed: s.basis === 'FIXED' ? (s.amount ? String(s.amount) : '') : '' };
        else e[i.id] = { basis: start, qty: fmtQty(autoQty(i, start), start), rate: defaultRate(start) ? String(defaultRate(start)) : '', fixed: '' };
      });
      setEdits(e);
      // per packing list: one charge shared by its items — unless what was saved shows the items were charged separately
      const byPl = new Map<string, Item[]>();
      rows.forEach((i) => { const k = plKeyOf(i); byPl.set(k, [...(byPl.get(k) ?? []), i]); });
      const pe: Record<string, Edit> = {}; const sp: Record<string, boolean> = {};
      byPl.forEach((its, k) => {
        const saved = its.map((i) => ch.map.get(i.id)).filter(Boolean) as ItemCharge[];
        const q = its.reduce((t, i) => t + i.quantity, 0), kg = its.reduce((t, i) => t + i.weight_kg, 0), cbm = its.reduce((t, i) => t + i.cbm, 0);
        if (saved.length) {
          const perUnit = its.map((i) => { const c = ch.map.get(i.id); return i.quantity > 0 ? (c?.amount ?? 0) / i.quantity : 0; });
          const mixed = new Set(saved.map((c) => c.basis)).size > 1 || new Set(saved.map((c) => c.rate)).size > 1
            || saved.length < its.length || Math.max(...perUnit) - Math.min(...perUnit) > 0.01;
          sp[k] = mixed;
          const b = saved[0].basis, amt = saved.reduce((t, c) => t + c.amount, 0);
          pe[k] = { basis: b, qty: b === 'FIXED' ? '' : fmtQty(saved.reduce((t, c) => t + c.qty, 0), b), rate: b === 'FIXED' ? '' : (saved[0].rate ? String(saved[0].rate) : ''), fixed: b === 'FIXED' ? String(r2(amt) || '') : '' };
        } else {
          pe[k] = { basis: start, qty: fmtQty(autoQty({ cbm, kg, qty: q }, start), start), rate: defaultRate(start) ? String(defaultRate(start)) : '', fixed: '' };
        }
      });
      setPlEdits(pe); setSplit(sp);
      setLoading(false);
    })().catch((err) => { setLoadErr(plain((err as Error).message).replace(/^Could not save: /, 'Could not load: ')); setLoading(false); });
  }, [shipment.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const editAmount = (e: Edit | undefined) => (!e ? 0 : e.basis === 'FIXED' ? num(e.fixed) : num(e.qty) * num(e.rate));
  const itemEditAmount = (id: string) => editAmount(edits[id]);

  const pls = useMemo<Map<string, PL>>(() => {
    const m = new Map<string, PL>();
    items.forEach((i) => {
      const k = plKeyOf(i);
      const p = m.get(k) ?? { key: k, plNo: i.packing_list_no || '—', billId: i.billId, items: [], qty: 0, kg: 0, cbm: 0 };
      p.items.push(i); p.qty += i.quantity; p.kg += i.weight_kg; p.cbm += i.cbm; m.set(k, p);
    });
    return m;
  }, [items]);
  const plAmount = (p: PL) => (split[p.key] ? p.items.reduce((t, i) => t + itemEditAmount(i.id), 0) : editAmount(plEdits[p.key]));
  /** How a PL's charge is shared by its items: a KG charge by each item's own weight and a CBM charge by each item's
      own CBM — when every item of the PL has its weight / CBM filled in. Otherwise (and for PCS / Fixed) by quantity. */
  const shareRule = (p: PL): { by: 'KG' | 'CBM' | 'QTY'; missing: string[] } => {
    const b = plEdits[p.key]?.basis;
    if (b !== 'KG' && b !== 'CBM') return { by: 'QTY', missing: [] };
    const metric = (i: Item) => (b === 'KG' ? i.weight_kg : i.cbm);
    const missing = p.items.filter((i) => !(metric(i) > 0)).map((i) => i.item_name);
    return missing.length === 0 ? { by: b, missing } : { by: 'QTY', missing };
  };
  const shareOf = (i: Item, p: PL) => {
    const r = shareRule(p);
    if (r.by === 'KG') return p.kg > 0 ? i.weight_kg / p.kg : 0;
    if (r.by === 'CBM') return p.cbm > 0 ? i.cbm / p.cbm : 0;
    return p.qty > 0 ? i.quantity / p.qty : 0;
  };
  /** what one item carries: its own charge, or its share of its packing list's charge */
  const amountOf = (id: string) => {
    const i = items.find((x) => x.id === id); if (!i) return 0;
    const p = pls.get(plKeyOf(i)); if (!p) return 0;
    if (split[p.key]) return itemEditAmount(id);
    return editAmount(plEdits[p.key]) * shareOf(i, p);
  };

  const groups = useMemo<Group[]>(() => {
    const byBill = new Map<string, PL[]>();
    const loose: PL[] = [];
    pls.forEach((p) => { if (p.billId) byBill.set(p.billId, [...(byBill.get(p.billId) ?? []), p]); else loose.push(p); });
    const byNo = (a: PL, b: PL) => a.plNo.localeCompare(b.plNo, undefined, { numeric: true });
    const out: Group[] = [...byBill.entries()].map(([id, ps]) => {
      const b = bills[id];
      return { key: id, billId: id, title: `Bill ${b?.label ?? '—'}`, sub: [b?.cnv ? `CNV ${b.cnv}` : '', b?.supplier ?? ''].filter(Boolean).join(' · '), pls: ps.sort(byNo) };
    });
    out.sort((a, b) => a.title.localeCompare(b.title));
    if (loose.length) out.push({ key: '__other', billId: null, title: 'Other items', sub: 'not linked to a bill (no PL Input bill)', pls: loose.sort(byNo) });
    return out;
  }, [pls, bills]);

  const itemsTotal = useMemo(() => [...pls.values()].reduce((t, p) => t + plAmount(p), 0), [pls, edits, plEdits, split]); // eslint-disable-line react-hooks/exhaustive-deps
  const otherV = num(other);
  const total = itemsTotal + otherV;
  const invoiceV = num(invoice);
  const diff = invoiceV > 0 ? invoiceV - total : 0;
  const agent = agents.find((a) => a.id === agentId) || null;
  const postAmount = invoiceV > 0 ? invoiceV : total;
  const usedBases = RATE_BASES.filter((b) => [...pls.values()].some((p) => (split[p.key] ? p.items.some((i) => edits[i.id]?.basis === b) : plEdits[p.key]?.basis === b)));

  function setBasis(i: Item, b: Basis) {
    const cur = edits[i.id];
    // keep a rate already used for this type elsewhere in the shipment, else the shipment's default
    const used = Object.values(edits).find((x) => x.basis === b && num(x.rate) > 0)?.rate;
    setEdits({ ...edits, [i.id]: { basis: b, qty: b === 'FIXED' ? '' : fmtQty(autoQty(i, b), b), rate: b === 'FIXED' ? '' : (used ?? (defaultRate(b) ? String(defaultRate(b)) : '')), fixed: b === 'FIXED' ? (cur.fixed || String(Math.round(amountOf(i.id)) || '')) : '' } });
  }
  const setField = (id: string, f: keyof Edit, v: string) => setEdits({ ...edits, [id]: { ...edits[id], [f]: v } });
  function applyRateToAll(b: Basis, rate: string) {
    const next = { ...edits };
    Object.keys(next).forEach((k) => { if (next[k].basis === b) next[k] = { ...next[k], rate }; });
    setEdits(next);
    const nextPl = { ...plEdits };
    Object.keys(nextPl).forEach((k) => { if (nextPl[k].basis === b) nextPl[k] = { ...nextPl[k], rate }; });
    setPlEdits(nextPl);
  }
  function setPlBasis(p: PL, b: Basis) {
    const cur = plEdits[p.key];
    const used = [...Object.values(plEdits), ...Object.values(edits)].find((x) => x.basis === b && num(x.rate) > 0)?.rate;
    setPlEdits({ ...plEdits, [p.key]: { basis: b, qty: b === 'FIXED' ? '' : fmtQty(autoQty({ cbm: p.cbm, kg: p.kg, qty: p.qty }, b), b), rate: b === 'FIXED' ? '' : (used ?? (defaultRate(b) ? String(defaultRate(b)) : '')), fixed: b === 'FIXED' ? (cur?.fixed || String(Math.round(plAmount(p)) || '')) : '' } });
  }
  const setPlField = (k: string, f: keyof Edit, v: string) => setPlEdits({ ...plEdits, [k]: { ...plEdits[k], [f]: v } });

  async function save(post: boolean) {
    setMsg(''); setOkMsg('');
    if (post && !agentId) { setMsg('Pick the agent first.'); return; }
    if (post && !(postAmount > 0)) { setMsg('Nothing to post — enter the charges or the agent’s invoice.'); return; }
    setSaving(true);
    try {
      // 1. charge per item. Items never charged and still at 0 are not written (their costing stays as it is).
      const rows: ItemCharge[] = items
        .filter((i) => savedCharges.has(i.id) || amountOf(i.id) > 0)
        .map((i) => {
          const p = pls.get(plKeyOf(i))!;
          if (split[p.key]) {
            const e = edits[i.id];
            return { shipment_id: shipment.id, packing_list_item_id: i.id, purchase_bill_id: i.billId, basis: e.basis, qty: e.basis === 'FIXED' ? 0 : num(e.qty), rate: e.basis === 'FIXED' ? 0 : num(e.rate), amount: r2(amountOf(i.id)) };
          }
          // the item's share of its packing list's charge (by its own weight / CBM, or by quantity)
          const e = plEdits[p.key]; const share = shareOf(i, p);
          return { shipment_id: shipment.id, packing_list_item_id: i.id, purchase_bill_id: i.billId, basis: e.basis, qty: e.basis === 'FIXED' ? 0 : Math.round(num(e.qty) * share * 10000) / 10000, rate: e.basis === 'FIXED' ? 0 : num(e.rate), amount: r2(amountOf(i.id)) };
        });
      for (let k = 0; k < rows.length; k += 500) {
        const { error } = await supabase.from('shipment_item_charges').upsert(rows.slice(k, k + 500), { onConflict: 'shipment_id,packing_list_item_id' });
        if (error) throw new Error(error.message);
      }
      // items no longer in this shipment: drop their charge rows (only rows we loaded — never anything else)
      const itemIds = new Set(items.map((i) => i.id));
      const goneItems = [...savedCharges.keys()].filter((id) => !itemIds.has(id));
      for (let k = 0; k < goneItems.length; k += 150) {
        const { error } = await supabase.from('shipment_item_charges').delete().eq('shipment_id', shipment.id).in('packing_list_item_id', goneItems.slice(k, k + 150));
        if (error) throw new Error(error.message);
      }
      const nextSaved = new Map<string, ItemCharge>();
      rows.forEach((r) => nextSaved.set(r.packing_list_item_id, r));
      setSavedCharges(nextSaved);

      // 2. per-bill totals for CN Reports (sum of that bill's items)
      const billTotals = new Map<string, number>();
      items.forEach((i) => { if (i.billId) billTotals.set(i.billId, (billTotals.get(i.billId) || 0) + amountOf(i.id)); });
      const billRows = [...billTotals.entries()].map(([id, amt]) => ({ shipment_id: shipment.id, purchase_bill_id: id, basis: 'FIXED', qty: 0, rate: 0, amount: r2(amt) }));
      if (billRows.length) {
        const { error } = await supabase.from('shipment_charges').upsert(billRows, { onConflict: 'shipment_id,purchase_bill_id' });
        if (error) throw new Error(error.message);
      }
      // bills taken out of the shipment: drop their old charge lines.
      // Only bills of THIS book that moved away — a bill of another book (not readable here) keeps its charge.
      const keep = new Set([...billTotals.keys(), ...batchBillIds]);
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

      // 3. the shipment itself
      const up: Record<string, unknown> = { agent_id: agentId || null, other_charges: otherV, agent_invoice: invoiceV, actual_charges: r2(invoiceV > 0 ? invoiceV : itemsTotal + otherV) };
      if (agent) up.forwarder = agent.name;
      const { error: e3 } = await supabase.from('shipments').update(up).eq('id', shipment.id);
      if (e3) throw new Error(e3.message);

      // 4. the agent's account
      if (post) {
        const line = { agent_id: agentId, amount: r2(postAmount), reference: `Shipment ${shipment.shipment_no}`, note: `${items.length} item${items.length === 1 ? '' : 's'}`, shipment_id: shipment.id, kind: 'charge' as const };
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
      onSaved();

      // 5. bring the charges into Costing now
      const sync = await syncCostingCharges(shipment.shipment_no);
      if (sync.error) setMsg(`Charges saved, but Costing was not updated: ${plain(sync.error).replace(/^Could not save: /, '')}`);
      else setOkMsg(`Saved — ${sync.updated} costing line${sync.updated === 1 ? '' : 's'} updated${post ? ' and posted to the agent' : ''}.`);
    } catch (err) {
      setMsg(plain((err as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={() => !saving && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white sm:rounded-xl shadow-xl w-full max-w-6xl h-[100dvh] sm:h-auto sm:max-h-[92vh] flex flex-col">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div><h3 className="font-semibold text-gray-900">Shipping charges — {shipment.shipment_no}</h3><p className="text-xs text-gray-500">Put a charge on each packing list (per kg, per CBM, per piece or a fixed amount). It is shared by the PL’s items by their own weight / CBM (or by quantity if those are not filled in); Costing shows it per piece.</p></div>
          <button onClick={onClose} className="text-gray-400"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-3 sm:p-5 overflow-y-auto flex-1 min-w-0">
          {loading ? <p className="text-sm text-gray-500">Loading…</p> : missing ? (
            <p className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900">Run <b>clearing-agents-setup.sql</b> in Supabase first, then refresh.</p>
          ) : noItemTable ? (
            <p className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900">Run <b>item-charges-costing.sql</b> in Supabase once, then refresh.</p>
          ) : loadErr ? (
            <p className="text-sm bg-rose-50 border border-rose-200 rounded-lg p-3 text-rose-700">{loadErr}</p>
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

              {items.length === 0 ? (
                <p className="text-sm bg-gray-50 border border-gray-200 rounded-lg p-3 text-gray-600">No packing list items for this shipment yet — import them in PL Input / Packing List first.</p>
              ) : (
                <>
                  {usedBases.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {usedBases.map((b) => (
                        <div key={b} className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-600">
                          <span>Same rate for all {b} items — Rs</span>
                          <input className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-right" inputMode="decimal" placeholder={`per ${b === 'PCS' ? 'pc' : b.toLowerCase()}`} value={bulk[b] ?? ''} onChange={(e) => setBulk({ ...bulk, [b]: e.target.value })} />
                          <button type="button" onClick={() => { if (num(bulk[b] ?? '') > 0) applyRateToAll(b, bulk[b]); }} disabled={!(num(bulk[b] ?? '') > 0)} className="px-2 py-1 border border-teal-600 text-teal-700 rounded disabled:opacity-40">Apply</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="overflow-x-auto border border-gray-200 rounded-lg max-w-full">
                    <table className="w-full text-sm whitespace-nowrap">
                      <thead className="bg-gray-50 text-[11px] uppercase text-gray-500">
                        <tr>
                          <th className="px-3 py-2 text-left">Packing list / items</th><th className="px-3 py-2 text-left">PL</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Kg</th><th className="px-3 py-2 text-right">CBM</th>
                          <th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-right">Charge qty</th><th className="px-3 py-2 text-right">Rate (Rs)</th><th className="px-3 py-2 text-right">Amount (Rs)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {groups.map((g) => {
                          const sub = g.pls.reduce((t, p) => t + plAmount(p), 0);
                          const qtyCell = (e: Edit, auto: number, onQty: (v: string) => void) => (e.basis === 'FIXED' ? <span className="block text-right text-gray-400">—</span> : <>
                            <input className={cell} inputMode="decimal" value={e.qty} onChange={(ev) => onQty(ev.target.value)} />
                            {auto === 0 && !(num(e.qty) > 0) && <div className="text-[10px] text-amber-600 text-right leading-tight">{e.basis === 'KG' ? 'No KG in packing list — type the kg here' : e.basis === 'CBM' ? 'No CBM in packing list — type the CBM here' : 'No qty — type it here'}</div>}
                          </>);
                          return (
                            <Fragment key={g.key}>
                              <tr className="bg-teal-50/60"><td colSpan={9} className="px-3 py-1.5 text-xs"><span className="font-semibold text-gray-900">{g.title}</span>{g.sub && <span className="text-gray-500"> · {g.sub}</span>}</td></tr>
                              {g.pls.map((p) => {
                                const pe = plEdits[p.key]; if (!pe) return null;
                                const isSplit = !!split[p.key];
                                const pa = plAmount(p);
                                const names = p.items.map((i) => i.item_name);
                                return (
                                  <Fragment key={p.key}>
                                    <tr className={isSplit ? 'bg-gray-50/60' : ''}>
                                      <td className="px-3 py-2 max-w-[260px]">
                                        <div className="font-semibold text-gray-900">PL {p.plNo} <span className="font-normal text-gray-500">· {p.items.length} item{p.items.length === 1 ? '' : 's'}</span></div>
                                        <div className="text-[11px] text-gray-500 truncate" title={names.join(', ')}>{names.join(', ')}</div>
                                        {p.items.length > 1 && <button type="button" onClick={() => setSplit({ ...split, [p.key]: !isSplit })} className="text-[11px] text-teal-700 underline">{isSplit ? 'One charge for the whole PL' : 'Charge items separately'}</button>}
                                      </td>
                                      <td className="px-3 py-2 text-gray-600">{p.plNo}</td>
                                      <td className="px-3 py-2 text-right tabular-nums">{nq(p.qty)} <span className="text-gray-400 text-xs">pcs</span></td>
                                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{n2(p.kg)}</td>
                                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{n3(p.cbm)}</td>
                                      {isSplit ? (
                                        <td colSpan={3} className="px-3 py-2 text-[11px] text-gray-500">Charged item by item below</td>
                                      ) : (<>
                                        <td className="px-3 py-2">
                                          <select value={pe.basis} onChange={(ev) => setPlBasis(p, ev.target.value as Basis)} className="px-2 py-1.5 border border-gray-300 rounded text-sm">
                                            {BASES.map((x) => <option key={x} value={x}>{x === 'FIXED' ? 'Fixed' : x}</option>)}
                                          </select>
                                        </td>
                                        <td className="px-3 py-2 w-32">{qtyCell(pe, autoQty({ cbm: p.cbm, kg: p.kg, qty: p.qty }, pe.basis), (v) => setPlField(p.key, 'qty', v))}</td>
                                        <td className="px-3 py-2 w-28">{pe.basis === 'FIXED' ? <span className="block text-right text-gray-400">—</span> : <input className={cell} inputMode="decimal" value={pe.rate} onChange={(ev) => setPlField(p.key, 'rate', ev.target.value)} />}</td>
                                      </>)}
                                      <td className="px-3 py-2 w-32 text-right">
                                        {!isSplit && pe.basis === 'FIXED'
                                          ? <input className={cell} inputMode="decimal" placeholder="amount" value={pe.fixed} onChange={(ev) => setPlField(p.key, 'fixed', ev.target.value)} />
                                          : <span className="tabular-nums font-semibold">{n0(pa)}</span>}
                                        {!isSplit && (() => {
                                          const r = shareRule(p);
                                          if (p.items.length === 1) return <div className="text-[10px] text-gray-400 tabular-nums">{p.qty > 0 ? `${n2(pa / p.qty)} per ${p.items[0].unit || 'piece'}` : 'no qty — can’t divide'}</div>;
                                          if (r.by !== 'QTY') return <div className="text-[10px] text-green-700">shared by each item’s {r.by === 'KG' ? 'weight' : 'CBM'}</div>;
                                          return <div className="text-[10px] text-gray-400 tabular-nums">{p.qty > 0 ? `${n2(pa / p.qty)} per piece (by quantity)` : 'no qty — can’t divide'}
                                            {r.missing.length > 0 && <div className="text-amber-600 whitespace-normal max-w-[190px] ml-auto">Fill the {plEdits[p.key]?.basis === 'KG' ? 'kg' : 'CBM'} of {r.missing.length === p.items.length ? 'each item' : r.missing.slice(0, 3).join(', ') + (r.missing.length > 3 ? ` +${r.missing.length - 3}` : '')} in Packing List to share by {plEdits[p.key]?.basis === 'KG' ? 'weight' : 'CBM'}</div>}</div>;
                                        })()}
                                      </td>
                                    </tr>
                                    {isSplit && p.items.map((i) => {
                                      const e = edits[i.id]; if (!e) return null;
                                      const a = itemEditAmount(i.id);
                                      return (
                                        <tr key={i.id} className="bg-gray-50/40">
                                          <td className="pl-8 pr-3 py-2 text-gray-900 max-w-[240px] truncate" title={i.item_name}>{i.item_name}</td>
                                          <td className="px-3 py-2 text-gray-400">{i.packing_list_no || '—'}</td>
                                          <td className="px-3 py-2 text-right tabular-nums">{nq(i.quantity)} <span className="text-gray-400 text-xs">{i.unit}</span></td>
                                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{n2(i.weight_kg)}</td>
                                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{n3(i.cbm)}</td>
                                          <td className="px-3 py-2">
                                            <select value={e.basis} onChange={(ev) => setBasis(i, ev.target.value as Basis)} className="px-2 py-1.5 border border-gray-300 rounded text-sm">
                                              {BASES.map((x) => <option key={x} value={x}>{x === 'FIXED' ? 'Fixed' : x}</option>)}
                                            </select>
                                          </td>
                                          <td className="px-3 py-2 w-32">{qtyCell(e, autoQty(i, e.basis), (v) => setField(i.id, 'qty', v))}</td>
                                          <td className="px-3 py-2 w-28">{e.basis === 'FIXED' ? <span className="block text-right text-gray-400">—</span> : <input className={cell} inputMode="decimal" value={e.rate} onChange={(ev) => setField(i.id, 'rate', ev.target.value)} />}</td>
                                          <td className="px-3 py-2 w-32 text-right">
                                            {e.basis === 'FIXED'
                                              ? <input className={cell} inputMode="decimal" placeholder="amount" value={e.fixed} onChange={(ev) => setField(i.id, 'fixed', ev.target.value)} />
                                              : <span className="tabular-nums font-semibold">{n0(a)}</span>}
                                            <div className="text-[10px] text-gray-400 tabular-nums">{i.quantity > 0 ? `${n2(a / i.quantity)} per ${i.unit || 'unit'}` : 'no qty — can’t divide'}</div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </Fragment>
                                );
                              })}
                              <tr className="bg-gray-50/70 text-xs"><td colSpan={8} className="px-3 py-1.5 text-right text-gray-500">{g.title} subtotal</td><td className="px-3 py-1.5 text-right tabular-nums font-semibold">{n0(sub)}</td></tr>
                            </Fragment>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                        <tr><td className="px-3 py-2" colSpan={8}>Items total</td><td className="px-3 py-2 text-right tabular-nums">Rs {n0(itemsTotal)}</td></tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}

              <div className="grid sm:grid-cols-3 gap-3 mt-4">
                <div>
                  <label className="text-xs text-gray-500">Other charges (DO, clearing, transport) — Rs</label>
                  <input className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-right" inputMode="decimal" value={other} onChange={(e) => setOther(e.target.value)} placeholder="0" />
                  {otherV > 0
                    ? <p className="text-[11px] text-amber-700 mt-0.5">Rs {n0(otherV)} is not on any item, so it won’t be in item costs — put it on an item if it belongs to one.</p>
                    : <p className="text-[11px] text-gray-400 mt-0.5">Charges not belonging to any item.</p>}
                </div>
                <div><label className="text-xs text-gray-500">Agent’s invoice total — Rs</label><input className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-right" inputMode="decimal" value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder={n0(total)} /><p className="text-[11px] text-gray-400 mt-0.5">What the agent actually billed.</p></div>
                <div className={`rounded-lg p-3 text-sm ${invoiceV <= 0 ? 'bg-gray-50' : Math.abs(diff) < 1 ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
                  <div className="text-[11px] text-gray-500 tabular-nums">Items Rs {n0(itemsTotal)} + other Rs {n0(otherV)} = <b>Rs {n0(total)}</b></div>
                  {invoiceV <= 0 ? <div className="text-[11px] text-gray-500">Type the agent’s invoice to compare.</div>
                    : Math.abs(diff) < 1 ? <div><Check className="w-4 h-4 inline mr-1" />Matches the invoice (Rs {n0(invoiceV)})</div>
                    : <div><AlertTriangle className="w-4 h-4 inline mr-1" />Difference <b>Rs {n0(Math.abs(diff))}</b><div className="text-[11px]">{diff > 0 ? 'Agent billed MORE than items + other' : 'Agent billed LESS than items + other'}</div></div>}
                </div>
              </div>
              {msg && <p className="text-sm text-red-600 mt-3">{msg}</p>}
              {okMsg && <p className="text-sm text-green-700 mt-3"><Check className="w-4 h-4 inline mr-1" />{okMsg}</p>}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex flex-wrap justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">{okMsg ? 'Close' : 'Cancel'}</button>
          {!loading && !missing && !noItemTable && !loadErr && <>
            <button onClick={() => save(false)} disabled={saving} className="px-4 py-2 text-sm border border-teal-600 text-teal-700 rounded-lg disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => save(true)} disabled={saving || items.length === 0} className="px-4 py-2 text-sm bg-teal-600 text-white rounded-lg flex items-center gap-1.5 disabled:opacity-50"><Send className="w-4 h-4" />{saving ? 'Saving…' : `Save & post Rs ${n0(postAmount)} to agent`}</button>
          </>}
        </div>
      </div>
    </div>
  );
}
