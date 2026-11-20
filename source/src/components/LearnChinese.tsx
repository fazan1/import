import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Lock, RotateCcw, Volume2, X } from 'lucide-react';

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
type Q = { kind: 'meaning' | 'fillGap' | 'wordOrder' | 'translate'; title: string; ask: string; sub?: string; answer: string; words?: string[]; chinese?: string; n?: number };
const MKEY = 'learn-chinese-mistakes-v1';
const qid = (q: Q) => `${q.n}|${q.kind}|${q.ask}|${q.answer}`;
const loadMist = (): Q[] => { try { return JSON.parse(localStorage.getItem(MKEY) || '[]'); } catch { return []; } };
const saveMist = (m: Q[]) => { try { localStorage.setItem(MKEY, JSON.stringify(m)); } catch { /* ignore */ } };
const SECNAME: Record<string, string> = { meaning: 'Meaning', fillGap: 'Fill the gap', wordOrder: 'Word order', translate: 'Translate' };
const KEY = 'learn-chinese-progress-v1';
const PASS = 80;

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const loadProg = (): Record<number, Prog> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
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
const ENG: Record<string, string> = { has: 'have', had: 'have', is: 'be', are: 'be', am: 'be', was: 'be', were: 'be', does: 'do', did: 'do', goods: 'stock', stocks: 'stock', cant: 'can not', cannot: 'can not', wont: 'will not', dont: 'do not', doesnt: 'do not', didnt: 'do not', isnt: 'be not', arent: 'be not', havent: 'have not', hasnt: 'have not', id: 'i would', ill: 'i will', im: 'i be', its: 'it be', whats: 'what be', ok: 'okay', yuan: 'rmb', him: 'he', me: 'i', them: 'they', us: 'we' };
const engNorm = (t: string) => t.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[’']/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  .map((w) => ENG[w] ?? w).join(' ').split(' ').filter((w) => !['a', 'an', 'the'].includes(w)).map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');

