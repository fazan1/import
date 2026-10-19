import { supabase } from './supabase';
import { fetchAllPages } from './fetchAll';

/* Sales invoice -> warehouse.
   Saving an invoice ISSUES its items from the warehouse (an issue note per location, linked by sales_invoice_id);
   saving it again replaces that issue; deleting the invoice removes it, which puts the stock back.
   Items are matched to warehouse products by the Items master link first, then by name.
   Stock is taken from the location that holds the most of that product. */

interface Line { item_id?: string | null; item_name: string; quantity: number }
interface Product { id: string; name: string; master_item_id: string | null; is_active: boolean }
interface Stock { product_id: string; location_id: string; qty: number }
interface Loc { id: string; name: string; is_active: boolean }

export interface IssueResult {
  issued: { name: string; qty: number; location: string }[];
  skipped: string[];        // invoice lines with no warehouse product
  error?: string;           // the warehouse part failed (the invoice itself is saved)
}

const key = (s: string | null | undefined) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export async function removeInvoiceStock(invoiceId: string): Promise<string | null> {
  const { error } = await supabase.from('wh_notes').delete().eq('sales_invoice_id', invoiceId);
  return error ? error.message : null;
}

export async function syncInvoiceStock(inv: { id: string; number: string; customer: string; date: string }, lines: Line[]): Promise<IssueResult> {
  const out: IssueResult = { issued: [], skipped: [] };
  const [p, s, l] = await Promise.all([
    fetchAllPages<Product>(() => supabase.from('wh_products').select('id, name, master_item_id, is_active').order('id')),
    fetchAllPages<Stock>(() => supabase.from('wh_stock').select('product_id, location_id, qty').order('product_id')),
    fetchAllPages<Loc>(() => supabase.from('wh_locations').select('id, name, is_active').order('id')),
  ]);
  if (p.error || s.error || l.error) { out.error = p.error || s.error || l.error || ''; return out; }
  const products = p.data.filter((x) => x.is_active !== false);
  const locs = l.data.filter((x) => x.is_active !== false);
  if (!locs.length) { out.error = 'No warehouse location set up'; return out; }
  const byMaster = new Map(products.filter((x) => x.master_item_id).map((x) => [x.master_item_id as string, x]));
  const byName = new Map(products.map((x) => [key(x.name), x]));

  // which product for each line, and how much comes from each location:
  // take from the location with the most stock first, then the next, until the quantity is covered;
  // whatever is still short comes from the biggest location (it goes negative, the owner sees it in Warehouse)
  const want: { product: Product; qty: number; locId: string }[] = [];
  const add = (product: Product, locId: string, qty: number) => {
    const same = want.find((w) => w.product.id === product.id && w.locId === locId);
    if (same) same.qty += qty; else want.push({ product, qty, locId });
  };
  const live = new Map<string, number>(); // product|loc -> qty still available during this allocation
  s.data.forEach((x) => live.set(x.product_id + '|' + x.location_id, Number(x.qty) || 0));
  for (const ln of lines) {
    let qty = Number(ln.quantity) || 0;
    if (qty <= 0) continue;
    const prod = (ln.item_id && byMaster.get(ln.item_id)) || byName.get(key(ln.item_name));
    if (!prod) { out.skipped.push(ln.item_name); continue; }
    const piles = locs.map((lc) => ({ locId: lc.id, qty: live.get(prod.id + '|' + lc.id) || 0 })).sort((a, b) => b.qty - a.qty);
    for (const pile of piles) {
      if (qty <= 0) break;
      if (pile.qty <= 0) continue;
      const take = Math.min(pile.qty, qty);
      add(prod, pile.locId, take); live.set(prod.id + '|' + pile.locId, pile.qty - take); qty -= take;
    }
    if (qty > 0) { const big = piles[0]?.locId || locs[0].id; add(prod, big, qty); live.set(prod.id + '|' + big, (live.get(prod.id + '|' + big) || 0) - qty); }
  }

  // replace whatever this invoice issued before
  const del = await removeInvoiceStock(inv.id);
  if (del) { out.error = del; return out; }
  if (!want.length) return out;

  const groups = new Map<string, typeof want>();
  want.forEach((w) => { (groups.get(w.locId) || groups.set(w.locId, []).get(w.locId)!).push(w); });
  for (const [locId, ws] of groups) {
    const { data: no, error: e0 } = await supabase.rpc('next_wh_note_no', { p_kind: 'issue' });
    if (e0) { out.error = e0.message; return out; }
    const { data: note, error: e1 } = await supabase.from('wh_notes').insert({
      note_no: no, kind: 'issue', note_date: inv.date,
      from_location_id: locId, to_location_id: null,
      issued_to: inv.customer, remarks: `Sales invoice ${inv.number}`, sales_invoice_id: inv.id,
    }).select().single();
    if (e1 || !note) { out.error = e1?.message || 'Could not create the issue note'; return out; }
    const { error: e2 } = await supabase.from('wh_note_lines').insert(ws.map((w, i) => ({ note_id: note.id, product_id: w.product.id, qty: w.qty, remark: `Inv ${inv.number}`, line_no: i + 1 })));
    if (e2) { await supabase.from('wh_notes').delete().eq('id', note.id); out.error = e2.message; return out; }
    const locName = locs.find((x) => x.id === locId)?.name || '';
    ws.forEach((w) => out.issued.push({ name: w.product.name, qty: w.qty, location: locName }));
  }
  return out;
}

