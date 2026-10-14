import { supabase } from './supabase';
import { fetchAllPages, selectByIds } from './fetchAll';

/* Shipping charges (v111) — two sides, compared on screen:
   - BULK (Shipping -> Charges): per packing list, its total kg / CBM / pcs from Packing List x the rate typed there
     (table shipment_pl_charges). All packing lists added up = the shipment's bulk amount, billed to the agent.
   - COSTING: each packing-list item gets its own type (KG / CBM / PCS / FIXED) and rate, typed in Costing.
     KG / CBM / PCS take the item's kg / CBM / qty fresh from Packing List: item charge = that x rate.
   - The charge per item is kept in shipment_item_charges; Costing divides it by the item's quantity:
       charge per unit = item charge / qty     landed per unit = (CNY price x rate) + charge per unit
   The database (trigger zzzz_costing_calc) works out landed / profit / totals from charge_per_unit. */

export type ChargeBasis = 'KG' | 'CBM' | 'PCS' | 'FIXED';
export interface ItemCharge { id?: string; shipment_id: string; packing_list_item_id: string; purchase_bill_id: string | null; basis: ChargeBasis; qty: number; rate: number; amount: number }
interface PlRow { id: string; weight_kg: number | null; cbm: number | null; quantity: number | null; pl_input_id: string | null }

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** the kg / CBM / pieces a charge type applies to, from the packing list line */
export function chargeQty(p: { weight_kg?: number | null; cbm?: number | null; quantity?: number | null }, basis: ChargeBasis): number {
  if (basis === 'KG') return Number(p.weight_kg) || 0;
  if (basis === 'CBM') return Number(p.cbm) || 0;
  if (basis === 'PCS') return Number(p.quantity) || 0;
  return 0;
}

/** Charges of one shipment, keyed by packing-list item id. */
export async function loadItemCharges(shipmentId: string): Promise<{ map: Map<string, ItemCharge>; error: string | null }> {
  const { data, error } = await fetchAllPages<ItemCharge>(() => supabase.from('shipment_item_charges').select('*').eq('shipment_id', shipmentId).order('id'));
  const map = new Map<string, ItemCharge>();
  data.forEach((c) => map.set(c.packing_list_item_id, { ...c, qty: Number(c.qty) || 0, rate: Number(c.rate) || 0, amount: Number(c.amount) || 0 }));
  return { map, error };
}

/** the key of a packing list inside a shipment: PL Input id | packing list no */
export const plKeyOf = (i: { pl_input_id: string | null; packing_list_no: string | null }) => `${i.pl_input_id ?? '-'}|${i.packing_list_no || '-'}`;
export interface PlCharge { id?: string; shipment_id: string; pl_key: string; pl_input_id: string | null; packing_list_no: string | null; basis: ChargeBasis; qty: number; rate: number; amount: number }

/** Charges per packing list (the bulk side). missing = sql not run yet. */
export async function loadPlCharges(shipmentId: string): Promise<{ map: Map<string, PlCharge>; error: string | null; missing: boolean }> {
  const { data, error } = await fetchAllPages<PlCharge>(() => supabase.from('shipment_pl_charges').select('*').eq('shipment_id', shipmentId).order('id'));
  const map = new Map<string, PlCharge>();
  if (error) return { map, error, missing: /does not exist|schema cache/i.test(error) };
  data.forEach((c) => map.set(c.pl_key, { ...c, qty: Number(c.qty) || 0, rate: Number(c.rate) || 0, amount: Number(c.amount) || 0 }));
  return { map, error: null, missing: false };
}

/** packing-list item -> its purchase bill (through PL Input) */
async function billsOf(rows: PlRow[]): Promise<{ map: Map<string, string | null>; error: string | null }> {
  const map = new Map<string, string | null>();
  const pl = await selectByIds<{ id: string; purchase_bill_id: string | null }>('pl_input', 'id, purchase_bill_id', 'id', rows.map((r) => r.pl_input_id || '').filter(Boolean));
  if (pl.error) return { map, error: pl.error };
  const toBill = new Map(pl.data.map((p) => [p.id, p.purchase_bill_id]));
  rows.forEach((r) => map.set(r.id, r.pl_input_id ? toBill.get(r.pl_input_id) ?? null : null));
  return { map, error: null };
}

/**
 * Set the charge of some items from Costing. basis null = take the charge off the item.
 * KG / CBM / PCS: amount = the item's kg / CBM / qty in Packing List x rate. FIXED: amount as given.
 */
