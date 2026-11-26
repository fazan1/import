import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, RotateCcw, Volume2, X } from 'lucide-react';

/* Learn Chinese -> Word quiz (owner: "a quiz for all words: I select the English, from all the levels I have finished").
   Multiple choice over the words of the lessons he ticks. A missed word comes back at the end until he gets it.
   Words come straight from chinese_lessons.json. Best mark kept on this device (learn-chinese-wordquiz-v1). */

interface W { pinyin: string; chinese?: string; meaning: string }
export interface WQLesson { number: number; title: string; words: W[]; extraWords?: W[] }
type Card = W & { n: number };
type Dir = 'zh-en' | 'en-zh';

const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
function speak(text?: string) {
  try { if (!text) return; const y = window.speechSynthesis; if (!y) return; y.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-CN'; u.rate = 0.8; const v = y.getVoices().find((x) => /^zh/i.test(x.lang)); if (v) u.voice = v; y.speak(u); } catch { /* ignore */ }
}
const KEY = 'learn-chinese-wordquiz-v1';

export default function WordQuizChinese({ lessons, done, onBack, onAnswer }: { lessons: WQLesson[]; done: number[]; onBack: () => void; onAnswer: () => void }) {
  const [sel, setSel] = useState<number[]>(done.length ? done : [1]);
  const [dir, setDir] = useState<Dir>('zh-en');
  const [queue, setQueue] = useState<Card[] | null>(null);     // null = setup screen
  const [total, setTotal] = useState(0);
  const [i, setI] = useState(0);
  const [first, setFirst] = useState(0);                       // right at the first try
  const [missed, setMissed] = useState<Card[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [repeat, setRepeat] = useState(false);
  const best = useMemo(() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') as { best?: number; rounds?: number }; } catch { return {}; } }, [queue]);

  const pool: Card[] = useMemo(() => lessons.filter((l) => sel.includes(l.number)).flatMap((l) => [...l.words, ...(l.extraWords || [])].map((w) => ({ ...w, n: l.number }))), [lessons, sel]);
  const everything: Card[] = useMemo(() => lessons.flatMap((l) => [...l.words, ...(l.extraWords || [])].map((w) => ({ ...w, n: l.number }))), [lessons]);
  const card = queue && i < queue.length ? queue[i] : null;
  const show = (c: Card) => (dir === 'zh-en' ? c.meaning : c.pinyin);
  const options = useMemo(() => {
    if (!card) return [];
    const others = [...shuffle(pool), ...shuffle(everything)].filter((c) => show(c) !== show(card));   // wrong choices from the same lessons first
    const picks: string[] = []; for (const o of others) { if (!picks.includes(show(o))) picks.push(show(o)); if (picks.length === 3) break; }
    return shuffle([show(card), ...picks]);
  }, [card, dir]); // eslint-disable-line
  useEffect(() => { if (card && dir === 'zh-en') speak(card.chinese); }, [card]); // eslint-disable-line

  const start = () => { if (!pool.length) { alert('Tick at least one lesson.'); return; } const q = shuffle(pool); setQueue(q); setTotal(q.length); setI(0); setFirst(0); setMissed([]); setChosen(null); setRepeat(false); };
  const choose = (o: string) => {
    if (!card || chosen) return;
    setChosen(o); onAnswer(); const ok = o === show(card);
    if (dir === 'en-zh' || !ok) speak(card.chinese);
    if (ok && !repeat) setFirst((x) => x + 1);
    if (!ok && !missed.some((m) => m.pinyin === card.pinyin && m.n === card.n)) setMissed((m) => [...m, card]);
    if (!ok) setQueue((q) => (q ? [...q, card] : q));          // a missed word comes back at the end
  };
  const next = () => { if (!queue) return; if (i + 1 >= total && !repeat && i + 1 < queue.length) setRepeat(true); setI(i + 1); setChosen(null); };

  if (!queue) return (
    <>
      <button onClick={onBack} className="flex items-center gap-1 text-sm mb-3"><ArrowLeft className="w-4 h-4" /> All lessons</button>
      <h1 className="text-2xl font-bold">Word quiz</h1>
      <p className="text-neutral-600 text-sm">Every word of the lessons you tick, one by one. Choose the right answer; a word you miss comes back at the end until you get it.</p>
      <div className="border border-neutral-300 rounded-lg bg-white p-3 mt-3">
        <div className="flex items-center justify-between mb-2"><b>Which lessons</b><span className="flex gap-2 text-xs"><button onClick={() => setSel(done.length ? done : [1])} className="underline">the ones I have done</button><button onClick={() => setSel(lessons.map((l) => l.number))} className="underline">all 16</button><button onClick={() => setSel([])} className="underline">none</button></span></div>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">{lessons.map((l) => { const on = sel.includes(l.number); return <button key={l.number} onClick={() => setSel(on ? sel.filter((x) => x !== l.number) : [...sel, l.number].sort((a, b) => a - b))} title={l.title} className={`rounded-lg py-2.5 font-mono font-bold border touch-manipulation ${on ? 'bg-[#111] text-white border-[#111]' : done.includes(l.number) ? 'bg-white border-[#111]' : 'bg-[#f4f3f1] border-neutral-300 text-neutral-500'}`}>{l.number}</button>; })}</div>
        <div className="text-xs text-neutral-600 mt-2">Black = in the quiz · white = a lesson you have done · grey = not reached yet (you can still tick it)</div>
      </div>
      <div className="border border-neutral-300 rounded-lg bg-white p-3 mt-3">
        <b>What you see</b>
        <div className="grid sm:grid-cols-2 gap-2 mt-2">
          <button onClick={() => setDir('zh-en')} className={`text-left rounded-lg p-2.5 border ${dir === 'zh-en' ? 'border-[#111] border-2' : 'border-neutral-300'}`}><b>Chinese → choose the English</b><span className="block text-xs text-neutral-600">You see and hear the word, you pick its meaning</span></button>
          <button onClick={() => setDir('en-zh')} className={`text-left rounded-lg p-2.5 border ${dir === 'en-zh' ? 'border-[#111] border-2' : 'border-neutral-300'}`}><b>English → choose the Chinese</b><span className="block text-xs text-neutral-600">You see the meaning, you pick the pinyin (harder)</span></button>
        </div>
      </div>
      <button onClick={start} className="mt-4 w-full bg-[#e8552a] text-white font-bold rounded-lg py-3.5">Start — {pool.length} words</button>
      {best.rounds ? <div className="text-xs text-neutral-600 mt-2 text-center">Best so far: {best.best}% right first time · {best.rounds} rounds played</div> : null}
    </>
  );

  if (!card) {
    const pct = total ? Math.round((first / total) * 100) : 0;
    try { const b = JSON.parse(localStorage.getItem(KEY) || '{}'); if (!b.stamp || b.stamp !== total + ':' + first + ':' + i) localStorage.setItem(KEY, JSON.stringify({ best: Math.max(b.best || 0, pct), rounds: (b.rounds || 0) + 1, stamp: total + ':' + first + ':' + i })); } catch { /* ignore */ }
    return (
      <div className="text-center py-6">
        <div className={`text-6xl font-bold ${pct >= 80 ? 'text-green-600' : 'text-[#e8552a]'}`}>{pct}%</div>
        <div className="text-neutral-600 mt-1">{first} of {total} words right first time</div>
        {missed.length > 0 ? <div className="mt-4 text-left max-w-md mx-auto border border-neutral-300 rounded-lg bg-white"><div className="p-2 font-mono text-[11px] tracking-[0.14em] uppercase font-semibold text-neutral-600">Words to learn again ({missed.length})</div>{missed.map((m, k) => <div key={k} className="px-3 py-2 border-t flex items-center gap-3"><div className="flex-1"><div className="font-mono font-semibold">{m.pinyin} <span className="font-sans text-lg font-normal">{m.chinese}</span></div><div className="text-sm text-neutral-600">{m.meaning} · Lesson {m.n}</div></div><button onClick={() => speak(m.chinese)} aria-label="Listen" className="w-9 h-9 rounded-full border border-[#111] flex items-center justify-center"><Volume2 className="w-4 h-4" /></button></div>)}</div>
          : <div className="text-lg font-bold mt-3">Every word right first time.</div>}
        <div className="grid gap-2 mt-6 max-w-xs mx-auto">
          {missed.length > 0 && <button onClick={() => { const q = shuffle(missed); setQueue(q); setTotal(q.length); setI(0); setFirst(0); setMissed([]); setChosen(null); setRepeat(false); }} className="bg-[#111] text-white font-bold rounded-lg py-3">Quiz only these {missed.length}</button>}
          <button onClick={start} className="bg-[#e8552a] text-white font-bold rounded-lg py-3 flex items-center justify-center gap-2"><RotateCcw className="w-4 h-4" /> Same lessons again</button>
          <button onClick={() => setQueue(null)} className="border border-[#111] rounded-lg py-3">Choose lessons</button>
          <button onClick={onBack} className="border border-neutral-300 rounded-lg py-3">All lessons</button>
        </div>
      </div>
    );
  }

  const right = chosen !== null && chosen === show(card);
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1"><button onClick={() => setQueue(null)} className="flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Stop</button><span className="font-mono">{repeat ? `repeat · ${queue.length - i} left` : `${i + 1} / ${total}`} · {first} right</span></div>
      <div className="h-1.5 bg-[#f4f3f1] rounded mb-4"><div className="h-full bg-[#e8552a] rounded" style={{ width: `${(Math.min(i, total) / total) * 100}%` }} /></div>
      <div className="border border-neutral-300 rounded-lg bg-white p-4">
        <div className="font-mono text-[11px] tracking-[0.14em] uppercase text-neutral-600 font-semibold">{repeat ? 'A word you missed' : `Lesson ${card.n}`} · {dir === 'zh-en' ? 'what does it mean?' : 'how do you say it?'}</div>
        {dir === 'zh-en'
          ? <div className="flex items-center gap-3 mt-2"><div className="flex-1"><div className="font-mono text-3xl font-semibold">{card.pinyin}</div><div className="text-3xl mt-1">{card.chinese}</div></div><button onClick={() => speak(card.chinese)} aria-label="Listen" className="w-12 h-12 rounded-full bg-[#e8552a] text-white flex items-center justify-center"><Volume2 className="w-5 h-5" /></button></div>
          : <div className="text-2xl font-semibold mt-2">{card.meaning}</div>}
        <div className="grid gap-2 mt-4">
          {options.map((o) => { const isAns = o === show(card); const mine = o === chosen; return (
            <button key={o} disabled={chosen !== null} onClick={() => choose(o)} className={`text-left rounded-lg px-3 py-3 border touch-manipulation ${dir === 'en-zh' ? 'font-mono text-lg' : 'text-[16px]'} ${chosen === null ? 'border-[#111] bg-[#f4f3f1]' : isAns ? 'bg-green-600 text-white border-green-600' : mine ? 'bg-red-600 text-white border-red-600' : 'border-neutral-200 text-neutral-400'}`}>{o}</button>); })}
        </div>
        {chosen !== null && (
          <div className={`mt-3 rounded-lg p-3 border ${right ? 'bg-green-50 border-green-600' : 'bg-red-50 border-red-600'}`}>
            {right ? <div className="font-bold text-green-700 flex items-center gap-1"><Check className="w-4 h-4" /> Correct</div> : <div className="font-bold text-red-700 flex items-center gap-1"><X className="w-4 h-4" /> Not this one — it comes back at the end</div>}
            <div className="mt-1"><span className="font-mono text-lg font-semibold">{card.pinyin}</span> <span className="text-xl">{card.chinese}</span> = <b>{card.meaning}</b></div>
            <button onClick={next} autoFocus className="mt-3 w-full bg-[#e8552a] text-white font-bold rounded-lg py-3">{i + 1 >= queue.length ? 'See my score' : 'Next'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
