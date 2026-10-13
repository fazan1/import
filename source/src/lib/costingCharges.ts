import { supabase } from './supabase';
import { fetchAllPages } from './fetchAll';

/* Shipping -> Charges is entered item by item (table shipment_item_charges).
   Costing takes that item's charge and divides it by the item's quantity:
     charge per unit = item charge / qty     landed per unit = (CNY price x rate) + charge per unit
   The database (trigger zzzz_costing_calc) works out landed / profit / totals from charge_per_unit. */

export type ChargeBasis = 'KG' | 'CBM' | 'PCS' | 'FIXED';
export interface ItemCharge { id?: string; shipment_id: string; packing_list_item_id: string; purchase_bill_id: string | null; basis: ChargeBasis; qty: number; rate: number; amount: number }

/** Charges of one shipment, keyed by packing-list item id. */
export async function loadItemCharges(shipmentId: string): Promise<{ map: Map<string, ItemCharge>; error: string | null }> {
  const { data, error } = await fetchAllPages<ItemCharge>(() => supabase.from('shipment_item_charges').select('*').eq('shipment_id', shipmentId).order('id'));
  const map = new Map<string, ItemCharge>();
  data.forEach((c) => map.set(c.packing_list_item_id, { ...c, qty: Number(c.qty) || 0, rate: Number(c.rate) || 0, amount: Number(c.amount) || 0 }));
  return { map, error };
}

/**
 * Put each item's shipping charge onto its costing line(s) of this batch (shipment number).
 * Only lines whose packing-list item has a charge are changed; manual lines and older costings stay as they are.
 * If one item has several costing lines (it was split), the charge is shared by their quantities.
 * Returns how many lines changed, or an error message.
 */
export async function syncCostingCharges(batchNumber: string): Promise<{ updated: number; error: string | null }> {
  if (!batchNumber) return { updated: 0, error: null };
  const { data: ship, error: shipErr } = await supabase.from('shipments').select('id').eq('shipment_no', batchNumber).maybeSingle();
  if (shipErr) return { updated: 0, error: shipErr.message };
  if (!ship) return { updated: 0, error: null };                       // not a Shipping record: nothing to bring in
  const { map, error } = await loadItemCharges(ship.id);
  if (error) return { updated: 0, error };
  if (map.size === 0) return { updated: 0, error: null };

  type Line = { id: string; packing_list_item_id: string | null; qty: number; charge_per_unit: number | null; charge_basis: string | null };
  const { data: lines, error: lErr } = await fetchAllPages<Line>(() => supabase.from('costing_duty_sheet')
    .select('id, packing_list_item_id, qty, charge_per_unit, charge_basis').eq('batch_number', batchNumber).order('id'));
  if (lErr) return { updated: 0, error: lErr };

  // total costing qty per item (an item split over several lines shares its charge)
  const qtyOf = new Map<string, number>();
  lines.forEach((l) => { if (l.packing_list_item_id) qtyOf.set(l.packing_list_item_id, (qtyOf.get(l.packing_list_item_id) || 0) + (Number(l.qty) || 0)); });

  let updated = 0;
  for (const l of lines) {
    const c = l.packing_list_item_id ? map.get(l.packing_list_item_id) : undefined;
    if (!c) continue;
    const q = qtyOf.get(l.packing_list_item_id!) || 0;
    const perUnit = q > 0 ? Math.round((c.amount / q) * 10000) / 10000 : 0;
    if (Math.abs((Number(l.charge_per_unit) || 0) - perUnit) < 0.00005 && l.charge_basis === c.basis) continue;
    const { error: uErr } = await supabase.from('costing_duty_sheet').update({ charge_per_unit: perUnit, charge_basis: c.basis }).eq('id', l.id);
    if (uErr) return { updated, error: uErr.message };
    updated++;
  }
  return { updated, error: null };
}
