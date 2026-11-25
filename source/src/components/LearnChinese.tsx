import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import TalkChinese from './TalkChinese';
import AskChinese from './AskChinese';
import ShortcutsChinese from './ShortcutsChinese';
import { ArrowLeft, Check, Lock, Mic, RotateCcw, Volume2, X } from 'lucide-react';

/* Learn Chinese (Tools). The ONLY data source is /chinese_lessons.json (shown as it is, never rewritten).
   Progress and scores live in this browser (localStorage). */

interface W { pinyin: string; chinese?: string; meaning: string }
interface Lesson {
  number: number; title: string; subtitle?: string; words: W[]; extraWords?: W[]; pattern?: string; notes?: string[];
  buildSteps?: W[]; sentenceBuilder?: { column: string; options: string[] }[]; examples?: W[];
  conversation?: { speaker: string; pinyin: string; meaning: string; chinese?: string }[];
  quizzes?: {
    meaning?: { prompt: string; chinese?: string; answer: string }[];
    fillGap?: { prompt: string; hint: string; answer: string }[];
    wordOrder?: { words: string[]; hint: string; answer: string }[];
    translate?: { prompt: string; answer: string }[];
  };
}
type Sec = Record<string, [number, number]>;
interface Prog { best: number; passed: boolean; tries: number; last: string; sec?: Sec; hist?: number[] }
type Kind = 'meaning' | 'fillGap' | 'wordOrder' | 'translate' | 'listen' | 'speak' | 'tone';
type Q = { kind: Kind; title: string; ask: string; sub?: string; answer: string; words?: string[]; chinese?: string; n?: number; card?: string; opts?: string[]; mean?: string };
type Mode = 'lesson' | 'mistakes' | 'review' | 'listen' | 'speak' | 'tone';
const MKEY = 'learn-chinese-mistakes-v1';
const qid = (q: Q) => `${q.n}|${q.kind}|${q.ask}|${q.answer}`;
const loadMist = (): Q[] => { try { return JSON.parse(localStorage.getItem(MKEY) || '[]'); } catch { return []; } };
const saveMist = (m: Q[]) => { try { localStorage.setItem(MKEY, JSON.stringify(m)); } catch { /* ignore */ } };
const SECNAME: Record<string, string> = { meaning: 'Meaning', fillGap: 'Fill the gap', wordOrder: 'Word order', translate: 'Translate' };
const ALLNAME: Record<string, string> = { ...SECNAME, listen: 'Listening', speak: 'Speaking', tone: 'Tones' };
const MODENAME: Record<Mode, string> = { lesson: 'Lesson quiz', mistakes: 'Practice my mistakes', review: 'Daily review', listen: 'Listening practice', speak: 'Speaking practice', tone: 'Tone practice' };
const KEY = 'learn-chinese-progress-v1';
/* Daily review (spaced repetition): each word / sentence sits in a box; right = next box (comes back later), wrong = back to the start. */
const RKEY = 'learn-chinese-resume-v1';
/* one half-done quiz is kept PER LESSON (one shared slot meant that opening another lesson's quiz wiped it) */
const rKey = (n: number) => `${RKEY}:${n}`;
const SKEY = 'learn-chinese-srs-v1', DKEY = 'learn-chinese-days-v1', XKEY = 'learn-chinese-extra-v1';
const GAP = [0, 1, 2, 4, 8, 16, 32];
const dayStr = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return dayStr(d); };
const loadJ = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) || '') as T; } catch { return d; } };
const saveJ = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
/* Tones: read the tone from the mark on the vowel; make three wrong choices by changing that mark. */
const TONE: Record<string, string> = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', 'ü': 'ǖǘǚǜ' };
const TONETXT = ['1st tone: high and flat', '2nd tone: rises, like asking “what?”', '3rd tone: dips low, then rises', '4th tone: falls sharply, like a command'];
const toneAt = (p: string): { i: number; base: string; t: number } | null => { for (let i = 0; i < p.length; i++) for (const [b, set] of Object.entries(TONE)) { const t = set.indexOf(p[i]); if (t >= 0) return { i, base: b, t }; } return null; };
const toneless = (p: string) => p.normalize('NFD').replace(/[\u0300\u0301\u0304\u030c]/g, '').normalize('NFC');
const hanOnly = (t: string) => t.replace(/[^\u4e00-\u9fff]/g, '').replace(/[她它]/g, '他');
const PASS = 80;

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const fixP = (p: Record<number, Prog>) => { Object.values(p || {}).forEach((x) => { if (x && (x.best >= PASS || (x.best >= 75 && String(x.last) < '2026-11-22'))) x.passed = true; /* 75+ earned under the old strict marking counts */ }); return p || {}; };
const loadProg = (): Record<number, Prog> => { try { return fixP(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return {}; } };
const saveProg = (p: Record<number, Prog>) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ } };

