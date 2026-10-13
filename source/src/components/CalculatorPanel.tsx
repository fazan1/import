import { useEffect, useMemo, useState } from 'react';
import { X, Delete, Plus, Trash2, Copy, Save, History } from 'lucide-react';

type Tab = 'calc' | 'pricing';
interface PriceRow { id: string; name: string; qty: string; cost: string; markup: string; profit: string; price: string; }
interface Sheet { id: string; name: string; date: string; rows: PriceRow[]; }
const HIST = 'crm-pricing-history';
const STORE = 'crm-pricing-rows';
const fmt = (v: number, d = 2) => (isFinite(v) ? v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const num = (s: string) => { const v = parseFloat(String(s).replace(/,/g, '')); return isFinite(v) ? v : 0; };
const newRow = (): PriceRow => ({ id: Math.random().toString(36).slice(2), name: '', qty: '', cost: '', markup: '', profit: '', price: '' });

export default function CalculatorPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('calc');

  // ---------------- basic calculator ----------------
  const [display, setDisplay] = useState('0');
  const [acc, setAcc] = useState<number | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [fresh, setFresh] = useState(true);
  const [tape, setTape] = useState<string[]>([]);

  const apply = (a: number, b: number, o: string) => (o === '+' ? a + b : o === '−' ? a - b : o === '×' ? a * b : o === '÷' ? (b === 0 ? NaN : a / b) : b);
  const show = (v: number) => (isFinite(v) ? String(+v.toFixed(10)) : 'Error');

  function digit(d: string) {
    if (fresh) { setDisplay(d === '.' ? '0.' : d); setFresh(false); return; }
    if (d === '.' && display.includes('.')) return;
    setDisplay(display === '0' && d !== '.' ? d : display + d);
  }
  function operate(o: string) {
    const cur = parseFloat(display);
    if (acc !== null && op && !fresh) { const r = apply(acc, cur, op); setTape((t) => [`${show(acc)} ${op} ${show(cur)} = ${show(r)}`, ...t].slice(0, 8)); setAcc(r); setDisplay(show(r)); }
    else setAcc(cur);
    setOp(o); setFresh(true);
  }
  function equals() {
    if (acc === null || !op) return;
    const cur = parseFloat(display);
    const r = apply(acc, cur, op);
    setTape((t) => [`${show(acc)} ${op} ${show(cur)} = ${show(r)}`, ...t].slice(0, 8));
    setDisplay(show(r)); setAcc(null); setOp(null); setFresh(true);
  }
  function percent() { const cur = parseFloat(display); setDisplay(show(acc !== null && op && (op === '+' || op === '−') ? acc * cur / 100 : cur / 100)); setFresh(true); }
  function clear() { setDisplay('0'); setAcc(null); setOp(null); setFresh(true); }
  function back() { if (fresh) return; setDisplay(display.length > 1 ? display.slice(0, -1) : '0'); }

  useEffect(() => {
    if (tab !== 'calc') return;
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (/^[0-9.]$/.test(e.key)) digit(e.key);
      else if (e.key === '+') operate('+'); else if (e.key === '-') operate('−'); else if (e.key === '*') operate('×'); else if (e.key === '/') { e.preventDefault(); operate('÷'); }
      else if (e.key === 'Enter' || e.key === '=') equals(); else if (e.key === 'Backspace') back(); else if (e.key === 'Escape') clear(); else if (e.key === '%') percent();
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });

  // ---------------- pricing (manual) ----------------
  const [rows, setRows] = useState<PriceRow[]>(() => { try { const s = localStorage.getItem(STORE); const r = s ? JSON.parse(s) : null; return Array.isArray(r) && r.length ? r : [newRow(), newRow(), newRow()]; } catch { return [newRow(), newRow(), newRow()]; } });
  const [defaultMarkup, setDefaultMarkup] = useState('');
  const [roundTo, setRoundTo] = useState<0 | 1 | 5 | 10 | 50 | 100>(0);
  const [sheets, setSheets] = useState<Sheet[]>(() => { try { const s = localStorage.getItem(HIST); return s ? JSON.parse(s) : []; } catch { return []; } });
  const [showHist, setShowHist] = useState(false);
  const [sheetName, setSheetName] = useState('');
  const saveSheet = () => {
    const live = rows.filter((r) => r.name || num(r.cost) > 0);
    if (!live.length) return;
    const name = sheetName.trim() || `Pricing ${new Date().toLocaleDateString('en-GB')}`;
    const next = [{ id: Math.random().toString(36).slice(2), name, date: new Date().toISOString(), rows: live }, ...sheets].slice(0, 100);
    setSheets(next); try { localStorage.setItem(HIST, JSON.stringify(next)); } catch { /* ignore */ }
    setSheetName('');
  };
  const loadSheet = (sh: Sheet) => { setRows(sh.rows.map((r) => ({ ...r, id: Math.random().toString(36).slice(2) }))); setSheetName(sh.name); setShowHist(false); };
  const deleteSheet = (id: string) => { const next = sheets.filter((x) => x.id !== id); setSheets(next); try { localStorage.setItem(HIST, JSON.stringify(next)); } catch { /* ignore */ } };
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(rows)); } catch { /* ignore */ } }, [rows]);

  const roundPrice = (p: number) => (roundTo ? Math.ceil(p / roundTo) * roundTo : p);
  const set = (id: string, patch: Partial<PriceRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // Type in any one of markup / profit / price and the other two follow
  function edit(r: PriceRow, field: 'cost' | 'markup' | 'profit' | 'price', value: string) {
    const cost = field === 'cost' ? num(value) : num(r.cost);
    const patch: Partial<PriceRow> = { [field]: value };
    if (field === 'cost' || field === 'markup') {
      const mk = field === 'markup' ? num(value) : num(r.markup);
      if (cost > 0 && (field === 'markup' ? value !== '' : r.markup !== '')) { const price = roundPrice(cost * (1 + mk / 100)); patch.price = String(+price.toFixed(2)); patch.profit = String(+(price - cost).toFixed(2)); }
      else if (field === 'cost' && r.price !== '') { const price = num(r.price); patch.profit = String(+(price - cost).toFixed(2)); patch.markup = cost > 0 ? String(+(((price - cost) / cost) * 100).toFixed(2)) : ''; }
    } else if (field === 'profit') {
      const pr = num(value); const price = cost + pr;
      patch.price = value === '' ? '' : String(+price.toFixed(2)); patch.markup = cost > 0 && value !== '' ? String(+((pr / cost) * 100).toFixed(2)) : '';
    } else if (field === 'price') {
      const price = num(value); const pr = price - cost;
      patch.profit = value === '' ? '' : String(+pr.toFixed(2)); patch.markup = cost > 0 && value !== '' ? String(+((pr / cost) * 100).toFixed(2)) : '';
    }
    set(r.id, patch);
  }
  function applyDefault() {
    const mk = num(defaultMarkup); if (!defaultMarkup) return;
    setRows((rs) => rs.map((r) => { const cost = num(r.cost); if (cost <= 0) return r; const price = roundPrice(cost * (1 + mk / 100)); return { ...r, markup: String(mk), price: String(+price.toFixed(2)), profit: String(+(price - cost).toFixed(2)) }; }));
  }
  const qtyOf = (r: PriceRow) => (r.qty === '' ? 1 : num(r.qty));
  const totals = useMemo(() => rows.reduce((t, r) => { const c = num(r.cost), p = num(r.price), q = qtyOf(r); if (c > 0 && p > 0) { t.cost += c * q; t.price += p * q; t.qty += q; t.n += 1; } return t; }, { cost: 0, price: 0, qty: 0, n: 0 }), [rows]);
  const margin = (r: PriceRow) => { const p = num(r.price), pr = num(r.profit); return p > 0 ? (pr / p) * 100 : NaN; };
  const copyTable = () => {
    const lines = ['Item\tQty\tLanded cost\tMarkup %\tProfit/unit\tSelling price\tTotal profit\tMargin %', ...rows.filter((r) => num(r.cost) > 0).map((r) => `${r.name}\t${qtyOf(r)}\t${r.cost}\t${r.markup}\t${r.profit}\t${r.price}\t${+(num(r.profit) * qtyOf(r)).toFixed(2)}\t${fmt(margin(r), 1)}`)];
    navigator.clipboard?.writeText(lines.join('\n'));
  };

  const key = 'h-11 rounded-lg text-base font-medium active:scale-95 transition';
  const cell = 'w-full px-2 py-1.5 text-sm border border-gray-300 rounded text-right focus:ring-2 focus:ring-teal-500 focus:border-teal-500';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-start sm:justify-end bg-black/30 sm:bg-transparent" onClick={onClose}>
      <div className={`bg-white shadow-2xl border border-gray-200 sm:rounded-xl sm:mt-16 sm:mr-4 w-full flex flex-col max-h-[92dvh] ${tab === 'calc' ? 'sm:w-80' : 'sm:w-[52rem]'}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
          <div className="flex gap-1">
            {(['calc', 'pricing'] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`px-3 py-1 text-sm rounded-md ${tab === t ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{t === 'calc' ? 'Calculator' : 'Pricing'}</button>
            ))}
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {tab === 'calc' && (
          <div className="p-3">
            <div className="bg-gray-900 text-white rounded-lg px-3 py-2 mb-2">
              <div className="text-xs text-gray-400 h-4 text-right">{acc !== null && op ? `${show(acc)} ${op}` : ''}</div>
              <div className="text-3xl font-mono text-right truncate">{display}</div>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              <button className={`${key} bg-red-100 text-red-700`} onClick={clear}>C</button>
              <button className={`${key} bg-gray-100 text-gray-700 flex items-center justify-center`} onClick={back}><Delete className="w-4 h-4" /></button>
              <button className={`${key} bg-gray-100 text-gray-700`} onClick={percent}>%</button>
              <button className={`${key} bg-teal-100 text-teal-800`} onClick={() => operate('÷')}>÷</button>
              {['7', '8', '9'].map((d) => <button key={d} className={`${key} bg-gray-50 hover:bg-gray-100`} onClick={() => digit(d)}>{d}</button>)}
              <button className={`${key} bg-teal-100 text-teal-800`} onClick={() => operate('×')}>×</button>
              {['4', '5', '6'].map((d) => <button key={d} className={`${key} bg-gray-50 hover:bg-gray-100`} onClick={() => digit(d)}>{d}</button>)}
              <button className={`${key} bg-teal-100 text-teal-800`} onClick={() => operate('−')}>−</button>
              {['1', '2', '3'].map((d) => <button key={d} className={`${key} bg-gray-50 hover:bg-gray-100`} onClick={() => digit(d)}>{d}</button>)}
              <button className={`${key} bg-teal-100 text-teal-800`} onClick={() => operate('+')}>+</button>
              <button className={`${key} bg-gray-50 hover:bg-gray-100 col-span-2`} onClick={() => digit('0')}>0</button>
              <button className={`${key} bg-gray-50 hover:bg-gray-100`} onClick={() => digit('.')}>.</button>
              <button className={`${key} bg-teal-600 text-white`} onClick={equals}>=</button>
            </div>
            {tape.length > 0 && (
              <div className="mt-2 max-h-28 overflow-y-auto text-xs font-mono text-gray-500 border-t border-gray-100 pt-2">
                {tape.map((l, i) => <div key={i} className="flex justify-between"><span>{l}</span><button onClick={() => navigator.clipboard?.writeText(l.split('= ')[1])} title="Copy result"><Copy className="w-3 h-3" /></button></div>)}
              </div>
            )}
            <p className="text-[10px] text-gray-400 mt-2">Keyboard works: digits, + − * /, Enter, Backspace, Esc.</p>
          </div>
        )}

        {tab === 'pricing' && (
          <div className="p-3 flex-1 overflow-y-auto">
            <div className="flex flex-wrap items-end gap-2 mb-3">
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">Markup % for all rows</label>
                <div className="flex gap-1">
                  <input value={defaultMarkup} onChange={(e) => setDefaultMarkup(e.target.value)} placeholder="e.g. 35" className={`${cell} w-24`} inputMode="decimal" />
                  <button onClick={applyDefault} className="px-3 py-1.5 text-sm bg-teal-600 text-white rounded">Apply</button>
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">Round price up to</label>
                <select value={roundTo} onChange={(e) => setRoundTo(Number(e.target.value) as typeof roundTo)} className="px-2 py-1.5 text-sm border border-gray-300 rounded">
                  <option value={0}>No rounding</option><option value={1}>Rs. 1</option><option value={5}>Rs. 5</option><option value={10}>Rs. 10</option><option value={50}>Rs. 50</option><option value={100}>Rs. 100</option>
                </select>
              </div>
              <div className="ml-auto flex gap-1 items-end">
                <input value={sheetName} onChange={(e) => setSheetName(e.target.value)} placeholder="Sheet name (e.g. Keely shoes)" className={`${cell} w-44 text-left`} />
                <button onClick={saveSheet} className="px-2 py-1.5 text-xs bg-emerald-600 text-white rounded flex items-center gap-1" title="Save this sheet on this computer"><Save className="w-3 h-3" />Save</button>
                <button onClick={() => setShowHist((o) => !o)} className={`px-2 py-1.5 text-xs border rounded flex items-center gap-1 ${showHist ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-300 hover:bg-gray-50'}`}><History className="w-3 h-3" />History{sheets.length ? ` (${sheets.length})` : ''}</button>
                <button onClick={copyTable} className="px-2 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1"><Copy className="w-3 h-3" />Copy</button>
                <button onClick={() => setRows([newRow(), newRow(), newRow()])} className="px-2 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50 text-red-600">Clear all</button>
              </div>
            </div>
            {showHist && (
              <div className="mb-3 border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
                {sheets.length === 0 && <div className="p-3 text-xs text-gray-500">No saved sheets yet. Type a name and press Save.</div>}
                {sheets.map((sh) => {
                  const tp = sh.rows.reduce((t, r) => t + num(r.profit) * (r.qty === '' ? 1 : num(r.qty)), 0);
                  return (
                    <div key={sh.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-100 text-sm hover:bg-gray-50">
                      <button onClick={() => loadSheet(sh)} className="flex-1 text-left"><span className="font-medium">{sh.name}</span><span className="text-xs text-gray-500 ml-2">{new Date(sh.date).toLocaleDateString('en-GB')} · {sh.rows.length} items · profit {fmt(tp)}</span></button>
                      <button onClick={() => deleteSheet(sh.id)} className="text-gray-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  );
                })}
                <div className="px-3 py-1.5 text-[10px] text-gray-400">Saved in this browser only (not in the database).</div>
              </div>
            )}
            <p className="text-[11px] text-gray-500 mb-2">Type the landed cost, then any one of markup %, profit or selling price — the other two follow. Margin = profit ÷ selling price.</p>
            <table className="w-full text-sm">
              <thead className="text-[11px] text-gray-500 uppercase">
                <tr><th className="text-left pb-1">Item</th><th className="text-right pb-1 w-16">Qty</th><th className="text-right pb-1 w-24">Landed</th><th className="text-right pb-1 w-20">Markup %</th><th className="text-right pb-1 w-24">Profit/unit</th><th className="text-right pb-1 w-24">Sell price</th><th className="text-right pb-1 w-24">Total profit</th><th className="text-right pb-1 w-16">Margin</th><th className="w-6"></th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-0.5 pr-1"><input value={r.name} onChange={(e) => set(r.id, { name: e.target.value })} placeholder="Item" className={`${cell} text-left`} /></td>
                    <td className="py-0.5 pr-1"><input value={r.qty} onChange={(e) => set(r.id, { qty: e.target.value })} className={cell} inputMode="numeric" placeholder="1" /></td>
                    <td className="py-0.5 pr-1"><input value={r.cost} onChange={(e) => edit(r, 'cost', e.target.value)} className={cell} inputMode="decimal" placeholder="0" /></td>
                    <td className="py-0.5 pr-1"><input value={r.markup} onChange={(e) => edit(r, 'markup', e.target.value)} className={`${cell} bg-amber-50`} inputMode="decimal" /></td>
                    <td className="py-0.5 pr-1"><input value={r.profit} onChange={(e) => edit(r, 'profit', e.target.value)} className={`${cell} bg-emerald-50`} inputMode="decimal" /></td>
                    <td className="py-0.5 pr-1"><input value={r.price} onChange={(e) => edit(r, 'price', e.target.value)} className={`${cell} bg-teal-50 font-semibold`} inputMode="decimal" /></td>
                    <td className="py-0.5 text-right text-sm font-semibold text-emerald-700">{num(r.profit) !== 0 ? fmt(num(r.profit) * qtyOf(r)) : ''}</td>
                    <td className="py-0.5 text-right text-xs text-gray-600">{fmt(margin(r), 1)}%</td>
                    <td className="py-0.5 text-right"><button onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.id !== r.id) : rs))} className="text-gray-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
              {totals.n > 0 && (
                <tfoot className="text-xs font-semibold border-t border-gray-300">
                  <tr><td className="pt-1">{totals.n} item{totals.n > 1 ? 's' : ''} · totals</td><td className="pt-1 text-right">{fmt(totals.qty, 0)}</td><td className="pt-1 text-right">{fmt(totals.cost)}</td><td className="pt-1 text-right">{fmt(((totals.price - totals.cost) / totals.cost) * 100, 1)}%</td><td></td><td className="pt-1 text-right">{fmt(totals.price)}</td><td className="pt-1 text-right text-emerald-700">{fmt(totals.price - totals.cost)}</td><td className="pt-1 text-right">{fmt(((totals.price - totals.cost) / totals.price) * 100, 1)}%</td><td></td></tr>
                </tfoot>
              )}
            </table>
            <button onClick={() => setRows((rs) => [...rs, newRow()])} className="mt-2 flex items-center gap-1 text-sm text-teal-700 hover:underline"><Plus className="w-4 h-4" />Add row</button>
          </div>
        )}
      </div>
    </div>
  );
}
