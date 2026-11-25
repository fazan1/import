import { useMemo, useState } from 'react';
import { ArrowLeft, Check, RotateCcw, Volume2, X } from 'lucide-react';

/* Learn Chinese -> Sentence builder (owner: "making a statement, then converting — make a module, I will learn that too").
   The method he learned in chat, as a drill: (1) an English QUESTION is first turned back into a statement (tap the words),
   (2) the statement is built in Chinese from blocks, with the traps he falls into as extra chips (yǒu for "his", tā for
   tā de, ma on a statement, a second action word). Sentences are generated from Lesson 1-2 words, so they never run out.
   Written by me, not from chinese_lessons.json. Marks kept on this device (learn-chinese-builder-v1). */

type B = { e: string; p: string; c: string; role?: 'act' | 'own' | 'who' | 'ma' };
type S = { text: string; form: 'statement' | 'question' | 'negative'; statement: string[]; blocks: B[]; helper?: string };
type Level = 'short' | 'not' | 'long' | 'mixed';

const WHO = [
  { e: 'I', be: 'am', has: 'have', does: 'do', wants: 'want', p: 'wǒ', c: '我', pl: false },
  { e: 'you', be: 'are', has: 'have', does: 'do', wants: 'want', p: 'nǐ', c: '你', pl: false },
  { e: 'he', be: 'is', has: 'has', does: 'does', wants: 'wants', p: 'tā', c: '他', pl: false },
  { e: 'we', be: 'are', has: 'have', does: 'do', wants: 'want', p: 'wǒmen', c: '我们', pl: true },
  { e: 'they', be: 'are', has: 'have', does: 'do', wants: 'want', p: 'tāmen', c: '他们', pl: true },
];
const OWN = [
  { e: 'my', p: 'wǒ de', c: '我的', who: 'I' }, { e: 'your', p: 'nǐ de', c: '你的', who: 'you' }, { e: 'his', p: 'tā de', c: '他的', who: 'he' },
  { e: 'our', p: 'wǒmen de', c: '我们的', who: 'we' }, { e: 'their', p: 'tāmen de', c: '他们的', who: 'they' },
];
const THING = [{ e: 'money', p: 'qián', c: '钱' }, { e: 'goods', p: 'huò', c: '货' }];
const DEMO = [{ e: 'this', p: 'zhège', c: '这个' }, { e: 'that', p: 'nàge', c: '那个' }];
const PERSON = [{ e: 'friend', p: 'péngyou', c: '朋友' }, { e: 'boss', p: 'lǎobǎn', c: '老板' }];
const ACTS = ['shì', 'yǒu', 'yào', 'bú shì', 'méi yǒu', 'bú yào'];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function make(level: Level): S {
  const lv = level === 'mixed' ? pick<Level>(['short', 'short', 'not', 'long']) : level;
  const form: S['form'] = lv === 'not' ? 'negative' : pick<S['form']>(['statement', 'question']);
  const kind = lv === 'long' ? pick(['two-owners', 'owner-has']) : pick(['has', 'is-thing', 'is-person']);
  const neg = form === 'negative';
  let blocks: B[] = [], q = '', helper: string | undefined;

  if (kind === 'has') {                       // He has money / Does he want this?
    const w = pick(WHO), verb = pick(['have', 'want']), t = pick([...THING, ...DEMO]);
    const act: B = verb === 'have' ? (neg ? { e: `${w.does === 'does' ? "doesn't" : "don't"} have`, p: 'méi yǒu', c: '没有', role: 'act' } : { e: w.has, p: 'yǒu', c: '有', role: 'act' })
      : (neg ? { e: `${w.does === 'does' ? "doesn't" : "don't"} want`, p: 'bú yào', c: '不要', role: 'act' } : { e: w.wants, p: 'yào', c: '要', role: 'act' });
    blocks = [{ e: w.e, p: w.p, c: w.c, role: 'who' }, act, { e: t.e, p: t.p, c: t.c }];
    q = `${cap(w.does)} ${w.e} ${verb} ${t.e}?`; helper = w.does;
  } else if (kind === 'is-thing') {           // This is his money
    const d = pick(DEMO), o = pick(OWN), t = pick(THING);
    blocks = [{ e: d.e, p: d.p, c: d.c }, neg ? { e: 'is not', p: 'bú shì', c: '不是', role: 'act' } : { e: 'is', p: 'shì', c: '是', role: 'act' }, { e: o.e, p: o.p, c: o.c, role: 'own' }, { e: t.e, p: t.p, c: t.c }];
    q = `Is ${d.e} ${o.e} ${t.e}?`;
  } else if (kind === 'is-person') {          // He is my friend
    const w = pick(WHO), o = pick(OWN.filter((x) => x.who !== w.e)), n = pick(PERSON);
    blocks = [{ e: w.e, p: w.p, c: w.c, role: 'who' }, neg ? { e: `${w.be} not`, p: 'bú shì', c: '不是', role: 'act' } : { e: w.be, p: 'shì', c: '是', role: 'act' }, { e: o.e, p: o.p, c: o.c, role: 'own' }, { e: n.e + (w.pl ? (n.e === 'boss' ? 'es' : 's') : ''), p: n.p, c: n.c }];
    q = `${cap(w.be)} ${w.e} ${o.e} ${n.e}${w.pl ? (n.e === 'boss' ? 'es' : 's') : ''}?`;
  } else if (kind === 'two-owners') {         // This is your boss's money
    const d = pick(DEMO), o = pick(OWN), n = pick(PERSON), t = pick(THING);
    blocks = [{ e: d.e, p: d.p, c: d.c }, { e: 'is', p: 'shì', c: '是', role: 'act' }, { e: o.e, p: o.p, c: o.c, role: 'own' }, { e: n.e + "'s", p: n.p + ' de', c: n.c + '的', role: 'own' }, { e: t.e, p: t.p, c: t.c }];
    q = `Is ${d.e} ${o.e} ${n.e}'s ${t.e}?`;
  } else {                                    // Your friend has my goods
    const o1 = pick(OWN), n = pick(PERSON), o2 = pick(OWN.filter((x) => x.who !== o1.who)), t = pick(THING), verb = pick(['have', 'want']);
    blocks = [{ e: o1.e, p: o1.p, c: o1.c, role: 'own' }, { e: n.e, p: n.p, c: n.c }, verb === 'have' ? { e: 'has', p: 'yǒu', c: '有', role: 'act' } : { e: 'wants', p: 'yào', c: '要', role: 'act' }, { e: o2.e, p: o2.p, c: o2.c, role: 'own' }, { e: t.e, p: t.p, c: t.c }];
    q = `Does ${o1.e} ${n.e} ${verb} ${o2.e} ${t.e}?`; helper = 'does';
  }
  const statement = blocks.map((b, i) => (i === 0 ? cap(b.e) : b.e));
  if (form === 'question') return { text: q, form, statement, blocks: [...blocks, { e: '?', p: 'ma', c: '吗', role: 'ma' }], helper };
  return { text: statement.join(' ') + '.', form, statement, blocks };
}

