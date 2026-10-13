import { APP_COMPANY } from './supabase';
import { BOOK_BRO, getBook, writeBook } from './book';

// The company that prints on a document: the shop book is BLINE Traders, your books are HDR & CO.
export interface Company { name: string; short: string; address: string; phone: string }

const HDR: Company = { name: APP_COMPANY === 'HDR&CO' ? 'HDR & CO' : APP_COMPANY, short: APP_COMPANY, address: 'NO 149/5 New Chetty Street Col 11', phone: '' };
export const BLINE: Company = { name: 'BLINE Traders (Pvt) Ltd', short: 'BLINE', address: 'No. 73, Quarry Road, Colombo 12', phone: '077 717 7344 / 074 343 4772' };

/** Company for a record's book (or the book you are in). */
export function companyFor(book?: string | null): Company {
  const b = book || (getBook() === BOOK_BRO ? BOOK_BRO : writeBook());
  return b === BOOK_BRO ? BLINE : HDR;
}