/* Compare the typed pinyin with the right answer word by word, and say in plain words where it went wrong. */
function explain(user: string, answer: string, meaningOf: Map<string, string>): { notes: string[]; marks: { w: string; ok: boolean }[] } {
  const toks = (t: string) => t.trim().split(/\s+/).filter((w) => norm(w));
  const U = toks(user), A = toks(answer); const un = U.map(norm), an = A.map(norm);
  const mean = (w: string) => { const m = meaningOf.get(norm(w)); return m ? ` (${w.replace(/[?.,!]/g, '')} = ${m})` : ''; };
  const show = (w: string) => `“${w.replace(/[?.,!]/g, '')}”`;
  const L: number[][] = Array.from({ length: U.length + 1 }, () => new Array(A.length + 1).fill(0));
  for (let i = U.length - 1; i >= 0; i--) for (let j = A.length - 1; j >= 0; j--) L[i][j] = un[i] === an[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const marks = A.map((w) => ({ w, ok: false })); const notes: string[] = [];
  if (!U.length) return { notes: ['You did not type an answer.'], marks };
  if ([...un].sort().join(' ') === [...an].sort().join(' ')) {
    A.forEach((_, j) => { marks[j].ok = un[j] === an[j]; });
    return { notes: ['You used the right words, but in the wrong order. Look at the order below.'], marks };
  }
  let i = 0, j = 0; let bu: string[] = [], ba: string[] = [];
  const flush = () => {
    const n = Math.min(bu.length, ba.length);
    for (let k = 0; k < n; k++) notes.push(`You wrote ${show(bu[k])}, but it should be ${show(ba[k])}${mean(ba[k])}.`);
    for (let k = n; k < ba.length; k++) notes.push(`You left out ${show(ba[k])}${mean(ba[k])}.`);
    for (let k = n; k < bu.length; k++) notes.push(`${show(bu[k])} does not belong in this sentence.`);
    bu = []; ba = [];
  };
  while (i < U.length || j < A.length) {
    if (i < U.length && j < A.length && un[i] === an[j]) { flush(); marks[j].ok = true; i++; j++; }
    else if (j < A.length && (i >= U.length || L[i][j + 1] >= L[i + 1][j])) { ba.push(A[j]); j++; }
    else { bu.push(U[i]); i++; }
  }
  flush();
  return { notes, marks };
}

/* Lenient English compare for the meaning quiz: small grammar slips (he have / he has, a / the, don't / do not) still count. */
const ENG: Record<string, string> = { has: 'have', had: 'have', is: 'be', are: 'be', am: 'be', was: 'be', were: 'be', does: 'do', did: 'do', goods: 'stock', stocks: 'stock', cant: 'can not', cannot: 'can not', wont: 'will not', dont: 'do not', doesnt: 'do not', didnt: 'do not', isnt: 'be not', arent: 'be not', havent: 'have not', hasnt: 'have not', id: 'i would', ill: 'i will', im: 'i be', its: 'it be', whats: 'what be', ok: 'okay', yuan: 'rmb', him: 'he', me: 'i', them: 'they', us: 'we', she: 'he', her: 'he', no: 'not', nothing: 'not' };
const engNorm = (t: string) => t.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[’']/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  .map((w) => ENG[w] ?? w).join(' ').split(' ').filter((w) => !['a', 'an', 'the'].includes(w)).map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');

const FILL = ['it', 'to', 'there', 'will', 'going'];
const engToks = (t: string) => t.replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean).flatMap((o) => engNorm(o).split(' ').filter(Boolean).map((n) => ({ o: o.replace(/[^A-Za-z0-9’']/g, ''), n }))).filter((x) => !FILL.includes(x.n));
/* Meaning quiz: marked by the system. Right when the same idea words are there; otherwise say which ideas are missing or do not fit. */
function checkMeaning(user: string, answer: string, prompt = '', meaningOf?: Map<string, string>): { ok: boolean; notes: string[] } {
  const U = engToks(user), A = engToks(answer);
  // a one-word prompt may be answered with its word-list meaning ("yǒu" -> "have")
  const wm = meaningOf?.get(norm(prompt));
  if (wm && U.length && wm.replace(/\([^)]*\)/g, '').split(',').some((alt) => engNorm(alt) === engNorm(user))) return { ok: true, notes: [] };
  // helper words the Chinese does not carry: "do" in questions, "yes"; "I" when the Chinese has no wǒ; "no" when "not" is there
  const soft = ['do', 'yes']; if (!/\bwo(men)?\b/.test(prompt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())) soft.push('i');
  const miss = A.filter((a) => !U.some((u) => u.n === a.n) && !soft.includes(a.n)), extra = U.filter((u) => !A.some((a) => a.n === u.n) && !soft.includes(u.n));
  if (!miss.length && !extra.length && U.length) return { ok: true, notes: [] };
  const uniq = (x: { o: string }[]) => [...new Set(x.map((y) => `“${y.o}”`))].join(', ');
  const notes: string[] = [];
  if (!U.length) notes.push('You did not type an answer.');
  if (extra.length) notes.push(`You wrote ${uniq(extra)}, which is not in this sentence.`);
  if (miss.length) notes.push(`Your answer is missing ${uniq(miss)}.`);
  return { ok: false, notes };
}
/* Word-by-word meaning of a pinyin sentence, from the lesson word lists (two-word entries like "shénme shíhou" first). */
function breakdown(sentence: string, meaningOf: Map<string, string>): { w: string; m: string }[] {
  const T = sentence.replace(/_+/g, ' ').split(/\s+/).map((w) => w.replace(/[?.,!]/g, '')).filter(Boolean); const out: { w: string; m: string }[] = [];
  for (let i = 0; i < T.length; i++) {
    const two = i + 1 < T.length ? meaningOf.get(norm(T[i] + T[i + 1])) : undefined;
    if (two && !meaningOf.get(norm(T[i]))) { out.push({ w: T[i] + ' ' + T[i + 1], m: two }); i++; continue; }
    const m = meaningOf.get(norm(T[i])); if (m) out.push({ w: T[i], m });
  }
  return out;
}

function speak(text: string) {
  try {
    const synth = window.speechSynthesis; if (!synth) { alert('This browser has no speech. Try Chrome or Safari.'); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-CN'; u.rate = 0.85;
    const v = synth.getVoices().find((x) => /^zh[-_]CN/i.test(x.lang)) || synth.getVoices().find((x) => /^zh/i.test(x.lang));
    if (v) u.voice = v;
    synth.speak(u);
  } catch { /* ignore */ }
}
const Spk = ({ text }: { text?: string }) => text ? (
  <button onClick={() => speak(text)} aria-label="Listen" className="shrink-0 w-9 h-9 rounded-full border border-[#111] flex items-center justify-center hover:bg-[#111] hover:text-white"><Volume2 className="w-4 h-4" /></button>
) : null;
const Rich = ({ t }: { t: string }) => <>{t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith('**') ? <b key={i} className="text-[#e8552a]">{p.slice(2, -2)}</b> : <span key={i}>{p}</span>)}</>;
const H = ({ children }: { children: React.ReactNode }) => <h2 className="font-mono text-[11px] tracking-[0.14em] uppercase text-neutral-600 font-semibold mt-7 mb-2">{children}</h2>;

export default function LearnChinese() {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [err, setErr] = useState('');
  const [prog, setProg] = useState<Record<number, Prog>>(loadProg);
  const [route, setRoute] = useState<{ page: 'home' | 'lesson' | 'quiz' | 'progress' | 'talk' | 'shortcuts'; n: number }>({ page: 'home', n: 1 });
  const [attempt, setAttempt] = useState(0);
  const [mist, setMist] = useState<Q[]>(loadMist);
  const [mode, setMode] = useState<Mode>('lesson');
  const [preset, setPreset] = useState<Q[] | undefined>(undefined);
  const [srs, setSrs] = useState<Record<string, { box: number; due: string }>>(() => loadJ(SKEY, {}));
  const [days, setDays] = useState<Record<string, number>>(() => loadJ(DKEY, {}));
  const [openL, setOpenL] = useState<number[]>(() => loadJ('learn-chinese-unlocked-v1', []));   // lessons he opened by hand
  const [goal, setGoal] = useState<number>(() => loadJ('learn-chinese-goal-v1', 40));
  const [extra, setExtra] = useState<Record<number, Record<string, number>>>(() => loadJ(XKEY, {}));
  const practice = mode !== 'lesson';
  /* Database copy (table learn_chinese_progress, one row per login): newest copy wins when the page opens, then every change is saved. */
  const [cloud, setCloud] = useState<'wait' | 'on' | 'off'>('wait');
  const uid = useRef<string | null>(null); const skip = useRef(true); const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession(); uid.current = sess.session?.user?.id || null;
        if (!uid.current) { setCloud('off'); return; }
        const { data, error } = await supabase.from('learn_chinese_progress').select('data').eq('user_id', uid.current).maybeSingle();
        if (error) { setCloud('off'); return; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r: any = data?.data; const mine = Number(loadJ('learn-chinese-stamp-v1', 0));
        if (r && r.stamp && r.stamp > mine) {
          skip.current = true;
          setProg(fixP(r.prog)); saveProg(fixP(r.prog)); setMist(r.mist || []); saveMist(r.mist || []); setSrs(r.srs || {}); saveJ(SKEY, r.srs || {});
          setDays(r.days || {}); saveJ(DKEY, r.days || {}); setExtra(r.extra || {}); saveJ(XKEY, r.extra || {}); if (r.goal) { setGoal(r.goal); saveJ('learn-chinese-goal-v1', r.goal); } if (Array.isArray(r.open)) { setOpenL(r.open); saveJ('learn-chinese-unlocked-v1', r.open); }
          saveJ('learn-chinese-stamp-v1', r.stamp);
        } else if (mine || Object.keys(loadProg()).length) { skip.current = false; }
        setCloud('on');
      } catch { setCloud('off'); }
    })();
  }, []);
  useEffect(() => {
    if (cloud !== 'on' || !uid.current) return;
    if (skip.current) { skip.current = false; return; }
    const stamp = Date.now(); saveJ('learn-chinese-stamp-v1', stamp);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const { error } = await supabase.from('learn_chinese_progress').upsert({ user_id: uid.current, data: { prog, mist, srs, days, extra, goal, open: openL, stamp }, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) setCloud('off');
    }, 1200);
  }, [cloud, prog, mist, srs, days, extra, goal, openL]); // eslint-disable-line

  useEffect(() => {
    fetch('/chinese_lessons.json').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => {
        (d.lessons as Lesson[]).forEach((l) => [...l.words, ...(l.extraWords || [])].forEach((w) => {
          const alts = w.meaning.replace(/\([^)]*\)/g, '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => /^[a-z]+$/.test(x));
          if (alts.length > 1) { const c = ENG[alts[0]] ?? alts[0]; alts.slice(1).forEach((a) => { if (!(a in ENG) && a !== c) ENG[a] = c; }); }
        }));
        setLessons(d.lessons);
      }).catch((e) => setErr('Could not load the lessons file: ' + e.message));
    try { window.speechSynthesis?.getVoices(); } catch { /* ignore */ }
  }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [route]);

  const chineseOf = useMemo(() => {
    const m = new Map<string, string>();
    (lessons || []).forEach((l) => {
      [...l.words, ...(l.extraWords || []), ...(l.examples || []), ...(l.quizzes?.meaning || []).map((q) => ({ pinyin: q.prompt, chinese: q.chinese, meaning: '' }))]
        .forEach((x) => { if (x.chinese) m.set(norm(x.pinyin), x.chinese); });
    });
    return m;
  }, [lessons]);

  const meaningOf = useMemo(() => {
    const m = new Map<string, string>();
    (lessons || []).forEach((l) => [...l.words, ...(l.extraWords || [])].forEach((w) => { if (!m.has(norm(w.pinyin))) m.set(norm(w.pinyin), w.meaning); }));
    return m;
  }, [lessons]);

  /* every pinyin word of the course with its tone marks and the first lesson it appears in: the quiz offers these while he types */
  const bank = useMemo(() => {
    const m = new Map<string, { t: string; n: number }>();
    (lessons || []).forEach((l) => [...l.words, ...(l.extraWords || []), ...(l.examples || []), ...(l.buildSteps || [])].forEach((w) => w.pinyin.split(/[\s,]+/).forEach((raw) => { const t = raw.replace(/[?.!，。？！]/g, ''); const k = t.toLowerCase(); if (t && norm(t) && !m.has(k)) m.set(k, { t, n: l.number }); })));
    return [...m.values()];
  }, [lessons]);

  /* English words of the lessons' meanings: offered while he types in the Meaning quiz */
  const engBank = useMemo(() => {
    const m = new Map<string, { t: string; n: number }>();
    (lessons || []).forEach((l) => [...l.words, ...(l.extraWords || []), ...(l.examples || []), ...(l.quizzes?.meaning || []).map((q) => ({ meaning: q.answer }))].forEach((w) => (w.meaning.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || []).forEach((t) => { if (!m.has(t)) m.set(t, { t, n: l.number }); })));
    return [...m.values()];
  }, [lessons]);

  if (err) return <div className="p-4 text-red-700">{err}</div>;
  if (!lessons) return <div className="p-4 text-neutral-600">Loading…</div>;
  const unlocked = (n: number) => n === 1 || !!prog[n - 1]?.passed || openL.includes(n);
  const unlockByHand = (n: number) => { if (!confirm(`Open Lesson ${n} now, without passing Lesson ${n - 1}?`)) return; const nx = [...new Set([...openL, n])]; setOpenL(nx); saveJ('learn-chinese-unlocked-v1', nx); };
  const lesson = lessons.find((l) => l.number === route.n) || lessons[0];
  const go = (page: 'home' | 'lesson' | 'quiz' | 'progress' | 'talk' | 'shortcuts', n = route.n) => { if (page === 'quiz') setAttempt((a) => a + 1); setMode('lesson'); setPreset(undefined); setRoute({ page, n }); };

  const finish = (n: number, pct: number, sec: Sec, missed: Q[], got: Q[]) => {
    const gotIds = new Set(got.map(qid));
    const m = [...mist.filter((x) => !gotIds.has(qid(x))), ...missed.filter((x) => !mist.some((y) => qid(y) === qid(x)))];
    if (mode === 'review') {
      const nx = { ...srs };
      got.forEach((q) => { if (q.card) { const b = Math.min((nx[q.card]?.box || 0) + 1, GAP.length - 1); nx[q.card] = { box: b, due: addDays(GAP[b]) }; } });
      missed.forEach((q) => { if (q.card) nx[q.card] = { box: 0, due: dayStr() }; });
      setSrs(nx); saveJ(SKEY, nx); return;
    }
    if (mode === 'listen' || mode === 'speak' || mode === 'tone') {
      const nx = { ...extra, [n]: { ...(extra[n] || {}), [mode]: Math.max(extra[n]?.[mode] || 0, pct) } };
      setExtra(nx); saveJ(XKEY, nx); return;
    }
    setMist(m); saveMist(m);
    if (mode === 'mistakes') return;
    const old = prog[n];
    const next = { ...prog, [n]: { best: Math.max(old?.best || 0, pct), passed: !!old?.passed || pct >= PASS, tries: (old?.tries || 0) + 1, last: new Date().toISOString(), sec, hist: [...(old?.hist || []), pct].slice(-10) } };
    setProg(next); saveProg(next);
  };
  const doneN = lessons.filter((l) => prog[l.number]?.passed).length;
  const scored = lessons.filter((l) => prog[l.number]);
  const avg = scored.length ? Math.round(scored.reduce((a, l) => a + prog[l.number].best, 0) / scored.length) : 0;
  const secTot: Sec = {};
  scored.forEach((l) => Object.entries(prog[l.number].sec || {}).forEach(([k, [c, t]]) => { const o = secTot[k] || [0, 0]; secTot[k] = [o[0] + c, o[1] + t]; }));
  const start = (m: Mode, qs: Q[], n = 0) => { if (!qs.length) { alert('Nothing to practise here yet.'); return; } setMode(m); setPreset(qs); setAttempt((a) => a + 1); setRoute({ page: 'quiz', n }); };
  const startPractice = () => start('mistakes', mist);
  const bump = () => { const t = dayStr(); setDays((d) => { const nx = { ...d, [t]: (d[t] || 0) + 1 }; saveJ(DKEY, nx); return nx; }); };
  let streak = 0; { const d = new Date(); if (!days[dayStr(d)]) d.setDate(d.getDate() - 1); while (days[dayStr(d)]) { streak++; d.setDate(d.getDate() - 1); } }
  // daily review cards: words and example sentences of every lesson whose quiz has been tried
  const cards: Q[] = lessons.filter((l) => prog[l.number]).flatMap((l) => [
    ...[...l.words, ...(l.extraWords || [])].map((w) => ({ t: 'w', w })), ...(l.examples || []).map((w) => ({ t: 'e', w })),
  ].map(({ t, w }) => ({ kind: 'translate' as Kind, title: 'Daily review', n: l.number, card: `${l.number}|${t}|${w.pinyin}`, ask: w.meaning, sub: 'Type it in pinyin (tone marks not needed)', answer: w.pinyin, chinese: w.chinese })));
  const today = dayStr();
  const dueCards = cards.filter((c) => !srs[c.card!] || srs[c.card!].due <= today);
  const known = cards.filter((c) => (srs[c.card!]?.box || 0) >= 3).length;
  const reviewSet = () => shuffle([...shuffle(dueCards.filter((c) => srs[c.card!])), ...dueCards.filter((c) => !srs[c.card!])].slice(0, 20));
  // ---- progress figures
  const mastery = Math.round(lessons.reduce((a, l) => a + (prog[l.number]?.best || 0), 0) / lessons.length);
  const LEVELS = ['Starter', 'Trader basics', 'Negotiator', 'Deal maker', 'Business speaker'];
  const level = LEVELS[doneN >= lessons.length ? 4 : Math.min(3, Math.floor(doneN / 4))];
  const toNext = doneN >= lessons.length ? 0 : (Math.floor(doneN / 4) + 1) * 4 - doneN;
  const todayN = days[today] || 0;
  const dayKeys = Object.keys(days).sort();
  let bestStreak = 0; { let run = 0; let prev = ''; dayKeys.forEach((k) => { const d = new Date(prev + 'T00:00:00'); d.setDate(d.getDate() + 1); run = prev && dayStr(d) === k ? run + 1 : 1; bestStreak = Math.max(bestStreak, run); prev = k; }); }
  const totalAns = dayKeys.reduce((a, k) => a + days[k], 0);
  const last14 = Array.from({ length: 14 }, (_, k) => { const d = new Date(); d.setDate(d.getDate() - (13 - k)); return { k: dayStr(d), n: days[dayStr(d)] || 0, lab: d.getDate() }; });
  const max14 = Math.max(goal, ...last14.map((x) => x.n));
  const exAvg = (m: string) => { const v = Object.values(extra).map((x) => x[m]).filter((x) => x !== undefined); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const skills: [string, number | null][] = [...Object.entries(SECNAME).map(([k, nm]) => [nm, secTot[k] && secTot[k][1] ? Math.round((secTot[k][0] / secTot[k][1]) * 100) : null] as [string, number | null]), ['Listening', exAvg('listen')], ['Speaking', exAvg('speak')], ['Tones', exAvg('tone')]];
  const tried = skills.filter((x) => x[1] !== null) as [string, number][];
  const weakSkill = tried.length ? [...tried].sort((a, b) => a[1] - b[1])[0] : null;
  const mem = { fresh: cards.filter((c) => !srs[c.card!]).length, learning: cards.filter((c) => srs[c.card!] && srs[c.card!].box < 3).length, known };
  const weakLesson = [...scored].sort((a, b) => prog[a.number].best - prog[b.number].best)[0];
  const changeGoal = (d: number) => { const g = Math.max(10, Math.min(200, goal + d)); setGoal(g); saveJ('learn-chinese-goal-v1', g); };
  const progressText = () => [`*My Chinese progress* — ${level}`, `Lessons passed: ${doneN} of ${lessons.length} · course mastery ${mastery}%`, `Streak: ${streak} days (best ${bestStreak}) · days studied ${dayKeys.length} · answers ${totalAns}`, `Today: ${todayN} of ${goal} answers`, `Memory: ${mem.known} known well, ${mem.learning} learning, ${mem.fresh} new`, '', '*Skills*', ...skills.map(([n, v]) => `${n}: ${v === null ? 'not tried' : v + '%'}`), '', '*Lessons*', ...lessons.filter((l) => prog[l.number]).map((l) => `${l.number}. ${l.title}: best ${prog[l.number].best}% (${prog[l.number].tries} tries)${prog[l.number].passed ? ' passed' : ''}`)].join('\n');
  const copyProgress = async () => { try { await navigator.clipboard.writeText(progressText()); alert('Progress copied. Paste it in WhatsApp.'); } catch { alert(progressText()); } };
  const resetAll = () => { if (!confirm('Delete ALL Learn Chinese progress on this device? Marks, review, mistakes and streak will be gone.')) return; if (!confirm('Are you sure? This cannot be undone.')) return; ['learn-chinese-unlocked-v1', KEY, MKEY, SKEY, DKEY, XKEY, RKEY, ...lessons.map((l) => rKey(l.number))].forEach((k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } }); setProg({}); setMist([]); setSrs({}); setDays({}); setExtra({}); setOpenL([]); go('home'); };
  const Bar = ({ v, color = 'bg-green-600' }: { v: number; color?: string }) => <div className="h-2.5 bg-[#f4f3f1] rounded"><div className={`h-full rounded ${color}`} style={{ width: `${Math.max(0, Math.min(100, v))}%` }} /></div>;
  const nextLesson = lessons.find((l) => !prog[l.number]?.passed);
  const listenQs = (l: Lesson): Q[] => shuffle((l.examples || []).filter((e) => e.chinese)).slice(0, 10).map((e) => ({ kind: 'listen', title: 'Listening practice', n: l.number, ask: 'Listen, then type what you hear', sub: 'Type it in pinyin (tone marks not needed)', answer: e.pinyin, chinese: e.chinese, mean: e.meaning }));
  const speakQs = (l: Lesson): Q[] => shuffle((l.examples || []).filter((e) => e.chinese)).slice(0, 8).map((e) => ({ kind: 'speak', title: 'Speaking practice', n: l.number, ask: e.pinyin, sub: e.meaning, answer: e.pinyin, chinese: e.chinese, mean: e.meaning }));
  const toneQs = (l: Lesson): Q[] => shuffle([...l.words, ...(l.extraWords || [])].filter((w) => !w.pinyin.includes(',') && toneAt(w.pinyin))).slice(0, 12).map((w) => {
    const at = toneAt(w.pinyin)!; const opts = shuffle([0, 1, 2, 3].map((t) => w.pinyin.slice(0, at.i) + TONE[at.base][t] + w.pinyin.slice(at.i + 1)));
    return { kind: 'tone', title: 'Tone practice', n: l.number, ask: `${toneless(w.pinyin)} — ${w.meaning}`, sub: 'Listen, then pick the right tone', answer: w.pinyin, chinese: w.chinese, opts, mean: w.meaning };
  });

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-6 text-[#111]">
      {route.page === 'home' && (
        <>
          <h1 className="text-2xl font-bold">Learn Chinese</h1>
          <p className="text-neutral-600 text-sm mb-1">16 lessons. Score {PASS}% or more in a lesson's quiz to open the next one.</p>
          <p className={`text-xs mb-3 ${cloud === 'off' ? 'text-red-700' : 'text-neutral-500'}`}>{cloud === 'on' ? 'Progress is saved to your account — it follows you to any phone or computer.' : cloud === 'off' ? 'Progress is saved on this device only (the database table is not there yet, or no connection).' : 'Checking your saved progress…'}</p>
          <div className="border border-neutral-300 rounded-lg bg-white p-3 mb-4">
            <div className="flex items-end justify-between"><div><div className="font-mono text-[11px] tracking-[0.14em] uppercase text-neutral-600 font-semibold">My progress</div><div className="text-3xl font-bold">{doneN} <span className="text-base font-normal text-neutral-600">of {lessons.length} lessons passed</span></div></div><div className="text-right"><div className="text-3xl font-bold text-[#e8552a]">{avg}%</div><div className="text-xs text-neutral-600">average best mark</div></div></div>
            <div className="h-2.5 bg-[#f4f3f1] rounded mt-2"><div className="h-full bg-green-600 rounded" style={{ width: `${(doneN / lessons.length) * 100}%` }} /></div>
            {!!Object.keys(secTot).length && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">{Object.entries(SECNAME).map(([k, nm]) => { const t = secTot[k]; const pc = t && t[1] ? Math.round((t[0] / t[1]) * 100) : null; return <div key={k} className="bg-[#f4f3f1] rounded p-2"><div className="text-[11px] text-neutral-600">{nm}</div><div className={`font-bold ${pc !== null && pc < PASS ? 'text-[#e8552a]' : ''}`}>{pc === null ? '–' : pc + '%'}</div></div>; })}</div>}
            <div className="mt-3"><div className="flex justify-between text-sm"><span>Level: <b>{level}</b>{toNext > 0 && <span className="text-neutral-600"> · {toNext} more {toNext === 1 ? 'lesson' : 'lessons'} to the next level</span>}</span></div></div>
            <div className="mt-2"><div className="flex justify-between text-sm"><span>Today's goal</span><b>{todayN} of {goal} answers{todayN >= goal ? ' — done' : ''}</b></div><Bar v={(todayN / goal) * 100} color="bg-[#e8552a]" /></div>
            <div className="grid grid-cols-2 gap-2 mt-3"><button onClick={() => go('progress')} className="border border-[#111] rounded-lg py-2 font-semibold">Full progress report</button><button onClick={() => go('shortcuts')} className="bg-[#111] text-white rounded-lg py-2 font-semibold">Shortcuts — quick rules</button></div>
            <div className="text-sm text-neutral-700 mt-3">Study streak: <b>{streak} {streak === 1 ? 'day' : 'days'}</b> · answers today: <b>{days[today] || 0}</b>{cards.length > 0 && <> · words and sentences known well: <b>{known} of {cards.length}</b></>}</div>
          </div>
          <div className="border-2 border-[#111] rounded-lg bg-white p-3 mb-4">
            <div className="font-mono text-[11px] tracking-[0.14em] uppercase text-neutral-600 font-semibold mb-2">Today's plan — do these in order</div>
            <div className="grid gap-2">
              <button disabled={!dueCards.length} onClick={() => start('review', reviewSet())} className="flex items-center gap-3 text-left rounded-lg p-2.5 bg-[#f4f3f1] disabled:opacity-50"><span className="w-7 h-7 rounded-full bg-[#111] text-white text-sm font-bold flex items-center justify-center shrink-0">1</span><span className="flex-1"><b>Daily review</b><span className="block text-xs text-neutral-600">{dueCards.length ? `${dueCards.length} words and sentences are due today (20 at a time)` : cards.length ? 'Nothing due today — well done' : 'Opens after your first lesson quiz'}</span></span></button>
              <button disabled={!mist.length} onClick={startPractice} className="flex items-center gap-3 text-left rounded-lg p-2.5 bg-[#f4f3f1] disabled:opacity-50"><span className="w-7 h-7 rounded-full bg-[#111] text-white text-sm font-bold flex items-center justify-center shrink-0">2</span><span className="flex-1"><b>Practice my mistakes</b><span className="block text-xs text-neutral-600">{mist.length ? `${mist.length} questions you got wrong before` : 'No mistakes waiting'}</span></span></button>
              <button onClick={() => go('talk')} className="flex items-center gap-3 text-left rounded-lg p-2.5 bg-[#111] text-white"><span className="w-7 h-7 rounded-full bg-white text-[#111] text-sm font-bold flex items-center justify-center shrink-0">4</span><span className="flex-1"><b>Talk — AI conversation partner</b><span className="block text-xs opacity-90">Speak with a "supplier" using your lesson words; it answers out loud and corrects you</span></span></button>
              {nextLesson && <button onClick={() => go('lesson', nextLesson.number)} className="flex items-center gap-3 text-left rounded-lg p-2.5 bg-[#e8552a] text-white"><span className="w-7 h-7 rounded-full bg-white text-[#111] text-sm font-bold flex items-center justify-center shrink-0">3</span><span className="flex-1"><b>{prog[nextLesson.number] ? 'Repeat' : 'Start'} Lesson {nextLesson.number}: {nextLesson.title}</b><span className="block text-xs opacity-90">Study it, then take the quiz</span></span></button>}
            </div>
          </div>
          <div className="grid gap-2">
            {lessons.map((l) => {
              const p = prog[l.number]; const open = unlocked(l.number);
              return (
                <div key={l.number} role="button" tabIndex={0} onClick={() => { if (open) go('lesson', l.number); }}
                  className={`flex items-center gap-3 text-left border rounded-lg p-3 bg-white ${open ? 'border-neutral-300 hover:border-[#111] cursor-pointer' : 'border-neutral-200'}`}>
                  <span className={`w-10 h-10 rounded-full flex items-center justify-center font-bold shrink-0 ${p?.passed ? 'bg-green-600 text-white' : 'bg-[#f4f3f1]'}`}>{p?.passed ? <Check className="w-5 h-5" /> : l.number}</span>
                  <span className={`flex-1 min-w-0 ${open ? '' : 'opacity-50'}`}><span className="block font-semibold">{l.number}. {l.title}</span><span className="block text-xs text-neutral-600">{l.subtitle}</span>{p?.sec && <span className="block text-[11px] font-mono text-neutral-600 mt-0.5">{Object.entries(SECNAME).map(([k, nm]) => p.sec![k] ? `${nm.split(' ')[0]} ${p.sec![k][0]}/${p.sec![k][1]}` : '').filter(Boolean).join(' · ')}</span>}</span>
                  <span className="text-xs font-mono text-right shrink-0">{!open ? <button onClick={(e) => { e.stopPropagation(); unlockByHand(l.number); }} className="border border-[#111] rounded-lg px-2.5 py-1.5 bg-white font-sans font-semibold text-xs inline-flex items-center gap-1"><Lock className="w-3.5 h-3.5" /> Unlock</button> : p ? <>{p.passed ? <span className="text-green-700">Passed</span> : <span className="text-[#e8552a]">Repeat</span>}<br />best {p.best}%<br />{p.tries}× tried</> : <span className="text-neutral-500">Not started</span>}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {route.page === 'lesson' && (
        <>
          <button onClick={() => go('home')} className="flex items-center gap-1 text-sm mb-3"><ArrowLeft className="w-4 h-4" /> All lessons</button>
          <h1 className="text-2xl font-bold">Lesson {lesson.number}: {lesson.title}</h1>
          <button onClick={() => { const el = document.getElementById('ask-lesson'); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); (el?.querySelector('button') as HTMLButtonElement | null)?.focus(); }} className="mt-2 text-sm border border-[#111] rounded-full px-3 py-1.5 bg-white font-semibold">Have a doubt? Ask the teacher ↓</button>
          <button onClick={() => go('shortcuts')} className="mt-2 ml-2 text-sm border border-[#111] rounded-full px-3 py-1.5 bg-white font-semibold">Shortcuts</button>
          <p className="text-neutral-600 text-sm">{lesson.subtitle}</p>

          <H>New words</H>
          <div className="border border-neutral-300 rounded-lg bg-white divide-y">
            {[...lesson.words, ...(lesson.extraWords || [])].map((w, i) => (
              <div key={i} className="flex items-center gap-3 p-2.5">
                <div className="w-24 sm:w-32 font-mono text-[15px]">{w.pinyin}</div>
                <div className="text-2xl w-24 sm:w-32">{w.chinese}</div>
                <div className="flex-1 text-sm">{w.meaning}</div>
                <Spk text={w.chinese} />
              </div>
            ))}
          </div>

          {(lesson.pattern || lesson.notes?.length) && <>
            <H>Pattern and notes</H>
            <div className="border border-neutral-300 rounded-lg bg-white p-3">
              {lesson.pattern && <div className="font-bold text-lg mb-2 text-[#e8552a]">{lesson.pattern}</div>}
              <ul className="list-disc pl-5 space-y-1 text-[15px]">{lesson.notes?.map((n, i) => <li key={i}><Rich t={n} /></li>)}</ul>
            </div>
          </>}

          {!!lesson.buildSteps?.length && <>
            <H>Build the sentence step by step</H>
            <div className="border border-neutral-300 rounded-lg bg-white divide-y">
              {lesson.buildSteps.map((s, i) => (
                <div key={i} className="flex items-center gap-3 p-2.5"><span className="w-6 h-6 rounded-full bg-[#111] text-white text-xs flex items-center justify-center shrink-0">{i + 1}</span>
                  <div className="flex-1"><div className="font-mono text-[15px]">{s.pinyin}</div><div className="text-sm text-neutral-600">{s.meaning}</div></div></div>
              ))}
            </div>
          </>}

          {!!lesson.sentenceBuilder?.length && <>
            <H>Sentence builder — pick one from each column, left to right</H>
            <div className="overflow-x-auto border border-neutral-300 rounded-lg bg-white">
              <table className="w-full text-sm">
                <thead><tr className="bg-[#111] text-white">{lesson.sentenceBuilder.map((c, i) => <th key={i} className="text-left p-2 font-semibold whitespace-nowrap">{c.column}</th>)}</tr></thead>
                <tbody><tr className="align-top">{lesson.sentenceBuilder.map((c, i) => <td key={i} className="p-2 border-r last:border-r-0 border-neutral-200">{c.options.map((o, j) => <div key={j} className="font-mono py-0.5">{o}</div>)}</td>)}</tr></tbody>
              </table>
            </div>
          </>}

          {!!lesson.examples?.length && <>
            <H>Example sentences</H>
            <div className="border border-neutral-300 rounded-lg bg-white divide-y">
              {lesson.examples.map((e, i) => (
                <div key={i} className="flex items-center gap-3 p-2.5">
                  <div className="flex-1"><div className="font-mono text-[15px]">{e.pinyin}</div><div className="text-xl">{e.chinese}</div><div className="text-sm text-neutral-600">{e.meaning}</div></div>
                  <Spk text={e.chinese} />
                </div>
              ))}
            </div>
          </>}

          {!!lesson.conversation?.length && <>
            <H>Conversation</H>
            <div className="border border-neutral-300 rounded-lg bg-white divide-y">
              {lesson.conversation.map((c, i) => (
                <div key={i} className="flex items-center gap-3 p-2.5">
                  <span className="w-7 h-7 rounded-full bg-[#f4f3f1] font-bold text-sm flex items-center justify-center shrink-0">{c.speaker}</span>
                  <div className="flex-1"><div className="font-mono text-[15px]">{c.pinyin}</div>{c.chinese && <div className="text-xl">{c.chinese}</div>}<div className="text-sm text-neutral-600">{c.meaning}</div></div>
                  <Spk text={c.chinese} />
                </div>
              ))}
            </div>
          </>}

          <button onClick={() => go('quiz')} className="mt-6 w-full bg-[#e8552a] text-white font-bold rounded-lg py-3.5 text-base">{(() => { const r = loadJ<{ n: number; i: number; qs: unknown[] } | null>(rKey(lesson.number), null); return r && r.n === lesson.number && r.i > 0 && r.i < r.qs.length ? `Continue the quiz (question ${r.i + 1} of ${r.qs.length})` : 'Take the quiz'; })()}</button>
          <H>Have a doubt?</H>
          <AskChinese key={lesson.number} lesson={lesson} earlier={lessons.filter((l) => l.number < lesson.number)} />
          <H>Extra practice — ear, mouth and tones (does not change the quiz mark)</H>
          <div className="grid sm:grid-cols-3 gap-2">
            {([['listen', 'Listening', 'Hear a sentence, type it', listenQs], ['speak', 'Speaking', 'Say it, the phone checks you', speakQs], ['tone', 'Tones', 'Pick the right tone', toneQs]] as [Mode, string, string, (l: Lesson) => Q[]][]).map(([m, nm, d, mk]) => (
              <button key={m} onClick={() => start(m, mk(lesson), lesson.number)} className="border border-[#111] rounded-lg p-3 text-left bg-white"><b>{nm}</b><span className="block text-xs text-neutral-600">{d}</span><span className="block text-xs font-mono mt-1">{extra[lesson.number]?.[m] !== undefined ? `best ${extra[lesson.number][m]}%` : 'not tried'}</span></button>
            ))}
          </div>
        </>
      )}

      {route.page === 'talk' && <TalkChinese lessons={lessons} level={Math.max(1, ...lessons.filter((l) => prog[l.number]).map((l) => l.number))} onBack={() => go('home')} onAnswer={bump} />}

      {route.page === 'shortcuts' && <ShortcutsChinese onBack={() => go('home')} />}

      {route.page === 'progress' && (
        <>
          <button onClick={() => go('home')} className="flex items-center gap-1 text-sm mb-3"><ArrowLeft className="w-4 h-4" /> All lessons</button>
          <h1 className="text-2xl font-bold">My progress</h1>
          <p className="text-neutral-600 text-sm">Level: <b className="text-[#111]">{level}</b>{toNext > 0 ? ` · ${toNext} more ${toNext === 1 ? 'lesson' : 'lessons'} to the next level` : ' · course complete'}</p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
            {([['Lessons passed', `${doneN} / ${lessons.length}`], ['Course mastery', `${mastery}%`], ['Study streak', `${streak} ${streak === 1 ? 'day' : 'days'}`], ['Best streak', `${bestStreak} ${bestStreak === 1 ? 'day' : 'days'}`], ['Days studied', `${dayKeys.length}`], ['Answers given', `${totalAns}`]] as [string, string][]).map(([a, b]) => <div key={a} className="border border-neutral-300 rounded-lg bg-white p-3"><div className="text-xs text-neutral-600">{a}</div><div className="text-2xl font-bold">{b}</div></div>)}
          </div>

          <H>Course</H>
          <div className="border border-neutral-300 rounded-lg bg-white p-3 space-y-3">
            <div><div className="flex justify-between text-sm"><span>Lessons passed</span><b>{Math.round((doneN / lessons.length) * 100)}%</b></div><Bar v={(doneN / lessons.length) * 100} /></div>
            <div><div className="flex justify-between text-sm"><span>Course mastery (average best mark over all 16)</span><b>{mastery}%</b></div><Bar v={mastery} color="bg-[#111]" /></div>
            <div className="flex gap-1">{lessons.map((l) => <div key={l.number} title={`Lesson ${l.number}`} className={`flex-1 h-7 rounded text-[10px] font-mono flex items-center justify-center ${prog[l.number]?.passed ? 'bg-green-600 text-white' : prog[l.number] ? 'bg-[#e8552a] text-white' : unlocked(l.number) ? 'bg-neutral-300' : 'bg-[#f4f3f1] text-neutral-400'}`}>{l.number}</div>)}</div>
            <div className="text-xs text-neutral-600">Green = passed · orange = tried, not passed · grey = open · pale = locked</div>
          </div>

          <H>Today's goal</H>
          <div className="border border-neutral-300 rounded-lg bg-white p-3">
            <div className="flex items-center justify-between"><div><b className="text-2xl">{todayN}</b> <span className="text-neutral-600">of {goal} answers</span></div><div className="flex items-center gap-2"><button onClick={() => changeGoal(-10)} className="w-9 h-9 rounded-full border border-[#111] font-bold">−</button><span className="font-mono w-10 text-center">{goal}</span><button onClick={() => changeGoal(10)} className="w-9 h-9 rounded-full border border-[#111] font-bold">+</button></div></div>
            <div className="mt-2"><Bar v={(todayN / goal) * 100} color="bg-[#e8552a]" /></div>
            <div className="text-xs text-neutral-600 mt-1">{todayN >= goal ? 'Goal reached today.' : `${goal - todayN} more to reach today's goal.`} Use − and + to change the goal.</div>
          </div>

          <H>Last 14 days</H>
          <div className="border border-neutral-300 rounded-lg bg-white p-3">
            <div className="flex items-end gap-1 h-28">{last14.map((d) => <div key={d.k} className="flex-1 flex flex-col items-center justify-end h-full"><div className="text-[10px] font-mono text-neutral-600">{d.n || ''}</div><div className={`w-full rounded-t ${d.n >= goal ? 'bg-green-600' : d.n ? 'bg-[#e8552a]' : 'bg-[#f4f3f1]'}`} style={{ height: `${d.n ? Math.max(6, (d.n / max14) * 80) : 3}%` }} /><div className={`text-[10px] font-mono mt-1 ${d.k === today ? 'font-bold' : 'text-neutral-500'}`}>{d.lab}</div></div>)}</div>
            <div className="text-xs text-neutral-600 mt-1">Answers per day · green = goal reached</div>
          </div>

          <H>Skills</H>
          <div className="border border-neutral-300 rounded-lg bg-white p-3 space-y-2.5">
            {skills.map(([n, v]) => <div key={n}><div className="flex justify-between text-sm"><span>{n}</span><b className={v !== null && v < PASS ? 'text-[#e8552a]' : ''}>{v === null ? 'not tried' : v + '%'}</b></div><Bar v={v || 0} color={v !== null && v < PASS ? 'bg-[#e8552a]' : 'bg-green-600'} /></div>)}
            {weakSkill && weakSkill[1] < 90 && <div className="text-sm bg-[#f4f3f1] rounded p-2">Work on next: <b>{weakSkill[0]}</b> ({weakSkill[1]}%) — it is your weakest skill.</div>}
          </div>

          <H>Memory — words and sentences</H>
          <div className="border border-neutral-300 rounded-lg bg-white p-3">
            {cards.length ? <>
              <div className="flex h-4 rounded overflow-hidden bg-[#f4f3f1]"><div className="bg-green-600" style={{ width: `${(mem.known / cards.length) * 100}%` }} /><div className="bg-[#e8552a]" style={{ width: `${(mem.learning / cards.length) * 100}%` }} /></div>
              <div className="grid grid-cols-3 gap-2 mt-2 text-sm"><div><b className="text-green-700">{mem.known}</b> known well</div><div><b className="text-[#e8552a]">{mem.learning}</b> learning</div><div><b>{mem.fresh}</b> new</div></div>
              <div className="text-xs text-neutral-600 mt-1">{dueCards.length} due for review today · "known well" = answered right 3 reviews in a row</div>
            </> : <div className="text-sm text-neutral-600">Starts after your first lesson quiz.</div>}
          </div>

          <H>Lesson by lesson</H>
          <div className="border border-neutral-300 rounded-lg bg-white divide-y">
            {lessons.map((l) => { const p = prog[l.number]; const x = extra[l.number] || {}; return (
              <div key={l.number} className={`p-2.5 ${!unlocked(l.number) ? 'opacity-50' : ''}`}>
                <div className="flex justify-between gap-2 text-sm"><span className="font-semibold">{l.number}. {l.title}</span><span className="font-mono shrink-0">{p ? `${p.best}%` : unlocked(l.number) ? 'open' : 'locked'}{p?.passed ? ' ✓' : ''}</span></div>
                {p && <><div className="mt-1"><Bar v={p.best} color={p.passed ? 'bg-green-600' : 'bg-[#e8552a]'} /></div>
                  <div className="text-[11px] font-mono text-neutral-600 mt-1">{p.tries} {p.tries === 1 ? 'try' : 'tries'}{p.hist?.length ? ` · marks: ${p.hist.join(' → ')}` : ''}</div>
                  <div className="text-[11px] font-mono text-neutral-600">Listening {x.listen ?? '–'}{x.listen !== undefined ? '%' : ''} · Speaking {x.speak ?? '–'}{x.speak !== undefined ? '%' : ''} · Tones {x.tone ?? '–'}{x.tone !== undefined ? '%' : ''}</div></>}
              </div>); })}
          </div>
          {weakLesson && prog[weakLesson.number].best < 90 && <div className="text-sm bg-white border border-neutral-300 rounded-lg p-3 mt-3">Lesson to strengthen: <b>{weakLesson.number}. {weakLesson.title}</b> (best {prog[weakLesson.number].best}%). <button onClick={() => go('lesson', weakLesson.number)} className="underline text-[#e8552a] font-semibold">Open it</button></div>}

          <div className="grid gap-2 mt-5">
            <button onClick={copyProgress} className="bg-[#111] text-white font-bold rounded-lg py-3">Copy my progress</button>
            <button onClick={resetAll} className="border border-red-600 text-red-700 rounded-lg py-2.5 text-sm">Reset all progress on this device</button>
          </div>
        </>
      )}

      {route.page === 'quiz' && <Quiz key={route.n + ':' + attempt} lesson={lesson} preset={practice ? preset : undefined} mode={mode} bank={bank} engBank={engBank} onAnswer={bump} onRestart={() => setAttempt((a) => a + 1)} onPractice={(qs) => start('mistakes', qs)} chineseOf={chineseOf} meaningOf={meaningOf} hasNext={route.n < lessons.length}
        onDone={(pct, sec, missed, got) => finish(route.n, pct, sec, missed, got)} onLesson={() => (mode === 'mistakes' || mode === 'review') ? go('home') : go('lesson')} onHome={() => go('home')} onNext={() => go('lesson', route.n + 1)} />}
    </div>
  );
}

function Quiz({ lesson, preset, mode, bank, engBank, onAnswer, onRestart, onPractice, chineseOf, meaningOf, hasNext, onDone, onLesson, onHome, onNext }: {
  lesson: Lesson; preset?: Q[]; mode: Mode; bank: { t: string; n: number }[]; engBank: { t: string; n: number }[]; onAnswer: () => void; onRestart: () => void; onPractice: (qs: Q[]) => void; chineseOf: Map<string, string>; meaningOf: Map<string, string>; hasNext: boolean; onDone: (pct: number, sec: Sec, missed: Q[], got: Q[]) => void; onLesson: () => void; onHome: () => void; onNext: () => void;
}) {
  // an unfinished lesson quiz is kept on this device, so it continues from the same question; a new quiz is in random order
  const kept = useMemo(() => { if (preset) return null; const r = loadJ<{ n: number; qs: Q[]; i: number; score: number; res: { q: Q; ok: boolean; a?: string }[] } | null>(rKey(lesson.number), null); return r && r.n === lesson.number && r.i > 0 && r.i < r.qs.length ? r : null; }, []); // eslint-disable-line
  const qs: Q[] = useMemo(() => {
    if (preset) return preset;
    if (kept) return kept.qs;
    const q = lesson.quizzes || {}; const out: Q[] = [];
    shuffle(q.meaning || []).forEach((x) => out.push({ n: lesson.number, kind: 'meaning', title: 'Quiz 1 — Meaning', ask: x.prompt, sub: 'Type the English meaning', answer: x.answer, chinese: x.chinese }));
    shuffle(q.fillGap || []).forEach((x) => out.push({ n: lesson.number, kind: 'fillGap', title: 'Quiz 2 — Fill the gap', ask: x.prompt, sub: x.hint, answer: x.answer }));
    shuffle(q.wordOrder || []).forEach((x) => out.push({ n: lesson.number, kind: 'wordOrder', title: 'Quiz 3 — Word order', ask: x.hint, sub: 'Tap the words in the right order', answer: x.answer, words: shuffle(x.words) }));
    shuffle(q.translate || []).forEach((x) => out.push({ n: lesson.number, kind: 'translate', title: 'Quiz 4 — Translate', ask: x.prompt, sub: 'Type it in pinyin (tone marks not needed)', answer: x.answer }));
    return out;
  }, [lesson]);

  const [i, setI] = useState(kept ? kept.i : 0);
  const [val, setVal] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [state, setState] = useState<'ask' | 'shown' | 'right' | 'wrong'>('ask');
  const [score, setScore] = useState(kept ? kept.score : 0);
  const [saved, setSaved] = useState(false);
  const [res, setRes] = useState<{ q: Q; ok: boolean; a?: string }[]>(kept ? kept.res : []);
  const inputRef = useRef<HTMLInputElement>(null);
  const [hearing, setHearing] = useState(false);
  const [spTry, setSpTry] = useState(0);
  const [spMsg, setSpMsg] = useState('');
  useEffect(() => { const c = qs[i]; if (c && (c.kind === 'listen' || c.kind === 'tone') && c.chinese) speak(c.chinese); }, [i]); // eslint-disable-line

  const done = i >= qs.length;
  useEffect(() => { if (done && !saved) { setSaved(true); const sec: Sec = {}; res.forEach((r) => { const o = sec[r.q.kind] || [0, 0]; sec[r.q.kind] = [o[0] + (r.ok ? 1 : 0), o[1] + 1]; });
    onDone(qs.length ? Math.round((score / qs.length) * 100) : 0, sec, res.filter((r) => !r.ok).map((r) => r.q), res.filter((r) => r.ok).map((r) => r.q)); } }, [done]); // eslint-disable-line

  if (!qs.length) return <div><button onClick={onLesson} className="text-sm">← Back</button><p className="mt-4">This lesson has no quiz.</p></div>;

  if (done) {
    const pct = Math.round((score / qs.length) * 100); const pass = pct >= PASS;
    return (
      <div className="text-center py-8">
        <div className={`text-6xl font-bold ${pass ? 'text-green-600' : 'text-[#e8552a]'}`}>{pct}%</div>
        <div className="text-neutral-600 mt-1">{score} of {qs.length} correct</div>
        <div className="text-xl font-bold mt-4">{preset ? `${MODENAME[mode]} finished` : pass ? (hasNext ? `Well done! Lesson ${lesson.number + 1} is unlocked.` : 'Well done! Course complete.') : 'Repeat this lesson'}</div>
        {!pass && !preset && <p className="text-sm text-neutral-600 mt-1">You need {PASS}% to open the next lesson.</p>}
        <div className="grid grid-cols-2 gap-2 mt-4 max-w-sm mx-auto text-left">{Object.entries(ALLNAME).map(([k, nm]) => { const r = res.filter((x) => x.q.kind === k); return r.length ? <div key={k} className="bg-[#f4f3f1] rounded p-2 text-sm"><div className="text-xs text-neutral-600">{nm}</div><b>{r.filter((x) => x.ok).length} / {r.length}</b></div> : null; })}</div>
        {res.some((r) => !r.ok) && <div className="mt-4 text-left max-w-md mx-auto border border-neutral-300 rounded-lg bg-white"><div className="p-2 font-mono text-[11px] tracking-[0.14em] uppercase font-semibold text-neutral-600">To revise</div>{res.filter((r) => !r.ok).map((r, k) => <div key={k} className="px-3 py-2 border-t text-sm"><div className="text-neutral-600">{r.q.ask}</div>{r.a ? <div className="font-mono text-red-700 line-through">{r.a}</div> : null}<div className="font-mono font-semibold text-green-700">{r.q.kind === 'fillGap' ? r.q.ask.replace(/_+/, r.q.answer) : r.q.answer}</div></div>)}</div>}
        <div className="grid gap-2 mt-6 max-w-xs mx-auto">
          {res.some((r) => !r.ok) && mode === 'lesson' && <button onClick={() => onPractice(res.filter((r) => !r.ok).map((r) => r.q))} className="bg-[#111] text-white font-bold rounded-lg py-3">Practise the {res.filter((r) => !r.ok).length} I got wrong</button>}
          {pass && hasNext && !preset && <button onClick={onNext} className="bg-[#e8552a] text-white font-bold rounded-lg py-3">Next lesson</button>}
          <button onClick={onLesson} className="border border-[#111] rounded-lg py-3 flex items-center justify-center gap-2"><RotateCcw className="w-4 h-4" /> {preset ? (mode === 'mistakes' || mode === 'review' ? 'Back to lessons' : 'Back to the lesson') : pass ? 'Review this lesson' : 'Repeat this lesson'}</button>
          <button onClick={onHome} className="border border-neutral-300 rounded-lg py-3">All lessons</button>
        </div>
      </div>
    );
  }

  const q = qs[i];
  const full = q.kind === 'fillGap' ? q.ask.replace(/_+/, q.answer) : q.answer;
  const zh = q.chinese || chineseOf.get(norm(full));
  const shownPinyin = q.kind === 'meaning' || q.kind === 'speak' ? q.ask : full;

  const mark = (ok: boolean, given?: string) => {
    const ans = given ?? (q.kind === 'wordOrder' ? picked.map((k) => q.words![k]).join(' ') : val);
    onAnswer(); setState(ok ? 'right' : 'wrong'); setRes((r) => [...r, { q, ok, a: ans }]); if (ok) setScore((s) => s + 1);
    if (!preset) { if (i + 1 >= qs.length) { try { localStorage.removeItem(rKey(lesson.number)); } catch { /* ignore */ } } else saveJ(rKey(lesson.number), { n: lesson.number, qs, i: i + 1, score: score + (ok ? 1 : 0), res: [...res, { q, ok, a: ans }] }); }
  };
  const restart = () => { if (!confirm('Start this quiz again from question 1? Your answers so far in this quiz will be dropped.')) return; try { localStorage.removeItem(rKey(lesson.number)); } catch { /* ignore */ } onRestart(); };
  const check = () => {
    if (q.kind === 'wordOrder') mark(norm(picked.map((k) => q.words![k]).join('')) === norm(q.answer));
    else if (q.kind === 'meaning') mark(checkMeaning(val, q.answer, q.ask, meaningOf).ok);
    else mark(norm(val) === norm(q.answer));
  };
  const next = () => { setI(i + 1); setVal(''); setPicked([]); setState('ask'); setSpTry(0); setSpMsg(''); };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const listenToMe = () => {
    if (!SR || hearing) return;
    try {
      const r = new SR(); r.lang = 'zh-CN'; r.maxAlternatives = 5; r.interimResults = false; setHearing(true); setSpMsg('');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      r.onresult = (e: any) => {
        const alts: string[] = Array.from(e.results[0] as ArrayLike<{ transcript: string }>).map((a) => a.transcript);
        const ok = alts.some((a) => hanOnly(a) === hanOnly(q.chinese || ''));
        setVal(alts[0] || '');
        if (ok || spTry >= 2) mark(ok, alts[0] || ''); else { setSpTry(spTry + 1); setSpMsg(`The phone heard “${alts[0] || '…'}”. Listen once more and try again (${2 - spTry} ${2 - spTry === 1 ? 'try' : 'tries'} left).`); }
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      r.onerror = (e: any) => { setSpMsg(e.error === 'not-allowed' ? 'The microphone is blocked. Allow the microphone for this site in the browser settings.' : e.error === 'no-speech' ? 'I did not hear anything. Tap the button and speak.' : 'The phone could not listen (' + e.error + '). Try again.'); };
      r.onend = () => setHearing(false);
      r.start();
    } catch { setHearing(false); setSpMsg('The phone could not start listening.'); }
  };
  const typed = q.kind === 'wordOrder' ? picked.map((k) => q.words![k]).join(' ') : val;
  const bd = breakdown(shownPinyin, meaningOf);
  const tn = q.kind === 'tone' ? toneAt(q.answer) : null;
  const fb = state === 'wrong'
    ? (q.kind === 'tone' ? { notes: [`You chose “${val}”. The right one is “${q.answer}”.`], marks: [] as { w: string; ok: boolean }[] }
      : q.kind === 'speak' ? { notes: [val ? `The phone heard “${val}”.` : 'The phone did not catch it.', 'Play the sentence, copy the sound slowly, then say it at normal speed.'], marks: [] as { w: string; ok: boolean }[] }
      : q.kind === 'meaning' ? { notes: checkMeaning(val, q.answer, q.ask, meaningOf).notes, marks: [] as { w: string; ok: boolean }[] } : q.kind === 'fillGap'
      ? { notes: [val.trim() ? `You wrote “${val.trim()}”, but the missing word is “${q.answer}”${meaningOf.get(norm(q.answer)) ? ` (${q.answer} = ${meaningOf.get(norm(q.answer))})` : ''}.` : 'You did not type an answer.'], marks: full.split(/\s+/).map((w) => ({ w, ok: norm(w) !== norm(q.answer) })) }
      : explain(typed, q.answer, meaningOf))
    : null;
  const noCheck = q.kind === 'tone' || q.kind === 'speak';
  // words to pick from while typing pinyin: those of his lessons so far that start with what he has typed
  const typesPinyin = q.kind === 'fillGap' || q.kind === 'translate' || q.kind === 'listen';
  const lastTok = val.split(/\s+/).pop() || '';
  const upto = q.n || lesson.number;
  const lt = lastTok.toLowerCase().replace(/[^a-z']/g, '');
  const picks = state !== 'ask' ? [] : typesPinyin && norm(lastTok) ? bank.filter((b) => b.n <= upto && norm(b.t).startsWith(norm(lastTok))).sort((a, b) => norm(a.t).length - norm(b.t).length).slice(0, 8)
    : q.kind === 'meaning' && lt ? engBank.filter((b) => b.n <= upto && b.t.startsWith(lt) && b.t !== lt).sort((a, b) => a.t.length - b.t.length).slice(0, 8) : [];
  const pickWord = (t: string) => { const parts = val.split(/\s+/); parts[parts.length - 1] = t; setVal(parts.join(' ') + (q.kind === 'fillGap' ? '' : ' ')); inputRef.current?.focus(); };
  const canCheck = q.kind === 'wordOrder' ? picked.length === q.words!.length : val.trim().length > 0;
  const answered = state !== 'ask';

  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1"><button onClick={onLesson} className="flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Lesson</button><span className="font-mono">{i + 1} / {qs.length}</span></div>
      <div className="h-1.5 bg-[#f4f3f1] rounded mb-4"><div className="h-full bg-[#e8552a] rounded" style={{ width: `${(i / qs.length) * 100}%` }} /></div>
      <div className="flex justify-between items-center"><div className="font-mono text-[11px] tracking-[0.14em] uppercase text-neutral-600 font-semibold">{q.title}</div>{!preset && i > 0 && <button onClick={restart} className="text-xs underline text-neutral-600">Start again</button>}</div>
      {kept && i === kept.i && state === 'ask' && <div className="text-sm bg-[#f4f3f1] rounded p-2 mt-2">Continuing where you stopped: question {i + 1} of {qs.length}, {score} correct so far.</div>}

      <div className="border border-neutral-300 rounded-lg bg-white p-4 mt-2">
        <div className="flex items-center gap-3">
          <div className={`flex-1 ${q.kind === 'meaning' || q.kind === 'fillGap' || q.kind === 'speak' ? 'font-mono text-xl' : 'text-xl font-semibold'}`}>{q.ask}{q.kind === 'speak' && <span className="block text-2xl font-sans mt-1">{q.chinese}</span>}</div>
          {(q.kind === 'meaning' || q.kind === 'speak' || q.kind === 'tone') && <Spk text={q.chinese} />}
          {q.kind === 'listen' && <button onClick={() => speak(q.chinese || '')} className="shrink-0 w-14 h-14 rounded-full bg-[#e8552a] text-white flex items-center justify-center" aria-label="Play"><Volume2 className="w-6 h-6" /></button>}
        </div>
        {q.sub && <div className="text-sm text-neutral-600 mt-1">{q.sub}</div>}

        {q.kind === 'tone' ? (
          <div className="grid grid-cols-2 gap-2 mt-4">{q.opts!.map((o) => <button key={o} disabled={answered} onClick={() => { setVal(o); mark(o === q.answer, o); }} className={`py-3 rounded-lg border font-mono text-xl ${answered && o === q.answer ? 'bg-green-600 text-white border-green-600' : answered && o === val ? 'bg-red-600 text-white border-red-600' : 'border-[#111] bg-[#f4f3f1]'}`}>{o}</button>)}</div>
        ) : q.kind === 'speak' ? (
          <div className="mt-4">
            {!SR ? <div className="text-sm text-red-700">This browser cannot listen to your voice. Use Chrome on Android or Safari on iPhone. You can still listen and repeat out loud.</div>
              : !answered && <button onClick={listenToMe} disabled={hearing} className={`w-full rounded-lg py-4 font-bold text-white flex items-center justify-center gap-2 ${hearing ? 'bg-red-600 animate-pulse' : 'bg-[#111]'}`}><Mic className="w-5 h-5" /> {hearing ? 'Listening… speak now' : 'Tap and say it in Chinese'}</button>}
            {spMsg && !answered && <div className="text-sm text-[#b3261e] mt-2">{spMsg}</div>}
            {!answered && <button onClick={() => { setVal(''); mark(false, ''); }} className="mt-2 w-full text-sm underline text-neutral-600">Skip this one</button>}
          </div>
        ) : q.kind === 'wordOrder' ? (
          <div className="mt-4">
            <div className="min-h-[52px] border-2 border-dashed border-neutral-300 rounded-lg p-2 flex flex-wrap gap-2">
              {picked.map((k, n) => <button key={n} disabled={answered} onClick={() => setPicked(picked.filter((_, m) => m !== n))} className="px-3 py-2 rounded-lg bg-[#111] text-white font-mono">{q.words![k]}</button>)}
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {q.words!.map((w, k) => <button key={k} disabled={answered || picked.includes(k)} onClick={() => setPicked([...picked, k])} className={`px-3 py-2 rounded-lg border border-[#111] font-mono ${picked.includes(k) ? 'opacity-25' : 'bg-[#f4f3f1]'}`}>{w}</button>)}
            </div>
          </div>
        ) : (
<>
          <input ref={inputRef} value={val} disabled={answered} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && canCheck && state === 'ask') check(); }}
            autoFocus autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder={q.kind === 'meaning' ? 'English meaning' : 'pinyin'}
            className="mt-4 w-full border border-neutral-400 rounded-lg px-3 py-3 text-lg font-mono disabled:bg-[#f4f3f1]" />
          {picks.length > 0 && <div className="flex flex-wrap gap-2 mt-2">{picks.map((b) => <button key={b.t} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickWord(b.t)} className="px-3 py-2 rounded-lg border border-[#111] bg-[#f4f3f1] font-mono text-lg touch-manipulation">{b.t}</button>)}</div>}
          {(typesPinyin || q.kind === 'meaning') && state === 'ask' && !val && <div className="text-xs text-neutral-500 mt-1">Start typing — matching words appear, tap one to put it in.</div>}
          </>
        )}

        {state === 'ask' && !noCheck && <button disabled={!canCheck} onClick={check} className="mt-4 w-full bg-[#111] text-white font-bold rounded-lg py-3 disabled:opacity-40">Check</button>}

        {answered && (
          <div className={`mt-4 rounded-lg p-3 ${state === 'right' ? 'bg-green-50 border border-green-600' : state === 'wrong' ? 'bg-red-50 border border-red-600' : 'bg-[#f4f3f1] border border-neutral-300'}`}>
            {state === 'right' && <div className="font-bold text-green-700 flex items-center gap-1"><Check className="w-4 h-4" /> Correct</div>}
            {state === 'wrong' && <div className="font-bold text-red-700 flex items-center gap-1"><X className="w-4 h-4" /> Not quite</div>}
            {(state === 'wrong' || state === 'shown') && typed.trim() && !noCheck && <div className="mt-2"><div className="text-xs text-neutral-600">Your answer</div><div className={`font-mono ${state === 'wrong' && q.kind !== 'meaning' ? 'line-through text-red-700' : state === 'wrong' ? 'text-red-700' : ''}`}>{typed}</div></div>}
            {fb && <div className="mt-2"><div className="text-xs text-neutral-600">Where it went wrong</div><ul className="list-disc pl-5 text-[15px] space-y-0.5">{fb.notes.map((n, k) => <li key={k}>{n}</li>)}</ul></div>}
            <div className="text-xs text-neutral-600 mt-2">{fb ? 'This is how it should be' : 'Correct answer'}</div>
            {q.kind === 'meaning'
              ? <div className="text-lg font-semibold">{q.answer}</div>
              : <div className="flex items-center gap-3"><div className="flex-1"><div className="font-mono text-lg font-semibold">{fb && fb.marks.length ? fb.marks.map((m, k) => <span key={k} className={m.ok ? '' : 'bg-yellow-200 text-red-700 px-0.5 rounded'}>{m.w}{' '}</span>) : shownPinyin}</div>{zh && <div className="text-2xl">{zh}</div>}{q.kind === 'fillGap' && q.sub && <div className="text-sm text-neutral-600">{q.sub}</div>}</div><Spk text={zh} /></div>}
            {q.kind === 'meaning' && zh && <div className="text-2xl mt-1">{zh}</div>}
            {state === 'right' && q.kind === 'meaning' && val.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '') !== q.answer.toLowerCase().replace(/[^a-z0-9 ]/g, '') && <div className="text-sm text-neutral-700 mt-2">Your meaning is right. You wrote “{val.trim()}”; the line above is how it is said in good English.</div>}
            {q.mean && q.kind !== 'tone' && <div className="text-sm text-neutral-700 mt-1">Meaning: <b>{q.mean}</b></div>}
            {tn && <div className="text-sm mt-2"><b className="font-mono">{q.answer}</b> is the {TONETXT[tn.t]}.</div>}
            {state !== 'shown' && bd.length > 0 && <div className="mt-3"><div className="text-xs text-neutral-600">{state === 'right' ? 'Why it is right — word by word' : 'Word by word'}</div><div className="flex flex-wrap gap-1.5 mt-1">{bd.map((x, k) => <span key={k} className="bg-white border border-neutral-300 rounded px-2 py-1 text-sm"><b className="font-mono">{x.w}</b> = {x.m}</span>)}</div></div>}
            {state === 'shown' && <div className="text-sm text-neutral-700 mt-2">Your words are different from the answer. If the meaning is the same, tap “I was right”.</div>}
            {state === 'shown'
              ? <div className="grid grid-cols-2 gap-2 mt-3"><button onClick={() => mark(true)} className="bg-green-600 text-white font-bold rounded-lg py-2.5">I was right</button><button onClick={() => mark(false)} className="bg-red-600 text-white font-bold rounded-lg py-2.5">I was wrong</button></div>
              : <button onClick={next} className="mt-3 w-full bg-[#e8552a] text-white font-bold rounded-lg py-3">{i + 1 === qs.length ? 'See my score' : 'Next'}</button>}
          </div>
        )}
      </div>
    </div>
  );
}
