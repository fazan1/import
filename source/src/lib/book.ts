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
  'packing_list_items', // lines carry their book too (sql/packing-lines-book.sql) — LCL 2026 never counts OLD lines
  'recycle_bin',        // deleted records keep their book (sql/books-separate.sql)
  'shipment_item_charges', // shipping charge per packing-list item (sql/item-charges-costing.sql)
  'change_log',         // history of changes, each entry keeps its book (sql/history-and-auto-charges.sql)
]);

const KEY = 'crm-book';
// OLD / LCL 2026 / All books are remembered between visits. The shop book is remembered only
// for this browser tab (sessionStorage): a new visit always starts in your own books, never in
// BLINE SHOP by surprise. (The shop login itself is always put in its book by lockBook().)
let current: string = (() => {
  try {
    if (sessionStorage.getItem(KEY) === BOOK_BRO) return BOOK_BRO;
    const v = localStorage.getItem(KEY); if (v === BOOK_OLD || v === BOOK_NEW || v === BOOK_ALL) return v;
  } catch { /* ignore */ }
  return BOOK_NEW;
})();
function remember(b: string) {
  try {
    if (b === BOOK_BRO) sessionStorage.setItem(KEY, b);
    else { sessionStorage.removeItem(KEY); localStorage.setItem(KEY, b); }
  } catch { /* ignore */ }
}

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
  { current = BOOK_NEW; remember(BOOK_NEW); listeners.forEach((f) => f(BOOK_NEW)); }
}
export function setBook(b: string) {
  if (locked || b === current) return;
  current = b;
  remember(b);
  listeners.forEach((f) => f(b));
}
export function onBookChange(f: Listener) { listeners.add(f); return () => { listeners.delete(f); }; }

/** Opening balances are money carried over from before the system — they belong to the OLD books only. */
export function openingBal(v: number | null | undefined): number {
  return current === BOOK_OLD || current === BOOK_ALL ? (Number(v) || 0) : 0;
}

// Book modes (table book_settings, sql/old-collection-only.sql):
//   open       = normal
//   collection = only receipts / payments / corrections; no NEW documents (OLD while old money is collected)
//   closed     = reference only, nothing can be saved
export type BookMode = 'open' | 'collection' | 'closed';
let modes: Record<string, BookMode> = {};
export function setBookModes(m: Record<string, BookMode>) { modes = m; listeners.forEach((f) => f(current)); }
export function bookMode(b: string = current): BookMode { return modes[b] ?? 'open'; }
/** Tables that hold documents (new ones are refused in a collection-only book). */
export const DOCUMENT_TABLES = new Set([
  'purchase_orders', 'purchase_bills', 'shipments', 'costing_duty_sheet', 'packing_lists', 'pl_input',
  'busy_sales_orders', 'busy_sales_invoices',
]);