export async function saveItemCharges(shipmentId: string, changes: { itemId: string; basis: ChargeBasis | null; rate: number; fixed?: number }[]): Promise<{ error: string | null }> {
  if (!changes.length) return { error: null };
  const pl = await selectByIds<PlRow>('packing_list_items', 'id, weight_kg, cbm, quantity, pl_input_id', 'id', changes.map((c) => c.itemId));
  if (pl.error) return { error: pl.error };
  const plOf = new Map(pl.data.map((p) => [p.id, p]));
  const bills = await billsOf(pl.data);
  if (bills.error) return { error: bills.error };

  const up: ItemCharge[] = []; const off: string[] = [];
  changes.forEach((c) => {
    if (!c.basis) { off.push(c.itemId); return; }
    const p = plOf.get(c.itemId);
    const qty = p ? chargeQty(p, c.basis) : 0;
    up.push({ shipment_id: shipmentId, packing_list_item_id: c.itemId, purchase_bill_id: bills.map.get(c.itemId) ?? null, basis: c.basis,
      qty: c.basis === 'FIXED' ? 0 : r4(qty), rate: c.basis === 'FIXED' ? 0 : c.rate, amount: r2(c.basis === 'FIXED' ? (c.fixed || 0) : qty * c.rate) });
  });
  for (let k = 0; k < up.length; k += 500) {
    const { error } = await supabase.from('shipment_item_charges').upsert(up.slice(k, k + 500), { onConflict: 'shipment_id,packing_list_item_id' });
    if (error) return { error: error.message };
  }
  for (let k = 0; k < off.length; k += 150) {
    const { error } = await supabase.from('shipment_item_charges').delete().eq('shipment_id', shipmentId).in('packing_list_item_id', off.slice(k, k + 150));
    if (error) return { error: error.message };
  }
  return { error: null };
}

/**
 * Bring each saved charge up to date with Packing List (kg / CBM / qty may have changed since),
 * then the per-bill totals (CN Reports) and — when no bulk amount was typed — the shipment's total.
 */
export async function refreshShipmentCharges(shipmentId: string): Promise<{ error: string | null }> {
  const pls = await refreshPlCharges(shipmentId);
  if (pls.error) return { error: pls.error };
  const { map, error } = await loadItemCharges(shipmentId);
  if (error) return { error };
  if (map.size === 0 && pls.total === null) return { error: null };
  const pl = await selectByIds<PlRow>('packing_list_items', 'id, weight_kg, cbm, quantity, pl_input_id', 'id', [...map.keys()]);
  if (pl.error) return { error: pl.error };
  const plOf = new Map(pl.data.map((p) => [p.id, p]));

  // 1. kg / CBM / qty fresh from the packing list
  for (const c of map.values()) {
    const p = plOf.get(c.packing_list_item_id);
    if (!p || c.basis === 'FIXED') continue;
    const q = r4(chargeQty(p, c.basis)); const amt = r2(q * c.rate);
    if (Math.abs(q - c.qty) < 0.00005 && Math.abs(amt - c.amount) < 0.005) continue;
    const { error: e } = await supabase.from('shipment_item_charges').update({ qty: q, amount: amt }).eq('shipment_id', shipmentId).eq('packing_list_item_id', c.packing_list_item_id);
    if (e) return { error: e.message };
    c.qty = q; c.amount = amt;
  }

  // 2. per-bill totals (only bills that have item charges)
  const byBill = new Map<string, number>();
  map.forEach((c) => { if (c.purchase_bill_id) byBill.set(c.purchase_bill_id, (byBill.get(c.purchase_bill_id) || 0) + c.amount); });
  const billRows = [...byBill.entries()].map(([id, amt]) => ({ shipment_id: shipmentId, purchase_bill_id: id, basis: 'FIXED', qty: 0, rate: 0, amount: r2(amt) }));
  if (billRows.length) {
    const { error: e } = await supabase.from('shipment_charges').upsert(billRows, { onConflict: 'shipment_id,purchase_bill_id' });
    if (e && !/shipment_charges/.test(e.message)) return { error: e.message };
  }

  // 3. the shipment's total: the agent's invoice when typed, else the packing-list charges (bulk), else what is on the items
  const { data: s, error: sErr } = await supabase.from('shipments').select('agent_invoice, other_charges, actual_charges').eq('id', shipmentId).maybeSingle();
  if (!sErr && s) {
    const inv = Number(s.agent_invoice) || 0;
    const base = pls.total !== null ? pls.total : [...map.values()].reduce((t, c) => t + c.amount, 0);
    const want = r2(inv > 0 ? inv : base + (Number(s.other_charges) || 0));
    if (Math.abs(want - (Number(s.actual_charges) || 0)) >= 0.005) {
      const { error: e } = await supabase.from('shipments').update({ actual_charges: want }).eq('id', shipmentId);
      if (e) return { error: e.message };
    }
    // the agent's account line follows the packing-list charges (only when no different agent invoice was typed)
    if (inv === 0 && pls.total !== null && pls.total > 0) {
      const { error: e } = await supabase.from('agent_ledger').update({ amount: r2(pls.total) }).eq('shipment_id', shipmentId).eq('kind', 'charge').neq('amount', r2(pls.total));
      if (e && !/agent_ledger/.test(e.message)) return { error: e.message };
    }
  }
  return { error: null };
}

