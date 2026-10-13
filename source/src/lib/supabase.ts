import { createClient } from '@supabase/supabase-js';
import { BOOKED_TABLES, DOCUMENT_TABLES, MAIN_BOOKS, bookMode, getBook, isAllBooks, writeBook } from './book';

// Runtime config (set in index.html) wins over build-time env, so one build can serve several sites.
declare global { interface Window { APP_CONFIG?: { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; MODE?: 'full' | 'shop'; COMPANY?: string; TITLE?: string } } }
const cfg = (typeof window !== 'undefined' && window.APP_CONFIG) || {};
export const supabaseUrl = cfg.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
export const supabaseAnonKey = cfg.SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
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

// "All books" is a reading view. Saving a NEW record there would silently file it under LCL 2026,
// even when it belongs to an OLD bill or invoice, so new records must be added inside one book.
export const ALL_BOOKS_SAVE_MSG = 'You are viewing "All books" (read-only). Switch to one book (LCL 2026 or OLD) to add records.';
const refused = (message: string = ALL_BOOKS_SAVE_MSG): any => {
  const result = { data: null, error: { message, details: '', hint: '', code: 'BOOK_MODE' }, count: null, status: 400, statusText: 'Book' };
  // behaves like a query: .select() / .single() / ... can be chained, awaiting it gives the error
  const p: any = new Proxy(function () { /* chainable */ }, {
    get(_t, prop) {
      if (prop === 'then') return (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad);
      return () => p;
    },
    apply() { return p; },
  });
  alert(message);
  return p;
};

// Why a save into the current book is not allowed (null = allowed). The database checks the same rules.
function writeRefusal(table: string, op: 'insert' | 'upsert'): string | null {
  if (isAllBooks()) return ALL_BOOKS_SAVE_MSG;
  const b = writeBook();
  const m = bookMode(b);
  if (m === 'closed') return `The ${b} book is closed (reference only). Nothing can be added there.`;
  if (m === 'collection' && op === 'insert' && DOCUMENT_TABLES.has(table)) {
    return `The ${b} book is collection-only: record receipts and payments there, but make new POs, bills, shipments, orders and invoices in LCL 2026.`;
  }
  return null;
}

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
      qb.insert = (rows: Row | Row[], ...rest: unknown[]) => {
        const why = writeRefusal(table, 'insert');
        return why ? refused(why) : origInsert(stamp(rows), ...rest);
      };
      const origUpsert = qb.upsert.bind(qb);
      qb.upsert = (rows: Row | Row[], ...rest: unknown[]) => {
        const why = writeRefusal(table, 'upsert');
        return why ? refused(why) : origUpsert(stamp(rows), ...rest);
      };
    } catch (e) {
      console.error('book filter not applied for', table, e);
    }
    return qb;
  };
} catch (e) {
  console.error('book switch disabled', e);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
