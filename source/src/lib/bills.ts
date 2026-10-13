import { supabase } from './supabase';
import { moveToRecycleBin } from './recycleBin';

/**
 * Delete a purchase bill with its lines and payments.
 * A copy goes to the Recycle Bin first, and every step is checked: if the bill itself
 * cannot be deleted, the lines and payments that were already removed are put back.
 * Returns an error message, or null when it worked.
 */
export async function deletePurchaseBill(billId: string): Promise<string | null> {
  const [billRes, itemsRes, paysRes] = await Promise.all([
    supabase.from('purchase_bills').select('*').eq('id', billId).maybeSingle(),
    supabase.from('purchase_bill_items').select('*').eq('purchase_bill_id', billId),
    supabase.from('purchase_payments').select('*').eq('purchase_bill_id', billId),
  ]);
  const readErr = billRes.error || itemsRes.error || paysRes.error;
  if (readErr) return readErr.message;
  if (!billRes.data) return 'Bill not found (it may belong to another book).';
  const bill = billRes.data;
  const items = itemsRes.data || [];
  const pays = paysRes.data || [];

  const bin = await moveToRecycleBin({
    source_table: 'purchase_bills',
    source_id: billId,
    record_data: bill,
    related_data: { purchase_bill_items: items, purchase_payments: pays },
    display_name: `Bill ${bill.cnv_invoice_number || bill.bill_number || ''} (${bill.bill_date || ''})`,
    portal: 'cn',
  });
  if (!bin.success) return 'Could not copy the bill to the Recycle Bin, so nothing was deleted: ' + (bin.error || '');

  const putBack = async (what: { items?: boolean; pays?: boolean }) => {
    if (what.items && items.length) await supabase.from('purchase_bill_items').insert(items);
    if (what.pays && pays.length) await supabase.from('purchase_payments').insert(pays);
  };

  const { error: payErr } = await supabase.from('purchase_payments').delete().eq('purchase_bill_id', billId);
  if (payErr) return payErr.message;
  const { error: itemErr } = await supabase.from('purchase_bill_items').delete().eq('purchase_bill_id', billId);
  if (itemErr) { await putBack({ pays: true }); return itemErr.message; }
  const { error: billErr } = await supabase.from('purchase_bills').delete().eq('id', billId);
  if (billErr) { await putBack({ items: true, pays: true }); return billErr.message + ' (the bill, its lines and payments were kept)'; }
  return null;
}
