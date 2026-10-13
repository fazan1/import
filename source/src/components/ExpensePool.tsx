import { useEffect, useMemo, useState } from 'react';
import { Wallet, Plus, ChevronLeft, ChevronRight, Printer, Download, Pencil, Trash2, X, ArrowLeftRight, Scale, Settings2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { esc } from '../lib/html';

interface Cat { id: string; name: string; budget: number; sort_order: number; is_active: boolean; }
interface Dep { id: string; entry_date: string; amount: number; via: 'Bank' | 'Cash'; note: string | null; }
interface Exp { id: string; entry_date: string; amount: number; category: string; paid_to: string | null; via: 'Bank' | 'Cash'; note: string | null; }
interface Move { id: string; entry_date: string; amount: number; dir: 'to_cash' | 'to_bank'; note: string | null; }
interface Tally { id: string; entry_date: string; bank_counted: number; cash_counted: number; bank_system: number; cash_system: number; note: string | null; }
type Sheet = { kind: 'exp'; row?: Exp } | { kind: 'dep'; row?: Dep } | { kind: 'move' } | { kind: 'tally' } | { kind: 'cats' } | null;

const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm';
const n0 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const today = () => new Date().toISOString().slice(0, 10);
const fmtD = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const monthName = (ym: string) => new Date(ym + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const card = 'bg-white border border-gray-200 rounded-lg';

export default function ExpensePool() {
  const [cats, setCats] = useState<Cat[]>([]);
  const [deps, setDeps] = useState<Dep[]>([]);
  const [exps, setExps] = useState<Exp[]>([]);
  const [moves, setMoves] = useState<Move[]>([]);
  const [tallies, setTallies] = useState<Tally[]>([]);
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [sheet, setSheet] = useState<Sheet>(null);
  const [tab, setTab] = useState<'month' | 'all' | 'tallies'>('month');
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);
  async function load() {
    const [c, d, e, m, t] = await Promise.all([
      supabase.from('ep_categories').select('*').order('sort_order').order('name'),
      supabase.from('ep_deposits').select('*').order('entry_date', { ascending: false }),
      supabase.from('ep_expenses').select('*').order('entry_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('ep_moves').select('*').order('entry_date', { ascending: false }),
      supabase.from('ep_tallies').select('*').order('entry_date', { ascending: false }),
    ]);
    const num = <T extends object>(rows: T[] | null, keys: string[]) => (rows ?? []).map((r) => { const o = { ...(r as Record<string, unknown>) }; keys.forEach((k) => { o[k] = Number(o[k]) || 0; }); return o as T; });
    setCats(num(c.data as Cat[] | null, ['budget', 'sort_order']));
    setDeps(num(d.data as Dep[] | null, ['amount']));
    setExps(num(e.data as Exp[] | null, ['amount']));
    setMoves(num(m.data as Move[] | null, ['amount']));
    setTallies(num(t.data as Tally[] | null, ['bank_counted', 'cash_counted', 'bank_system', 'cash_system']));
    setLoading(false);
  }

  // ---- pool state (all time) ----
  const pool = useMemo(() => {
    let bank = 0, cash = 0;
    deps.forEach((d) => { if (d.via === 'Cash') cash += d.amount; else bank += d.amount; });
    exps.forEach((e) => { if (e.via === 'Cash') cash -= e.amount; else bank -= e.amount; });
    moves.forEach((m) => { if (m.dir === 'to_cash') { bank -= m.amount; cash += m.amount; } else { cash -= m.amount; bank += m.amount; } });
    return { bank, cash, total: bank + cash };
  }, [deps, exps, moves]);

  // ---- this month ----
  const mExps = exps.filter((e) => e.entry_date.startsWith(month));
  const mDeps = deps.filter((d) => d.entry_date.startsWith(month));
  const mMoves = moves.filter((m) => m.entry_date.startsWith(month));
  const mSpent = mExps.reduce((t, e) => t + e.amount, 0);
  const mIn = mDeps.reduce((t, d) => t + d.amount, 0);
  const byCat = cats.filter((c) => c.is_active).map((c) => ({ c, spent: mExps.filter((e) => e.category === c.name).reduce((t, e) => t + e.amount, 0) })).concat(
    Array.from(new Set(mExps.map((e) => e.category))).filter((n) => !cats.some((c) => c.name === n)).map((n) => ({ c: { id: n, name: n, budget: 0, sort_order: 999, is_active: true }, spent: mExps.filter((e) => e.category === n).reduce((t, e) => t + e.amount, 0) })));
  const totalBudget = cats.filter((c) => c.is_active).reduce((t, c) => t + c.budget, 0);
  const months = useMemo(() => Array.from(new Set([...exps, ...deps].map((x) => x.entry_date.slice(0, 7)))).sort().reverse(), [exps, deps]);
  const last6 = useMemo(() => { const out: { key: string; in: number; out: number }[] = []; const d = new Date(month + '-01'); for (let i = 5; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); const k = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; out.push({ key: k, in: deps.filter((p) => p.entry_date.startsWith(k)).reduce((t, p) => t + p.amount, 0), out: exps.filter((e) => e.entry_date.startsWith(k)).reduce((t, e) => t + e.amount, 0) }); } return out; }, [month, deps, exps]);
  const max6 = Math.max(1, ...last6.map((x) => Math.max(x.in, x.out)));
  const shiftMonth = (n: number) => { const d = new Date(month + '-01'); d.setMonth(d.getMonth() + n); setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); };

  async function del(table: string, id: string, label: string) { if (!confirm(`Delete this ${label}?`)) return; const { error } = await supabase.from(table).delete().eq('id', id); if (error) alert(error.message); load(); }

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exps.map((e) => ({ Date: e.entry_date, Category: e.category, 'Paid to': e.paid_to, Amount: e.amount, Via: e.via, Note: e.note }))), 'Expenses');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(deps.map((d) => ({ Date: d.entry_date, Amount: d.amount, Via: d.via, Note: d.note }))), 'Deposits');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(moves.map((m) => ({ Date: m.entry_date, Direction: m.dir === 'to_cash' ? 'Bank → Cash' : 'Cash → Bank', Amount: m.amount, Note: m.note }))), 'Moves');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tallies.map((t) => ({ Date: t.entry_date, 'Bank counted': t.bank_counted, 'Bank system': t.bank_system, 'Cash counted': t.cash_counted, 'Cash system': t.cash_system, Note: t.note }))), 'Tallies');
    XLSX.writeFile(wb, `expense-pool-${today()}.xlsx`);
  }
  function printMonth() {
    const w = window.open('', '_blank'); if (!w) return;
    const row = (c: (string | number)[]) => `<tr>${c.map((x, i) => `<td class="${i >= c.length - 1 || typeof x === 'number' ? 'r' : ''}">${esc(x)}</td>`).join('')}</tr>`;
    w.document.write(`<html><head><title>Expense pool — ${monthName(month)}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px;color:#111}h1{font-size:18px;margin:0}h2{font-size:12px;color:#555;margin:2px 0 12px;font-weight:normal}h3{font-size:13px;margin:14px 0 4px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:5px 6px;text-align:left}th{background:#f3f4f6;font-size:11px}.r{text-align:right}.tot td{font-weight:bold;background:#f9fafb}</style></head><body>
      <h1>Expense pool — ${monthName(month)}</h1><h2>printed ${new Date().toLocaleDateString('en-GB')}</h2>
      <h3>Pool summary</h3><table><tr class="tot"><td>Balance left this month</td><td class="r">${n0(mIn - mSpent)}</td></tr><tr><td>In the bank</td><td class="r">${n0(pool.bank)}</td></tr><tr><td>Cash drawer</td><td class="r">${n0(pool.cash)}</td></tr><tr class="tot"><td>Pool holds</td><td class="r">${n0(pool.total)}</td></tr><tr><td>Deposits this month</td><td class="r">${n0(mIn)}</td></tr><tr><td>Spent this month</td><td class="r">${n0(mSpent)}</td></tr></table>
      <h3>Budget vs actual</h3><table><thead><tr><th>Category</th><th class="r">Budget</th><th class="r">Spent</th><th class="r">Left</th></tr></thead><tbody>${byCat.map((b) => row([b.c.name, n0(b.c.budget), n0(b.spent), n0(b.c.budget - b.spent)])).join('')}<tr class="tot"><td>Total</td><td class="r">${n0(totalBudget)}</td><td class="r">${n0(mSpent)}</td><td class="r">${n0(totalBudget - mSpent)}</td></tr></tbody></table>
      <h3>Payments</h3><table><thead><tr><th>Date</th><th>Category</th><th>Paid to</th><th>Note</th><th>Via</th><th class="r">Amount</th></tr></thead><tbody>${[...mExps].sort((a, b) => a.entry_date.localeCompare(b.entry_date)).map((e) => row([fmtD(e.entry_date), e.category, e.paid_to ?? '', e.note ?? '', e.via, n0(e.amount)])).join('')}</tbody></table>
      ${mDeps.length ? `<h3>Deposits</h3><table><thead><tr><th>Date</th><th>Note</th><th>Via</th><th class="r">Amount</th></tr></thead><tbody>${mDeps.map((d) => row([fmtD(d.entry_date), d.note ?? '', d.via, n0(d.amount)])).join('')}</tbody></table>` : ''}
      ${mMoves.length ? `<h3>Bank ↔ cash</h3><table><thead><tr><th>Date</th><th>Direction</th><th>Note</th><th class="r">Amount</th></tr></thead><tbody>${mMoves.map((m) => row([fmtD(m.entry_date), m.dir === 'to_cash' ? 'Bank → Cash drawer' : 'Cash drawer → Bank', m.note ?? '', n0(m.amount)])).join('')}</tbody></table>` : ''}
      <script>window.print()</script></body></html>`);
    w.document.close();
  }

  if (loading) return <div className="p-6 text-gray-500">Loading…</div>;
  const chip = (a: boolean) => `px-3 py-1.5 rounded-lg text-sm border ${a ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`;

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div><h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Wallet className="w-6 h-6 text-teal-600" />Expenses</h2><p className="text-sm text-gray-500">Personal pool — top up, pay out, tally. Not part of business reports.</p></div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setSheet({ kind: 'exp' })} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-teal-600 text-white hover:bg-teal-700"><Plus className="w-4 h-4" />Pay an expense</button>
          <button onClick={() => setSheet({ kind: 'dep' })} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-300 bg-white hover:bg-gray-50">Put money in</button>
          <button onClick={() => setSheet({ kind: 'move' })} className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50" title="Move bank ↔ cash"><ArrowLeftRight className="w-4 h-4" /></button>
          <button onClick={() => setSheet({ kind: 'tally' })} className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50" title="Do a tally"><Scale className="w-4 h-4" /></button>
          <button onClick={() => setSheet({ kind: 'cats' })} className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50" title="Categories & budgets"><Settings2 className="w-4 h-4" /></button>
          <button onClick={printMonth} className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50" title="Print month report"><Printer className="w-4 h-4" /></button>
          <button onClick={exportExcel} className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50" title="Excel"><Download className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <div className={`${card} p-4 ${mIn - mSpent < 0 ? 'border-red-300' : 'border-teal-300'}`}><p className="text-xs text-gray-500">Balance left this month</p><p className={`text-2xl font-bold ${mIn - mSpent < 0 ? 'text-red-700' : 'text-teal-700'}`}>Rs {n0(mIn - mSpent)}</p><p className="text-[11px] text-gray-500">put in − spent</p></div>
        <div className={`${card} p-4`}><p className="text-xs text-gray-500">Put in · {monthName(month).split(' ')[0]}</p><p className="text-2xl font-bold text-green-700">Rs {n0(mIn)}</p></div>
        <div className={`${card} p-4`}><p className="text-xs text-gray-500">Spent · {monthName(month).split(' ')[0]}</p><p className="text-2xl font-bold text-gray-900">Rs {n0(mSpent)}</p><p className="text-[11px] text-gray-500">of budget {n0(totalBudget)}</p></div>
        <div className={`${card} p-4 ${totalBudget - mSpent < 0 ? 'border-red-300' : ''}`}><p className="text-xs text-gray-500">Budget left</p><p className={`text-2xl font-bold ${totalBudget - mSpent < 0 ? 'text-red-700' : 'text-gray-900'}`}>Rs {n0(totalBudget - mSpent)}</p></div>
        <div className={`${card} p-4 ${pool.total < 0 ? 'border-red-300' : ''}`}><p className="text-xs text-gray-500">All-time balance</p><p className={`text-2xl font-bold ${pool.total < 0 ? 'text-red-700' : 'text-gray-900'}`}>Rs {n0(pool.total)}</p><p className="text-[11px] text-gray-500">bank {n0(pool.bank)} · cash {n0(pool.cash)}</p></div>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button onClick={() => shiftMonth(-1)} className="p-1.5 border border-gray-300 rounded-lg bg-white"><ChevronLeft className="w-4 h-4" /></button>
        <select value={month} onChange={(e) => setMonth(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white">{Array.from(new Set([month, ...months])).sort().reverse().map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select>
        <button onClick={() => shiftMonth(1)} className="p-1.5 border border-gray-300 rounded-lg bg-white"><ChevronRight className="w-4 h-4" /></button>
        <span className="flex-1" />
        <button onClick={() => setTab('month')} className={chip(tab === 'month')}>This month</button>
        <button onClick={() => setTab('all')} className={chip(tab === 'all')}>All transactions</button>
        <button onClick={() => setTab('tallies')} className={chip(tab === 'tallies')}>Tallies ({tallies.length})</button>
      </div>

      {tab === 'month' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <div className={`${card} p-4`}>
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Budget vs actual</h3>
              <div className="space-y-2">
                {byCat.map(({ c, spent }) => { const pct = c.budget > 0 ? Math.min(100, (spent / c.budget) * 100) : spent > 0 ? 100 : 0; const over = c.budget > 0 && spent > c.budget; return (
                  <div key={c.id}>
                    <div className="flex justify-between text-xs"><span className="text-gray-700">{c.name}</span><span className={over ? 'text-red-600 font-medium' : 'text-gray-600'}>{n0(spent)}{c.budget > 0 ? ` / ${n0(c.budget)}` : ''}</span></div>
                    <div className="h-1.5 bg-gray-100 rounded mt-1"><div className={`h-1.5 rounded ${over ? 'bg-red-500' : pct > 85 ? 'bg-amber-500' : 'bg-teal-600'}`} style={{ width: `${pct}%` }} /></div>
                  </div>
                ); })}
              </div>
            </div>
            <div className={`${card} p-4`}>
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Last 6 months — in vs spent</h3>
              <div className="flex items-end gap-2 h-28">{last6.map((x) => <div key={x.key} className="flex-1 flex flex-col items-center justify-end h-full"><div className="w-full flex items-end gap-0.5 h-full"><div className="flex-1 bg-green-500" style={{ height: `${(x.in / max6) * 100}%` }} title={`In ${n0(x.in)}`} /><div className="flex-1 bg-gray-800" style={{ height: `${(x.out / max6) * 100}%` }} title={`Spent ${n0(x.out)}`} /></div><div className="text-[10px] text-gray-500 mt-1">{new Date(x.key + '-01').toLocaleDateString('en-GB', { month: 'short' })}</div></div>)}</div>
              <div className="text-[10px] text-gray-500 mt-1"><span className="inline-block w-2 h-2 bg-green-500 mr-1" />in <span className="inline-block w-2 h-2 bg-gray-800 ml-3 mr-1" />spent</div>
            </div>
          </div>
          <div className="lg:col-span-3 space-y-4">
            <div className={`${card} overflow-x-auto`}>
              <div className="px-4 py-2 border-b border-gray-200 text-sm font-semibold text-gray-800">Payments — {monthName(month)}</div>
              <table className="w-full text-sm"><thead className="bg-gray-50 text-xs text-gray-500 uppercase"><tr><th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Category</th><th className="text-left px-3 py-2">Paid to / note</th><th className="text-right px-3 py-2">Amount</th><th className="w-16"></th></tr></thead>
                <tbody className="divide-y divide-gray-100">{mExps.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">No payments this month.</td></tr>}{mExps.map((e) => <tr key={e.id} className="hover:bg-gray-50"><td className="px-3 py-2 whitespace-nowrap">{fmtD(e.entry_date)}</td><td className="px-3 py-2">{e.category}</td><td className="px-3 py-2 text-gray-600">{[e.paid_to, e.note].filter(Boolean).join(' · ')}<span className="ml-1 text-[10px] text-gray-400">{e.via}</span></td><td className="px-3 py-2 text-right font-medium">{n0(e.amount)}</td><td className="px-2 py-2 text-right whitespace-nowrap"><button onClick={() => setSheet({ kind: 'exp', row: e })} className="p-1 text-gray-400 hover:text-teal-700"><Pencil className="w-3.5 h-3.5" /></button><button onClick={() => del('ep_expenses', e.id, 'payment')} className="p-1 text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button></td></tr>)}</tbody>
                {mExps.length > 0 && <tfoot><tr className="bg-gray-50 font-semibold"><td colSpan={3} className="px-3 py-2">Total</td><td className="px-3 py-2 text-right">{n0(mSpent)}</td><td /></tr></tfoot>}</table>
            </div>
            {(mDeps.length > 0 || mMoves.length > 0) && (
              <div className={`${card} overflow-x-auto`}>
                <div className="px-4 py-2 border-b border-gray-200 text-sm font-semibold text-gray-800">Deposits & movements — {monthName(month)}</div>
                <table className="w-full text-sm"><tbody className="divide-y divide-gray-100">
                  {mDeps.map((d) => <tr key={d.id} className="hover:bg-gray-50"><td className="px-3 py-2 whitespace-nowrap">{fmtD(d.entry_date)}</td><td className="px-3 py-2"><span className="text-green-700 font-medium">Deposit</span> <span className="text-gray-500">{d.note}</span> <span className="text-[10px] text-gray-400">{d.via}</span></td><td className="px-3 py-2 text-right font-medium text-green-700">+{n0(d.amount)}</td><td className="px-2 py-2 text-right whitespace-nowrap"><button onClick={() => setSheet({ kind: 'dep', row: d })} className="p-1 text-gray-400 hover:text-teal-700"><Pencil className="w-3.5 h-3.5" /></button><button onClick={() => del('ep_deposits', d.id, 'deposit')} className="p-1 text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button></td></tr>)}
                  {mMoves.map((m) => <tr key={m.id} className="hover:bg-gray-50"><td className="px-3 py-2 whitespace-nowrap">{fmtD(m.entry_date)}</td><td className="px-3 py-2">{m.dir === 'to_cash' ? 'Bank → Cash drawer' : 'Cash drawer → Bank'} <span className="text-gray-500">{m.note}</span></td><td className="px-3 py-2 text-right">{n0(m.amount)}</td><td className="px-2 py-2 text-right"><button onClick={() => del('ep_moves', m.id, 'movement')} className="p-1 text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button></td></tr>)}
                </tbody></table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'all' && (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm"><thead className="bg-gray-50 text-xs text-gray-500 uppercase"><tr><th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Type</th><th className="text-left px-3 py-2">Detail</th><th className="text-right px-3 py-2">In</th><th className="text-right px-3 py-2">Out</th><th className="text-right px-3 py-2">Balance</th></tr></thead>
            <tbody className="divide-y divide-gray-100">{(() => { const all = [...deps.map((d) => ({ date: d.entry_date, type: 'Deposit', detail: `${d.note ?? ''} (${d.via})`, inn: d.amount, out: 0 })), ...exps.map((e) => ({ date: e.entry_date, type: e.category, detail: [e.paid_to, e.note].filter(Boolean).join(' · ') + ` (${e.via})`, inn: 0, out: e.amount }))].sort((a, b) => a.date.localeCompare(b.date)); let bal = 0; const rows = all.map((r, i) => { bal += r.inn - r.out; return <tr key={i}><td className="px-3 py-1.5 whitespace-nowrap">{fmtD(r.date)} <span className="text-gray-400 text-xs">{r.date.slice(0, 4)}</span></td><td className="px-3 py-1.5">{r.type}</td><td className="px-3 py-1.5 text-gray-600">{r.detail}</td><td className="px-3 py-1.5 text-right text-green-700">{r.inn ? n0(r.inn) : ''}</td><td className="px-3 py-1.5 text-right">{r.out ? n0(r.out) : ''}</td><td className="px-3 py-1.5 text-right font-medium">{n0(bal)}</td></tr>; }); return rows.reverse(); })()}</tbody></table>
        </div>
      )}

      {tab === 'tallies' && (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm"><thead className="bg-gray-50 text-xs text-gray-500 uppercase"><tr><th className="text-left px-3 py-2">Date</th><th className="text-right px-3 py-2">Bank counted</th><th className="text-right px-3 py-2">Bank system</th><th className="text-right px-3 py-2">Cash counted</th><th className="text-right px-3 py-2">Cash system</th><th className="text-right px-3 py-2">Difference</th><th className="text-left px-3 py-2">Note</th><th /></tr></thead>
            <tbody className="divide-y divide-gray-100">{tallies.map((t) => { const diff = (t.bank_counted - t.bank_system) + (t.cash_counted - t.cash_system); return <tr key={t.id}><td className="px-3 py-2 whitespace-nowrap">{fmtD(t.entry_date)} <span className="text-gray-400 text-xs">{t.entry_date.slice(0, 4)}</span></td><td className="px-3 py-2 text-right">{n0(t.bank_counted)}</td><td className="px-3 py-2 text-right text-gray-500">{n0(t.bank_system)}</td><td className="px-3 py-2 text-right">{n0(t.cash_counted)}</td><td className="px-3 py-2 text-right text-gray-500">{n0(t.cash_system)}</td><td className={`px-3 py-2 text-right font-medium ${diff === 0 ? 'text-green-700' : 'text-red-600'}`}>{diff === 0 ? '✓' : n0(diff)}</td><td className="px-3 py-2 text-gray-600">{t.note}</td><td className="px-2 py-2"><button onClick={() => del('ep_tallies', t.id, 'tally')} className="p-1 text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button></td></tr>; })}{tallies.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">No tallies yet.</td></tr>}</tbody></table>
        </div>
      )}

      {sheet?.kind === 'exp' && <ExpForm row={sheet.row} cats={cats} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load(); }} />}
      {sheet?.kind === 'dep' && <DepForm row={sheet.row} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load(); }} />}
      {sheet?.kind === 'move' && <MoveForm onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load(); }} />}
      {sheet?.kind === 'tally' && <TallyForm pool={pool} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load(); }} />}
      {sheet?.kind === 'cats' && <CatsForm cats={cats} onClose={() => setSheet(null)} onChange={load} />}
    </div>
  );
}