/* the wrong chips offered beside the right ones: exactly the slips he makes */
function traps(s: S): B[] {
  const have = new Set(s.blocks.map((b) => b.p)); const out: B[] = [];
  const add = (b: B) => { if (!have.has(b.p) && !out.some((x) => x.p === b.p)) out.push(b); };
  s.blocks.forEach((b) => {
    if (b.role === 'own' && / de$/.test(b.p)) add({ e: '', p: b.p.replace(/ de$/, ''), c: b.c.replace(/的$/, '') });     // tā for tā de
    if (b.role === 'who') add({ e: '', p: b.p + ' de', c: b.c + '的' });                                                   // tā de for tā
    if (b.p === 'zhège') add({ e: '', p: 'nàge', c: '那个' }); if (b.p === 'nàge') add({ e: '', p: 'zhège', c: '这个' });
  });
  [{ e: '', p: 'yǒu', c: '有' }, { e: '', p: 'yào', c: '要' }, { e: '', p: 'shì', c: '是' }].forEach((a) => add(a as B));
  if (s.form !== 'question') add({ e: '', p: 'ma', c: '吗' });
  add({ e: '', p: 'de', c: '的' });
  return shuffle(out).slice(0, 4);
}

function reasons(s: S, got: string[]): string[] {
  const want = s.blocks.map((b) => b.p); const out: string[] = [];
  const acts = got.filter((p) => ACTS.includes(p));
  if (got.includes('ma') && s.form !== 'question') out.push('No ma: this is a statement (it ends with a full stop). ma is only for questions.');
  if (!got.includes('ma') && s.form === 'question') out.push('It is a question, so it needs ma at the end.');
  if (got.includes('ma') && s.form === 'question' && got[got.length - 1] !== 'ma') out.push('ma goes at the very end.');
  if (acts.length === 0) out.push('The action word is missing (shì, yǒu or yào).');
  if (acts.length > 1) out.push('One action word only. If shì is there, yǒu or yào cannot be there too.');
  s.blocks.filter((b) => b.role === 'own').forEach((b) => {
    if (!got.includes(b.p)) {
      const bare = b.p.replace(/ de$/, '');
      if (got.includes(bare)) out.push(`“${b.e}” is the owner block ${b.p}, not just ${bare}. The owner and de go together.`);
      else if (b.e === 'his' && got.includes('yǒu') && !want.includes('yǒu')) out.push('“his” is not “has”. has = yǒu (an action). his = tā de (an owner).');
      else if (got.includes('de')) out.push(`de cannot stand alone. “${b.e}” = ${b.p}.`);
      else out.push(`“${b.e}” is missing: ${b.p}.`);
    }
  });
  s.blocks.filter((b) => b.role === 'who').forEach((b) => { if (!got.includes(b.p) && got.includes(b.p + ' de')) out.push(`“${b.e}” is doing the action here, so it is plain ${b.p}. ${b.p} de is only for something that person owns.`); });
  if (want.includes('zhège') && got.includes('nàge')) out.push('“this” is zhège. nàge is “that”.');
  if (want.includes('nàge') && got.includes('zhège')) out.push('“that” is nàge. zhège is “this”.');
  if (!out.length && [...got].sort().join('|') === [...want].sort().join('|')) out.push('Right words, wrong order. Keep the same order as the English statement.');
  if (!out.length) out.push('Compare with the table below, block by block.');
  return out;
}

