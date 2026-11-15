import { useEffect, useState } from 'react';

/* NG pages: English / Igbo toggle. t(english) returns the Igbo text when Igbo is on, else the English.
   Unknown strings fall back to English, so nothing breaks. Choice kept per phone in localStorage 'ng-lang'. */

const KEY = 'ng-lang';

/* ONLINE translation (owner: 'make it as online translate'): the Google Translate web element translates the whole page.
   We set its cookie (googtrans=/en/ig), load its script once and hide its own bar. Back to English clears the cookie. */
declare global { interface Window { google?: { translate?: { TranslateElement: new (o: Record<string, unknown>, id: string) => unknown } }; googleTranslateElementInit?: () => void } }
export function onlineTranslateTo(lang: NgLang) {
  const host = location.hostname; const exp = lang === 'ig' ? 'Fri, 31 Dec 2099 23:59:59 GMT' : 'Thu, 01 Jan 1970 00:00:00 GMT';
  ['', '; domain=' + host, '; domain=.' + host].forEach((d) => { document.cookie = `googtrans=/en/${lang === 'ig' ? 'ig' : 'en'}; expires=${exp}; path=/${d}`; });
  try { localStorage.setItem(KEY, lang); } catch { /* ignore */ }
  if (lang === 'ig') loadGoogleTranslate(); else location.reload();
}
export function loadGoogleTranslate() {
  if (document.getElementById('google_translate_element')) { if (window.google?.translate) return; }
  else { const d = document.createElement('div'); d.id = 'google_translate_element'; d.style.display = 'none'; document.body.appendChild(d); }
  if (!document.getElementById('ng-gt-css')) { const st = document.createElement('style'); st.id = 'ng-gt-css'; st.textContent = '.goog-te-banner-frame, .skiptranslate iframe, #goog-gt-tt, .goog-te-balloon-frame { display: none !important; } body { top: 0 !important; } .goog-text-highlight { background: none !important; box-shadow: none !important; }'; document.head.appendChild(st); }
  window.googleTranslateElementInit = () => { if (window.google?.translate) new window.google.translate.TranslateElement({ pageLanguage: 'en', includedLanguages: 'ig,en', autoDisplay: false }, 'google_translate_element'); };
  if (!document.getElementById('ng-gt-script')) { const sc = document.createElement('script'); sc.id = 'ng-gt-script'; sc.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit'; sc.async = true; sc.onerror = () => alert('Online translation could not load. Check the internet connection and try again.'); document.head.appendChild(sc); }
  else { location.reload(); }
}
/** true when the Igbo cookie is set (page is being translated online) */
export function onlineLangIsIgbo() { return /googtrans=\/en\/ig/.test(document.cookie); }
export type NgLang = 'en' | 'ig';
let current: NgLang = (() => { try { return localStorage.getItem(KEY) === 'ig' ? 'ig' : 'en'; } catch { return 'en'; } })();
const listeners = new Set<(l: NgLang) => void>();
export function getNgLang() { return current; }
export function setNgLang(l: NgLang) { current = l; try { localStorage.setItem(KEY, l); } catch { /* ignore */ } listeners.forEach((f) => f(l)); }
export function useNgLang() {
  const [lang, setLang] = useState<NgLang>(current);
  useEffect(() => { listeners.add(setLang); return () => { listeners.delete(setLang); }; }, []);
  // Google translates the page text itself, so t() keeps the English source text (the IG list is kept as a reference only)
  return { lang, t: (s: string) => (IG[s] ? s : s), toggle: () => onlineTranslateTo(lang === 'ig' ? 'en' : 'ig') };
}

const IG: Record<string, string> = {
  // common
  'Refresh': 'Megharịa', 'Print / PDF': 'Bipụta / PDF', 'Copy summary': 'Depụta nchịkọta', 'Save': 'Chekwaa', 'Cancel': 'Kagbuo', 'Edit': 'Dezie', 'Delete': 'Hichapụ',
  'Date': 'Ụbọchị', 'Item': 'Ngwaahịa', 'Items': 'Ngwaahịa', 'Quantity': 'Ọnụọgụgụ', 'Qty': 'Ọnụọgụgụ', 'Note': 'Ndetu', 'Reference': 'Ntụaka', 'Total': 'Ngụkọta', 'Customer': 'Onye ahịa', 'Supplier': 'Onye na-ere', 'Month': 'Ọnwa', 'All time': 'Oge niile', 'Status': 'Ọnọdụ',
  'Product': 'Ngwaahịa', 'Specification': 'Nkọwa', 'Finish': 'Ngwụcha', 'Unit': 'Nkeji', 'Stock': 'Ngwaahịa dị', 'Cost': 'Ọnụ ahịa', 'Profit': 'Uru', 'Sold': 'Erere', 'Paid': 'Akwụọla', 'Loading…': 'Na-ebu…',
  // NG book
  'NG — Nigeria': 'NG — Naịjirịa', 'Nigeria — Items NG': 'Naịjirịa — Ngwaahịa NG', 'Nigeria — Stock NG': 'Naịjirịa — Ngwaahịa dị NG', 'Nigeria — Sales NG': 'Naịjirịa — Ahịa NG', 'Nigeria — Expenses & duty NG': 'Naịjirịa — Mmefu na ụtụ NG', 'Nigeria — Purchases NG': 'Naịjirịa — Ịzụ ahịa NG', 'Nigeria — Overview NG': 'Naịjirịa — Nlele NG', 'Nigeria — Profit NG': 'Naịjirịa — Uru NG',
  'Overview NG': 'Nlele NG', 'Items NG': 'Ngwaahịa NG', 'Purchases NG': 'Ịzụ ahịa NG', 'Stock NG': 'Ngwaahịa dị NG', 'Sales NG': 'Ahịa NG', 'Expenses NG': 'Mmefu NG', 'Profit NG': 'Uru NG',
  // items
  'New item': 'Ngwaahịa ọhụrụ', 'New item NG': 'Ngwaahịa ọhụrụ NG', 'Edit item': 'Dezie ngwaahịa', 'Save item': 'Chekwaa ngwaahịa', 'Show hidden': 'Gosi nke zoro ezo', 'Search name, specification, finish': 'Chọọ aha, nkọwa, ngwụcha',
  'Pcs / ton': 'Pcs / tọn', 'China cost (RMB)': 'Ọnụ ahịa China (RMB)', 'Landed / unit (RMB)': 'Ọnụ ahịa ndabata / nkeji (RMB)', 'Landed ₦': 'Ndabata ₦', 'Selling price (₦)': 'Ọnụ ahịa ire (₦)', 'Margin': 'Uru %',
  'Unit (counted in)': 'Nkeji (a na-agụ na)', 'Pieces per ton': 'Pcs n\'otu tọn', 'Price per ton (RMB) — from the proforma': 'Ọnụ ahịa n\'otu tọn (RMB) — site na proforma',
  // purchases
  'New supplier': 'Onye na-ere ọhụrụ', 'New order / PI': 'Iwu ọhụrụ / PI', 'Orders': 'Iwu', 'Suppliers NG': 'Ndị na-ere NG', 'Payments': 'Ụgwọ akwụrụ', 'Pay': 'Kwụọ ụgwọ', 'Print': 'Bipụta', 'Receive into stock': 'Nabata n\'ime ngwaahịa', 'Received': 'Anabatara', 'Record a payment': 'Dekọọ ụgwọ', 'Ordered (RMB)': 'Iwu (RMB)', 'Paid to suppliers': 'Akwụọla ndị na-ere', 'Outstanding': 'Ụgwọ fọdụrụ', 'still to pay China': 'ka ga-akwụ China',
  'Put into stock': 'Tinye n\'ime ngwaahịa', 'Ordered': 'Iwu', 'Received before': 'Anabatara na mbụ', 'Receiving now': 'Na-anabata ugbu a', 'Still to come': 'Ka ga-abịa', 'Arrival date in Nigeria': 'Ụbọchị ọbịbịa na Naịjirịa', 'Save order': 'Chekwaa iwu', 'Save payment': 'Chekwaa ụgwọ', 'Payment to supplier': 'Ụgwọ nye onye na-ere', 'Amount paid (RMB)': 'Ego akwụrụ (RMB)', 'Paid with': 'Kwụrụ site na', 'Against order': 'Maka iwu',
  // stock
  'Stock in': 'Ngwaahịa batara', 'Adjust': 'Gbanwee', 'Adjust stock': 'Gbanwee ngwaahịa dị', 'Load a proforma': 'Bubata proforma', 'Stock on hand': 'Ngwaahịa dị n\'aka', 'Movements': 'Mmegharị', 'On hand': 'Dị n\'aka', 'In': 'Batara', 'Out': 'Pụrụ', 'Cost (RMB)': 'Ọnụ ahịa (RMB)',
  'Stock at China cost': 'Ngwaahịa n\'ọnụ ahịa China', 'Stock at landed cost': 'Ngwaahịa n\'ọnụ ahịa ndabata', 'Stock at selling price': 'Ngwaahịa n\'ọnụ ahịa ire', 'Profit in the stock': 'Uru dị na ngwaahịa', 'if all sold at the selling price': 'ma ọ bụrụ na e rere ha niile', 'Landed ₦ / unit': 'Ndabata ₦ / nkeji', 'Value at cost ₦': 'Uru n\'ọnụ ahịa ₦', 'Sell ₦ / unit': 'Ire ₦ / nkeji', 'Value at selling ₦': 'Uru n\'ọnụ ahịa ire ₦', 'Tons': 'Tọn', 'Total cost (RMB)': 'Ngụkọta ọnụ ahịa (RMB)',
  // sales
  'New sale': 'Ahịa ọhụrụ', 'Save sale': 'Chekwaa ahịa', 'Money from partner': 'Ego site n\'aka onye mmekọ', 'Sales': 'Ahịa', 'Sold all time': 'Erere oge niile', 'Received from partner': 'Enwetara site n\'aka onye mmekọ', 'Partner still holds': 'Onye mmekọ ka ji', 'sales money not sent yet': 'ego ahịa a na-ezipụbeghị', 'Sent to us': 'Ezigara anyị', 'paid': 'akwụọla', 'not yet': 'ka ọ bụ',
  'Sold ₦': 'Erere ₦', 'Cost ₦': 'Ọnụ ahịa ₦', 'Profit ₦': 'Uru ₦', '₦ / pc': '₦ / otu', 'Selling price (₦ per pcs)': 'Ọnụ ahịa ire (₦ n\'otu)', 'Total sold (₦)': 'Ngụkọta erere (₦)', 'Rate — Naira for 1 RMB': 'Ọnụ mgbanwe — Naira maka 1 RMB', 'Customer (optional)': 'Onye ahịa (nhọrọ)', 'Cost of goods (landed)': 'Ọnụ ahịa ngwaahịa (ndabata)', 'Profit all time': 'Uru oge niile',
  'Money received from the partner': 'Ego enwetara site n\'aka onye mmekọ', 'Date received': 'Ụbọchị enwetara', 'Amount (₦ of sales money)': 'Ego (₦ nke ego ahịa)', 'How it came': 'Otú o si bịa', 'For which sale (optional — otherwise the oldest unpaid sales first)': 'Maka ahịa ole (nhọrọ — ma ọ bụghị, ahịa ochie akwụghị ụgwọ buru ụzọ)', 'Oldest unpaid sales first': 'Ahịa ochie akwụghị ụgwọ buru ụzọ', 'Amount ₦': 'Ego ₦', 'How': 'Otú', 'We got': 'Anyị nwetara', 'For sale': 'Maka ahịa', 'Total received': 'Ngụkọta enwetara',
  // expenses
  'New expense': 'Mmefu ọhụrụ', 'Edit expense': 'Dezie mmefu', 'Entries': 'Ndenye', 'Landed cost by shipment': 'Ọnụ ahịa ndabata site na mbupu', 'Default rate — Naira for 1 RMB': 'Ọnụ mgbanwe — Naira maka 1 RMB', 'Save rate': 'Chekwaa ọnụ mgbanwe', 'Type': 'Ụdị', 'Description': 'Nkọwa', 'Amount': 'Ego', 'Currency': 'Ego mba', 'For which bill / shipment': 'Maka akwụkwọ ụgwọ / mbupu ole', 'General (not for one shipment)': 'Izugbe (ọ bụghị maka otu mbupu)', 'Shipment': 'Mbupu', 'Pieces in': 'Pcs batara', 'Weight': 'Ịdị arọ', 'Duty per kg': 'Ụtụ n\'otu kg', 'Duty & expenses (₦)': 'Ụtụ na mmefu (₦)', 'Goods (RMB)': 'Ngwaahịa (RMB)', 'Landed (RMB)': 'Ndabata (RMB)',
  'Customs duty': 'Ụtụ kọstọm', 'Shipping / freight': 'Mbupu / ụgbọ', 'Clearing agent': 'Onye nkwụcha', 'Port / terminal': 'Ọdụ ụgbọ mmiri', 'Transport': 'Njem', 'Rent': 'Ụgwọ ụlọ', 'Salary': 'Ụgwọ ọnwa', 'Bank charges': 'Ụgwọ ụlọ akụ', 'Partner payout': 'Ụgwọ onye mmekọ', 'Owner withdrawal': 'Ego onye nwe wepụrụ', 'Other': 'Ndị ọzọ',
  // overview / profit
  'Ordered from China': 'Iwu site na China', 'Duty & clearing': 'Ụtụ na nkwụcha', 'Stock in Nigeria (landed)': 'Ngwaahịa na Naịjirịa (ndabata)', 'Sold (all time)': 'Erere (oge niile)', 'Cost of goods sold': 'Ọnụ ahịa ngwaahịa erere', 'Gross profit': 'Uru mbụ', 'General expenses': 'Mmefu izugbe', 'Net': 'Uru ikpeazụ', 'Profit by shipment': 'Uru site na mbupu', 'Stock left': 'Ngwaahịa fọdụrụ', 'Profit so far ₦': 'Uru ruo ugbu a ₦', 'Left in stock RMB': 'Fọdụrụ na ngwaahịa RMB',
  'Total profit': 'Ngụkọta uru', 'Each sale': 'Ahịa ọ bụla', 'By item — all time': 'Site na ngwaahịa — oge niile', 'Pull out — what each partner can take': 'Wepụ — ihe onye mmekọ ọ bụla nwere ike iwere', 'Partner': 'Onye mmekọ', 'Owner': 'Onye nwe', 'Share': 'Òkè', 'Pulled out': 'Ewepụla', 'Can pull out now': 'Nwere ike iwepụ ugbu a', 'Save share': 'Chekwaa òkè', 'Pcs sold': 'Pcs erere',
  'English': 'Bekee', 'Igbo': 'Igbo',
};
