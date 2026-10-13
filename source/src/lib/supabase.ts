import { createClient } from '@supabase/supabase-js';
import { BOOKED_TABLES, MAIN_BOOKS, getBook, isAllBooks, writeBook } from './book';

// Runtime config (set in index.html) wins over build-time env, so one build can serve several sites.
declare global { interface Window { APP_CONFIG?: { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; MODE?: 'full' | 'shop'; COMPANY?: string; TITLE?: string } } }
const cfg = (typeof window !== 'undefined' && window.APP_CONFIG) || {};
const supabaseUrl = cfg.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = cfg.SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
export const APP_MODE: 'full' | 'shop' = cfg.MODE || 'full';
export const APP_COMPANY = cfg.COMPANY || 'HDR&CO';
export const APP_TITLE = cfg.TITLE || 'IMPORT CRM';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase environment variables are not set');
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

/* ---------------------------------------------------------------------------
   Book awareness. For the tables in BOOKED_TABLES only:
     - select()           gets .eq('book', <current book>)  (skipped on "All books")
     - insert()/upsert()  stamps the book on rows that don't already carry one
   Done by replacing the three methods on each fresh query builder, so nothing
   inside supabase-js is wrapped or proxied.
--------------------------------------------------------------------------- */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, unknown>;

const stamp = (rows: Row | Row[]) => {
  const b = writeBook();
  const one = (r: Row) => (r && typeof r === 'object' && !Array.isArray(r) && (r as Row).book === undefined ? { ...r, book: b } : r);
  return Array.isArray(rows) ? rows.map(one) : one(rows);
};

try {
  const client = supabase as any;
  const rawFrom = client.from.bind(client);
  client.from = (table: string) => {
    const qb = rawFrom(table);
    if (!BOOKED_TABLES.has(table)) return qb;
    try {
      const origSelect = qb.select.bind(qb);
      qb.select = (...args: unknown[]) => {
        const q = origSelect(...args);
        return isAllBooks() ? q.in('book', MAIN_BOOKS) : q.eq('book', getBook());
      };
      const origInsert = qb.insert.bind(qb);
      qb.insert = (rows: Row | Row[], ...rest: unknown[]) => origInsert(stamp(rows), ...rest);
      const origUpsert = qb.upsert.bind(qb);
      qb.upsert = (rows: Row | Row[], ...rest: unknown[]) => origUpsert(stamp(rows), ...rest);
    } catch (e) {
      console.error('book filter not applied for', table, e);
    }
    return qb;
  };
} catch (e) {
  console.error('book switch disabled', e);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
