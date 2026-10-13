import { supabase } from './supabase';

/**
 * Read every row of `table` whose `col` is one of `ids` (e.g. the lines of the invoices of the current book).
 * Works in small groups and pages, so it never stops at Supabase's 1000-row limit.
 */
export async function selectByIds<T>(table: string, cols: string, col: string, ids: string[]): Promise<{ data: T[]; error: string | null }> {
  const out: T[] = [];
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 150) {
    const group = unique.slice(i, i + 150);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from(table).select(cols).in(col, group).order('id').range(from, from + 999);
      if (error) return { data: out, error: error.message };
      out.push(...((data ?? []) as T[]));
      if (!data || data.length < 1000) break;
    }
  }
  return { data: out, error: null };
}