function Modal({ title, children, onClose, onSave, saveLabel = 'Save', wide }: { title: string; children: React.ReactNode; onClose: () => void; onSave?: () => void; saveLabel?: string; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={`bg-white w-full ${wide ? 'sm:max-w-lg' : 'sm:max-w-sm'} rounded-t-2xl sm:rounded-lg shadow-xl p-5 max-h-[92vh] overflow-y-auto`}>
        <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">{title}</h3><button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button></div>
        {children}
        {onSave && <div className="flex justify-end gap-2 mt-4"><button onClick={onClose} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">Cancel</button><button onClick={onSave} className="px-4 py-1.5 bg-teal-600 text-white rounded-lg text-sm">{saveLabel}</button></div>}
      </div>
    </div>
  );
}
const Via = ({ value, onChange }: { value: 'Bank' | 'Cash'; onChange: (v: 'Bank' | 'Cash') => void }) => (
  <div className="flex gap-1">{(['Cash', 'Bank'] as const).map((v) => <button key={v} type="button" onClick={() => onChange(v)} className={`px-3 py-1.5 rounded-lg text-sm border ${value === v ? 'bg-teal-600 text-white border-teal-600' : 'bg-white border-gray-300'}`}>{v}</button>)}</div>
);

function ExpForm({ row, cats, onClose, onSaved }: { row?: Exp; cats: Cat[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ entry_date: row?.entry_date ?? today(), amount: row ? String(row.amount) : '', category: row?.category ?? (cats[0]?.name ?? ''), paid_to: row?.paid_to ?? '', via: (row?.via ?? 'Cash') as 'Bank' | 'Cash', note: row?.note ?? '' });
  async function save() {
    if (!(Number(f.amount) > 0)) { alert('Enter the amount'); return; }
    if (!f.category) { alert('Pick a category'); return; }
    const payload = { entry_date: f.entry_date, amount: Number(f.amount), category: f.category, paid_to: f.paid_to.trim() || null, via: f.via, note: f.note.trim() || null };
    const { error } = row ? await supabase.from('ep_expenses').update(payload).eq('id', row.id) : await supabase.from('ep_expenses').insert(payload);
    if (error) { alert(error.message); return; } onSaved();
  }
  return (
    <Modal title={row ? 'Edit payment' : 'Pay an expense'} onClose={onClose} onSave={save} saveLabel={row ? 'Save changes' : 'Save payment'}>
      <div className="space-y-3">
        <div><label className="text-xs text-gray-500">Amount (Rs)</label><input autoFocus type="number" inputMode="decimal" className={`${input} text-2xl font-bold text-center`} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0" /></div>
        <div><label className="text-xs text-gray-500">Category</label><select className={input} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{cats.filter((c) => c.is_active).map((c) => <option key={c.id}>{c.name}</option>)}{!cats.some((c) => c.name === f.category) && f.category && <option>{f.category}</option>}</select></div>
        <div className="grid grid-cols-2 gap-3"><div><label className="text-xs text-gray-500">Date</label><input type="date" className={input} value={f.entry_date} onChange={(e) => setF({ ...f, entry_date: e.target.value })} /></div><div><label className="text-xs text-gray-500">From</label><Via value={f.via} onChange={(v) => setF({ ...f, via: v })} /></div></div>
        <div><label className="text-xs text-gray-500">Paid to</label><input className={input} value={f.paid_to} onChange={(e) => setF({ ...f, paid_to: e.target.value })} placeholder="who received it" /></div>
        <div><label className="text-xs text-gray-500">Note</label><input className={input} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
      </div>
    </Modal>
  );
}
function DepForm({ row, onClose, onSaved }: { row?: Dep; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ entry_date: row?.entry_date ?? today(), amount: row ? String(row.amount) : '', via: (row?.via ?? 'Cash') as 'Bank' | 'Cash', note: row?.note ?? '' });
  async function save() { if (!(Number(f.amount) > 0)) { alert('Enter the amount'); return; } const payload = { entry_date: f.entry_date, amount: Number(f.amount), via: f.via, note: f.note.trim() || null }; const { error } = row ? await supabase.from('ep_deposits').update(payload).eq('id', row.id) : await supabase.from('ep_deposits').insert(payload); if (error) { alert(error.message); return; } onSaved(); }
  return (
    <Modal title={row ? 'Edit deposit' : 'Put money into the pool'} onClose={onClose} onSave={save}>
      <div className="space-y-3">
        <div><label className="text-xs text-gray-500">Amount (Rs)</label><input autoFocus type="number" inputMode="decimal" className={`${input} text-2xl font-bold text-center`} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0" /></div>
        <div className="grid grid-cols-2 gap-3"><div><label className="text-xs text-gray-500">Date</label><input type="date" className={input} value={f.entry_date} onChange={(e) => setF({ ...f, entry_date: e.target.value })} /></div><div><label className="text-xs text-gray-500">Into</label><Via value={f.via} onChange={(v) => setF({ ...f, via: v })} /></div></div>
        <div><label className="text-xs text-gray-500">Note</label><input className={input} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
      </div>
    </Modal>
  );
}
function MoveForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ entry_date: today(), amount: '', dir: 'to_cash' as 'to_cash' | 'to_bank', note: '' });
  async function save() { if (!(Number(f.amount) > 0)) { alert('Enter the amount'); return; } const { error } = await supabase.from('ep_moves').insert({ entry_date: f.entry_date, amount: Number(f.amount), dir: f.dir, note: f.note.trim() || null }); if (error) { alert(error.message); return; } onSaved(); }
  return (
    <Modal title="Move money bank ↔ cash drawer" onClose={onClose} onSave={save}>
      <div className="space-y-3">
        <div className="flex gap-1">{([['to_cash', 'Bank → Cash drawer'], ['to_bank', 'Cash drawer → Bank']] as const).map(([v, l]) => <button key={v} type="button" onClick={() => setF({ ...f, dir: v })} className={`flex-1 px-3 py-2 rounded-lg text-sm border ${f.dir === v ? 'bg-teal-600 text-white border-teal-600' : 'bg-white border-gray-300'}`}>{l}</button>)}</div>
        <div><label className="text-xs text-gray-500">Amount (Rs)</label><input autoFocus type="number" inputMode="decimal" className={`${input} text-2xl font-bold text-center`} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3"><div><label className="text-xs text-gray-500">Date</label><input type="date" className={input} value={f.entry_date} onChange={(e) => setF({ ...f, entry_date: e.target.value })} /></div><div><label className="text-xs text-gray-500">Note</label><input className={input} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div></div>
      </div>
    </Modal>
  );
}
function TallyForm({ pool, onClose, onSaved }: { pool: { bank: number; cash: number }; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ bank: String(pool.bank), cash: '', note: '' });
  const db = Number(f.bank || 0) - pool.bank, dc = Number(f.cash || 0) - pool.cash;
  async function save() { const { error } = await supabase.from('ep_tallies').insert({ entry_date: today(), bank_counted: Number(f.bank) || 0, cash_counted: Number(f.cash) || 0, bank_system: pool.bank, cash_system: pool.cash, note: f.note.trim() || null }); if (error) { alert(error.message); return; } onSaved(); }
  return (
    <Modal title="Do a tally — count and compare" onClose={onClose} onSave={save} saveLabel="Save tally">
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3"><div><label className="text-xs text-gray-500">Bank — counted</label><input type="number" className={input} value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} /><p className="text-[11px] text-gray-500 mt-1">system says {n0(pool.bank)}</p></div><div><label className="text-xs text-gray-500">Cash drawer — counted</label><input autoFocus type="number" className={input} value={f.cash} onChange={(e) => setF({ ...f, cash: e.target.value })} /><p className="text-[11px] text-gray-500 mt-1">system says {n0(pool.cash)}</p></div></div>
        <div className={`rounded-lg px-3 py-2 ${db === 0 && dc === 0 ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>{db === 0 && dc === 0 ? 'Tallied — matches the system.' : `Difference: bank ${db >= 0 ? '+' : ''}${n0(db)} · cash ${dc >= 0 ? '+' : ''}${n0(dc)}`}</div>
        <div><label className="text-xs text-gray-500">Note</label><input className={input} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Rs 500 short — petrol not recorded" /></div>
      </div>
    </Modal>
  );
}
function CatsForm({ cats, onClose, onChange }: { cats: Cat[]; onClose: () => void; onChange: () => void }) {
  const [name, setName] = useState(''); const [budget, setBudget] = useState('');
  async function add() { if (!name.trim()) return; const { error } = await supabase.from('ep_categories').insert({ name: name.trim(), budget: Number(budget) || 0, sort_order: cats.length + 1 }); if (error) { alert(error.message); return; } setName(''); setBudget(''); onChange(); }
  async function setB(c: Cat, v: string) { await supabase.from('ep_categories').update({ budget: Number(v) || 0 }).eq('id', c.id); onChange(); }
  async function toggle(c: Cat) { await supabase.from('ep_categories').update({ is_active: !c.is_active }).eq('id', c.id); onChange(); }
  return (
    <Modal title="Categories & monthly budgets" onClose={onClose} wide>
      <div className="space-y-1 mb-3">
        {cats.map((c) => <div key={c.id} className={`flex items-center gap-2 text-sm ${c.is_active ? '' : 'opacity-50'}`}><span className="flex-1">{c.name}</span><input type="number" defaultValue={c.budget} onBlur={(e) => Number(e.target.value) !== c.budget && setB(c, e.target.value)} className={`${input} w-32 text-right`} /><button onClick={() => toggle(c)} className="text-xs text-gray-500 hover:text-gray-900 w-14">{c.is_active ? 'hide' : 'show'}</button></div>)}
        <div className="flex justify-between text-sm font-semibold border-t border-gray-200 pt-2"><span>Total budget</span><span>{n0(cats.filter((c) => c.is_active).reduce((t, c) => t + c.budget, 0))}</span></div>
      </div>
      <div className="flex gap-2 items-end"><div className="flex-1"><label className="text-xs text-gray-500">New category</label><input className={input} value={name} onChange={(e) => setName(e.target.value)} /></div><div className="w-32"><label className="text-xs text-gray-500">Budget</label><input type="number" className={input} value={budget} onChange={(e) => setBudget(e.target.value)} /></div><button onClick={add} className="px-3 py-2 bg-teal-600 text-white rounded-lg text-sm">Add</button></div>
      <p className="text-xs text-gray-400 mt-3">Budgets apply to every month. Hidden categories keep their history but don't appear in the pick list.</p>
    </Modal>
  );
}
