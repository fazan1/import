import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Eye, Lightbulb, Mic, RotateCcw, Send, Volume2 } from 'lucide-react';
import { supabase, supabaseAnonKey } from '../lib/supabase';

/* Learn Chinese -> Talk. A spoken role-play with an AI partner (/api/chinese) that uses only the words of the lessons done.
   The phone listens (speech recognition zh-CN) and speaks (speech synthesis); typing pinyin works too. */

interface W { pinyin: string; chinese?: string; meaning: string }
export interface TalkLesson { number: number; title: string; words: W[]; extraWords?: W[]; examples?: W[] }
interface Line { chinese: string; pinyin: string; english: string }
interface Fb { ok: boolean; heard?: string; better?: Line | null; note?: string }
type Msg = { who: 'ai'; line: Line; show?: boolean } | { who: 'me'; text: string; fb?: Fb | null; secs?: number };

const SCENES: { id: string; name: string; from: number; scene: string }[] = [
  { id: 'meet', name: 'Meet a supplier', from: 1, scene: 'First meeting with a supplier at his shop. Greet, ask what he has, say what you want and do not want.' },
  { id: 'price', name: 'Ask stock and price', from: 4, scene: 'The buyer asks if there is stock, how much for one, and says how many he wants.' },
  { id: 'bargain', name: 'Bargain on the price', from: 6, scene: 'The price is too expensive. The buyer bargains for a cheaper price; the supplier gives a little.' },
  { id: 'pay', name: 'Payment and shipping', from: 7, scene: 'Agreeing when the buyer pays and when the supplier ships; checking if the goods were sent.' },
  { id: 'visit', name: 'Visit the factory', from: 8, scene: 'The buyer is coming to China to visit the factory: when, where, how, and why.' },
  { id: 'problem', name: 'A problem with the goods', from: 11, scene: 'There is a problem with the goods or the price is wrong. The buyer explains, the supplier answers.' },
  { id: 'order', name: 'Samples and an order', from: 16, scene: 'The buyer asks for a sample, checks quality, and places an order.' },
  { id: 'free', name: 'Free talk', from: 1, scene: 'Free small talk between a buyer and a Chinese supplier who are friends.' },
];

/* Every conversation gets a random twist, so the same scene never runs the same way twice. */
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const twist = () => [
  pick(['The supplier is friendly and talkative.', 'The supplier is busy and answers very shortly.', 'The supplier is a tough bargainer.', 'The supplier is polite and a little shy.', 'The supplier is in a hurry.']),
  pick(['The supplier opens with a greeting.', 'The supplier opens by asking what the buyer wants.', 'The supplier opens by asking who the buyer is.', 'The supplier opens by asking where the buyer is.', 'The supplier opens by saying he has goods today.']),
  pick(['He has plenty of stock.', 'He has only a little stock.', 'He has no stock today.', 'His goods are good but expensive.', 'His goods are cheap.', 'His boss is not here today.']),
  pick(['Use different numbers and prices from usual.', 'Ask at least one "why" or "when" question if those words are allowed.', 'Ask the buyer about himself once.', 'Say no to the buyer once, then agree.', 'Ask one question the buyer must answer with a number, if number words are allowed.']),
  'Variation code ' + Math.floor(Math.random() * 100000) + ': make this conversation clearly different from a standard one.',
].join(' ');

let RATE = (() => { try { return localStorage.getItem('learn-chinese-voice') === 'slow' ? 0.7 : 1; } catch { return 1; } })();
function speak(text: string, onEnd?: () => void) {
  try {
    const synth = window.speechSynthesis; if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-CN'; u.rate = RATE;
    const v = synth.getVoices().find((x) => /^zh[-_]CN/i.test(x.lang)) || synth.getVoices().find((x) => /^zh/i.test(x.lang));
    if (v) u.voice = v;
    if (onEnd) u.onend = onEnd;
    synth.speak(u);
  } catch { /* ignore */ }
}
const Spk = ({ text }: { text: string }) => <button onClick={() => speak(text)} aria-label="Listen" className="shrink-0 w-8 h-8 rounded-full border border-current flex items-center justify-center"><Volume2 className="w-4 h-4" /></button>;