const FILL = ['it', 'to', 'there', 'will', 'going'];
const engToks = (t: string) => t.replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean).flatMap((o) => engNorm(o).split(' ').filter(Boolean).map((n) => ({ o: o.replace(/[^A-Za-z0-9’']/g, ''), n }))).filter((x) => !FILL.includes(x.n));
/* Meaning quiz: marked by the system. Right when the same idea words are there; otherwise say which ideas are missing or do not fit. */
function checkMeaning(user: string, answer: string): { ok: boolean; notes: string[] } {
  const U = engToks(user), A = engToks(answer);
  const miss = A.filter((a) => !U.some((u) => u.n === a.n)), extra = U.filter((u) => !A.some((a) => a.n === u.n));
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
  const [route, setRoute] = useState<{ page: 'home' | 'lesson' | 'quiz'; n: number }>({ page: 'home', n: 1 });
  const [attempt, setAttempt] = useState(0);
  const [mist, setMist] = useState<Q[]>(loadMist);
  const [practice, setPractice] = useState(false);

  useEffect(() => {
    fetch('/chinese_lessons.json').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => setLessons(d.lessons)).catch((e) => setErr('Could not load the lessons file: ' + e.message));
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

  if (err) return <div className="p-4 text-red-700">{err}</div>;
  if (!lessons) return <div className="p-4 text-neutral-600">Loading…</div>;
  const unlocked = (n: number) => n === 1 || !!prog[n - 1]?.passed;
  const lesson = lessons.find((l) => l.number === route.n) || lessons[0];
  const go = (page: 'home' | 'lesson' | 'quiz', n = route.n) => { if (page === 'quiz') setAttempt((a) => a + 1); setPractice(false); setRoute({ page, n }); };

  const finish = (n: number, pct: number, sec: Sec, missed: Q[], got: Q[]) => {
    const gotIds = new Set(got.map(qid));
    const m = [...mist.filter((x) => !gotIds.has(qid(x))), ...missed.filter((x) => !mist.some((y) => qid(y) === qid(x)))];
    setMist(m); saveMist(m);
    if (practice) return;
    const old = prog[n];
    const next = { ...prog, [n]: { best: Math.max(old?.best || 0, pct), passed: !!old?.passed || pct >= PASS, tries: (old?.tries || 0) + 1, last: new Date().toISOString(), sec, hist: [...(old?.hist || []), pct].slice(-10) } };
    setProg(next); saveProg(next);
  };
  const doneN = lessons.filter((l) => prog[l.number]?.passed).length;
  const scored = lessons.filter((l) => prog[l.number]);
  const avg = scored.length ? Math.round(scored.reduce((a, l) => a + prog[l.number].best, 0) / scored.length) : 0;
  const secTot: Sec = {};
  scored.forEach((l) => Object.entries(prog[l.number].sec || {}).forEach(([k, [c, t]]) => { const o = secTot[k] || [0, 0]; secTot[k] = [o[0] + c, o[1] + t]; }));
  const startPractice = () => { setPractice(true); setAttempt((a) => a + 1); setRoute({ page: 'quiz', n: 0 }); };

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-6 text-[#111]">
      {route.page === 'home' && (
        <>
          <h1 className="text-2xl font-bold">Learn Chinese</h1>
          <p className="text-neutral-600 text-sm mb-3">16 lessons. Score 80% or more in a lesson's quiz to open the next one.</p>
          <div className="border border-neutral-300 rounded-lg bg-white p-3 mb-4">
            <div className="flex items-end justify-between"><div><div className="font-mono text-[11px] tracking-[0.14em] uppercase text-neutral-600 font-semibold">My progress</div><div className="text-3xl font-bold">{doneN} <span className="text-base font-normal text-neutral-600">of {lessons.length} lessons passed</span></div></div><div className="text-right"><div className="text-3xl font-bold text-[#e8552a]">{avg}%</div><div className="text-xs text-neutral-600">average best mark</div></div></div>
            <div className="h-2.5 bg-[#f4f3f1] rounded mt-2"><div className="h-full bg-green-600 rounded" style={{ width: `${(doneN / lessons.length) * 100}%` }} /></div>
            {!!Object.keys(secTot).length && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">{Object.entries(SECNAME).map(([k, nm]) => { const t = secTot[k]; const pc = t && t[1] ? Math.round((t[0] / t[1]) * 100) : null; return <div key={k} className="bg-[#f4f3f1] rounded p-2"><div className="text-[11px] text-neutral-600">{nm}</div><div className={`font-bold ${pc !== null && pc < PASS ? 'text-[#e8552a]' : ''}`}>{pc === null ? '–' : pc + '%'}</div></div>; })}</div>}
            {!!mist.length && <button onClick={startPractice} className="mt-3 w-full bg-[#111] text-white font-bold rounded-lg py-2.5">Practice my mistakes ({mist.length})</button>}
          </div>
          <div className="grid gap-2">
            {lessons.map((l) => {
              const p = prog[l.number]; const open = unlocked(l.number);
              return (
                <button key={l.number} disabled={!open} onClick={() => go('lesson', l.number)}
                  className={`flex items-center gap-3 text-left border rounded-lg p-3 bg-white ${open ? 'border-neutral-300 hover:border-[#111]' : 'border-neutral-200 opacity-60'}`}>
                  <span className={`w-10 h-10 rounded-full flex items-center justify-center font-bold shrink-0 ${p?.passed ? 'bg-green-600 text-white' : 'bg-[#f4f3f1]'}`}>{p?.passed ? <Check className="w-5 h-5" /> : l.number}</span>
                  <span className="flex-1 min-w-0"><span className="block font-semibold">{l.number}. {l.title}</span><span className="block text-xs text-neutral-600">{l.subtitle}</span>{p?.sec && <span className="block text-[11px] font-mono text-neutral-600 mt-0.5">{Object.entries(SECNAME).map(([k, nm]) => p.sec![k] ? `${nm.split(' ')[0]} ${p.sec![k][0]}/${p.sec![k][1]}` : '').filter(Boolean).join(' · ')}</span>}</span>
                  <span className="text-xs font-mono text-right shrink-0">{!open ? <Lock className="w-4 h-4 inline" /> : p ? <>{p.passed ? <span className="text-green-700">Passed</span> : <span className="text-[#e8552a]">Repeat</span>}<br />best {p.best}%<br />{p.tries}× tried</> : <span className="text-neutral-500">Not started</span>}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {route.page === 'lesson' && (
        <>
          <button onClick={() => go('home')} className="flex items-center gap-1 text-sm mb-3"><ArrowLeft className="w-4 h-4" /> All lessons</button>
          <h1 className="text-2xl font-bold">Lesson {lesson.number}: {lesson.title}</h1>
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

          <button onClick={() => go('quiz')} className="mt-6 w-full bg-[#e8552a] text-white font-bold rounded-lg py-3.5 text-base">Take the quiz</button>
        </>
      )}

      {route.page === 'quiz' && <Quiz key={route.n + ':' + attempt} lesson={lesson} preset={practice ? mist : undefined} chineseOf={chineseOf} meaningOf={meaningOf} hasNext={route.n < lessons.length}
        onDone={(pct, sec, missed, got) => finish(route.n, pct, sec, missed, got)} onLesson={() => practice ? go('home') : go('lesson')} onHome={() => go('home')} onNext={() => go('lesson', route.n + 1)} />}
    </div>
  );
}

function Quiz({ lesson, preset, chineseOf, meaningOf, hasNext, onDone, onLesson, onHome, onNext }: {
  lesson: Lesson; preset?: Q[]; chineseOf: Map<string, string>; meaningOf: Map<string, string>; hasNext: boolean; onDone: (pct: number, sec: Sec, missed: Q[], got: Q[]) => void; onLesson: () => void; onHome: () => void; onNext: () => void;
}) {
  const qs: Q[] = useMemo(() => {
    if (preset) return preset;
    const q = lesson.quizzes || {}; const out: Q[] = [];
    (q.meaning || []).forEach((x) => out.push({ n: lesson.number, kind: 'meaning', title: 'Quiz 1 — Meaning', ask: x.prompt, sub: 'Type the English meaning', answer: x.answer, chinese: x.chinese }));
    (q.fillGap || []).forEach((x) => out.push({ n: lesson.number, kind: 'fillGap', title: 'Quiz 2 — Fill the gap', ask: x.prompt, sub: x.hint, answer: x.answer }));
    (q.wordOrder || []).forEach((x) => out.push({ n: lesson.number, kind: 'wordOrder', title: 'Quiz 3 — Word order', ask: x.hint, sub: 'Tap the words in the right order', answer: x.answer, words: x.words }));
    (q.translate || []).forEach((x) => out.push({ n: lesson.number, kind: 'translate', title: 'Quiz 4 — Translate', ask: x.prompt, sub: 'Type it in pinyin (tone marks not needed)', answer: x.answer }));
    return out;
  }, [lesson]);

  const [i, setI] = useState(0);
  const [val, setVal] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [state, setState] = useState<'ask' | 'shown' | 'right' | 'wrong'>('ask');
  const [score, setScore] = useState(0);
  const [saved, setSaved] = useState(false);
  const [res, setRes] = useState<{ q: Q; ok: boolean }[]>([]);

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
        <div className="text-xl font-bold mt-4">{preset ? 'Practice finished' : pass ? (hasNext ? `Well done! Lesson ${lesson.number + 1} is unlocked.` : 'Well done! Course complete.') : 'Repeat this lesson'}</div>
        {!pass && !preset && <p className="text-sm text-neutral-600 mt-1">You need {PASS}% to open the next lesson.</p>}
        <div className="grid grid-cols-2 gap-2 mt-4 max-w-sm mx-auto text-left">{Object.entries(SECNAME).map(([k, nm]) => { const r = res.filter((x) => x.q.kind === k); return r.length ? <div key={k} className="bg-[#f4f3f1] rounded p-2 text-sm"><div className="text-xs text-neutral-600">{nm}</div><b>{r.filter((x) => x.ok).length} / {r.length}</b></div> : null; })}</div>
        {res.some((r) => !r.ok) && <div className="mt-4 text-left max-w-md mx-auto border border-neutral-300 rounded-lg bg-white"><div className="p-2 font-mono text-[11px] tracking-[0.14em] uppercase font-semibold text-neutral-600">To revise</div>{res.filter((r) => !r.ok).map((r, k) => <div key={k} className="px-3 py-2 border-t text-sm"><div className="text-neutral-600">{r.q.ask}</div><div className="font-mono font-semibold">{r.q.kind === 'fillGap' ? r.q.ask.replace(/_+/, r.q.answer) : r.q.answer}</div></div>)}</div>}
        <div className="grid gap-2 mt-6 max-w-xs mx-auto">
          {pass && hasNext && !preset && <button onClick={onNext} className="bg-[#e8552a] text-white font-bold rounded-lg py-3">Next lesson</button>}
          <button onClick={onLesson} className="border border-[#111] rounded-lg py-3 flex items-center justify-center gap-2"><RotateCcw className="w-4 h-4" /> {preset ? 'Back to lessons' : pass ? 'Review this lesson' : 'Repeat this lesson'}</button>
          <button onClick={onHome} className="border border-neutral-300 rounded-lg py-3">All lessons</button>
        </div>
      </div>
    );
  }

  const q = qs[i];
  const full = q.kind === 'fillGap' ? q.ask.replace(/_+/, q.answer) : q.answer;
  const zh = q.chinese || chineseOf.get(norm(full));
  const shownPinyin = q.kind === 'meaning' ? q.ask : full;

  const mark = (ok: boolean) => { setState(ok ? 'right' : 'wrong'); setRes((r) => [...r, { q, ok }]); if (ok) setScore((s) => s + 1); };
  const check = () => {
    if (q.kind === 'wordOrder') mark(norm(picked.map((k) => q.words![k]).join('')) === norm(q.answer));
    else if (q.kind === 'meaning') mark(checkMeaning(val, q.answer).ok);
    else mark(norm(val) === norm(q.answer));
  };
  const next = () => { setI(i + 1); setVal(''); setPicked([]); setState('ask'); };
  const typed = q.kind === 'wordOrder' ? picked.map((k) => q.words![k]).join(' ') : val;
  const bd = breakdown(shownPinyin, meaningOf);
  const fb = state === 'wrong'
    ? (q.kind === 'meaning' ? { notes: checkMeaning(val, q.answer).notes, marks: [] as { w: string; ok: boolean }[] } : q.kind === 'fillGap'
      ? { notes: [val.trim() ? `You wrote “${val.trim()}”, but the missing word is “${q.answer}”${meaningOf.get(norm(q.answer)) ? ` (${q.answer} = ${meaningOf.get(norm(q.answer))})` : ''}.` : 'You did not type an answer.'], marks: full.split(/\s+/).map((w) => ({ w, ok: norm(w) !== norm(q.answer) })) }
      : explain(typed, q.answer, meaningOf))
    : null;
  const canCheck = q.kind === 'wordOrder' ? picked.length === q.words!.length : val.trim().length > 0;
  const answered = state !== 'ask';

  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1"><button onClick={onLesson} className="flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Lesson</button><span className="font-mono">{i + 1} / {qs.length}</span></div>
      <div className="h-1.5 bg-[#f4f3f1] rounded mb-4"><div className="h-full bg-[#e8552a] rounded" style={{ width: `${(i / qs.length) * 100}%` }} /></div>
      <div className="font-mono text-[11px] tracking-[0.14em] uppercase text-neutral-600 font-semibold">{q.title}</div>

      <div className="border border-neutral-300 rounded-lg bg-white p-4 mt-2">
        <div className="flex items-center gap-3">
          <div className={`flex-1 ${q.kind === 'meaning' || q.kind === 'fillGap' ? 'font-mono text-xl' : 'text-xl font-semibold'}`}>{q.ask}</div>
          {q.kind === 'meaning' && <Spk text={q.chinese} />}
        </div>
        {q.sub && <div className="text-sm text-neutral-600 mt-1">{q.sub}</div>}

        {q.kind === 'wordOrder' ? (
          <div className="mt-4">
            <div className="min-h-[52px] border-2 border-dashed border-neutral-300 rounded-lg p-2 flex flex-wrap gap-2">
              {picked.map((k, n) => <button key={n} disabled={answered} onClick={() => setPicked(picked.filter((_, m) => m !== n))} className="px-3 py-2 rounded-lg bg-[#111] text-white font-mono">{q.words![k]}</button>)}
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {q.words!.map((w, k) => <button key={k} disabled={answered || picked.includes(k)} onClick={() => setPicked([...picked, k])} className={`px-3 py-2 rounded-lg border border-[#111] font-mono ${picked.includes(k) ? 'opacity-25' : 'bg-[#f4f3f1]'}`}>{w}</button>)}
            </div>
          </div>
        ) : (
          <input value={val} disabled={answered} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && canCheck && state === 'ask') check(); }}
            autoFocus autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder={q.kind === 'meaning' ? 'English meaning' : 'pinyin'}
            className="mt-4 w-full border border-neutral-400 rounded-lg px-3 py-3 text-lg font-mono disabled:bg-[#f4f3f1]" />
        )}

        {state === 'ask' && <button disabled={!canCheck} onClick={check} className="mt-4 w-full bg-[#111] text-white font-bold rounded-lg py-3 disabled:opacity-40">Check</button>}

        {answered && (
          <div className={`mt-4 rounded-lg p-3 ${state === 'right' ? 'bg-green-50 border border-green-600' : state === 'wrong' ? 'bg-red-50 border border-red-600' : 'bg-[#f4f3f1] border border-neutral-300'}`}>
            {state === 'right' && <div className="font-bold text-green-700 flex items-center gap-1"><Check className="w-4 h-4" /> Correct</div>}
            {state === 'wrong' && <div className="font-bold text-red-700 flex items-center gap-1"><X className="w-4 h-4" /> Not quite</div>}
            {(state === 'wrong' || state === 'shown') && typed.trim() && <div className="mt-2"><div className="text-xs text-neutral-600">Your answer</div><div className={`font-mono ${state === 'wrong' && q.kind !== 'meaning' ? 'line-through text-red-700' : state === 'wrong' ? 'text-red-700' : ''}`}>{typed}</div></div>}
            {fb && <div className="mt-2"><div className="text-xs text-neutral-600">Where it went wrong</div><ul className="list-disc pl-5 text-[15px] space-y-0.5">{fb.notes.map((n, k) => <li key={k}>{n}</li>)}</ul></div>}
            <div className="text-xs text-neutral-600 mt-2">{fb ? 'This is how it should be' : 'Correct answer'}</div>
            {q.kind === 'meaning'
              ? <div className="text-lg font-semibold">{q.answer}</div>
              : <div className="flex items-center gap-3"><div className="flex-1"><div className="font-mono text-lg font-semibold">{fb && fb.marks.length ? fb.marks.map((m, k) => <span key={k} className={m.ok ? '' : 'bg-yellow-200 text-red-700 px-0.5 rounded'}>{m.w}{' '}</span>) : shownPinyin}</div>{zh && <div className="text-2xl">{zh}</div>}{q.kind === 'fillGap' && q.sub && <div className="text-sm text-neutral-600">{q.sub}</div>}</div><Spk text={zh} /></div>}
            {q.kind === 'meaning' && zh && <div className="text-2xl mt-1">{zh}</div>}
            {state === 'right' && q.kind === 'meaning' && val.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '') !== q.answer.toLowerCase().replace(/[^a-z0-9 ]/g, '') && <div className="text-sm text-neutral-700 mt-2">Your meaning is right. You wrote “{val.trim()}”; the line above is how it is said in good English.</div>}
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
