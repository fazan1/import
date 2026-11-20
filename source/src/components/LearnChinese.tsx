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
interface Prog { best: number; passed: boolean; tries: number; last: string }
const KEY = 'learn-chinese-progress-v1';
const PASS = 80;

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const loadProg = (): Record<number, Prog> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const saveProg = (p: Record<number, Prog>) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ } };

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

  if (err) return <div className="p-4 text-red-700">{err}</div>;
  if (!lessons) return <div className="p-4 text-neutral-600">Loading…</div>;
  const unlocked = (n: number) => n === 1 || !!prog[n - 1]?.passed;
  const lesson = lessons.find((l) => l.number === route.n)!;
  const go = (page: 'home' | 'lesson' | 'quiz', n = route.n) => { if (page === 'quiz') setAttempt((a) => a + 1); setRoute({ page, n }); };

  const finish = (n: number, pct: number) => {
    const old = prog[n];
    const next = { ...prog, [n]: { best: Math.max(old?.best || 0, pct), passed: !!old?.passed || pct >= PASS, tries: (old?.tries || 0) + 1, last: new Date().toISOString() } };
    setProg(next); saveProg(next);
  };

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-6 text-[#111]">
      {route.page === 'home' && (
        <>
          <h1 className="text-2xl font-bold">Learn Chinese</h1>
          <p className="text-neutral-600 text-sm mb-4">16 lessons. Score 80% or more in a lesson's quiz to open the next one.</p>
          <div className="grid gap-2">
            {lessons.map((l) => {
              const p = prog[l.number]; const open = unlocked(l.number);
              return (
                <button key={l.number} disabled={!open} onClick={() => go('lesson', l.number)}
                  className={`flex items-center gap-3 text-left border rounded-lg p-3 bg-white ${open ? 'border-neutral-300 hover:border-[#111]' : 'border-neutral-200 opacity-60'}`}>
                  <span className={`w-10 h-10 rounded-full flex items-center justify-center font-bold shrink-0 ${p?.passed ? 'bg-green-600 text-white' : 'bg-[#f4f3f1]'}`}>{p?.passed ? <Check className="w-5 h-5" /> : l.number}</span>
                  <span className="flex-1 min-w-0"><span className="block font-semibold">{l.number}. {l.title}</span><span className="block text-xs text-neutral-600">{l.subtitle}</span></span>
                  <span className="text-xs font-mono text-right shrink-0">{!open ? <Lock className="w-4 h-4 inline" /> : p ? <>{p.passed ? <span className="text-green-700">Passed</span> : <span className="text-[#e8552a]">Repeat</span>}<br />best {p.best}%</> : <span className="text-neutral-500">Not started</span>}</span>
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

      {route.page === 'quiz' && <Quiz key={route.n + ':' + attempt} lesson={lesson} chineseOf={chineseOf} hasNext={route.n < lessons.length}
        onDone={(pct) => finish(route.n, pct)} onLesson={() => go('lesson')} onHome={() => go('home')} onNext={() => go('lesson', route.n + 1)} />}
    </div>
  );
}

type Q = { kind: 'meaning' | 'fillGap' | 'wordOrder' | 'translate'; title: string; ask: string; sub?: string; answer: string; words?: string[]; chinese?: string };

function Quiz({ lesson, chineseOf, hasNext, onDone, onLesson, onHome, onNext }: {
  lesson: Lesson; chineseOf: Map<string, string>; hasNext: boolean; onDone: (pct: number) => void; onLesson: () => void; onHome: () => void; onNext: () => void;
}) {
  const qs: Q[] = useMemo(() => {
    const q = lesson.quizzes || {}; const out: Q[] = [];
    (q.meaning || []).forEach((x) => out.push({ kind: 'meaning', title: 'Quiz 1 — Meaning', ask: x.prompt, sub: 'Type the English meaning', answer: x.answer, chinese: x.chinese }));
    (q.fillGap || []).forEach((x) => out.push({ kind: 'fillGap', title: 'Quiz 2 — Fill the gap', ask: x.prompt, sub: x.hint, answer: x.answer }));
    (q.wordOrder || []).forEach((x) => out.push({ kind: 'wordOrder', title: 'Quiz 3 — Word order', ask: x.hint, sub: 'Tap the words in the right order', answer: x.answer, words: x.words }));
    (q.translate || []).forEach((x) => out.push({ kind: 'translate', title: 'Quiz 4 — Translate', ask: x.prompt, sub: 'Type it in pinyin (tone marks not needed)', answer: x.answer }));
    return out;
  }, [lesson]);

  const [i, setI] = useState(0);
  const [val, setVal] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [state, setState] = useState<'ask' | 'shown' | 'right' | 'wrong'>('ask');
  const [score, setScore] = useState(0);
  const [saved, setSaved] = useState(false);

  const done = i >= qs.length;
  useEffect(() => { if (done && !saved) { setSaved(true); onDone(qs.length ? Math.round((score / qs.length) * 100) : 0); } }, [done]); // eslint-disable-line

  if (!qs.length) return <div><button onClick={onLesson} className="text-sm">← Back</button><p className="mt-4">This lesson has no quiz.</p></div>;

  if (done) {
    const pct = Math.round((score / qs.length) * 100); const pass = pct >= PASS;
    return (
      <div className="text-center py-8">
        <div className={`text-6xl font-bold ${pass ? 'text-green-600' : 'text-[#e8552a]'}`}>{pct}%</div>
        <div className="text-neutral-600 mt-1">{score} of {qs.length} correct</div>
        <div className="text-xl font-bold mt-4">{pass ? (hasNext ? `Well done! Lesson ${lesson.number + 1} is unlocked.` : 'Well done! Course complete.') : 'Repeat this lesson'}</div>
        {!pass && <p className="text-sm text-neutral-600 mt-1">You need {PASS}% to open the next lesson.</p>}
        <div className="grid gap-2 mt-6 max-w-xs mx-auto">
          {pass && hasNext && <button onClick={onNext} className="bg-[#e8552a] text-white font-bold rounded-lg py-3">Next lesson</button>}
          <button onClick={onLesson} className="border border-[#111] rounded-lg py-3 flex items-center justify-center gap-2"><RotateCcw className="w-4 h-4" /> {pass ? 'Review this lesson' : 'Repeat this lesson'}</button>
          <button onClick={onHome} className="border border-neutral-300 rounded-lg py-3">All lessons</button>
        </div>
      </div>
    );
  }

  const q = qs[i];
  const full = q.kind === 'fillGap' ? q.ask.replace(/_+/, q.answer) : q.answer;
  const zh = q.chinese || chineseOf.get(norm(full));
  const shownPinyin = q.kind === 'meaning' ? q.ask : full;

  const mark = (ok: boolean) => { setState(ok ? 'right' : 'wrong'); if (ok) setScore((s) => s + 1); };
  const check = () => {
    if (q.kind === 'wordOrder') mark(norm(picked.map((k) => q.words![k]).join('')) === norm(q.answer));
    else if (q.kind === 'meaning') setState('shown');
    else mark(norm(val) === norm(q.answer));
  };
  const next = () => { setI(i + 1); setVal(''); setPicked([]); setState('ask'); };
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

        {state === 'ask' && <button disabled={!canCheck} onClick={check} className="mt-4 w-full bg-[#111] text-white font-bold rounded-lg py-3 disabled:opacity-40">{q.kind === 'meaning' ? 'Show answer' : 'Check'}</button>}

        {answered && (
          <div className={`mt-4 rounded-lg p-3 ${state === 'right' ? 'bg-green-50 border border-green-600' : state === 'wrong' ? 'bg-red-50 border border-red-600' : 'bg-[#f4f3f1] border border-neutral-300'}`}>
            {state === 'right' && <div className="font-bold text-green-700 flex items-center gap-1"><Check className="w-4 h-4" /> Correct</div>}
            {state === 'wrong' && <div className="font-bold text-red-700 flex items-center gap-1"><X className="w-4 h-4" /> Not quite</div>}
            <div className="text-xs text-neutral-600 mt-1">Correct answer</div>
            {q.kind === 'meaning'
              ? <div className="text-lg font-semibold">{q.answer}</div>
              : <div className="flex items-center gap-3"><div className="flex-1"><div className="font-mono text-lg font-semibold">{shownPinyin}</div>{zh && <div className="text-2xl">{zh}</div>}{q.kind === 'fillGap' && q.sub && <div className="text-sm text-neutral-600">{q.sub}</div>}</div><Spk text={zh} /></div>}
            {q.kind === 'meaning' && zh && <div className="text-2xl mt-1">{zh}</div>}
            {state === 'shown'
              ? <div className="grid grid-cols-2 gap-2 mt-3"><button onClick={() => mark(true)} className="bg-green-600 text-white font-bold rounded-lg py-2.5">I was right</button><button onClick={() => mark(false)} className="bg-red-600 text-white font-bold rounded-lg py-2.5">I was wrong</button></div>
              : <button onClick={next} className="mt-3 w-full bg-[#e8552a] text-white font-bold rounded-lg py-3">{i + 1 === qs.length ? 'See my score' : 'Next'}</button>}
          </div>
        )}
      </div>
    </div>
  );
}
