import { expenseBoth } from '../components/NigeriaExpenses';

/* ONE landed-cost rule for every NG page (owner's partner, Nov 2026): the shipment's TOTAL duty & expenses are divided by
   the TOTAL PIECES received under that reference — every piece carries the same amount, whatever its value.
   An item belongs to the shipment of its LAST stock-in. Landed cost per piece = China cost per piece + duty per piece. */

export interface LandedItem { id: string; cost_rmb: number }
export interface LandedIn { item_id: string; kind: string; quantity: number; cost_rmb: number | null; reference: string | null }
export interface LandedExp { amount: number; currency: string; rate: number | null; reference: string | null }
export interface Landed { cost: number; up: number; ref: string | null; perPiece: number }

export function landedCosts(items: LandedItem[], ins: LandedIn[], exps: LandedExp[], rate: number): Record<string, Landed> {
  const exByRef: Record<string, number> = {};
  exps.filter((e) => e.reference).forEach((e) => { const b = expenseBoth(e, rate); if (isFinite(b.rmb)) exByRef[e.reference!] = (exByRef[e.reference!] || 0) + b.rmb; });
  const pcsByRef: Record<string, number> = {}, valByItemRef: Record<string, { qty: number; value: number }> = {};
  ins.filter((m) => m.kind === 'in' && m.reference).forEach((m) => { pcsByRef[m.reference!] = (pcsByRef[m.reference!] || 0) + m.quantity; const k = m.reference! + '|' + m.item_id; const x = (valByItemRef[k] ||= { qty: 0, value: 0 }); x.qty += m.quantity; x.value += m.cost_rmb || 0; });
  const out: Record<string, Landed> = {};
  items.forEach((i) => {
    const li = ins.find((m) => m.item_id === i.id && m.kind === 'in'); // ins are newest first
    const ref = li?.reference || null;
    if (!ref || !pcsByRef[ref]) { out[i.id] = { cost: i.cost_rmb, up: 0, ref, perPiece: 0 }; return; }
    const perPiece = (exByRef[ref] || 0) / pcsByRef[ref];                 // RMB of duty & expenses on every piece of the shipment
    const mine = valByItemRef[ref + '|' + i.id]; const base = mine && mine.qty > 0 ? mine.value / mine.qty : i.cost_rmb;
    out[i.id] = { cost: base + perPiece, up: base > 0 ? perPiece / base : 0, ref, perPiece };
  });
  return out;
}
