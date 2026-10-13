// Book (company period) switch. OLD = everything up to the changeover, LCL 2026 = the fresh start.
// A book-aware wrapper sits on top of supabase.from(), so every screen filters and stamps automatically.

export const BOOK_OLD = 'OLD';
export const BOOK_NEW = 'LCL 2026';
export const BOOK_ALL = '__all__';
export const BOOK_BRO = 'BLINE SHOP';
export const BOOKS = [BOOK_NEW, BOOK_OLD, BOOK_BRO] as const;
/** Books that share the original investor (OLD + LCL 2026). Any other book has its own investor. */
export const MAIN_BOOKS = [BOOK_OLD, BOOK_NEW];

// Transaction tables that belong to a book. Masters (customers, items, suppliers),
// the warehouse, expenses, growth and factory are shared by both books.
export const BOOKED_TABLES = new Set([
  'purchase_orders',
  'purchase_bills',
  'purchase_payments',
  'shipments',
  'costing_duty_sheet',
  'packing_lists',
  'pl_input',
  'busy_sales_orders',
  'busy_sales_invoices',
  'busy_sales_payments',
  'customer_payments',
  'investor_ledger',
  'shipment_charges',
  'agent_ledger',
]);

const KEY = 'crm-book';
let current: string = (() => {
  try { const v = localStorage.getItem(KEY); if (v === BOOK_OLD || v === BOOK_NEW || (v === BOOK_BRO) || v === BOOK_ALL) return v; } catch { /* ignore */ }
  return BOOK_NEW;
})();

type Listener = (b: string) => void;
const listeners = new Set<Listener>();

export function getBook() { return current; }
export function isAllBooks() { return current === BOOK_ALL; }
/** The book a new record is stamped with (never "all"). */
export function writeBook() { return current === BOOK_ALL ? BOOK_NEW : current; }
let locked = false;
/** A login tied to one book: the switch is disabled for the whole session. */
export function lockBook(b: string) {
  locked = true;
  if (b !== current) { current = b; listeners.forEach((f) => f(b)); }
}
export function isBookLocked() { return locked; }
/** Normal login: free the switch again and leave any locked-only book. */
export function unlockBook() {
  if (!locked) return;
  locked = false;
  { current = BOOK_NEW; try { localStorage.setItem(KEY, BOOK_NEW); } catch { /* ignore */ } listeners.forEach((f) => f(BOOK_NEW)); }
}
export function setBook(b: string) {
  if (locked || b === current) return;
  current = b;
  try { localStorage.setItem(KEY, b); } catch { /* ignore */ }
  listeners.forEach((f) => f(b));
}
export function onBookChange(f: Listener) { listeners.add(f); return () => { listeners.delete(f); }; }

/** Opening balances are money carried over from before the system — they belong to the OLD books only. */
export function openingBal(v: number | null | undefined): number {
  return current === BOOK_OLD || current === BOOK_ALL ? (Number(v) || 0) : 0;
}
