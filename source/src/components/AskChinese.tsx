import { useEffect, useRef, useState } from 'react';
import { Send, Trash2, Volume2 } from 'lucide-react';
import { supabase, supabaseAnonKey } from '../lib/supabase';

/* Learn Chinese -> "Ask about this lesson": a teacher chat on every lesson page (/api/chinese, mode 'ask').
   The lesson's own text is sent with the question, so the answer is about THIS lesson. Chats are kept per lesson on this device. */

interface W { pinyin: string; chinese?: string; meaning: string }
export interface AskLesson {
  number: number; title: string; subtitle?: string; words: W[]; extraWords?: W[]; pattern?: string; notes?: string[];
  buildSteps?: W[]; examples?: W[]; conversation?: { speaker: string; pinyin: string; meaning: string }[];
}
type Turn = { role: 'user' | 'assistant'; text: string };
const KEY = 'learn-chinese-ask-v1';
const load = (): Record<number, Turn[]> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };

function speak(text: string) {
  try { const s = window.speechSynthesis; if (!s) return; s.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-CN'; u.rate = 0.85; const v = s.getVoices().find((x) => /^zh/i.test(x.lang)); if (v) u.voice = v; s.speak(u); } catch { /* ignore */ }
}
/* An answer line: Chinese characters in it become tappable (they are spoken). */
const Line = ({ t }: { t: string }) => <>{t.split(/([一-鿿][一-鿿，。？！、,?!\s]*[一-鿿？！。]|[一-鿿])/g).map((p, i) => /[一-鿿]/.test(p)
  ? <button key={i} onClick={() => speak(p)} className="inline-flex items-center gap-0.5 text-[17px] underline decoration-dotted underline-offset-4">{p}<Volume2 className="w-3 h-3 inline" /></button> : <span key={i}>{p}</span>)}</>;

const lessonText = (l: AskLesson) => [
  `Lesson ${l.number}: ${l.title}${l.subtitle ? ' — ' + l.subtitle : ''}`,
  l.pattern ? 'PATTERN: ' + l.pattern : '',
  l.notes?.length ? 'NOTES:\n' + l.notes.map((n) => '- ' + n.replace(/\*\*/g, '')).join('\n') : '',
  'WORDS:\n' + [...l.words, ...(l.extraWords || [])].map((w) => `${w.pinyin} | ${w.chinese || ''} | ${w.meaning}`).join('\n'),
  l.buildSteps?.length ? 'BUILD STEPS:\n' + l.buildSteps.map((w) => `${w.pinyin} = ${w.meaning}`).join('\n') : '',
  l.examples?.length ? 'EXAMPLES:\n' + l.examples.map((w) => `${w.pinyin} | ${w.chinese || ''} | ${w.meaning}`).join('\n') : '',
  l.conversation?.length ? 'CONVERSATION:\n' + l.conversation.map((c) => `${c.speaker}: ${c.pinyin} = ${c.meaning}`).join('\n') : '',
].filter(Boolean).join('\n\n');

export default function AskChinese({ lesson, earlier }: { lesson: AskLesson; earlier: AskLesson[] }) {
  const [all, setAll] = useState<Record<number, Turn[]>>(load);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const turns = all[lesson.number] || [];
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [turns.length, busy]);
  const keep = (t: Turn[]) => { const nx = { ...all, [lesson.number]: t.slice(-40) }; setAll(nx); try { localStorage.setItem(KEY, JSON.stringify(nx)); } catch { /* ignore */ } };

  const ask = async (text: string) => {
    const v = text.trim(); if (!v || busy) return;
    setQ(''); setErr(''); setBusy(true);
    const mine: Turn[] = [...turns, { role: 'user', text: v }]; keep(mine);
    try {
      const { data } = await supabase.auth.getSession();
      const r = await fetch('/api/chinese', {
        method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + (data.session?.access_token || ''), 'x-supabase-key': supabaseAnonKey || '' },
        body: JSON.stringify({ mode: 'ask', lesson: lessonText(lesson), earlier: earlier.flatMap((l) => [...l.words, ...(l.extraWords || [])]).map((w) => `${w.pinyin} (${w.chinese || ''}) = ${w.meaning}`).join('; '), question: v, messages: turns.slice(-10) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.message || j.error || 'The teacher could not answer (' + r.status + ').'); return; }
      keep([...mine, { role: 'assistant', text: String(j.text || '') }]);
    } catch (e) { setErr('No connection to the teacher. ' + String((e as Error).message || e)); }
    finally { setBusy(false); }
  };
  const SUGGEST = ['Explain this lesson\'s pattern in a simple way', 'Give me 5 more example sentences', 'What mistakes do beginners make in this lesson?', 'Test me: ask me one question'];

  return (
    <div id="ask-lesson" className="border-2 border-[#111] rounded-lg bg-white p-3">
      <div className="flex items-center justify-between"><div><b>Ask about this lesson</b><div className="text-xs text-neutral-600">A doubt? Ask the teacher in English. It answers from this lesson. Tap any Chinese to hear it.</div></div>
        {turns.length > 0 && <button onClick={() => { if (confirm('Clear this lesson\'s chat?')) keep([]); }} aria-label="Clear chat" className="text-neutral-500 p-1"><Trash2 className="w-4 h-4" /></button>}</div>
      {turns.length === 0 && <div className="flex flex-wrap gap-2 mt-3">{SUGGEST.map((x) => <button key={x} onClick={() => ask(x)} disabled={busy} className="text-sm border border-neutral-400 rounded-full px-3 py-1.5 bg-[#f4f3f1] text-left">{x}</button>)}</div>}
      <div className="grid gap-2 mt-3">
        {turns.map((t, k) => t.role === 'user'
          ? <div key={k} className="justify-self-end max-w-[88%] bg-[#111] text-white rounded-lg rounded-tr-none px-3 py-2">{t.text}</div>
          : <div key={k} className="max-w-[94%] bg-[#f4f3f1] rounded-lg rounded-tl-none px-3 py-2 text-[15px] leading-relaxed">{t.text.split('\n').map((ln, i) => ln.trim() ? <p key={i} className="mb-1.5 last:mb-0"><Line t={ln.replace(/\*\*/g, '')} /></p> : null)}</div>)}
        {busy && <div className="text-sm text-neutral-600">The teacher is writing…</div>}
        {err && <div className="text-sm text-red-700 border border-red-600 bg-red-50 rounded-lg p-2">{err}</div>}
        <div ref={endRef} />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ask(q); }} placeholder="Type your doubt… e.g. when do I use bù and when méi?" className="flex-1 min-w-0 border border-neutral-400 rounded-lg px-3 py-2.5" />
        <button onClick={() => ask(q)} disabled={busy || !q.trim()} aria-label="Send" className="w-11 h-11 rounded-full bg-[#e8552a] text-white flex items-center justify-center disabled:opacity-40"><Send className="w-5 h-5" /></button>
      </div>
    </div>
  );
}