export default function TalkChinese({ lessons, level, onBack, onAnswer }: { lessons: TalkLesson[]; level: number; onBack: () => void; onAnswer: () => void }) {
  const [upTo, setUpTo] = useState(level);
  const [scene, setScene] = useState<typeof SCENES[number] | null>(null);
  const [tw, setTw] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [hint, setHint] = useState<Line | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [text, setText] = useState('');
  const [hearing, setHearing] = useState(false);
  const [quick, setQuick] = useState(false);
  const [timerOn, setTimerOn] = useState(false);   // off by default: a learner needs thinking time, not pressure
  const [hintStep, setHintStep] = useState(0);     // 0 hidden, 1 the first word only, 2 the whole line
  const [tick, setTick] = useState(0);
  const t0 = useRef(0);
  useEffect(() => { const id = window.setInterval(() => setTick((x) => x + 1), 250); return () => window.clearInterval(id); }, []);
  const [slow, setSlow] = useState(RATE < 1);
  const flipVoice = () => { const n = !slow; setSlow(n); RATE = n ? 0.7 : 1; try { localStorage.setItem('learn-chinese-voice', n ? 'slow' : 'normal'); } catch { /* ignore */ } };
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy, showHint]);
  useEffect(() => () => { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } }, []);

  const used = lessons.filter((l) => l.number <= upTo);
  const vocab = used.flatMap((l) => [...l.words, ...(l.extraWords || [])]).map((w) => `${w.pinyin} | ${w.chinese || ''} | ${w.meaning}`).join('\n');
  const examples = used.flatMap((l) => (l.examples || []).slice(0, 6)).slice(-60).map((e) => `${e.pinyin} | ${e.chinese || ''} | ${e.meaning}`).join('\n');

  const call = async (sc: typeof SCENES[number], list: Msg[], t = tw) => {
    setBusy(true); setErr(''); setShowHint(false); setHintStep(0);
    try {
      const { data } = await supabase.auth.getSession();
      const post = () => fetch('/api/chinese', {
        method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + (data.session?.access_token || ''), 'x-supabase-key': supabaseAnonKey || '' },
        body: JSON.stringify({ scene: sc.scene + ' ' + t + (quick ? ' QUICK-FIRE DRILL: ask ONE very short, simple question per turn (3 to 6 words) that he can answer in 2 to 4 words; reuse the same few question types again and again with different words so his answers become automatic; no long sentences; about 12 exchanges before closing.' : ''), vocab, examples, messages: list.map((m) => (m.who === 'ai' ? { role: 'assistant', text: m.line.chinese } : { role: 'user', text: m.text })) }),
      });
      let r = await post();
      if (r.status === 502 || r.status === 504) r = await post();   // one quiet second try before showing an error
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.message || j.error || 'The AI partner could not answer (' + r.status + ').'); return; }
      const next = [...list];
      if (j.feedback && next.length && next[next.length - 1].who === 'me') next[next.length - 1] = { ...(next[next.length - 1] as Extract<Msg, { who: 'me' }>), fb: j.feedback };
      next.push({ who: 'ai', line: j.reply });
      setMsgs(next); setHint(j.hint || null); setDone(!!j.done);
      t0.current = Date.now(); speak(j.reply.chinese, () => { t0.current = Date.now(); });
    } catch (e) { setErr('No connection to the AI partner. ' + String((e as Error).message || e)); }
    finally { setBusy(false); }
  };
  const begin = (sc: typeof SCENES[number]) => { const t = twist(); setTw(t); setScene(sc); setMsgs([]); setDone(false); setHint(null); call(sc, [], t); };
  const surprise = () => begin(pick(SCENES.filter((x) => upTo >= x.from)));
  const say = (t: string) => { const v = t.trim(); if (!v || busy || !scene) return; setText(''); onAnswer(); const secs = t0.current ? Math.round((Date.now() - t0.current) / 100) / 10 : undefined; t0.current = 0; const list: Msg[] = [...msgs, { who: 'me', text: v, secs }]; setMsgs(list); call(scene, list); };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const listen = () => {
    if (!SR || hearing || busy) return;
    try {
      window.speechSynthesis?.cancel();
      const r = new SR(); r.lang = 'zh-CN'; r.interimResults = false; r.maxAlternatives = 1; setHearing(true); setErr('');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      r.onresult = (e: any) => say(e.results[0][0].transcript || '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      r.onerror = (e: any) => setErr(e.error === 'not-allowed' ? 'The microphone is blocked. Allow the microphone for this site in the browser settings.' : e.error === 'no-speech' ? 'I did not hear anything. Tap the microphone and speak.' : 'The phone could not listen (' + e.error + ').');
      r.onend = () => setHearing(false);
      r.start();
    } catch { setHearing(false); setErr('The phone could not start listening.'); }
  };

  const mine = msgs.filter((m) => m.who === 'me') as Extract<Msg, { who: 'me' }>[];
  const good = mine.filter((m) => m.fb?.ok).length;
  const timed = mine.filter((m) => m.secs !== undefined && m.secs < 120);
  const avgSecs = timed.length ? Math.round((timed.reduce((a, m) => a + (m.secs || 0), 0) / timed.length) * 10) / 10 : null;
  const waiting = !busy && !done && t0.current ? (Date.now() - t0.current) / 1000 : 0; void tick;

  if (!scene) return (
    <>
      <button onClick={onBack} className="flex items-center gap-1 text-sm mb-3"><ArrowLeft className="w-4 h-4" /> All lessons</button>
      <h1 className="text-2xl font-bold">Talk — AI conversation partner</h1>
      <p className="text-neutral-600 text-sm">Speak with a Chinese "supplier". It uses only the words from your lessons, answers out loud, and corrects you after every line.</p>
      <div className="border border-neutral-300 rounded-lg bg-white p-3 mt-3 flex items-center justify-between gap-3">
        <span className="text-sm">Use the words of lessons 1 to</span>
        <select value={upTo} onChange={(e) => setUpTo(Number(e.target.value))} className="border border-neutral-400 rounded-lg px-3 py-2 font-mono">{lessons.map((l) => <option key={l.number} value={l.number}>{l.number}</option>)}</select>
      </div>
      <label className="border border-neutral-300 rounded-lg bg-white p-3 mt-3 flex items-start gap-3 cursor-pointer"><input type="checkbox" checked={quick} onChange={(e) => setQuick(e.target.checked)} className="mt-1 w-5 h-5" /><span><b>Quick-fire drill</b><span className="block text-xs text-neutral-600">Very short questions, short answers, again and again. This trains you to answer straight in Chinese without going through English first.</span></span></label>
      <label className="border border-neutral-300 rounded-lg bg-white p-3 mt-2 flex items-start gap-3 cursor-pointer"><input type="checkbox" checked={timerOn} onChange={(e) => setTimerOn(e.target.checked)} className="mt-1 w-5 h-5" /><span><b>Show my answer time</b><span className="block text-xs text-neutral-600">Leave this off while you are learning — take all the time you need. Turn it on later to build speed.</span></span></label>
      <button onClick={surprise} className="mt-3 w-full bg-[#e8552a] text-white font-bold rounded-lg py-3.5">Random conversation — surprise me</button>
      <p className="text-xs text-neutral-600 mt-1">Every conversation is different: the supplier's mood, his opening line, his stock and his questions change each time. Or pick a scene:</p>
      <div className="grid gap-2 mt-3">
        {SCENES.map((sc) => { const open = upTo >= sc.from; return (
          <button key={sc.id} disabled={!open} onClick={() => begin(sc)} className={`text-left border rounded-lg p-3 bg-white ${open ? 'border-[#111]' : 'border-neutral-200 opacity-50'}`}>
            <b>{sc.name}</b><span className="block text-xs text-neutral-600">{open ? sc.scene : `Opens with the words of lesson ${sc.from}`}</span>
          </button>); })}
      </div>
      {!SR && <p className="text-sm text-red-700 mt-3">This browser cannot listen to your voice — you can still type in pinyin. For speaking use Chrome on Android or Safari on iPhone.</p>}
    </>
  );

  return (
    <div className="pb-44">
      <div className="flex items-center justify-between text-sm mb-2"><button onClick={() => { window.speechSynthesis?.cancel(); setScene(null); }} className="flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Scenes</button><span className="font-mono text-xs">{scene.name} · lessons 1–{upTo}</span><button onClick={flipVoice} className="text-xs border border-[#111] rounded-full px-2.5 py-1 bg-white">Voice: <b>{slow ? 'slow' : 'normal'}</b></button></div>
      <div className="grid gap-2">
        {msgs.map((m, k) => m.who === 'ai' ? (
          <div key={k} className="max-w-[88%] bg-white border border-neutral-300 rounded-lg rounded-tl-none p-3">
            <div className="flex items-start gap-2"><div className="flex-1"><div className="text-2xl">{m.line.chinese}</div><div className="font-mono text-[15px]">{m.line.pinyin}</div>
              {m.show ? <div className="text-sm text-neutral-600">{m.line.english}</div> : <button onClick={() => setMsgs(msgs.map((x, j) => (j === k ? { ...x, show: true } : x)))} className="text-xs underline text-neutral-600 flex items-center gap-1 mt-0.5"><Eye className="w-3 h-3" /> show English</button>}</div><Spk text={m.line.chinese} /></div>
          </div>
        ) : (
          <div key={k} className="max-w-[88%] justify-self-end">
            <div className="bg-[#111] text-white rounded-lg rounded-tr-none p-3 text-lg">{m.text}{m.fb?.heard && <div className="font-mono text-sm opacity-80">{m.fb.heard}</div>}{timerOn && m.secs !== undefined && m.secs < 120 && <div className={`text-[11px] font-mono mt-0.5 ${m.secs <= 3 ? 'text-green-400' : m.secs <= 6 ? 'text-amber-300' : 'text-red-300'}`}>answered in {m.secs} s</div>}</div>
            {m.fb && <div className={`mt-1 rounded-lg p-2 text-sm border ${m.fb.ok ? 'bg-green-50 border-green-600' : 'bg-amber-50 border-amber-500'}`}>
              <b className={m.fb.ok ? 'text-green-700' : 'text-amber-700'}>{m.fb.ok ? 'Good' : 'Say it this way'}</b>{m.fb.note ? ' — ' + m.fb.note : ''}
              {m.fb.better && <div className="flex items-center gap-2 mt-1 text-[#111]"><div className="flex-1"><div className="text-xl">{m.fb.better.chinese}</div><div className="font-mono">{m.fb.better.pinyin}</div><div className="text-xs text-neutral-600">{m.fb.better.english}</div></div><Spk text={m.fb.better.chinese} /></div>}
            </div>}
          </div>
        ))}
        {busy && <div className="text-sm text-neutral-600">The partner is thinking…</div>}
        {err && <div className="text-sm text-red-700 border border-red-600 bg-red-50 rounded-lg p-2">{err} <button onClick={() => call(scene, msgs)} className="underline font-semibold">Try again</button></div>}
        {done && <div className="border-2 border-[#111] rounded-lg bg-white p-3 text-center"><b>Conversation finished</b><div className="text-sm text-neutral-600">{mine.length} lines spoken · {good} good first time{timerOn && avgSecs !== null ? ` · average answer time ${avgSecs} s` : ''}</div>{timerOn && avgSecs !== null && <div className="text-xs text-neutral-600">{avgSecs <= 3 ? 'Fast — you are starting to answer without translating.' : 'Aim for under 3 seconds. Repeat the same scene: the second time is always faster.'}</div>}<button onClick={() => begin(scene)} className="mt-2 bg-[#e8552a] text-white font-bold rounded-lg px-4 py-2 inline-flex items-center gap-2"><RotateCcw className="w-4 h-4" /> Same scene, new conversation</button><button onClick={surprise} className="mt-2 ml-2 border border-[#111] font-bold rounded-lg px-4 py-2">Random scene</button></div>}
        <div ref={endRef} />
      </div>

      <div className="fixed left-0 right-0 bottom-0 bg-[#f4f3f1] border-t border-neutral-300 p-3 pb-[4.25rem] lg:pb-3">
        <div className="max-w-3xl mx-auto">
          {showHint && hint && <div className="flex items-center gap-2 bg-white border border-neutral-300 rounded-lg p-2 mb-2"><div className="flex-1"><div className="text-xs text-neutral-600">{hintStep < 2 ? 'Start with…' : 'You could say'}</div><div className="font-mono">{hintStep < 2 ? hint.pinyin.split(/\s+/)[0] + ' …' : hint.pinyin}</div>{hintStep >= 2 && <div className="text-xs text-neutral-600">{hint.english}</div>}{hintStep < 2 && <button onClick={() => setHintStep(2)} className="text-xs underline text-[#e8552a] font-semibold">Show the whole line</button>}</div>{hintStep >= 2 && <Spk text={hint.chinese} />}</div>}
          {timerOn && waiting > 0 && <div className="h-1.5 bg-white rounded mb-2 overflow-hidden"><div className={`h-full ${waiting <= 3 ? 'bg-green-600' : waiting <= 6 ? 'bg-amber-500' : 'bg-red-600'}`} style={{ width: `${Math.min(100, (waiting / 8) * 100)}%` }} /></div>}
          <div className="flex items-center gap-2">
            <button onClick={() => { setShowHint(!showHint); if (!showHint) setHintStep(1); }} disabled={!hint} className="w-11 h-11 rounded-full border border-[#111] bg-white flex items-center justify-center disabled:opacity-40" aria-label="Hint"><Lightbulb className="w-5 h-5" /></button>
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') say(text); }} placeholder="or type pinyin…" autoCapitalize="off" autoCorrect="off" spellCheck={false} className="flex-1 min-w-0 border border-neutral-400 rounded-lg px-3 py-2.5 font-mono bg-white" />
            {text.trim() ? <button onClick={() => say(text)} disabled={busy} className="w-11 h-11 rounded-full bg-[#111] text-white flex items-center justify-center" aria-label="Send"><Send className="w-5 h-5" /></button>
              : <button onClick={listen} disabled={!SR || busy} className={`w-14 h-14 rounded-full text-white flex items-center justify-center disabled:opacity-40 ${hearing ? 'bg-red-600 animate-pulse' : 'bg-[#e8552a]'}`} aria-label="Speak"><Mic className="w-6 h-6" /></button>}
          </div>
          <div className="text-[11px] text-neutral-600 mt-1 text-center">{hearing ? 'Listening… speak Chinese now' : 'Take your time. Tap the microphone when you are ready · bulb = help'}</div>
        </div>
      </div>
    </div>
  );
}
