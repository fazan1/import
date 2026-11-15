import { expenseBoth } from '../components/NigeriaExpenses';

/* ONE landed-cost rule for every NG page.
   A shipment's duty & expenses (entries with that reference, in RMB at their rate) are spread over the goods received
   under that reference, weighted by VALUE × DUTY FACTOR of each item (factor 1 = normal, 1.5 = carries more, 0.7 = less).
   An item belongs to the shipment of its LAST stock-in. Landed cost per unit = China cost + its share ÷ quantity received. */

export interface LandedItem { id: string; cost_rmb: number; duty_factor?: number | null }
export interface LandedIn { item_id: string; kind: string; quantity: number; cost_rmb: number | null; reference: string | null }
export interface LandedExp { amount: number; currency: string; rate: number | null; reference: string | null }
export interface Landed { cost: number; up: number; ref: string | null; factor: number }

export function landedCosts(items: LandedItem[], ins: LandedIn[], exps: LandedExp[], rate: number): Record<string, Landed> {
  const exByRef: Record<string, number> = {};
  exps.filter((e) => e.reference).forEach((e) => { const b = expenseBoth(e, rate); if (isFinite(b.rmb)) exByRef[e.reference!] = (exByRef[e.reference!] || 0) + b.rmb; });
  // goods per reference per item (quantity + value), from stock-in rows
  const perRef: Record<string, Record<string, { qty: number; value: number }>> = {};
  ins.filter((m) => m.kind === 'in' && m.reference).forEach((m) => { const r = (perRef[m.reference!] ||= {}); const x = (r[m.item_id] ||= { qty: 0, value: 0 }); x.qty += m.quantity; x.value += m.cost_rmb || 0; });
  const factorOf = (id: string) => { const f = Number(items.find((i) => i.id === id)?.duty_factor); return isFinite(f) && f > 0 ? f : 1; };
  const out: Record<string, Landed> = {};
  items.forEach((i) => {
    const li = ins.find((m) => m.item_id === i.id && m.kind === 'in'); // ins are newest first
    const ref = li?.reference || null; const f = factorOf(i.id);
    if (!ref || !perRef[ref] || !perRef[ref][i.id] || perRef[ref][i.id].qty <= 0) { out[i.id] = { cost: i.cost_rmb, up: 0, ref, factor: f }; return; }
    const ex = exByRef[ref] || 0;
    const weighted = Object.entries(perRef[ref]).reduce((t, [id, x]) => t + x.value * factorOf(id), 0);
    const mine = perRef[ref][i.id];
    const share = weighted > 0 ? ex * (mine.value * f) / weighted : 0;   // RMB of duty & expenses this item carries
    const perUnit = share / mine.qty; const base = mine.value / mine.qty || i.cost_rmb;
    out[i.id] = { cost: base + perUnit, up: base > 0 ? perUnit / base : 0, ref, factor: f };
  });
  return out;
}
