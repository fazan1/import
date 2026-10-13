import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { FolderOpen, Download, Search, Image as ImageIcon, Film, X, ExternalLink } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import type { FactoryProblem, FactoryMedia, FactoryAnswer, FactoryStep } from './FactoryProblemDetail';
import { STATUS_LABELS, signedUrls, fmtDate, fmtSize } from './FactoryProblemDetail';

type Tab = 'problems' | 'media' | 'steps';

function List({ children, empty }: { children: ReactNode[]; empty: string }) {
  if (!children || children.length === 0) return <Empty text={empty} />;
  return <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">{children}</div>;
}
function Empty({ text }: { text: string }) {
  return <div className="bg-white border border-dashed border-gray-300 rounded-lg p-10 text-center text-gray-500 text-sm">{text}</div>;
}
function Row({ children, onOpen }: { children: ReactNode; onOpen: () => void }) {
  return (
    <div className="px-4 py-3 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">{children}</div>
      <button onClick={onOpen} className="shrink-0 text-teal-700 hover:text-teal-900" title="Open problem"><ExternalLink className="w-4 h-4" /></button>
    </div>
  );
}

export default function FactoryMyData({ onOpenProblem }: { onOpenProblem: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>('problems');
  const [problems, setProblems] = useState<FactoryProblem[]>([]);
  const [media, setMedia] = useState<FactoryMedia[]>([]);
  const [answers, setAnswers] = useState<FactoryAnswer[]>([]);
  const [steps, setSteps] = useState<FactoryStep[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<FactoryMedia | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const [p, m, a, s] = await Promise.all([
      supabase.from('factory_problems').select('*').order('problem_date', { ascending: false }),
      supabase.from('factory_problem_media').select('*').order('created_at', { ascending: false }),
      supabase.from('factory_supplier_answers').select('*').order('answered_at', { ascending: false }),
      supabase.from('factory_steps').select('*').order('step_no'),
    ]);
    setProblems((p.data ?? []) as FactoryProblem[]);
    const md = (m.data ?? []) as FactoryMedia[];
    setMedia(md);
    setAnswers((a.data ?? []) as FactoryAnswer[]);
    setSteps((s.data ?? []) as FactoryStep[]);
    setUrls(await signedUrls(md.map((x) => x.storage_path)));
  }

  const byId = useMemo(() => Object.fromEntries(problems.map((p) => [p.id, p])), [problems]);
  const q = search.trim().toLowerCase();
  const match = (...parts: (string | null | undefined)[]) => !q || parts.join(' ').toLowerCase().includes(q);

  async function exportExcel() {
    setExporting(true);
    try {
      const wb = XLSX.utils.book_new();
      const title = (id: string) => byId[id]?.title ?? '';
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(problems.map((p) => ({
        Date: p.problem_date, Machine: p.machine_no, Title: p.title, Description: p.description, 'Question asked': p.question_asked,
        Status: STATUS_LABELS[p.knowledge_status], 'Final solution': p.final_solution, Result: p.result_notes, Tags: (p.tags ?? []).join(', '), ID: p.id,
      }))), 'Problems');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(answers.map((a) => ({
        Problem: title(a.problem_id), Date: a.answered_at, 'Chinese (original)': a.answer_zh, 'English translation': a.answer_en, Source: a.source,
      }))), 'Supplier answers');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(steps.map((s) => ({
        Problem: title(s.problem_id), Step: s.step_no, Description: s.description, Outcome: s.outcome,
      }))), 'Steps');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(media.map((m) => ({
        Problem: title(m.problem_id), Type: m.media_type, File: m.file_name, Size: fmtSize(m.size_bytes), Seconds: m.duration_seconds, Uploaded: m.created_at, 'Storage path': m.storage_path,
      }))), 'Media');
      XLSX.writeFile(wb, `factory-knowledge-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally { setExporting(false); }
  }

  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: 'problems', label: 'Problems', n: problems.length },
    { id: 'media', label: 'Photos & videos', n: media.length },
    { id: 'steps', label: 'Fix steps', n: steps.length },
  ];

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center space-x-2"><FolderOpen className="w-6 h-6 text-teal-600" /><span>My Data</span></h2>
          <p className="text-sm text-gray-500">Everything you've recorded about the factory, in one place.</p>
        </div>
        <button onClick={exportExcel} disabled={exporting} className="flex items-center space-x-1 px-3 py-2 border border-teal-300 text-teal-800 hover:bg-teal-50 rounded-lg text-sm disabled:opacity-50"><Download className="w-4 h-4" /><span>{exporting ? 'Exporting…' : 'Export to Excel'}</span></button>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-1.5 rounded-lg text-sm border ${tab === t.id ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>{t.label} <span className="opacity-70">({t.n})</span></button>
        ))}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
          <input className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {tab === 'problems' && (
        <List empty="No problems recorded yet.">
          {problems.filter((p) => match(p.title, p.description, p.final_solution, p.machine_no, ...(p.tags ?? []))).map((p) => (
            <Row key={p.id} onOpen={() => onOpenProblem(p.id)}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-gray-900">{p.title}</span>
                {p.machine_no && <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{p.machine_no}</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full ${p.final_solution ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{p.final_solution ? 'Solved' : 'Open'}</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">{fmtDate(p.problem_date)} · {media.filter((m) => m.problem_id === p.id).length} photo/video · {steps.filter((s) => s.problem_id === p.id).length} steps</p>
              {p.final_solution && <p className="text-sm text-green-800 mt-1 truncate">✔ {p.final_solution}</p>}
            </Row>
          ))}
        </List>
      )}

      {tab === 'media' && (media.length === 0 ? <Empty text="No photos or videos uploaded yet." /> : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {media.filter((m) => match(m.file_name, m.caption, byId[m.problem_id]?.title)).map((m) => (
            <div key={m.id} className="border border-gray-200 rounded-lg overflow-hidden bg-white">
              <button onClick={() => setPreview(m)} className="w-full aspect-square bg-black overflow-hidden flex items-center justify-center">
                {urls[m.storage_path] ? (m.media_type === 'photo' ? <img src={urls[m.storage_path]} alt="" className="w-full h-full object-cover" /> : <video src={urls[m.storage_path]} className="w-full h-full object-cover" muted preload="metadata" />) : <ImageIcon className="w-8 h-8 text-gray-400" />}
              </button>
              <div className="p-2 text-xs">
                <button onClick={() => onOpenProblem(m.problem_id)} className="text-teal-700 hover:underline truncate block w-full text-left">{byId[m.problem_id]?.title ?? 'Unknown problem'}</button>
                <div className="text-gray-500 flex items-center space-x-1 mt-0.5">{m.media_type === 'video' ? <Film className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />}<span>{fmtDate(m.created_at)}{m.duration_seconds ? ` · ${m.duration_seconds}s` : ''}</span></div>
              </div>
            </div>
          ))}
        </div>
      ))}

      {tab === 'steps' && (
        <List empty="No fix steps recorded yet.">
          {steps.filter((st) => match(st.description, byId[st.problem_id]?.title)).map((st) => (
            <Row key={st.id} onOpen={() => onOpenProblem(st.problem_id)}>
              <p className="text-sm text-gray-900"><span className="font-bold text-teal-700 mr-2">{st.step_no}.</span>{st.description}</p>
              <p className="text-xs text-gray-400 mt-1">{byId[st.problem_id]?.description?.split('\n')[0] || byId[st.problem_id]?.title} · {media.filter((m) => m.step_id === st.id).length} photo/video</p>
            </Row>
          ))}
        </List>
      )}

      {preview && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <button className="absolute top-4 right-4 text-white"><X className="w-6 h-6" /></button>
          <div onClick={(e) => e.stopPropagation()} className="max-w-4xl max-h-full">
            {preview.media_type === 'photo' ? <img src={urls[preview.storage_path]} alt="" className="max-h-[85vh] max-w-full object-contain" /> : <video src={urls[preview.storage_path]} controls autoPlay className="max-h-[85vh] max-w-full" />}
            <p className="text-white text-xs mt-2 text-center">{byId[preview.problem_id]?.title} · {preview.file_name}</p>
          </div>
        </div>
      )}
    </div>
  );
}
