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

/**
 * Read ALL rows of a query, page by page (Supabase returns at most 1000 rows per call).
 * `build` must return a fresh query each time, with a stable .order() so pages don't skip or repeat rows.
 * The current-book filter is applied automatically for booked tables, so books never mix.
 *   const { data } = await fetchAllPages(() => supabase.from('busy_sales_payments').select('...').order('id'));
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllPages<T>(build: () => any): Promise<{ data: T[]; error: string | null }> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) return { data: out, error: error.message };
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return { data: out, error: null };
}
