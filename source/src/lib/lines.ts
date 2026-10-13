import { supabase } from './supabase';

type Row = Record<string, unknown>;

/**
 * Replace the detail lines of one document (delete old lines, insert new ones).
 * If the insert fails, the old lines are put back, so a document is never left empty.
 * Returns the error message, or null when it worked.
 */
export async function replaceLines(table: string, parentCol: string, parentId: string, newRows: Row[]): Promise<string | null> {
  const { data: oldRows, error: readErr } = await supabase.from(table).select('*').eq(parentCol, parentId);
  if (readErr) return readErr.message;
  const { error: delErr } = await supabase.from(table).delete().eq(parentCol, parentId);
  if (delErr) return delErr.message;
  if (newRows.length === 0) return null;
  const { error: insErr } = await supabase.from(table).insert(newRows);
  if (!insErr) return null;
  if (oldRows && oldRows.length) {
    const { error: backErr } = await supabase.from(table).insert(oldRows);
    if (backErr) return `${insErr.message} — and the old lines could not be put back: ${backErr.message}`;
  }
  return `${insErr.message} (your old lines were kept)`;
}
