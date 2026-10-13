import { openingBal } from './book';

// ONE rule for what a customer owes, used by every screen. Everything is per book:
// the invoices and payments passed in are already filtered to the current book, and
// openingBal() gives the opening balance only in the OLD book (0 in LCL 2026 / BLINE SHOP).
//
//   owed = unpaid invoice dues (this book)
//        + opening balance (OLD book only)
//        - money received "on account" in this book (not against an invoice; returned cheques don't count)
// The on-account part may go below 0: money paid ahead is a credit against the invoices.

/** Same customer whatever the spelling of spaces / capitals. */
export const custKey = (name: string | null | undefined) => (name || '').trim().toLowerCase();

type Pay = { customer_name?: string | null; sales_invoice_id?: string | null; amount?: number | string | null; cheque_status?: string | null };

/** Money received on account per customer (key = custKey(name)). */
export function onAccountByCustomer(payments: Pay[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of payments) {
    if (p.sales_invoice_id || p.cheque_status === 'returned') continue;
    const k = custKey(p.customer_name);
    m.set(k, (m.get(k) || 0) + (Number(p.amount) || 0));
  }
  return m;
}

/** Opening balance still owed in the current book (can be negative = credit). */
export function netOpening(customerName: string | null | undefined, openingBalance: number | null | undefined, onAccount: Map<string, number>): number {
  return openingBal(openingBalance) - (onAccount.get(custKey(customerName)) || 0);
}
