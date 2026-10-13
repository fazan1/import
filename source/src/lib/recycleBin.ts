import { supabase } from './supabase';

interface RecycleBinEntry {
  source_table: string;
  source_id: string;
  record_data: object;
  related_data?: Record<string, unknown[]>;
  display_name: string;
  portal: 'cn' | 'sl';
}

export async function moveToRecycleBin(entry: RecycleBinEntry): Promise<{ success: boolean; error?: string }> {
  const { data: userData } = await supabase.auth.getUser();

  const { error: insertError } = await supabase
    .from('recycle_bin')
    .insert({
      user_id: userData?.user?.id || null,
      source_table: entry.source_table,
      source_id: entry.source_id,
      record_data: entry.record_data,
      related_data: entry.related_data || {},
      display_name: entry.display_name,
      portal: entry.portal,
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
    .insert(record_data);

  if (restoreError) {
    return { success: false, error: restoreError.message };
  }

  if (related_data && typeof related_data === 'object') {
    for (const [relatedTable, records] of Object.entries(related_data)) {
      if (Array.isArray(records) && records.length > 0) {
        await supabase.from(relatedTable).insert(records);
      }
    }
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
