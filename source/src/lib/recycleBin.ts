import { supabase } from './supabase';
import { writeBook } from './book';

interface RecycleBinEntry {
  source_table: string;
  source_id: string;
  record_data: object;
  related_data?: Record<string, unknown[]>;
  display_name: string;
  portal: 'cn' | 'sl';
}

// Drop joined/nested data (e.g. line arrays or a joined customer object) that was loaded with the row;
// it is not a column of the table, so inserting it back would fail.
function stripNested(row: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!row || typeof row !== 'object') return out;
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (Array.isArray(v) && v.some(x => x !== null && typeof x === 'object')) continue;
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) continue;
    out[k] = v;
  }
  return out;
}

export async function moveToRecycleBin(entry: RecycleBinEntry): Promise<{ success: boolean; error?: string }> {
  const { data: userData } = await supabase.auth.getUser();

  const { error: insertError } = await supabase
    .from('recycle_bin')
    .insert({
      user_id: userData?.user?.id || null,
      source_table: entry.source_table,
      source_id: entry.source_id,
      record_data: stripNested(entry.record_data),
      related_data: entry.related_data || {},
      display_name: entry.display_name,
      portal: entry.portal,
      // the deleted record's own book (a master without a book: the book you are in)
      book: ((entry.record_data as { book?: string | null }).book) || writeBook(),
    });

  if (insertError) {
    return { success: false, error: insertError.message };
  }

  return { success: true };
}

export async function restoreFromRecycleBin(
  recycleBinId: string
): Promise<{ success: boolean; error?: string }> {
  const { data: item, error: fetchError } = await supabase
    .from('recycle_bin')
    .select('*')
    .eq('id', recycleBinId)
    .maybeSingle();

  if (fetchError || !item) {
    return { success: false, error: fetchError?.message || 'Item not found' };
  }

  const { source_table, record_data, related_data } = item;

  const { error: restoreError } = await supabase
    .from(source_table)
    .insert(stripNested(record_data));

  if (restoreError) {
    return { success: false, error: restoreError.message };
  }

  const failed: string[] = [];
  if (related_data && typeof related_data === 'object') {
    for (const [relatedTable, records] of Object.entries(related_data)) {
      if (Array.isArray(records) && records.length > 0) {
        const { error: relErr } = await supabase.from(relatedTable).insert(records.map(stripNested));
        if (relErr) failed.push(`${relatedTable}: ${relErr.message}`);
      }
    }
  }

  if (failed.length > 0) {
    return {
      success: false,
      error: `The main record was restored, but some of its lines could not be restored (${failed.join('; ')}). The item was kept in the Recycle Bin so nothing is lost.`,
    };
  }

  const { error: deleteError } = await supabase
    .from('recycle_bin')
    .delete()
    .eq('id', recycleBinId);

  if (deleteError) {
    return { success: false, error: deleteError.message };
  }

  return { success: true };
}

export async function permanentlyDelete(recycleBinId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('recycle_bin')
    .delete()
    .eq('id', recycleBinId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function getRecycleBinItems(portal?: 'cn' | 'sl') {
  let query = supabase
    .from('recycle_bin')
    .select('*')
    .order('deleted_at', { ascending: false });

  if (portal) {
    query = query.eq('portal', portal);
  }

  const { data, error } = await query;

  return { data, error };
}
