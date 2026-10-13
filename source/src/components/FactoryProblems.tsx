import { useEffect, useState } from 'react';
import { Wrench, Plus, Search, CheckCircle2, CircleDashed } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { FactoryProblem } from './FactoryProblemDetail';
import FactoryProblemDetail, { currentUserId, fmtDate } from './FactoryProblemDetail';

const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm';

interface Props { openProblemId?: string | null; onOpenChange?: (id: string | null) => void; }

export default function FactoryProblems({ openProblemId = null, onOpenChange }: Props) {
  const [problems, setProblems] = useState<FactoryProblem[]>([]);
  const [counts, setCounts] = useState<Record<string, { media: number; steps: number }>>({});
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'open' | 'solved'>('all');
  const [openId, setOpenId] = useState<string | null>(openProblemId);
  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ machine_no: '', problem_date: new Date().toISOString().slice(0, 10), description: '' });

  useEffect(() => { setOpenId(openProblemId); }, [openProblemId]);
  useEffect(() => { if (!openId) load(); }, [openId]);

  function open(id: string | null) { setOpenId(id); onOpenChange?.(id); }

  async function load() {
    const { data } = await supabase.from('factory_problems').select('*').order('problem_date', { ascending: false }).order('created_at', { ascending: false });
    setProblems((data ?? []) as FactoryProblem[]);
    const [m, a] = await Promise.all([
      supabase.from('factory_problem_media').select('problem_id'),
      supabase.from('factory_steps').select('problem_id'),
    ]);
    const c: Record<string, { media: number; steps: number }> = {};
    (m.data ?? []).forEach((r) => { c[r.problem_id] = c[r.problem_id] ?? { media: 0, steps: 0 }; c[r.problem_id].media++; });
    (a.data ?? []).forEach((r) => { c[r.problem_id] = c[r.problem_id] ?? { media: 0, steps: 0 }; c[r.problem_id].steps++; });
    setCounts(c);
  }

  async function create() {
    if (!draft.description.trim()) return;
    setCreating(true);
    const uid = await currentUserId();
    const text = draft.description.trim();
    const { data, error } = await supabase.from('factory_problems').insert({
      user_id: uid, title: text.split('\n')[0].slice(0, 80), machine_no: draft.machine_no || null, problem_date: draft.problem_date, description: text, knowledge_status: 'unresolved',
    }).select().single();
    setCreating(false);
    if (error) { alert(error.message); return; }
    setShowNew(false);
    setDraft({ machine_no: '', problem_date: new Date().toISOString().slice(0, 10), description: '' });
    open(data.id);
  }

  if (openId) return <FactoryProblemDetail problemId={openId} onBack={() => open(null)} onDeleted={() => open(null)} />;

  const q = search.trim().toLowerCase();
  const filtered = problems.filter((p) => {
    const solved = !!(p.final_solution && p.final_solution.trim());
    if (status === 'open' && solved) return false;
    if (status === 'solved' && !solved) return false;
    if (!q) return true;
    return [p.title, p.description, p.question_asked, p.final_solution, p.machine_no, ...(p.tags ?? [])].join(' ').toLowerCase().includes(q);
  });

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center space-x-2"><Wrench className="w-6 h-6 text-teal-600" /><span>Factory Problems</span></h2>
          <p className="text-sm text-gray-500">Problem → answer → steps with photos and videos.</p>
        </div>
        <button onClick={() => setShowNew(true)} className="flex items-center space-x-1 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium"><Plus className="w-4 h-4" /><span>New problem</span></button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
          <input className={`${input} pl-9`} placeholder="Search title, description, solution, tags…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="px-3 py-2 border border-gray-300 rounded-lg text-sm" value={status} onChange={(e) => setStatus(e.target.value as 'all' | 'open' | 'solved')}>
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="solved">Solved</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-lg p-10 text-center text-gray-500 text-sm">
          {problems.length === 0 ? 'No problems logged yet. Click "New problem" to record the first one.' : 'Nothing matches that search.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {filtered.map((p) => {
            const solved = !!(p.final_solution && p.final_solution.trim());
            return (
              <button key={p.id} onClick={() => open(p.id)} className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {p.machine_no && <span className="text-xs bg-gray-800 text-white px-1.5 py-0.5 rounded">{p.machine_no}</span>}
                    <span className="font-medium text-gray-900">{p.description?.split('\n')[0] || p.title}</span>
                  </div>
                  {solved && <p className="text-sm text-green-800 truncate mt-0.5">✔ {p.final_solution}</p>}
                  <p className="text-xs text-gray-400 mt-1">{fmtDate(p.problem_date)} · {counts[p.id]?.media ?? 0} photo/video · {counts[p.id]?.steps ?? 0} steps</p>
                </div>
                <span className={`shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${solved ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{solved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <CircleDashed className="w-3.5 h-3.5" />}{solved ? 'Solved' : 'Open'}</span>
              </button>
            );
          })}
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-lg shadow-xl w-full max-w-lg p-5 space-y-3">
            <h3 className="text-lg font-semibold text-gray-900">New problem</h3>
            <div className="grid grid-cols-2 gap-3">
              <input className={input} placeholder="Machine no. (e.g. M3)" value={draft.machine_no} onChange={(e) => setDraft({ ...draft, machine_no: e.target.value })} autoFocus />
              <input type="date" className={input} value={draft.problem_date} onChange={(e) => setDraft({ ...draft, problem_date: e.target.value })} />
            </div>
            <textarea rows={3} className={input} placeholder="What is wrong? e.g. Machine stops with E3 alarm after 10 minutes" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            <p className="text-xs text-gray-500">Photos, videos, the answer and the steps go on the next screen.</p>
            <div className="flex justify-end space-x-2">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button>
              <button onClick={create} disabled={creating || !draft.description.trim()} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm disabled:opacity-50">{creating ? 'Creating…' : 'Create & continue'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