/** Bring the packing-list charges up to date with Packing List (PL total kg / CBM / pcs). total = null when there are none. */
async function refreshPlCharges(shipmentId: string): Promise<{ total: number | null; error: string | null }> {
  const pc = await loadPlCharges(shipmentId);
  if (pc.missing) return { total: null, error: null };
  if (pc.error) return { total: null, error: pc.error };
  if (pc.map.size === 0) return { total: null, error: null };
  const { data: ship } = await supabase.from('shipments').select('shipment_no').eq('id', shipmentId).maybeSingle();
  if (!ship) return { total: null, error: null };
  type P = { id: string; weight_kg: number | null; cbm: number | null; quantity: number | null; pl_input_id: string | null; packing_list_no: string | null };
  const { data: items, error } = await fetchAllPages<P>(() => supabase.from('packing_list_items').select('id, weight_kg, cbm, quantity, pl_input_id, packing_list_no').eq('batch_number', ship.shipment_no).order('id'));
  if (error) return { total: null, error };
  let total = 0;
  for (const c of pc.map.values()) {
    // 'SHIPMENT' = the whole shipment's total typed in Charges (not from Packing List): keep it as typed
    if (c.basis !== 'FIXED' && c.pl_key !== 'SHIPMENT') {
      const q = r4(items.filter((i) => plKeyOf(i) === c.pl_key).reduce((t, i) => t + chargeQty(i, c.basis), 0));
      const amt = r2(q * c.rate);
      if (Math.abs(q - c.qty) >= 0.00005 || Math.abs(amt - c.amount) >= 0.005) {
        const { error: e } = await supabase.from('shipment_pl_charges').update({ qty: q, amount: amt }).eq('shipment_id', shipmentId).eq('pl_key', c.pl_key);
        if (e) return { total: null, error: e.message };
        c.qty = q; c.amount = amt;
      }
    }
    total += c.amount;
  }
  return { total, error: null };
}

/**
 * Put each item's shipping charge onto its costing line(s) of this batch (shipment number).
 * Charges are first brought up to date with Packing List. Only lines whose packing-list item has a charge
 * are changed; manual lines and older costings stay as they are.
 * If one item has several costing lines (it was split), the charge is shared by their quantities.
 * Returns how many lines changed, or an error message.
 */
export async function syncCostingCharges(batchNumber: string): Promise<{ updated: number; error: string | null }> {
  if (!batchNumber) return { updated: 0, error: null };
  const { data: ship, error: shipErr } = await supabase.from('shipments').select('id').eq('shipment_no', batchNumber).maybeSingle();
  if (shipErr) return { updated: 0, error: shipErr.message };
  if (!ship) return { updated: 0, error: null };                       // not a Shipping record: nothing to bring in
  const fresh = await refreshShipmentCharges(ship.id);
  if (fresh.error) return { updated: 0, error: fresh.error };
  const { map, error } = await loadItemCharges(ship.id);
  if (error) return { updated: 0, error };

  type Line = { id: string; packing_list_item_id: string | null; qty: number; charge_per_unit: number | null; charge_basis: string | null };
  const { data: lines, error: lErr } = await fetchAllPages<Line>(() => supabase.from('costing_duty_sheet')
    .select('id, packing_list_item_id, qty, charge_per_unit, charge_basis').eq('batch_number', batchNumber).order('id'));
  if (lErr) return { updated: 0, error: lErr };

  // total costing qty per item (an item split over several lines shares its charge)
  const qtyOf = new Map<string, number>();
  lines.forEach((l) => { if (l.packing_list_item_id) qtyOf.set(l.packing_list_item_id, (qtyOf.get(l.packing_list_item_id) || 0) + (Number(l.qty) || 0)); });

  let updated = 0;
  for (const l of lines) {
    if (!l.packing_list_item_id) continue;
    const c = map.get(l.packing_list_item_id);
    // charge taken off the item: its line goes back to no charge (older costings without a charge row keep theirs)
    if (!c) {
      if (l.charge_basis && ['KG', 'CBM', 'PCS', 'FIXED'].includes(l.charge_basis)) {
        const { error: uErr } = await supabase.from('costing_duty_sheet').update({ charge_per_unit: 0, charge_basis: null }).eq('id', l.id);
        if (uErr) return { updated, error: uErr.message };
        updated++;
      }
      continue;
    }
    const q = qtyOf.get(l.packing_list_item_id) || 0;
    const perUnit = q > 0 ? r4(c.amount / q) : 0;
    if (Math.abs((Number(l.charge_per_unit) || 0) - perUnit) < 0.00005 && l.charge_basis === c.basis) continue;
    const { error: uErr } = await supabase.from('costing_duty_sheet').update({ charge_per_unit: perUnit, charge_basis: c.basis }).eq('id', l.id);
    if (uErr) return { updated, error: uErr.message };
    updated++;
  }
  return { updated, error: null };
}
