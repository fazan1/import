import { useEffect, useState } from 'react';
import { TrendingUp, Plus, Lock, Unlock, Pencil, Printer, Download, X, Trash2, Check as CheckIcon, Lightbulb, Settings2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { esc } from '../lib/html';

/* =====================================================================
   CAPITAL — the money-exchange business, one row a month.
   Columns reused from growth_months:
     net_capital   = working capital at month-end
     profit        = GROSS profit (before expenses)
     expenses      = expenses for the month
     capital_added = money put in,  withdrawn = money taken out
   Net profit = profit − expenses (never typed, always calculated)
   ===================================================================== */
interface Row {
  id: string; month: string; rmb_volume: number; lkr_billed: number; profit: number; expenses: number; cash: number; bank: number; usdt_lkr: number;
  receivables: number; payables_lkr: number; capital_added: number; withdrawn: number; net_capital: number; days_to_collect: number | null;
  note: string | null; outcome: string | null; closed: boolean;
}
const NUM: (keyof Row)[] = ['rmb_volume', 'lkr_billed', 'profit', 'expenses', 'cash', 'bank', 'usdt_lkr', 'receivables', 'payables_lkr', 'capital_added', 'withdrawn', 'net_capital'];
const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm';
const n0 = (n: number) => (isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—');
const Rs = (n: number) => `Rs ${n0(n)}`;
const M = (n: number) => (isFinite(n) ? (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n0(n)) : '—');
const p1 = (n: number) => (isFinite(n) ? `${n.toFixed(1)}%` : '—');
const sp1 = (n: number) => (isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(1)}%` : '—');
const ml = (m: string) => new Date(m + '-01').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
const mlong = (m: string) => new Date(m + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const addMonths = (m: string, k: number) => { const d = new Date(m + '-01'); d.setMonth(d.getMonth() + k); return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };
const card = 'bg-white border border-gray-200 rounded-lg';
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/* ---------- settings (giving percentages), kept in the browser ---------- */
interface Cfg { max: number; rotate: number; stretch: number }
const CFG_KEY = 'capital-mentor-cfg5';

/* ---------- savings ledger (capital_savings) ---------- */
interface Sav { id: string; entry_date: string; kind: 'deposit' | 'withdraw'; amount: number; purpose: string | null; note: string | null }
// month → money moved to savings / money brought back from savings into the business
let SAV: { dep: Record<string, number>; back: Record<string, number>; list: Sav[]; ready: boolean } = { dep: {}, back: {}, list: [], ready: false };
/* capital left in the business after this month's savings moves */
const carried = (x: Row) => x.net_capital + (x.profit - x.expenses) + x.capital_added - x.withdrawn - (SAV.dep[x.month] || 0) + (SAV.back[x.month] || 0);
const balanceAt = (month: string) => SAV.list.filter((e) => e.entry_date.slice(0, 7) <= month).reduce((t, e) => t + (e.kind === 'deposit' ? e.amount : -e.amount), 0);
const PURPOSES = [['business', 'Back into the business'], ['property', 'Property / investment'], ['zakat', 'Zakat / charity'], ['personal', 'Personal'], ['other', 'Other']] as const;
const loadCfg = (): Cfg => { try { const c = JSON.parse(localStorage.getItem(CFG_KEY) || ''); if (isFinite(c.max) && isFinite(c.rotate)) return { max: c.max, rotate: c.rotate, stretch: isFinite(c.stretch) ? c.stretch : 5 }; } catch { /* */ } return { max: 2.5, rotate: 0, stretch: 5 }; };

/* ---------- derived figures for one month ---------- */
interface D {
  net: number; ratio: number; roc: number;
  change: number | null; changePct: number;
  expectedCap: number | null; capGap: number | null;
  zakat: number; free: number;      // from net profit
  avgRoc3: number; avgNet3: number; avgRatio3: number; // trailing 3 incl. this month
  prevNet: number; prevRoc: number; prevRatio: number;
}
function derive(rows: Row[], i: number, cfg: Cfg): D {
  const r = rows[i], prev = i > 0 ? rows[i - 1] : null;
  const netOf = (x: Row) => x.profit - x.expenses;
  const rocOf = (x: Row) => (x.net_capital > 0 ? (netOf(x) / x.net_capital) * 100 : NaN);
  const ratioOf = (x: Row) => (x.profit > 0 ? (x.expenses / x.profit) * 100 : NaN);
  const net = netOf(r);
  const w3 = rows.slice(Math.max(0, i - 2), i + 1);
  const expectedCap = prev ? carried(prev) : null;
  const zakat = Math.max(0, net) * cfg.max / 100;   // ceiling only — the real figure comes from planOf
  return {
    net, ratio: ratioOf(r), roc: rocOf(r),
    change: prev ? r.net_capital - prev.net_capital : null,
    changePct: prev && prev.net_capital > 0 ? ((r.net_capital - prev.net_capital) / prev.net_capital) * 100 : NaN,
    expectedCap, capGap: expectedCap === null ? null : r.net_capital - expectedCap,
    zakat, free: Math.max(0, net - zakat),
    avgRoc3: avg(w3.map(rocOf).filter(isFinite)), avgNet3: avg(w3.map(netOf)), avgRatio3: avg(w3.map(ratioOf).filter(isFinite)),
    prevNet: prev ? netOf(prev) : NaN, prevRoc: prev ? rocOf(prev) : NaN, prevRatio: prev ? ratioOf(prev) : NaN,
  };
}

/* ---------- the mentor ---------- */
type Tone = 'good' | 'warn' | 'bad' | 'info';
interface Verdict { grade: Grade; headline: string; lines: { tone: Tone; text: string }[]; plan: { label: string; value: string; note: string }[] }

type Grade = 'STRONG' | 'STEADY' | 'WEAK' | 'RISKY' | 'FIRST';
const netOfR = (x: Row) => x.profit - x.expenses;
const rocOfR = (x: Row) => (x.net_capital > 0 ? (netOfR(x) / x.net_capital) * 100 : NaN);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
/* "your usual" = up to 3 earlier months that actually traded. Dead months are left out,
   so one quiet month never drags the yardstick down or makes the next month look heroic. */
const trading = (rows: Row[], end: number, n: number) => {           // the last n real trading months before index `end`
  const win = rows.slice(Math.max(0, end - 6), end);
  const pos = win.map(netOfR).filter((x) => x > 0).sort((a, b) => a - b);
  if (!pos.length) return [] as Row[];
  const med = pos[Math.floor(pos.length / 2)];
  return win.filter((x) => netOfR(x) >= med * 0.5).slice(-n);
};
const usualNet = (rows: Row[], i: number) => { const xs = trading(rows, i, 3).map(netOfR); return xs.length ? avg(xs) : NaN; };
const usualRoc = (rows: Row[], i: number) => { const xs = trading(rows, i, 3).map(rocOfR).filter(isFinite); return xs.length ? avg(xs) : NaN; };
const relOf = (rows: Row[], i: number) => { const u = usualNet(rows, i); return isFinite(u) && u > 0 ? netOfR(rows[i]) / u : NaN; };
const softAt = (rows: Row[], i: number) => i >= 0 && (netOfR(rows[i]) <= 0 || (isFinite(relOf(rows, i)) && relOf(rows, i) < 0.75));

/* Smoothed grading: judged against your usual, not just last month.
   One soft month = WEAK (a quiet month, absorbed). Two soft months in a row = RISKY (a real trend). */
function gradeOf(rows: Row[], i: number, _cfg: Cfg): Grade {
  if (i <= 0) return 'FIRST';
  const rel = relOf(rows, i);
  if (!isFinite(rel)) return netOfR(rows[i]) > 0 ? 'STEADY' : 'WEAK';
  if (softAt(rows, i)) return softAt(rows, i - 1) ? 'RISKY' : 'WEAK';
  if (rel >= 1.08) return 'STRONG';
  return 'STEADY';
}
const GIVES = (g: Grade) => g === 'STRONG' || g === 'STEADY' || g === 'FIRST';

/* ---------- what to do with this month's net profit ---------- */
type Mode = 'loss' | 'first' | 'absorbing' | 'idle' | 'softer' | 'hold';
interface Plan { tier: 'loss' | 'none' | 'normal' | 'high'; mode: Mode; strength: number; pct: number; give: number; keepPct: number; keep: number; save: number; idle: number; neededCap: number; uRoc: number; target: number }
/* Giving slides 0% → cfg.max% in 0.1% steps with the month's strength.
   Keep-in vs pull-out is decided by the RETURN %, not a fixed ceiling:
     return held while capital grew → the business is using the money → keep half the profit in to compound
     capital grew but return fell   → part of the capital sat idle → keep a small cushion, move the rest AND the idle capital to savings
     weak / risky month             → hold everything in */
function planOf(rows: Row[], i: number, cfg: Cfg): Plan {
  const r = rows[i], N = netOfR(r), C = r.net_capital, prev = i > 0 ? rows[i - 1] : null;
  const g = gradeOf(rows, i, cfg), roc = rocOfR(r), uRoc = usualRoc(rows, i);
  const target = cfg.rotate > 0 ? cfg.rotate : (rows[0]?.net_capital || C);
  const base: Omit<Plan, 'tier' | 'mode'> = { strength: 0, pct: 0, give: 0, keepPct: 0, keep: 0, save: 0, idle: 0, neededCap: C, uRoc, target };
  if (N <= 0) return { ...base, tier: 'loss', mode: 'loss' };
  const strength = isFinite(uRoc) ? clamp01((roc / uRoc - 0.6) / 0.7) : clamp01(roc / 20);
  const pct = Math.round(strength * cfg.max * 10) / 10;
  const give = N * pct / 100, after = N - give;
  let mode: Mode, keepPct: number, idle = 0, neededCap = C;
  if (g === 'WEAK' || g === 'RISKY') { mode = 'hold'; keepPct = 1; }
  else if (!prev || !isFinite(uRoc)) { mode = 'first'; keepPct = 0.30 - 0.20 * strength; }
  else {
    const capGrew = C > prev.net_capital * 1.01;
    if (roc >= uRoc * 0.95) { mode = 'absorbing'; keepPct = 0.5; }
    else if (capGrew) {
      mode = 'idle'; keepPct = 0.1;
      neededCap = N / (uRoc / 100);
      idle = Math.max(0, Math.min(C - neededCap, C - prev.net_capital));
    } else { mode = 'softer'; keepPct = 0.3; }
  }
  const keep = after * keepPct;
  const tier: Plan['tier'] = pct <= 0 ? 'none' : strength >= 0.75 ? 'high' : 'normal';
  return { tier, mode, strength, pct, give, keepPct, keep, save: Math.max(0, after - keep), idle, neededCap, uRoc, target };
}

/* ---------- next month's target profit ---------- */
interface Target { base: number; stretch: number; target: number; held: boolean }
function targetFor(rows: Row[], i: number, cfg: Cfg): Target | null {
  const xs = trading(rows, i + 1, 3).map(netOfR);
  if (!xs.length) return null;
  const base = avg(xs);
  const g = gradeOf(rows, i, cfg);
  if (g === 'WEAK' || g === 'RISKY' || netOfR(rows[i]) <= 0) {
    const before = i > 0 ? targetFor(rows, i - 1, cfg) : null;           // after a quiet month the goal is held, not raised
    if (before) return { ...before, held: true };
    return { base, stretch: 0.1, target: base * 1.001, held: true };
  }
  const st = planOf(rows, i, cfg).strength;
  const stretch = Math.round((0.1 + st * (cfg.stretch - 0.1)) * 10) / 10;
  const fresh = base * (1 + stretch / 100);
  const before = i > 0 ? targetFor(rows, i - 1, cfg) : null;
  if (before?.held && before.target > fresh) return { ...before, held: false };   // coming out of a quiet spell, keep the higher bar
  return { base, stretch, target: fresh, held: false };
}

function mentor(rows: Row[], i: number, cfg: Cfg): Verdict {
  const r = rows[i], d = derive(rows, i, cfg), prev = i > 0 ? rows[i - 1] : null;
  const L: Verdict['lines'] = [];
  const add = (tone: Tone, text: string) => L.push({ tone, text });
  const grade = gradeOf(rows, i, cfg);
  const u = usualNet(rows, i), uR = usualRoc(rows, i);
  const C = r.net_capital;

  const headline = {
    FIRST: `First month: ${Rs(d.net)} net, ${p1(d.roc)} return.`,
    STRONG: `Strong month: ${Rs(d.net)} net${isFinite(u) ? `, ${sp1((d.net / u - 1) * 100)} on usual` : ''}.`,
    STEADY: `Steady month: ${Rs(d.net)} net, in line with usual.`,
    WEAK: `Quiet month: ${Rs(d.net)} net. Hold the profit in.`,
    RISKY: `Second soft month in a row. Protect the capital, invest nothing new.`,
  }[grade];

  /* the plan */
  const P = planOf(rows, i, cfg);
  const plan: Verdict['plan'] = [];
  if (P.mode === 'loss') {
    plan.push({ label: 'Zakat / charity 0%', value: 'Rs 0', note: 'no profit' });
    plan.push({ label: 'To savings', value: 'Rs 0', note: 'nothing to move' });
    add('bad', 'No profit. Give nothing, move nothing, invest nothing.');
  } else {
    const score = Math.round(P.strength * 10);
    plan.push({ label: `Zakat / charity ${P.pct.toFixed(1)}%`, value: Rs(P.give), note: `score ${score}/10` });
    plan.push({ label: 'Keep in business', value: Rs(P.keep), note: { first: 'cushion', absorbing: 'money is working — compound it', idle: '10% cushion', softer: '30% cushion', hold: 'quiet month — keep it all', loss: '' }[P.mode] });
    plan.push({ label: 'Profit to savings', value: Rs(P.save), note: P.save > 0 ? `${Math.round((P.save / d.net) * 100)}% of profit` : '—' });
    if (P.idle > 0) plan.push({ label: 'Idle capital to savings', value: Rs(P.idle), note: 'not earning this month' });
  }
  const T = targetFor(rows, i, cfg);
  if (T) plan.push({ label: `Target ${addMonths(r.month, 1).split(' ')[0]}`, value: Rs(T.target), note: T.held ? 'held' : `+${T.stretch.toFixed(1)}%` });

  /* what the numbers say — what happened, why it matters, what to do */
  const nets = rows.slice(0, i + 1).map(netOfR);

  // 1. how the month compares
  if (grade === 'FIRST') add('info', `First month on record. ${Rs(d.net)} net on ${Rs(C)} — the yardstick every later month is measured against.`);
  if (grade === 'WEAK') add('info', `A quiet month — it happens. Your usual is still ${Rs(u)}, so this is not a decline. Only if next month is soft too does it become a trend.`);
  if (grade === 'RISKY') add('bad', 'Second soft month in a row — now a trend. Before anything goes out, check rates, volumes and who is paying late.');
  if (prev && softAt(rows, i - 1) && (grade === 'STRONG' || grade === 'STEADY')) add('good', `Back from a quiet ${ml(prev.month)}: ${Rs(d.net)} this month against your usual ${Rs(u)}.`);
  if (prev && !softAt(rows, i - 1) && isFinite(d.prevNet) && d.prevNet > 0) {
    const g = ((d.net - d.prevNet) / d.prevNet) * 100;
    add(g >= 8 ? 'good' : g <= -8 ? 'warn' : 'info', `Net profit ${g >= 0 ? 'up' : 'down'} ${Math.abs(g).toFixed(0)}% on ${ml(prev.month)} (${Rs(d.prevNet)} → ${Rs(d.net)}).`);
  }

  // 2. how hard the money worked
  if (isFinite(d.roc) && isFinite(uR)) {
    const diff = d.roc - uR;
    add(diff > 1 ? 'good' : diff < -1 ? 'warn' : 'info', `Return ${p1(d.roc)} against your usual ${p1(uR)} — ${diff > 1 ? 'every rupee worked harder than normal.' : diff < -1 ? 'the money moved slower. Look at late payers and whether rates were cut.' : 'right on your normal pace.'}`);
  } else if (isFinite(d.roc)) add('info', `Return ${p1(d.roc)} on ${Rs(C)} of working capital.`);

  // 3. keep in or move out — and why
  if (P.mode === 'absorbing') add('good', `The business is putting its money to work${prev && C > prev.net_capital * 1.01 ? ` — capital grew to ${Rs(C)} and the return held` : ''}. Keep half the profit in so it compounds; move the other half to savings.`);
  if (P.mode === 'idle') add('warn', `Capital grew to ${Rs(C)} but the return fell. At your usual return this profit needed only ${Rs(P.neededCap)} — about ${Rs(P.idle)} sat idle. Move it to savings: idle money earns nothing and still carries risk.`);
  if (P.mode === 'softer') add('info', 'Return slipped a little without capital growing — a softer month for rates or volume. Keep 30% in as cushion, move the rest to savings.');
  if (P.mode === 'hold') add('warn', 'Hold the whole profit in the business this month. Nothing to savings, nothing invested, until the next month is clearer.');
  if (P.mode === 'first') add('info', `First month: ${Math.round(P.keepPct * 100)}% stays in as cushion, the rest to savings. From next month the decision follows the return.`);

  // 4. giving
  if (P.mode !== 'loss') add(P.tier === 'high' ? 'good' : P.tier === 'none' ? 'warn' : 'info', P.pct > 0
    ? `Zakat / charity ${P.pct.toFixed(1)}% = ${Rs(P.give)} — the month scored ${Math.round(P.strength * 10)}/10${P.tier === 'high' ? ', a month to share' : ''}. Taken from profit only; capital is untouched.`
    : 'Too thin a month to give from — the business needs this profit.');

  // 5. expenses
  if (r.profit > 0 && r.expenses > 0) {
    if (isFinite(d.prevRatio) && d.ratio > d.prevRatio + 5) add('warn', `Expenses took ${p1(d.ratio)} of gross, up from ${p1(d.prevRatio)}. Costs are growing faster than profit — find what grew and cut it.`);
    else if (isFinite(d.prevRatio) && d.ratio < d.prevRatio - 5) add('good', `Expenses down to ${p1(d.ratio)} of gross (was ${p1(d.prevRatio)}). Good discipline — keep it there.`);
    else add('info', `Expenses ${Rs(r.expenses)} — ${p1(d.ratio)} of gross${isFinite(d.prevRatio) ? `, steady on last month` : ''}.`);
  }

  // 6. money in and out, books
  if (r.withdrawn > 0) add(r.withdrawn > d.net ? 'bad' : 'info', r.withdrawn > d.net ? `You took out ${Rs(r.withdrawn)} — ${Rs(r.withdrawn - d.net)} more than the month earned. Repeat that and the business shrinks.` : `You took out ${Rs(r.withdrawn)} and still left ${Rs(d.net - r.withdrawn)} of profit in.`);
  if (r.capital_added > 0) add('info', `${Rs(r.capital_added)} of your own money went in — that growth is bought, not earned.`);
  if (d.capGap !== null && Math.abs(d.capGap) > 1000) add('bad', `Capital is off by ${Rs(Math.abs(d.capGap))}: last month should have carried ${Rs(d.expectedCap!)} into this month, you entered ${Rs(C)}. ${d.capGap < 0 ? 'Money left unrecorded' : 'Extra money appeared'} — find it first.`);
  else if (d.capGap !== null) add('good', 'Capital matches what last month carried over — the books are clean.');

  // 7. streaks and records
  let up = 0; for (let k = i; k >= 1; k--) { if (nets[k] > nets[k - 1]) up++; else break; }
  let down = 0; for (let k = i; k >= 1; k--) { if (nets[k] < nets[k - 1]) down++; else break; }
  if (up >= 2) add('good', `${up + 1} months of rising profit in a row — write down what changed so it is not lost.`);
  if (down >= 2) add('bad', `${down + 1} months of falling profit in a row — sit down together and find the cause.`);
  if (nets.length >= 3 && d.net === Math.max(...nets)) add('good', `Best month of the ${nets.length} on record.`);

  // 8. target
  const tPrev = i > 0 ? targetFor(rows, i - 1, cfg) : null;
  if (tPrev) {
    const diff = ((d.net - tPrev.target) / tPrev.target) * 100;
    add(diff >= 0 ? 'good' : 'warn', `Target was ${Rs(tPrev.target)} — ${diff >= 0 ? 'beaten' : 'missed'} by ${Math.abs(diff).toFixed(1)}%.${diff < 0 && grade === 'WEAK' ? ' One quiet month, so the target holds.' : ''}`);
  }
  if (T) add('info', T.held ? `Next target stays at ${Rs(T.target)} — no point raising the bar after a quiet month.` : `Next target ${Rs(T.target)}: ${T.stretch.toFixed(1)}% above your 3-month average of ${Rs(T.base)}.`);

  // 9. the road ahead
  const avg3 = avg(trading(rows, i + 1, 3).map(netOfR));
  if (isFinite(avg3) && avg3 > 0 && C > 0) {
    const dbl = Math.log(2) / Math.log(1 + avg3 / C);
    add('info', `At ${Rs(avg3)} a month, the next 12 months bring about ${Rs(avg3 * 12)}. Left in, the capital would double in ~${dbl.toFixed(0)} months.`);
  }

  // 10. savings
  if (SAV.ready && SAV.list.length) {
    const bal = balanceAt(r.month);
    const expAvg = avg(rows.slice(Math.max(0, i - 2), i + 1).map((x) => x.expenses).filter((x) => x > 0));
    if (bal > 0) add('good', `Savings ${Rs(bal)}${isFinite(expAvg) && expAvg > 0 ? ` — covers ${(bal / expAvg).toFixed(1)} months of expenses if business stopped` : ''}.`);
    if (bal >= C * 0.5) add('good', 'Savings is over half the capital — a strong reserve. A good time to put part into property or another business.');
    const suggested = rows.slice(0, i + 1).reduce((t, _x, k) => { const q = planOf(rows, k, cfg); return t + q.save + q.idle; }, 0);
    const moved = rows.slice(0, i + 1).reduce((t, x) => t + (SAV.dep[x.month] || 0), 0);
    if (suggested > 0 && moved < suggested * 0.8) add('warn', `Plan said ${Rs(suggested)} to savings so far; ${Rs(moved)} actually moved. ${Rs(suggested - moved)} is still in the business, carrying its risk.`);
    if (bal < 0) add('bad', 'Savings is below zero — more recorded out than in. Check the entries.');
  } else if (SAV.ready && P.save + P.idle > 0) add('info', 'Nothing in savings yet — press the green "Record" button under the plan when you move the money.');
  if (d.net > C) add('warn', 'Profit is bigger than the whole capital — check gross and expenses for an extra digit.');

  return { grade, headline, lines: L, plan };
}

/* ===================================================================== */
export default function Growth() {
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Partial<Row> | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMonth, setViewMonth] = useState<string | null>(null);
  const [cfg, setCfg] = useState<Cfg>(loadCfg);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [savings, setSavings] = useState<Sav[]>([]);
  const [savMissing, setSavMissing] = useState(false);
  const [savForm, setSavForm] = useState<Partial<Sav> | null>(null);

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from('growth_months').select('*').order('month');
    setRows(((data ?? []) as Row[]).map((r) => { const o = { ...r } as Row; NUM.forEach((k) => { (o as unknown as Record<string, number>)[k] = Number(r[k]) || 0; }); o.days_to_collect = r.days_to_collect == null ? null : Number(r.days_to_collect); return o; }));
    const sv = await supabase.from('capital_savings').select('*').order('entry_date').order('created_at');
    if (sv.error) setSavMissing(true); else { setSavMissing(false); setSavings(((sv.data ?? []) as Sav[]).map((e) => ({ ...e, amount: Number(e.amount) || 0 }))); }
    setLoading(false);
  }
  async function saveSav() {
    if (!savForm?.kind || !savForm.entry_date || !(Number(savForm.amount) > 0)) { alert('Enter the date and an amount'); return; }
    if (savForm.kind === 'withdraw') {
      const balThen = savings.filter((e) => e.entry_date <= savForm.entry_date!).reduce((t, e) => t + (e.kind === 'deposit' ? e.amount : -e.amount), 0);
      if (Number(savForm.amount) > balThen) {
        alert(`Savings only holds ${Rs(Math.max(0, balThen))} on ${savForm.entry_date}.\n\nYou can't take out more than is in savings. If this money came out of the business, enter it as "Money taken out" when you edit that month instead.`);
        return;
      }
    }
    const { error } = await supabase.from('capital_savings').insert({ kind: savForm.kind, entry_date: savForm.entry_date, amount: Number(savForm.amount), purpose: savForm.kind === 'withdraw' ? (savForm.purpose || 'other') : null, note: savForm.note || null });
    if (error) { alert(error.message); return; }
    setSavForm(null); load();
  }
  async function removeSav(e: Sav) {
    if (!confirm(`Delete this savings entry?\n\n${e.kind === 'deposit' ? 'Put into savings' : 'Taken out'} ${Rs(e.amount)} on ${e.entry_date}`)) return;
    await supabase.from('capital_savings').delete().eq('id', e.id); load();
  }
  const monthEnd = (m: string) => { const [y, mo] = m.split('-').map(Number); const last = new Date(y, mo, 0).getDate(); return `${m}-${String(last).padStart(2, '0')}`; };
  const saveCfg = (c: Cfg) => { setCfg(c); localStorage.setItem(CFG_KEY, JSON.stringify(c)); };

  const li = viewMonth ? rows.findIndex((r) => r.month === viewMonth) : -1;
  const idx = li >= 0 ? li : rows.length - 1;
  const latest = idx >= 0 ? rows[idx] : null;
  const isLatest = idx === rows.length - 1;
  SAV = { dep: {}, back: {}, list: savings, ready: !savMissing };
  savings.forEach((e) => { const m = e.entry_date.slice(0, 7); if (e.kind === 'deposit') SAV.dep[m] = (SAV.dep[m] || 0) + e.amount; else if (e.purpose === 'business') SAV.back[m] = (SAV.back[m] || 0) + e.amount; });
  const savBal = savings.reduce((t, e) => t + (e.kind === 'deposit' ? e.amount : -e.amount), 0);
  const d = latest ? derive(rows, idx, cfg) : null;
  const P = latest ? planOf(rows, idx, cfg) : null;
  const v = latest ? mentor(rows, idx, cfg) : null;

  async function save() {
    if (!edit?.month) { alert('Pick the month'); return; }
    const payload: Record<string, unknown> = { month: edit.month, note: edit.note || null, outcome: edit.outcome || null, updated_at: new Date().toISOString() };
    NUM.forEach((k) => { payload[k] = Number(edit[k]) || 0; });
    const { error } = edit.id ? await supabase.from('growth_months').update(payload).eq('id', edit.id) : await supabase.from('growth_months').insert(payload);
    if (error) { alert(error.message.includes('duplicate') ? 'That month already exists — edit it from the table.' : error.message); return; }
    if (edit.month) setViewMonth(edit.month);
    setEdit(null); load();
  }
  async function remove(r: Row) {
    if (r.closed) { alert('This month is closed. Reopen it first (unlock icon) if you really want to delete it.'); return; }
    if (!confirm(`Delete ${mlong(r.month)}?\n\nAll figures for this month will be removed. This cannot be undone.`)) return;
    const { error } = await supabase.from('growth_months').delete().eq('id', r.id);
    if (error) { alert(error.message); return; }
    if (viewMonth === r.month) setViewMonth(null);
    load();
  }
  async function fixGap(how: 'savings' | 'taken' | 'putin' | 'capital') {
    if (idx < 1 || !d || d.capGap === null) return;
    const prev = rows[idx - 1], cur = rows[idx], gap = Math.round(Math.abs(d.capGap));
    if ((how !== 'capital' && prev.closed) || (how === 'capital' && cur.closed)) { alert('That month is closed. Reopen it first (unlock icon).'); return; }
    const msg = how === 'savings' ? `Record ${Rs(gap)} as put into savings at the end of ${mlong(prev.month)}?`
      : how === 'taken' ? `Record ${Rs(gap)} as money taken out in ${mlong(prev.month)}?`
      : how === 'putin' ? `Record ${Rs(gap)} as money put in during ${mlong(prev.month)}?`
      : `Change ${mlong(cur.month)} working capital to ${Rs(Math.round(d.expectedCap!))}?`;
    if (!confirm(msg)) return;
    let error;
    if (how === 'savings') ({ error } = await supabase.from('capital_savings').insert({ kind: 'deposit', entry_date: monthEnd(prev.month), amount: gap, note: `Profit kept aside from ${mlong(prev.month)}` }));
    else if (how === 'taken') ({ error } = await supabase.from('growth_months').update({ withdrawn: (prev.withdrawn || 0) + gap }).eq('id', prev.id));
    else if (how === 'putin') ({ error } = await supabase.from('growth_months').update({ capital_added: (prev.capital_added || 0) + gap }).eq('id', prev.id));
    else ({ error } = await supabase.from('growth_months').update({ net_capital: Math.round(d.expectedCap!) }).eq('id', cur.id));
    if (error) { alert(error.message); return; }
    load();
  }
  async function toggleClose(r: Row) { await supabase.from('growth_months').update({ closed: !r.closed }).eq('id', r.id); load(); }
  function newMonth(): Partial<Row> {
    const last = rows[rows.length - 1];
    const m = last ? (() => { const dd = new Date(last.month + '-01'); dd.setMonth(dd.getMonth() + 1); return `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}`; })() : new Date().toISOString().slice(0, 7);
    return { month: m, net_capital: last ? Math.round(carried(last)) : 0, profit: 0, expenses: 0, capital_added: 0, withdrawn: 0, note: '', outcome: '' };
  }

  function exportExcel() {
    const ws = XLSX.utils.json_to_sheet(rows.map((r, i) => { const x = derive(rows, i, cfg); return { Month: r.month, 'Working capital': r.net_capital, 'Gross profit': r.profit, Expenses: r.expenses, 'Net profit': x.net, 'Expense %': isFinite(x.ratio) ? +x.ratio.toFixed(1) : '', 'Return %': isFinite(x.roc) ? +x.roc.toFixed(1) : '', 'Capital change': x.change ?? '', 'Put in': r.capital_added, 'Taken out': r.withdrawn, 'Zakat / charity': Math.round(planOf(rows, i, cfg).give), 'To savings': Math.round(planOf(rows, i, cfg).save + planOf(rows, i, cfg).idle), 'Target next month': Math.round(targetFor(rows, i, cfg)?.target ?? 0), Note: r.note, Outcome: r.outcome }; }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Capital'); XLSX.writeFile(wb, `capital-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }
  function print() {
    if (!latest || !d || !v) return;
    const w = window.open('', '_blank'); if (!w) { alert('Allow pop-ups to print'); return; }
    w.document.write(`<html><head><title>Capital — ${mlong(latest.month)}</title><style>
      body{font-family:ui-monospace,Menlo,monospace;padding:28px;color:#111;max-width:900px}h1{font-size:18px;margin:0}h2{font-size:12px;color:#666;font-weight:400;margin:2px 0 16px}h3{font-size:13px;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.08em}
      .grade{display:inline-block;padding:3px 10px;border:2px solid #111;font-weight:700;margin-bottom:8px}.head{font-size:14px;margin:0 0 10px}
      table{width:100%;border-collapse:collapse;font-size:11px}th,td{border-bottom:1px solid #ddd;padding:5px 7px;text-align:right}th:first-child,td:first-child{text-align:left}
      .l{font-size:12px;margin:5px 0;padding-left:10px;border-left:3px solid #999}.good{border-color:#16a34a}.warn{border-color:#d97706}.bad{border-color:#dc2626}
      .plan{display:flex;gap:18px;margin:8px 0}.plan div{border:1px solid #ccc;padding:8px 12px}.plan b{display:block;font-size:15px}</style></head><body>
      <h1>Capital — money exchange</h1><h2>${mlong(latest.month)} · printed ${new Date().toLocaleDateString('en-GB')}</h2>
      <div class="grade">${v.grade} MONTH</div><p class="head">${esc(v.headline)}</p>
      <h3>This month's plan</h3><div class="plan">${v.plan.map((p) => `<div>${esc(p.label)}<b>${esc(p.value)}</b><small>${esc(p.note)}</small></div>`).join('')}</div>
      <h3>What the numbers say</h3>${v.lines.map((l) => `<p class="l ${esc(l.tone)}">${esc(l.text)}</p>`).join('')}
      <h3>All months</h3><table><thead><tr><th>Month</th><th>Capital</th><th>Gross</th><th>Expenses</th><th>Net</th><th>Return</th><th>Put in</th><th>Taken out</th></tr></thead><tbody>
      ${rows.map((r, i) => { const x = derive(rows, i, cfg); return `<tr><td>${ml(r.month)}</td><td>${n0(r.net_capital)}</td><td>${n0(r.profit)}</td><td>${n0(r.expenses)}</td><td>${n0(x.net)}</td><td>${p1(x.roc)}</td><td>${r.capital_added ? n0(r.capital_added) : ''}</td><td>${r.withdrawn ? n0(r.withdrawn) : ''}</td></tr>`; }).join('')}
      </tbody></table>${latest.note ? `<h3>Decision</h3><p style="font-size:12px">${esc(latest.note)}</p>` : ''}</body></html>`);
    w.document.close(); w.print();
  }

  if (loading) return <div className="p-6 text-gray-500">Loading…</div>;

  const Tile = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) => (
    <div className={`${card} p-3`}>
      <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-gray-500">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${tone ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
  const Bars = ({ title, get, fmt, color, avgLine }: { title: string; get: (r: Row, i: number) => number; fmt: (n: number) => string; color: string; avgLine?: boolean }) => {
    const data = rows.slice(-12); const off = rows.length - data.length;
    const vals = data.map((r, k) => get(r, off + k)); const max = Math.max(1, ...vals.map((x) => Math.abs(x)).filter(isFinite));
    const a = avg(vals.filter(isFinite));
    return (
      <div className={`${card} p-3`}>
        <div className="flex justify-between items-baseline mb-2"><h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wide">{title}</h3>{avgLine && isFinite(a) && <span className="text-[10px] text-gray-500">avg {fmt(a)}</span>}</div>
        {data.length < 2 ? <p className="text-[11px] text-gray-400 py-6 text-center">from the second month</p> : (
          <div className="relative flex items-end gap-1 h-28">
            {avgLine && isFinite(a) && <div className="absolute left-0 right-0 border-t border-dashed border-gray-400" style={{ bottom: `${(Math.abs(a) / max) * 100}%` }} />}
            {data.map((r, k) => { const x = vals[k]; const h = isFinite(x) ? Math.max(2, (Math.abs(x) / max) * 100) : 2; return (
              <div key={r.month} className="flex-1 flex flex-col items-center justify-end h-full" title={`${mlong(r.month)}: ${fmt(x)}`}>
                <span className="text-[8px] text-gray-500 leading-none mb-0.5">{isFinite(x) ? fmt(x) : ''}</span>
                <div className={`w-full ${x < 0 ? 'bg-red-500' : r.month === latest?.month ? 'bg-[#e8552a]' : color}`} style={{ height: `${h}%` }} />
                <div className="text-[8px] text-gray-500 mt-0.5">{ml(r.month)}</div>
              </div>); })}
          </div>)}
      </div>
    );
  };
  const gradeStyle = { STRONG: 'bg-green-600', STEADY: 'bg-teal-600', WEAK: 'bg-amber-500', RISKY: 'bg-red-600', FIRST: 'bg-gray-700' };
  const toneStyle = { good: 'border-green-500', warn: 'border-amber-500', bad: 'border-red-500', info: 'border-gray-300 text-gray-600' };

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><TrendingUp className="w-6 h-6 text-[#e8552a]" />Capital</h1>
          <p className="text-sm text-gray-500">Money exchange — one row a month, and the mentor reads it for the meeting.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setCfgOpen(true)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex items-center gap-1" title="Giving and target settings"><Settings2 className="w-4 h-4" />Giving 0–{cfg.max}% · target up to +{cfg.stretch}%</button>
          <button onClick={print} className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex items-center gap-1"><Printer className="w-4 h-4" />Print</button>
          <button onClick={exportExcel} className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex items-center gap-1"><Download className="w-4 h-4" />Excel</button>
          <button onClick={() => setEdit(newMonth())} className="px-4 py-2 bg-[#e8552a] text-white rounded-lg text-sm flex items-center gap-1"><Plus className="w-4 h-4" />Add month</button>
        </div>
      </div>

      {!latest || !d || !v ? (
        <div className={`${card} p-10 text-center text-gray-500`}>No months yet. Add one to start.</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-xs font-mono uppercase tracking-[0.14em] text-gray-500">Showing</span>
            <select value={latest.month} onChange={(e) => setViewMonth(e.target.value)} className="border border-gray-300 bg-white px-2 py-1 text-sm font-semibold text-gray-800">
              {[...rows].reverse().map((r) => <option key={r.month} value={r.month}>{mlong(r.month)}{r.closed ? ' · closed' : ''}</option>)}
            </select>
            {!isLatest && <button onClick={() => setViewMonth(null)} className="text-xs text-teal-700 hover:underline">latest month</button>}
          </div>

          {/* ---- the verdict ---- */}
          <div className={`${card} mb-4 overflow-hidden`}>
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-200">
              <span className={`text-white text-[11px] font-mono tracking-[0.14em] px-2.5 py-1 ${gradeStyle[v.grade]}`}>{v.grade} MONTH</span>
              <p className="text-sm text-gray-900 flex-1 min-w-[240px]">{v.headline}</p>
            </div>
            <div className="grid md:grid-cols-[1fr_280px]">
              <div className="p-4 space-y-2">
                <h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wide flex items-center gap-1.5"><Lightbulb className="w-3.5 h-3.5 text-[#e8552a]" />What the numbers say</h3>
                {v.lines.map((l, k) => <p key={k} className={`text-sm pl-3 border-l-[3px] ${toneStyle[l.tone]}`}>{l.text}</p>)}
              </div>
              <div className="p-4 bg-gray-50 border-t md:border-t-0 md:border-l border-gray-200">
                <h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wide mb-2">This month's plan</h3>
                <p className="text-[11px] text-gray-500 mb-3">All from the month's net profit. The {Rs(latest.net_capital)} working capital stays untouched.</p>
                <div className="space-y-2">
                  {v.plan.map((p) => (
                    <div key={p.label} className="bg-white border border-gray-200 px-3 py-2">
                      <div className="flex justify-between items-baseline"><span className="text-xs text-gray-600">{p.label}</span><b className="text-sm">{p.value}</b></div>
                      <div className="text-[10px] text-gray-400">{p.note}</div>
                    </div>
                  ))}
                </div>
                {P && P.save + P.idle > 0 && !savMissing && (
                  <button onClick={() => setSavForm({ kind: 'deposit', entry_date: monthEnd(latest.month), amount: Math.round(P.save + P.idle), note: `From ${mlong(latest.month)}${P.idle > 0 ? ' — profit + idle capital' : ' profit'}` })} className="mt-3 w-full px-3 py-2 bg-teal-600 text-white text-sm rounded-lg">Record {Rs(P.save + P.idle)} moved to savings</button>
                )}
              </div>
            </div>
          </div>

          {/* ---- meters ---- */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Tile label="Working capital" value={`Rs ${M(latest.net_capital)}`} sub={`carries ${M(carried(latest))} into next month`} />
            <Tile label="Net profit" value={`Rs ${M(d.net)}`} sub={`gross ${M(latest.profit)} − expenses ${M(latest.expenses)}`} tone="text-green-700" />
            <Tile label="Return on capital" value={p1(d.roc)} sub={rows.length >= 2 ? `3-month avg ${p1(d.avgRoc3)}` : 'this month'} tone={isFinite(d.avgRoc3) && d.roc < d.avgRoc3 - 1 ? 'text-amber-700' : 'text-gray-900'} />
            <Tile label="Expenses take" value={p1(d.ratio)} sub={isFinite(d.prevRatio) ? `last month ${p1(d.prevRatio)}` : 'of gross profit'} tone={isFinite(d.prevRatio) && d.ratio > d.prevRatio + 5 ? 'text-amber-700' : 'text-gray-900'} />
          </div>

          {/* ---- graphs ---- */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <Bars title="Working capital" get={(r) => r.net_capital} fmt={M} color="bg-teal-600" />
            <Bars title="Net profit" get={(r) => r.profit - r.expenses} fmt={M} color="bg-green-600" avgLine />
            <Bars title="Return on capital %" get={(_, i) => derive(rows, i, cfg).roc} fmt={p1} color="bg-teal-600" avgLine />
            <Bars title="Expenses as % of gross" get={(_, i) => derive(rows, i, cfg).ratio} fmt={p1} color="bg-amber-500" avgLine />
          </div>

          {/* ---- money flow for the month ---- */}
          <div className={`${card} p-4 mb-4`}>
            <h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wide mb-2">Money flow — {mlong(latest.month)}</h3>
            <div className="text-sm space-y-1 max-w-md">
              {d.expectedCap !== null && (
                <div className={`flex justify-between text-xs mb-1 ${Math.abs(d.capGap!) > 1000 ? 'text-red-600' : 'text-green-700'}`}>
                  <span>{ml(rows[idx - 1].month)} carried {Rs(d.expectedCap)}</span>
                  <span>{Math.abs(d.capGap!) > 1000 ? `you entered ${Rs(latest.net_capital)} — off by ${Rs(d.capGap!)}` : 'matches ✓'}</span>
                </div>
              )}
              {d.expectedCap !== null && Math.abs(d.capGap!) > 1000 && (
                <div className="text-xs bg-red-50 border border-red-200 rounded-lg p-3 mb-2">
                  <p className="text-red-700 mb-2">{d.capGap! < 0 ? `Where did the ${Rs(Math.abs(d.capGap!))} go?` : `Where did the extra ${Rs(d.capGap!)} come from?`} Tap the true answer — the gap clears.</p>
                  <div className="flex flex-wrap gap-2">
                    {d.capGap! < 0 ? (<>
                      <button onClick={() => fixGap('savings')} className="px-2.5 py-1.5 bg-teal-600 text-white rounded-lg font-semibold">Moved to savings</button>
                      <button onClick={() => fixGap('taken')} className="px-2.5 py-1.5 border border-gray-300 bg-white rounded-lg font-semibold">Taken out by us</button>
                    </>) : (
                      <button onClick={() => fixGap('putin')} className="px-2.5 py-1.5 bg-teal-600 text-white rounded-lg font-semibold">We put it in</button>
                    )}
                    <button onClick={() => fixGap('capital')} className="px-2.5 py-1.5 border border-gray-300 bg-white rounded-lg font-semibold">Typing mistake — capital is {Rs(Math.round(d.expectedCap!))}</button>
                  </div>
                </div>
              )}
              <div className="flex justify-between"><span className="text-gray-600">Capital rotating this month</span><span>{Rs(latest.net_capital)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">+ net profit (gross {M(latest.profit)} − expenses {M(latest.expenses)})</span><span className="text-green-700">{Rs(d.net)}</span></div>
              {latest.capital_added > 0 && <div className="flex justify-between"><span className="text-gray-600">+ your money put in</span><span className="text-amber-700">{Rs(latest.capital_added)}</span></div>}
              {latest.withdrawn > 0 && <div className="flex justify-between"><span className="text-gray-600">− taken out</span><span className="text-red-600">{Rs(latest.withdrawn)}</span></div>}
              {(SAV.dep[latest.month] || 0) > 0 && <div className="flex justify-between"><span className="text-gray-600">− put into savings</span><span className="text-teal-700">{Rs(SAV.dep[latest.month])}</span></div>}
              {(SAV.back[latest.month] || 0) > 0 && <div className="flex justify-between"><span className="text-gray-600">+ back from savings</span><span className="text-teal-700">{Rs(SAV.back[latest.month])}</span></div>}
              <div className="flex justify-between border-t border-gray-200 pt-1 font-semibold"><span>Carries into next month</span><span>{Rs(carried(latest))}</span></div>
            </div>
          </div>

          {/* ---- savings account ---- */}
          <div className={`${card} p-4 mb-4`}>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <div><h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wide">Savings account</h3><p className="text-[11px] text-gray-500 mt-0.5">Money kept outside the business. Put in = profit (or idle capital) moved out to safety. Take from = spent on property, Zakat, personal — or brought back into the business. Your rotating capital is never touched; savings comes out of the profit.</p></div>
              {!savMissing && (
                <div className="flex gap-2">
                  <button onClick={() => setSavForm({ kind: 'deposit', entry_date: monthEnd(latest.month), amount: undefined })} className="px-3 py-1.5 border border-teal-600 text-teal-700 rounded-lg text-xs font-semibold">+ Put into savings</button>
                  <button onClick={() => setSavForm({ kind: 'withdraw', entry_date: monthEnd(latest.month), amount: undefined, purpose: 'property' })} className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-xs font-semibold">− Take from savings</button>
                </div>
              )}
            </div>
            {savMissing ? (
              <p className="text-sm text-amber-700">The savings table is not set up yet — run <b>savings-setup.sql</b> in Supabase once, then refresh.</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div><p className="text-[10px] font-mono uppercase tracking-[0.14em] text-gray-500">Balance</p><p className={`text-2xl font-bold ${savBal < 0 ? 'text-red-600' : 'text-teal-700'}`}>Rs {M(savBal)}</p></div>
                  <div><p className="text-[10px] font-mono uppercase tracking-[0.14em] text-gray-500">Put in (total)</p><p className="text-lg font-semibold text-gray-900">Rs {M(savings.filter((e) => e.kind === 'deposit').reduce((t, e) => t + e.amount, 0))}</p></div>
                  <div><p className="text-[10px] font-mono uppercase tracking-[0.14em] text-gray-500">Taken out (total)</p><p className="text-lg font-semibold text-gray-900">Rs {M(savings.filter((e) => e.kind === 'withdraw').reduce((t, e) => t + e.amount, 0))}</p></div>
                </div>
                {savings.length === 0 ? <p className="text-sm text-gray-400">No entries yet. Use "Record" in the plan, or "+ Move in", when money goes to savings.</p> : (
                  <table className="w-full text-sm">
                    <thead className="text-[10px] text-gray-500 uppercase"><tr><th className="text-left py-1">Date</th><th className="text-left py-1">What</th><th className="text-right py-1">In</th><th className="text-right py-1">Out</th><th className="text-right py-1">Balance</th><th /></tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {(() => { let run = 0; return savings.map((e) => { run += e.kind === 'deposit' ? e.amount : -e.amount; return { e, run }; }); })().reverse().map(({ e, run }) => (
                        <tr key={e.id}>
                          <td className="py-1.5 whitespace-nowrap text-gray-600">{new Date(e.entry_date).toLocaleDateString('en-GB')}</td>
                          <td className="py-1.5">{e.kind === 'deposit' ? 'Moved in' : (PURPOSES.find((pp) => pp[0] === e.purpose)?.[1] ?? 'Taken out')}{e.note ? <span className="text-gray-400"> · {e.note}</span> : null}</td>
                          <td className="py-1.5 text-right text-teal-700">{e.kind === 'deposit' ? n0(e.amount) : ''}</td>
                          <td className="py-1.5 text-right text-red-600">{e.kind === 'withdraw' ? n0(e.amount) : ''}</td>
                          <td className="py-1.5 text-right font-medium">{n0(run)}</td>
                          <td className="py-1.5 text-right"><button onClick={() => removeSav(e)} className="p-1 text-gray-300 hover:text-red-600" title="Delete entry"><Trash2 className="w-3.5 h-3.5" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>

          {/* ---- decision ---- */}
          <div className={`${card} p-4 mb-4`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wide">Decision — {mlong(latest.month)}</h3>
              <button onClick={() => setEdit({ ...latest })} className="text-xs text-teal-700 hover:underline flex items-center gap-1"><Pencil className="w-3 h-3" />edit</button>
            </div>
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{latest.note || <span className="text-gray-400">No note yet — what did the meeting decide?</span>}</p>
            {idx > 0 && rows[idx - 1].note && (
              <div className="mt-3 pt-3 border-t border-gray-100 text-sm">
                <p className="text-xs text-gray-500">Last month you decided:</p>
                <p className="text-gray-700">{rows[idx - 1].note}</p>
                <p className="text-xs text-gray-500 mt-1">Did it work? {latest.outcome || <span className="text-gray-400">not filled in</span>}</p>
              </div>
            )}
          </div>

          {/* ---- table ---- */}
          <div className={`${card} overflow-x-auto`}>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr><th className="text-left px-3 py-2">Month</th><th className="text-right px-3 py-2">Capital</th><th className="text-right px-3 py-2">Gross</th><th className="text-right px-3 py-2">Expenses</th><th className="text-right px-3 py-2">Net</th><th className="text-right px-3 py-2">Return</th><th className="text-right px-3 py-2">Put in</th><th className="text-right px-3 py-2">Taken out</th><th className="text-right px-3 py-2">Zakat / charity</th><th className="px-2 py-2 w-24"></th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => ({ r, i })).reverse().map(({ r, i }) => { const x = derive(rows, i, cfg); return (
                  <tr key={r.id} className={`hover:bg-gray-50 ${r.closed ? 'text-gray-500' : ''} ${r.month === latest.month ? 'bg-teal-50/60' : ''}`}>
                    <td className="px-3 py-2 font-medium whitespace-nowrap"><button onClick={() => { setViewMonth(r.month); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="text-teal-700 hover:underline">{ml(r.month)}</button></td>
                    <td className="px-3 py-2 text-right font-semibold">{n0(r.net_capital)}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{n0(r.profit)}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{n0(r.expenses)}</td>
                    <td className="px-3 py-2 text-right text-green-700 font-medium">{n0(x.net)}</td>
                    <td className="px-3 py-2 text-right">{p1(x.roc)}</td>
                    <td className="px-3 py-2 text-right text-amber-700">{r.capital_added ? n0(r.capital_added) : ''}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{r.withdrawn ? n0(r.withdrawn) : ''}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{(() => { const pl = planOf(rows, i, cfg); return pl.give > 0 ? n0(pl.give) : '—'; })()}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      <button onClick={() => setEdit({ ...r })} className="p-1 text-gray-400 hover:text-teal-700" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => toggleClose(r)} className="p-1 text-gray-400 hover:text-gray-900" title={r.closed ? 'Reopen' : 'Close month'}>{r.closed ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}</button>
                      {!r.closed && <button onClick={() => remove(r)} className="p-1 text-gray-400 hover:text-red-600" title="Delete month"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </td>
                  </tr>); })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ---- entry form ---- */}
      {edit && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEdit(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-lg shadow-xl w-full max-w-xl max-h-[92vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">{edit.id ? 'Edit' : 'Enter'} month</h3><button onClick={() => setEdit(null)} className="p-1 text-gray-400"><X className="w-5 h-5" /></button></div>
            {edit.closed && <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 mb-3">This month is closed. Reopen it from the table if you really need to change figures.</p>}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500">Month</label><input type="month" className={input} value={edit.month ?? ''} onChange={(e) => setEdit({ ...edit, month: e.target.value })} disabled={!!edit.id} /></div>
              <div><label className="text-xs text-gray-500">Working capital — money rotating this month, before profit (Rs)</label><input type="number" inputMode="decimal" className={input} value={(edit.net_capital as number) || ''} onChange={(e) => setEdit({ ...edit, net_capital: e.target.value as unknown as number })} disabled={!!edit.closed} />{(() => { const pi = rows.findIndex((r) => r.month >= (edit.month || '')) ; const pr = pi === -1 ? rows[rows.length - 1] : rows[pi - 1]; return pr && pr.month < (edit.month || '') ? <p className="text-[11px] text-gray-500 mt-1">{ml(pr.month)} carried {Rs(Math.round(carried(pr)))} — use that unless money left or came in.</p> : null; })()}</div>
              <div><label className="text-xs text-gray-500">Gross profit — before expenses (Rs)</label><input type="number" inputMode="decimal" className={input} value={(edit.profit as number) || ''} onChange={(e) => setEdit({ ...edit, profit: e.target.value as unknown as number })} disabled={!!edit.closed} /></div>
              <div><label className="text-xs text-gray-500">Expenses (Rs)</label><input type="number" inputMode="decimal" className={input} value={(edit.expenses as number) || ''} onChange={(e) => setEdit({ ...edit, expenses: e.target.value as unknown as number })} disabled={!!edit.closed} /></div>
              <div className="col-span-2 text-sm bg-gray-50 border border-gray-200 px-3 py-2 flex justify-between"><span className="text-gray-600">Net profit (calculated)</span><b className="text-green-700">{Rs((Number(edit.profit) || 0) - (Number(edit.expenses) || 0))}</b></div>
              <div className="col-span-2 text-[11px] text-gray-500 pt-1 border-t border-gray-100">Only if money moved between you and the business this month — otherwise leave empty.</div>
              <div><label className="text-xs text-gray-500">Money put in (Rs)</label><input type="number" inputMode="decimal" className={input} value={(edit.capital_added as number) || ''} onChange={(e) => setEdit({ ...edit, capital_added: e.target.value as unknown as number })} disabled={!!edit.closed} /></div>
              <div><label className="text-xs text-gray-500">Money taken out (Rs)</label><input type="number" inputMode="decimal" className={input} value={(edit.withdrawn as number) || ''} onChange={(e) => setEdit({ ...edit, withdrawn: e.target.value as unknown as number })} disabled={!!edit.closed} /></div>
              <div className="col-span-2"><label className="text-xs text-gray-500">Decision — what the meeting agreed</label><textarea rows={2} className={input} value={edit.note ?? ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></div>
              <div className="col-span-2"><label className="text-xs text-gray-500">Did last month's decision work? (fill in the following month)</label><input className={input} value={edit.outcome ?? ''} onChange={(e) => setEdit({ ...edit, outcome: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEdit(null)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">Cancel</button>
              <button onClick={save} className="px-4 py-1.5 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1"><CheckIcon className="w-4 h-4" />Save</button>
            </div>
          </div>
        </div>
      )}

      {savForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSavForm(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5">
            <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">{savForm.kind === 'deposit' ? 'Put money into savings' : 'Take money from savings'}</h3><button onClick={() => setSavForm(null)} className="p-1 text-gray-400"><X className="w-5 h-5" /></button></div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setSavForm({ ...savForm, kind: 'deposit' })} className={`py-1.5 text-xs font-semibold border ${savForm.kind === 'deposit' ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-gray-300 text-gray-500'}`}>Put in</button>
                <button onClick={() => setSavForm({ ...savForm, kind: 'withdraw', purpose: savForm.purpose || 'property' })} className={`py-1.5 text-xs font-semibold border ${savForm.kind === 'withdraw' ? 'border-gray-800 bg-gray-50 text-gray-900' : 'border-gray-300 text-gray-500'}`}>Take out</button>
              </div>
              <div><label className="text-xs text-gray-500">Date</label><input type="date" className={input} value={savForm.entry_date ?? ''} onChange={(e) => setSavForm({ ...savForm, entry_date: e.target.value })} />
                {savForm.entry_date && <p className="text-[11px] text-gray-500 mt-1">Counts in <b>{mlong(savForm.entry_date.slice(0, 7))}</b>. {savForm.kind === 'deposit' ? 'Comes out of that month\'s profit, so less carries into the next month.' : savForm.purpose === 'business' ? 'Goes back into the business, so more carries into the next month.' : 'Spent from savings — the business is not affected.'}</p>}</div>
              <div><label className="text-xs text-gray-500">Amount (Rs)</label><input type="number" inputMode="decimal" className={input} value={savForm.amount ?? ''} onChange={(e) => setSavForm({ ...savForm, amount: e.target.value as unknown as number })} /></div>
              {savForm.kind === 'withdraw' && (
                <div><label className="text-xs text-gray-500">Where it goes</label>
                  <select className={input} value={savForm.purpose ?? 'property'} onChange={(e) => setSavForm({ ...savForm, purpose: e.target.value })}>
                    {PURPOSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  {savForm.purpose === 'business' && <p className="text-[11px] text-gray-500 mt-1">Counted as money going back into the business for that month's capital check.</p>}
                </div>
              )}
              <div><label className="text-xs text-gray-500">Note (optional)</label><input className={input} value={savForm.note ?? ''} onChange={(e) => setSavForm({ ...savForm, note: e.target.value })} /></div>
              {savForm.kind === 'withdraw' && <p className={`text-xs ${Number(savForm.amount) > savBal ? 'text-red-600' : 'text-gray-500'}`}>Savings balance: {Rs(savBal)}{Number(savForm.amount) > savBal ? ' — not enough' : ''}</p>}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setSavForm(null)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">Cancel</button>
              <button onClick={saveSav} className="px-4 py-1.5 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1"><CheckIcon className="w-4 h-4" />Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- giving settings ---- */}
      {cfgOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setCfgOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-1">Mentor settings</h3>
            <p className="text-xs text-gray-500 mb-3">Giving is always from the month's net profit — never from the capital. Keep-in or move-to-savings is decided by how hard the money is working each month.</p>
            <div className="space-y-3">
              <div><label className="text-xs text-gray-500">Giving % in the very best months (top of the scale)</label><input type="number" step="0.1" className={input} value={cfg.max} onChange={(e) => saveCfg({ ...cfg, max: Number(e.target.value) || 0 })} />
                <p className="text-[11px] text-gray-400 mt-1">Each month slides from 0% up to this, in 0.1% steps, depending on how strong the month is.</p></div>
              <div><label className="text-xs text-gray-500">Target stretch % in the very best months</label><input type="number" step="0.1" className={input} value={cfg.stretch} onChange={(e) => saveCfg({ ...cfg, stretch: Number(e.target.value) || 0 })} />
                <p className="text-[11px] text-gray-400 mt-1">Next month's target sits 0.1% to this much above your 3-month average, depending on how well you are doing. Held after a quiet month.</p></div>
            </div>
            <div className="flex justify-end mt-4"><button onClick={() => setCfgOpen(false)} className="px-4 py-1.5 bg-teal-600 text-white rounded-lg text-sm">Done</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
