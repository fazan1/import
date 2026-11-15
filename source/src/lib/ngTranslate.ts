/* NG pages: online Igbo / English switch (Google Translate web element translates the whole page).
   Igbo = cookie googtrans=/en/ig + load the element script once (its bar is hidden); English = clear the cookie + reload. */
const KEY = 'ng-lang';
declare global { interface Window { google?: { translate?: { TranslateElement: new (o: Record<string, unknown>, id: string) => unknown } }; googleTranslateElementInit?: () => void } }
export function translateIsIgbo() { return /googtrans=\/en\/ig/.test(document.cookie); }
/** the partner's choice for NG, kept even while another book is open */
export function wantsIgbo() { try { return localStorage.getItem(KEY) === 'ig'; } catch { return false; } }
/** leaving the NG book: switch the translation off for the other books (choice kept) */
export function leaveTranslator() {
  if (!translateIsIgbo() && !document.getElementById('ng-gt-script')) return;
  const host = location.hostname;
  ['', '; domain=' + host, '; domain=.' + host].forEach((d) => { document.cookie = `googtrans=/en/en; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d}`; document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d}`; });
  location.reload();
}
export function translateTo(lang: 'en' | 'ig') {
  const host = location.hostname; const exp = lang === 'ig' ? 'Fri, 31 Dec 2099 23:59:59 GMT' : 'Thu, 01 Jan 1970 00:00:00 GMT';
  ['', '; domain=' + host, '; domain=.' + host].forEach((d) => { document.cookie = `googtrans=/en/${lang}; expires=${exp}; path=/${d}`; });
  try { localStorage.setItem(KEY, lang); } catch { /* ignore */ }
  if (lang === 'ig') loadTranslator(); else location.reload();
}
export function loadTranslator() {
  if (!document.getElementById('google_translate_element')) { const d = document.createElement('div'); d.id = 'google_translate_element'; d.style.display = 'none'; document.body.appendChild(d); }
  if (!document.getElementById('ng-gt-css')) { const st = document.createElement('style'); st.id = 'ng-gt-css'; st.textContent = '.goog-te-banner-frame, .skiptranslate iframe, #goog-gt-tt, .goog-te-balloon-frame { display: none !important; } body { top: 0 !important; } .goog-text-highlight { background: none !important; box-shadow: none !important; }'; document.head.appendChild(st); }
  window.googleTranslateElementInit = () => { if (window.google?.translate) new window.google.translate.TranslateElement({ pageLanguage: 'en', includedLanguages: 'ig,en', autoDisplay: false }, 'google_translate_element'); };
  if (!document.getElementById('ng-gt-script')) { const sc = document.createElement('script'); sc.id = 'ng-gt-script'; sc.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit'; sc.async = true; sc.onerror = () => alert('Online translation could not load. Check the internet connection and try again.'); document.head.appendChild(sc); }
  else location.reload();
}
