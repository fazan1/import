import { useEffect, useRef, useState } from 'react';
import { supabase, supabaseAnonKey } from '../lib/supabase';
import { fetchAllPages } from '../lib/fetchAll';
import { Send, Image as ImageIcon, X, Bot, Trash2, Loader2, AlertTriangle } from 'lucide-react';

/* FACTORY -> FACTORY ASSISTANT
   Ask a question or attach photos (machine screen, glove fault). The page gathers the owner's factory data under his own
   login — Factory Problems with their steps and solutions, plus the three machine guides (public/glove-guides.json) —
   and sends question + photos + data to /api/assistant (Vercel function, source/api/assistant.js) which calls Claude.
   The API key lives only in Vercel (ANTHROPIC_API_KEY). Chat history stays in this browser (localStorage). */

interface Msg { role: 'user' | 'assistant'; text: string; images?: string[]; at: string; error?: boolean }
interface Problem { id: string; problem_date: string; machine_no: string | null; title: string; description: string | null; question_asked: string | null; knowledge_status: string; final_solution: string | null; result_notes: string | null; tags: string[] | null }
interface Step { problem_id: string; step_no: number; description: string; outcome: string | null; created_at?: string }

const STORE = 'factory-assistant-chat';

async function compress(file: File): Promise<{ type: string; data: string; preview: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const max = 1280; const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/jpeg', 0.82);
    return { type: 'image/jpeg', data: dataUrl.split(',')[1], preview: dataUrl };
  } finally { URL.revokeObjectURL(url); }
}