/** One-line message for the alert after saving an invoice (empty when nothing to say). */
export function describeIssue(r: IssueResult): string {
  const parts: string[] = [];
  if (r.error) parts.push(`Warehouse stock was NOT updated: ${r.error}` + (/sales_invoice_id|column/i.test(r.error) ? ' (run warehouse-invoice-link.sql in Supabase)' : ''));
  if (r.issued.length) parts.push('Warehouse: issued ' + r.issued.map((x) => `${x.qty} ${x.name} (${x.location})`).join(', '));
  if (r.skipped.length) parts.push('Not in the warehouse (stock not changed): ' + r.skipped.join(', '));
  return parts.join('\n');
}

/** Older invoices (saved before v142) never moved stock: issue them now.
    An invoice counts as done only when its linked issue note(s) have lines; empty notes (from an older mechanism) are redone. */
export async function backfillInvoiceStock(invoices: { id: string; invoice_number: string; customer_name: string | null; invoice_date: string; status: string; busy_sales_invoice_items?: Line[] }[]): Promise<{ done: number; skipped: number; errors: string[]; report: string[] }> {
  const res = { done: 0, skipped: 0, errors: [] as string[], report: [] as string[] };
  const { data: linked, error } = await supabase.from('wh_notes').select('id, sales_invoice_id').not('sales_invoice_id', 'is', null);
  if (error) { res.errors.push('Could not read warehouse notes: ' + error.message); return res; }
  const noteIds = (linked || []).map((x: { id: string }) => x.id);
  const withLines = new Set<string>();
  if (noteIds.length) {
    const { data: ls, error: e2 } = await supabase.from('wh_note_lines').select('note_id').in('note_id', noteIds);
    if (e2) { res.errors.push('Could not read warehouse note lines: ' + e2.message); return res; }
    (ls || []).forEach((l: { note_id: string }) => withLines.add(l.note_id));
  }
  const done = new Set((linked || []).filter((x: { id: string }) => withLines.has(x.id)).map((x: { sales_invoice_id: string }) => x.sales_invoice_id));
  for (const inv of invoices) {
    if (inv.status === 'cancelled' || inv.status === 'draft') { res.skipped++; continue; }
    if (done.has(inv.id)) { res.skipped++; res.report.push(`${inv.invoice_number}: already issued`); continue; }
    const lines = inv.busy_sales_invoice_items || [];
    if (!lines.length) { res.skipped++; res.report.push(`${inv.invoice_number}: no item lines`); continue; }
    const r = await syncInvoiceStock({ id: inv.id, number: inv.invoice_number, customer: inv.customer_name || '', date: inv.invoice_date }, lines);
    if (r.error) { res.errors.push(`${inv.invoice_number}: ${r.error}`); continue; }
    if (r.issued.length) { res.done++; res.report.push(`${inv.invoice_number}: issued ` + r.issued.map((x) => `${x.qty} ${x.name}`).join(', ') + (r.skipped.length ? ` (not in warehouse: ${r.skipped.join(', ')})` : '')); }
    else { res.skipped++; res.report.push(`${inv.invoice_number}: nothing to issue — not in warehouse: ${r.skipped.join(', ') || '(no items)'}`); }
  }
  return res;
}
