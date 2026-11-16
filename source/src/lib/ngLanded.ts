import { expenseBoth } from '../components/NigeriaExpenses';

/* ONE landed-cost rule for every NG page (owner, Nov 2026): the shipment's TOTAL duty & expenses are spread BY WEIGHT.
   Duty per kg = Σ expenses with the shipment reference (RMB at their rate) ÷ Σ kg received under that reference;
   each piece carries its own weight × duty per kg. Weight per piece comes from the item: 1000 kg ÷ pieces per ton
   (unit kg = 1 kg, bag = 25 kg, ton = 1000 kg). An item belongs to the shipment of its LAST stock-in.
   Landed cost per piece = China cost per piece + duty on that piece. */

export interface LandedItem { id: string; cost_rmb: number; unit?: string; pcs_per_ton?: number | null }
export interface LandedIn { item_id: string; kind: string; quantity: number; cost_rmb: number | null; reference: string | null }
export interface LandedExp { amount: number; currency: string; rate: number | null; reference: string | null }
export interface Landed { cost: number; up: number; ref: string | null; perPiece: number; kgPerUnit: number; perKg: number; pending: boolean }

/** kg of one unit of the item (0 when unknown) */
export function kgPerUnit(i: { unit?: string; pcs_per_ton?: number | null }): number {
  const u = i.unit || 'pcs';
  if (u === 'kg') return 1; if (u === 'bag') return 25; if (u === 'ton') return 1000;
  return i.pcs_per_ton && i.pcs_per_ton > 0 ? 1000 / i.pcs_per_ton : 0;
}

/** references of orders that are NOT fully received yet: their duty is not applied until all goods are in (owner's rule) */
export function pendingRefs(purchases: { number: string; received_at: string | null; status?: string }[]): Set<string> {
  return new Set(purchases.filter((p) => !p.received_at && p.status !== 'cancelled').map((p) => p.number));
}

export function landedCosts(items: LandedItem[], ins: LandedIn[], exps: LandedExp[], rate: number, pending: Set<string> = new Set()): Record<string, Landed> {
  /* WEIGHTED AVERAGE across shipments (owner, Nov 2026): an item that came in on several shipments is costed at the
     average of all its receipts, weighted by quantity: Σ(qty × (China cost of that receipt + duty per piece of that
     shipment)) ÷ Σ qty. A shipment still arriving (pending) counts at China cost only until it is fully received. */
  const exByRef: Record<string, number> = {};
  exps.filter((e) => e.reference).forEach((e) => { const b = expenseBoth(e, rate); if (isFinite(b.rmb)) exByRef[e.reference!] = (exByRef[e.reference!] || 0) + b.rmb; });
  const kgOf: Record<string, number> = {}; items.forEach((i) => { kgOf[i.id] = kgPerUnit(i); });
  const kgByRef: Record<string, number> = {}, pcsByRef: Record<string, number> = {};
  const recv: Record<string, Record<string, { qty: number; value: number }>> = {};   // item -> ref -> received
  ins.filter((m) => m.kind === 'in' && m.reference && m.quantity > 0).forEach((m) => {
    kgByRef[m.reference!] = (kgByRef[m.reference!] || 0) + m.quantity * (kgOf[m.item_id] || 0); pcsByRef[m.reference!] = (pcsByRef[m.reference!] || 0) + m.quantity;
    const r = (recv[m.item_id] ||= {}); const x = (r[m.reference!] ||= { qty: 0, value: 0 }); x.qty += m.quantity; x.value += m.cost_rmb || 0;
  });
  const perKgOf = (ref: string) => (kgByRef[ref] > 0 ? (exByRef[ref] || 0) / kgByRef[ref] : 0);
  const out: Record<string, Landed> = {};
  items.forEach((i) => {
    const kg = kgOf[i.id] || 0; const refs = recv[i.id] ? Object.keys(recv[i.id]) : [];
    const lastIn = ins.find((m) => m.item_id === i.id && m.kind === 'in'); const lastRef = lastIn?.reference || null;
    if (!refs.length) { out[i.id] = { cost: i.cost_rmb, up: 0, ref: lastRef, perPiece: 0, kgPerUnit: kg, perKg: 0, pending: false }; return; }
    let qty = 0, goods = 0, duty = 0, isPending = false;
    refs.forEach((ref) => {
      const x = recv[i.id][ref]; qty += x.qty; goods += x.value;
      if (pending.has(ref)) { isPending = true; return; }
      const perPiece = kg > 0 && kgByRef[ref] > 0 ? perKgOf(ref) * kg : (pcsByRef[ref] > 0 ? (exByRef[ref] || 0) / pcsByRef[ref] : 0);
      duty += perPiece * x.qty;
    });
    const base = goods / qty, perPiece = duty / qty;
    out[i.id] = { cost: base + perPiece, up: base > 0 ? perPiece / base : 0, ref: refs.length > 1 ? `${refs.length} shipments (avg)` : lastRef, perPiece, kgPerUnit: kg, perKg: lastRef ? perKgOf(lastRef) : 0, pending: isPending };
  });
  return out;
}