export default function FactoryAssistant() {
  const [msgs, setMsgs] = useState<Msg[]>(() => { try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { return []; } });
  const [q, setQ] = useState('');
  const [imgs, setImgs] = useState<{ type: string; data: string; preview: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [guides, setGuides] = useState<{ items: unknown[]; tables: unknown[] } | null>(null);
  const [loadNote, setLoadNote] = useState('Loading your factory data…');
  const [sentNote, setSentNote] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const [p, s] = await Promise.all([
        fetchAllPages<Problem>(() => supabase.from('factory_problems').select('id, problem_date, machine_no, title, description, question_asked, knowledge_status, final_solution, result_notes, tags').order('problem_date', { ascending: false }).order('id')),
        fetchAllPages<Step>(() => supabase.from('factory_steps').select('problem_id, step_no, description, outcome, created_at').order('step_no').order('created_at')),
      ]);
      setProblems(p.data); setSteps(s.data);
      let g: { items: unknown[]; tables: unknown[] } | null = null;
      try { const r = await fetch('/glove-guides.json'); if (r.ok) g = await r.json(); } catch { /* guides optional */ }
      setGuides(g);
      setLoadNote(`${p.error || s.error ? 'Could not read all problems. ' : ''}Knows ${p.data.length} logged problem${p.data.length === 1 ? '' : 's'}, ${s.data.length} steps${g ? ` and ${g.items.length} machine settings from the guides` : ' (guides not found)'}.`);
    })();
  }, []);

  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(msgs.slice(-40))); } catch { /* ignore */ } endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  // guides: send only the settings that match the question (names, pages, fault words); with a photo, or when nothing
  // matches, send the whole guide (it is cached by the AI service, so repeats within minutes cost little)
  const STOP = new Set(['the','a','an','and','or','of','to','in','on','at','is','it','my','me','what','why','how','do','does','can','should','i','we','this','that','for','with','when','not','be','are','was','there','from','machine','glove','gloves','problem','please','now','have','has','which','setting','settings','value','values']);
  const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  function pickGuides(question: string, hasPhoto: boolean): { json: string; mode: string } {
    const items = (guides?.items || []) as Record<string, unknown>[];
    const tables = (guides?.tables || []) as Record<string, unknown>[];
    const qw = new Set(words(question + ' ' + msgs.filter((m) => m.role === 'user').slice(-2).map((m) => m.text).join(' ')));
    if (!items.length) return { json: '', mode: 'no guides' };
    if (hasPhoto || !qw.size) return { json: JSON.stringify({ settings: items, tables }), mode: 'all pages' };
    const score = (it: Record<string, unknown>) => { const t = words(JSON.stringify([it.name, it.page, it.what, it.high, it.low]).slice(0, 4000)); let n = 0; const seen = new Set<string>(); t.forEach((w) => { if (qw.has(w) && !seen.has(w)) { seen.add(w); n += (String(it.name).toLowerCase().includes(w) || String(it.page).toLowerCase().includes(w)) ? 3 : 1; } }); return n; };
    const scored = items.map((it) => ({ it, s: score(it) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    if (scored.length < 3) return { json: JSON.stringify({ settings: items, tables }), mode: 'all pages' };
    const keep = scored.slice(0, 45).map((x) => x.it);
    const pages = new Set(keep.map((x) => String(x.guide) + '|' + String(x.page)));
    const tbl = tables.filter((t) => [...qw].some((w) => String(t.table).toLowerCase().includes(w)));
    return { json: JSON.stringify({ settings: keep, tables: tbl }), mode: `${keep.length} matching settings from ${pages.size} pages` };
  }
  function buildProblems(): string {
    const byProblem = new Map<string, Step[]>();
    steps.forEach((s) => { (byProblem.get(s.problem_id) || byProblem.set(s.problem_id, []).get(s.problem_id)!).push(s); });
    const probs = problems.slice(0, 120).map((p) => ({
      date: p.problem_date, machine: p.machine_no, title: p.title, description: p.description, asked: p.question_asked, status: p.knowledge_status,
      solution: p.final_solution, result: p.result_notes, tags: p.tags,
      steps: (byProblem.get(p.id) || []).map((s) => `${s.step_no}. ${s.description}${s.outcome ? ` [${s.outcome}]` : ''}`),
    }));
    return JSON.stringify({ today: new Date().toISOString().slice(0, 10), logged_problems: probs });
  }

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const next = [...imgs];
    for (const f of Array.from(files).slice(0, 4 - imgs.length)) { try { next.push(await compress(f)); } catch { alert('Could not read ' + f.name); } }
    setImgs(next);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function ask() {
    const question = q.trim();
    if ((!question && !imgs.length) || busy) return;
    const mine: Msg = { role: 'user', text: question || '(photo)', images: imgs.map((i) => i.preview), at: new Date().toISOString() };
    const history = msgs.filter((m) => !m.error).slice(-8).map((m) => ({ role: m.role, text: m.text }));
    const picked = pickGuides(question, imgs.length > 0);
    setMsgs((m) => [...m, mine]); setQ(''); const sendImgs = imgs; setImgs([]); setBusy(true); setSentNote('Sending ' + picked.mode + ' of the guides');
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error('You are not signed in. Sign in again and retry.');
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 120000);
      let res: Response;
      try {
        res = await fetch('/api/assistant', { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'x-supabase-key': supabaseAnonKey || '' },
          body: JSON.stringify({ question, images: sendImgs.map((i) => ({ type: i.type, data: i.data })), messages: history, guides: picked.json, problems: buildProblems() }) });
      } finally { clearTimeout(timer); }
      const raw = await res.text();
      let data: { text?: string; message?: string; error?: string } = {};
      try { data = JSON.parse(raw); } catch { throw new Error(res.status === 404 ? 'The assistant service is not deployed on this site yet (/api/assistant missing).' : 'Unexpected answer from the assistant service: ' + raw.slice(0, 120)); }
      if (!res.ok) throw new Error(data.message || data.error || ('Assistant answered ' + res.status));
      setMsgs((m) => [...m, { role: 'assistant', text: data.text || '(no answer)', at: new Date().toISOString() }]);
    } catch (e) {
      const msg = e instanceof Error ? (e.name === 'AbortError' ? 'The assistant took longer than 2 minutes. Try again with a smaller photo.' : e.message) : String(e);
      setMsgs((m) => [...m, { role: 'assistant', text: msg, at: new Date().toISOString(), error: true }]);
    } finally { setBusy(false); }
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto flex flex-col" style={{ minHeight: 'calc(100vh - 80px)' }}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2"><Bot className="w-6 h-6" />Factory Assistant</h1>
          <p className="text-sm text-gray-500 mt-0.5">Ask about a glove fault or a machine screen. Attach photos. Answers use your logged Factory Problems and the machine guides.</p>
          <p className="text-[11px] font-mono text-gray-400 mt-1">{loadNote}{sentNote ? ` · ${sentNote}` : ''}</p>
        </div>
        {msgs.length > 0 && <button onClick={() => { if (confirm('Clear this chat?')) setMsgs([]); }} className="text-xs text-gray-500 hover:text-red-600 flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" />Clear chat</button>}
      </div>

      <div className="flex-1 bg-white border border-gray-200 rounded-lg p-3 sm:p-4 space-y-3 overflow-y-auto">
        {msgs.length === 0 && (
          <div className="text-sm text-gray-500 space-y-2">
            <p>Examples:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Photo of the controller screen + "the wrist elastic is loose, which setting?"</li>
              <li>Photo of a glove + "why are there holes at the finger tips?"</li>
              <li>"Did we have this problem before on machine 3? What fixed it?"</li>
              <li>"What does Depth of front press needle do and what is a safe value?"</li>
            </ul>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-[#111] text-white' : m.error ? 'bg-amber-50 border border-amber-200 text-amber-900' : 'bg-[#f4f3f1] text-gray-900'}`}>
              {m.error && <AlertTriangle className="w-4 h-4 inline mr-1 -mt-0.5" />}
              {m.images && m.images.length > 0 && <div className="flex gap-2 mb-2 flex-wrap">{m.images.map((src, k) => <img key={k} src={src} alt="" className="h-24 rounded-md object-cover border border-white/20" />)}</div>}
              {m.text}
            </div>
          </div>
        ))}
        {busy && <div className="flex justify-start"><div className="bg-[#f4f3f1] rounded-xl px-3.5 py-2.5 text-sm text-gray-600 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Reading your data and the photo…</div></div>}
        <div ref={endRef} />
      </div>

      {imgs.length > 0 && (
        <div className="flex gap-2 mt-3 flex-wrap">
          {imgs.map((im, i) => <div key={i} className="relative"><img src={im.preview} alt="" className="h-20 rounded-md border border-gray-200 object-cover" /><button onClick={() => setImgs(imgs.filter((_, k) => k !== i))} className="absolute -top-2 -right-2 bg-white border border-gray-300 rounded-full p-0.5 text-gray-600 hover:text-red-600"><X className="w-3 h-3" /></button></div>)}
        </div>
      )}
      <div className="mt-3 flex items-end gap-2">
        <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={busy || imgs.length >= 4} className="h-11 w-11 shrink-0 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 flex items-center justify-center" title="Attach a photo (up to 4)"><ImageIcon className="w-5 h-5" /></button>
        <textarea value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }} rows={2} placeholder="Describe the fault or ask a question… (Enter to send, Shift+Enter for a new line)" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 resize-none" />
        <button onClick={ask} disabled={busy || (!q.trim() && !imgs.length)} className="h-11 px-4 shrink-0 rounded-lg bg-[#e8552a] text-white font-medium hover:bg-[#d24a22] disabled:opacity-40 flex items-center gap-2"><Send className="w-4 h-4" />Ask</button>
      </div>
      <p className="text-[11px] text-gray-400 mt-2">Each question sends your Factory Problems and the guides to the AI so it can answer from your own data. It does not change anything in the CRM. Log what worked in Factory Problems so the next answer is better.</p>
    </div>
  );
}
