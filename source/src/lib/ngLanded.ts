import { expenseBoth } from '../components/NigeriaExpenses';

/* ONE landed-cost rule for every NG page (owner, Nov 2026): the shipment's TOTAL duty & expenses are spread BY WEIGHT.
   Duty per kg = Σ expenses with the shipment reference (RMB at their rate) ÷ Σ kg received under that reference;
   each piece carries its own weight × duty per kg. Weight per piece comes from the item: 1000 kg ÷ pieces per ton
   (unit kg = 1 kg, bag = 25 kg, ton = 1000 kg). An item belongs to the shipment of its LAST stock-in.
   Landed cost per piece = China cost per piece + duty on that piece. */

export interface LandedItem { id: string; cost_rmb: number; unit?: string; pcs_per_ton?: number | null }
export interface LandedIn { item_id: string; kind: string; quantity: number; cost_rmb: number | null; reference: string | null }
export interface LandedExp { amount: number; currency: string; rate: number | null; reference: string | null }
export interface Landed { cost: number; up: number; ref: string | null; perPiece: number; kgPerUnit: number; perKg: number }

/** kg of one unit of the item (0 when unknown) */
export function kgPerUnit(i: { unit?: string; pcs_per_ton?: number | null }): number {
  const u = i.unit || 'pcs';
  if (u === 'kg') return 1; if (u === 'bag') return 25; if (u === 'ton') return 1000;
  return i.pcs_per_ton && i.pcs_per_ton > 0 ? 1000 / i.pcs_per_ton : 0;
}

export function landedCosts(items: LandedItem[], ins: LandedIn[], exps: LandedExp[], rate: number): Record<string, Landed> {
  const exByRef: Record<string, number> = {};
  exps.filter((e) => e.reference).forEach((e) => { const b = expenseBoth(e, rate); if (isFinite(b.rmb)) exByRef[e.reference!] = (exByRef[e.reference!] || 0) + b.rmb; });
  const kgOf: Record<string, number> = {}; items.forEach((i) => { kgOf[i.id] = kgPerUnit(i); });
  const kgByRef: Record<string, number> = {}, pcsByRef: Record<string, number> = {}, valByItemRef: Record<string, { qty: number; value: number }> = {};
  ins.filter((m) => m.kind === 'in' && m.reference).forEach((m) => { kgByRef[m.reference!] = (kgByRef[m.reference!] || 0) + m.quantity * (kgOf[m.item_id] || 0); pcsByRef[m.reference!] = (pcsByRef[m.reference!] || 0) + m.quantity; const k = m.reference! + '|' + m.item_id; const x = (valByItemRef[k] ||= { qty: 0, value: 0 }); x.qty += m.quantity; x.value += m.cost_rmb || 0; });
  const out: Record<string, Landed> = {};
  items.forEach((i) => {
    const li = ins.find((m) => m.item_id === i.id && m.kind === 'in'); // ins are newest first
    const ref = li?.reference || null; const kg = kgOf[i.id] || 0;
    if (!ref || !pcsByRef[ref]) { out[i.id] = { cost: i.cost_rmb, up: 0, ref, perPiece: 0, kgPerUnit: kg, perKg: 0 }; return; }
    const ex = exByRef[ref] || 0;
    // by weight when the shipment's weight is known; items without a weight fall back to an equal share per piece
    const perKg = kgByRef[ref] > 0 ? ex / kgByRef[ref] : 0;
    const perPiece = kg > 0 && kgByRef[ref] > 0 ? perKg * kg : ex / pcsByRef[ref];
    const mine = valByItemRef[ref + '|' + i.id]; const base = mine && mine.qty > 0 ? mine.value / mine.qty : i.cost_rmb;
    out[i.id] = { cost: base + perPiece, up: base > 0 ? perPiece / base : 0, ref, perPiece, kgPerUnit: kg, perKg };
  });
  return out;
}
