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

const key = (s: string | null | undefined) => (s || '').trim().toLowerCase();

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

  // which product and location for each invoice line
  const want: { product: Product; qty: number; locId: string }[] = [];
  for (const ln of lines) {
    const qty = Number(ln.quantity) || 0;
    if (qty <= 0) continue;
    const prod = (ln.item_id && byMaster.get(ln.item_id)) || byName.get(key(ln.item_name));
    if (!prod) { out.skipped.push(ln.item_name); continue; }
    // the location holding the most of it (first active location when none has any)
    const stocks = s.data.filter((x) => x.product_id === prod.id && locs.some((lc) => lc.id === x.location_id));
    const best = stocks.sort((a, b) => Number(b.qty) - Number(a.qty))[0];
    const locId = best && Number(best.qty) > 0 ? best.location_id : locs[0].id;
    const same = want.find((w) => w.product.id === prod.id && w.locId === locId);
    if (same) same.qty += qty; else want.push({ product: prod, qty, locId });
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