function speak(text: string) {
  try { const y = window.speechSynthesis; if (!y) return; y.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-CN'; u.rate = 0.8; const v = y.getVoices().find((x) => /^zh/i.test(x.lang)); if (v) u.voice = v; y.speak(u); } catch { /* ignore */ }
}
const KEY = 'learn-chinese-builder-v1';
const loadBest = (): Record<string, { best: number; rounds: number }> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const LEVELS: { id: Level; name: string; sub: string }[] = [
  { id: 'short', name: 'Short sentences', sub: 'He has money · Is this your goods?' },
  { id: 'not', name: 'With "not"', sub: "I don't have goods · That is not his money" },
  { id: 'long', name: 'Long sentences', sub: "This is your boss's money · Your friend has my goods" },
  { id: 'mixed', name: 'Mixed', sub: 'All kinds, in random order' },
];
const ROUND = 10;

export default function BuilderChinese({ onBack, onAnswer }: { onBack: () => void; onAnswer: () => void }) {
  const [level, setLevel] = useState<Level | null>(null);
  const [n, setN] = useState(0);
  const [score, setScore] = useState(0);
  const [seed, setSeed] = useState(0);
  const [step, setStep] = useState<1 | 2>(1);
  const [picked, setPicked] = useState<number[]>([]);
  const [state, setState] = useState<'ask' | 'right' | 'wrong'>('ask');
  const [slips, setSlips] = useState(0);            // a wrong try on either step = not "right first time"
  const [best, setBest] = useState(loadBest);

  const s = useMemo(() => (level ? make(level) : null), [level, seed]); // eslint-disable-line
  const chips1 = useMemo(() => (s ? shuffle([...s.statement, ...(s.helper ? [s.helper] : [])].map((w, i) => ({ w, i }))) : []), [s]);
  const chips2 = useMemo(() => (s ? shuffle([...s.blocks, ...traps(s)]) : []), [s]);

  const begin = (lv: Level) => { setLevel(lv); setN(0); setScore(0); setSeed((x) => x + 1); setStep(1); setPicked([]); setState('ask'); setSlips(0); };
  if (!level || !s) return (
    <>
      <button onClick={onBack} className="flex items-center gap-1 text-sm mb-3"><ArrowLeft className="w-4 h-4" /> All lessons</button>
      <h1 className="text-2xl font-bold">Sentence builder</h1>
      <p className="text-neutral-600 text-sm">Train the method: turn a question back into a statement, then build it in Chinese block by block. {ROUND} sentences a round, new ones every time. Words of Lessons 1 and 2.</p>
      <div className="grid gap-2 mt-3">{LEVELS.map((l) => <button key={l.id} onClick={() => begin(l.id)} className="text-left border border-[#111] rounded-lg p-3 bg-white flex items-center gap-3"><span className="flex-1"><b>{l.name}</b><span className="block text-xs text-neutral-600">{l.sub}</span></span><span className="text-xs font-mono text-right shrink-0">{best[l.id] ? <>best {best[l.id].best}/{ROUND}<br />{best[l.id].rounds} rounds</> : 'not tried'}</span></button>)}</div>
    </>
  );

  if (n >= ROUND) return (
    <div className="text-center py-8">
      <div className={`text-6xl font-bold ${score >= 8 ? 'text-green-600' : 'text-[#e8552a]'}`}>{score} / {ROUND}</div>
      <div className="text-neutral-600 mt-1">right first time</div>
      <div className="text-lg font-bold mt-3">{score >= 9 ? 'Excellent — this level is yours.' : score >= 7 ? 'Good. One more round to make it solid.' : 'Do this level again; read each explanation.'}</div>
      <div className="grid gap-2 mt-6 max-w-xs mx-auto"><button onClick={() => begin(level)} className="bg-[#e8552a] text-white font-bold rounded-lg py-3 flex items-center justify-center gap-2"><RotateCcw className="w-4 h-4" /> Another round</button><button onClick={() => setLevel(null)} className="border border-[#111] rounded-lg py-3">Choose a level</button><button onClick={onBack} className="border border-neutral-300 rounded-lg py-3">All lessons</button></div>
    </div>
  );

  const needStep1 = s.form === 'question';
  const onStep = needStep1 ? step : 2;
  // the picked numbers belong to the chips of the CURRENT step only (reading them against the other step's chips crashed)
  const got1 = onStep === 1 ? picked.map((k) => chips1[k]?.w || '') : [], got2 = onStep === 2 ? picked.map((k) => chips2[k]?.p || '') : [];
  const check = () => {
    const ok = onStep === 1 ? got1.join(' ') === s.statement.join(' ') : got2.join('|') === s.blocks.map((b) => b.p).join('|');
    if (!ok) setSlips((x) => x + 1);
    setState(ok ? 'right' : 'wrong');
    if (ok && onStep === 2) speak(s.blocks.map((b) => b.c).join(''));
  };
  const retry = () => { setPicked([]); setState('ask'); };
  const next = () => {
    if (onStep === 1) { setStep(2); setPicked([]); setState('ask'); return; }
    onAnswer(); const sc = score + (slips === 0 ? 1 : 0); setScore(sc);
    if (n + 1 >= ROUND) { const b = loadBest(); b[level] = { best: Math.max(b[level]?.best || 0, sc), rounds: (b[level]?.rounds || 0) + 1 }; try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* ignore */ } setBest(b); }
    setN(n + 1); setSeed((x) => x + 1); setStep(1); setPicked([]); setState('ask'); setSlips(0);
  };
  const chips = onStep === 1 ? chips1.map((c) => c.w) : chips2.map((c) => c.p);
  const why = state === 'wrong' ? (onStep === 1
    ? [got1.includes(s.helper || '§') ? `Drop “${s.helper}”: it only makes the question in English.` : 'Start with the person or thing, then the action word. Nothing else moves.']
    : reasons(s, got2)) : [];

  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1"><button onClick={() => setLevel(null)} className="flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Levels</button><span className="font-mono">{n + 1} / {ROUND} · {score} right</span></div>
      <div className="h-1.5 bg-[#f4f3f1] rounded mb-4"><div className="h-full bg-[#e8552a] rounded" style={{ width: `${(n / ROUND) * 100}%` }} /></div>
      <div className="border border-neutral-300 rounded-lg bg-white p-4">
        <div className="font-mono text-[11px] tracking-[0.14em] uppercase text-neutral-600 font-semibold">{s.form === 'question' ? 'A question' : s.form === 'negative' ? 'A statement with "not"' : 'A statement'}</div>
        <div className="text-2xl font-semibold mt-1">{s.text}</div>
        {needStep1 && onStep === 2 && <div className="text-sm text-neutral-600 mt-1">As a statement: <b>{s.statement.join(' ')}.</b></div>}
        <div className="mt-4 text-sm font-semibold">{onStep === 1 ? 'Step 1 — undo the swap: tap the words to make it a statement' : `${needStep1 ? 'Step 2' : 'Build it'} — tap the Chinese blocks in order${s.form === 'question' ? ', then finish the question' : ''}`}</div>
        <div className="min-h-[52px] border-2 border-dashed border-neutral-300 rounded-lg p-2 flex flex-wrap gap-2 mt-2">
          {picked.map((k, i) => <button key={i} disabled={state !== 'ask'} onClick={() => setPicked(picked.filter((_, m) => m !== i))} className="px-3 py-2 rounded-lg bg-[#111] text-white font-mono touch-manipulation">{chips[k]}</button>)}
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {chips.map((w, k) => <button key={k} disabled={state !== 'ask' || picked.includes(k)} onClick={() => setPicked([...picked, k])} className={`px-3 py-2 rounded-lg border border-[#111] font-mono touch-manipulation ${picked.includes(k) ? 'opacity-25' : 'bg-[#f4f3f1]'}`}>{w}</button>)}
        </div>
        {state === 'ask' && <button disabled={!picked.length} onClick={check} className="mt-4 w-full bg-[#111] text-white font-bold rounded-lg py-3 disabled:opacity-40">Check</button>}

        {state !== 'ask' && (
          <div className={`mt-4 rounded-lg p-3 border ${state === 'right' ? 'bg-green-50 border-green-600' : 'bg-red-50 border-red-600'}`}>
            {state === 'right' ? <div className="font-bold text-green-700 flex items-center gap-1"><Check className="w-4 h-4" /> Correct</div> : <div className="font-bold text-red-700 flex items-center gap-1"><X className="w-4 h-4" /> Not quite</div>}
            {why.length > 0 && <ul className="list-disc pl-5 text-[15px] mt-1 space-y-0.5">{why.map((w, i) => <li key={i}>{w}</li>)}</ul>}
            {onStep === 1 ? <div className="mt-2 text-lg font-semibold">{s.statement.join(' ')}.</div> : (
              <div className="mt-2">
                <div className="overflow-x-auto"><table className="text-sm border-collapse"><tbody>
                  <tr>{s.blocks.map((b, i) => <td key={i} className="border border-neutral-300 px-2 py-1 font-mono font-semibold bg-white">{b.p}</td>)}</tr>
                  <tr>{s.blocks.map((b, i) => <td key={i} className="border border-neutral-300 px-2 py-1 text-neutral-600 bg-white">{b.e}</td>)}</tr>
                </tbody></table></div>
                <div className="flex items-center gap-3 mt-2"><div className="text-2xl flex-1">{s.blocks.map((b) => b.c).join('')}{s.form === 'question' ? '?' : ''}</div><button onClick={() => speak(s.blocks.map((b) => b.c).join(''))} aria-label="Listen" className="w-9 h-9 rounded-full border border-[#111] flex items-center justify-center"><Volume2 className="w-4 h-4" /></button></div>
              </div>
            )}
            {state === 'wrong' ? <div className="grid grid-cols-2 gap-2 mt-3"><button onClick={retry} className="border border-[#111] bg-white rounded-lg py-2.5 font-semibold">Try again</button><button onClick={next} className="bg-[#e8552a] text-white rounded-lg py-2.5 font-bold">{onStep === 1 ? 'Go to step 2' : n + 1 === ROUND ? 'See my score' : 'Next'}</button></div>
              : <button onClick={next} className="mt-3 w-full bg-[#e8552a] text-white font-bold rounded-lg py-3">{onStep === 1 ? 'Now build it in Chinese' : n + 1 === ROUND ? 'See my score' : 'Next'}</button>}
          </div>
        )}
      </div>
    </div>
  );
}
