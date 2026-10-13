import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Save, Trash2, Camera, Image as ImageIcon, Film, Plus, X, CheckCircle2, CircleDashed } from 'lucide-react';
import { supabase } from '../lib/supabase';

export const BUCKET = 'factory-media';
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 60;

export const STATUS_LABELS: Record<string, string> = {
  confirmed_solution: 'Confirmed solution',
  supplier_suggestion: 'Supplier suggestion',
  ai_suggestion: 'AI suggestion',
  failed_solution: 'Failed solution',
  unresolved: 'Unresolved',
};
export const STATUS_CLASSES: Record<string, string> = {
  confirmed_solution: 'bg-green-100 text-green-800 border-green-300',
  supplier_suggestion: 'bg-teal-100 text-teal-800 border-teal-300',
  ai_suggestion: 'bg-purple-100 text-purple-800 border-purple-300',
  failed_solution: 'bg-red-100 text-red-800 border-red-300',
  unresolved: 'bg-amber-100 text-amber-800 border-amber-300',
};
export const OUTCOME_LABELS: Record<string, string> = {
  worked: 'Worked',
  failed: 'Failed',
  partial: 'Partly worked',
  pending: 'Not tried yet',
};

export interface FactoryProblem {
  id: string;
  user_id: string | null;
  problem_date: string;
  machine_no: string | null;
  title: string;
  description: string | null;
  question_asked: string | null;
  knowledge_status: string;
  final_solution: string | null;
  result_notes: string | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
}
export interface FactoryMedia {
  id: string;
  problem_id: string;
  media_type: 'photo' | 'video';
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  caption: string | null;
  step_id?: string | null;
  created_at: string;
}
export interface FactoryAnswer {
  id: string;
  problem_id: string;
  answer_zh: string | null;
  answer_en: string | null;
  source: string | null;
  answered_at: string | null;
  created_at: string;
}
export interface FactoryStep {
  id: string;
  problem_id: string;
  step_no: number;
  description: string;
  outcome: string;
  created_at: string;
}

export async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Not logged in');
  return data.user.id;
}

export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  data.forEach((d, i) => { if (d.signedUrl) out[paths[i]] = d.signedUrl; });
  return out;
}

function videoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    const url = URL.createObjectURL(file);
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(v.duration); };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(NaN); };
    v.src = url;
  });
}

async function uploadMedia(problemId: string, file: File, stepId: string | null = null) {
  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if (!isVideo && !isImage) throw new Error(`${file.name}: only photos and videos are allowed`);
  if (file.size > MAX_BYTES) throw new Error(`${file.name}: larger than 50 MB`);
  let duration: number | null = null;
  if (isVideo) {
    duration = await videoDuration(file);
    if (!isNaN(duration) && duration > MAX_VIDEO_SECONDS) throw new Error(`${file.name}: video is ${Math.round(duration)}s — keep videos under ${MAX_VIDEO_SECONDS}s`);
  }
  const uid = await currentUserId();
  const ext = file.name.includes('.') ? file.name.split('.').pop() : isVideo ? 'mp4' : 'jpg';
  const path = `${uid}/${problemId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw new Error(`${file.name}: ${upErr.message}`);
  const { data, error } = await supabase.from('factory_problem_media').insert({
    problem_id: problemId, user_id: uid, media_type: isVideo ? 'video' : 'photo', storage_path: path,
    file_name: file.name, mime_type: file.type, size_bytes: file.size,
    duration_seconds: duration && !isNaN(duration) ? Math.round(duration * 10) / 10 : null, caption: null, step_id: stepId,
  }).select().single();
  if (error) { await supabase.storage.from(BUCKET).remove([path]); throw new Error(error.message); }
  return data;
}

async function deleteMedia(m: FactoryMedia) {
  await supabase.storage.from(BUCKET).remove([m.storage_path]);
  const { error } = await supabase.from('factory_problem_media').delete().eq('id', m.id);
  if (error) throw new Error(error.message);
}

export async function deleteProblemWithMedia(problemId: string) {
  const { data } = await supabase.from('factory_problem_media').select('storage_path').eq('problem_id', problemId);
  const paths = (data ?? []).map((r) => r.storage_path);
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
  const { error } = await supabase.from('factory_problems').delete().eq('id', problemId);
  if (error) throw new Error(error.message);
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  const t = new Date(d);
  return isNaN(t.getTime()) ? d : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtSize(b: number | null | undefined): string {
  if (!b) return '';
  return b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
}

const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm';

function MediaGrid({ items, urls, onDelete, onOpen, small }: { items: FactoryMedia[]; urls: Record<string, string>; onDelete: (m: FactoryMedia) => void; onOpen: (m: FactoryMedia) => void; small?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className={`grid gap-2 ${small ? 'grid-cols-4 sm:grid-cols-6' : 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5'}`}>
      {items.map((m) => (
        <div key={m.id} className="relative group border border-gray-200 rounded-lg overflow-hidden bg-black aspect-square">
          <button onClick={() => onOpen(m)} className="w-full h-full flex items-center justify-center">
            {urls[m.storage_path] ? (m.media_type === 'photo' ? <img src={urls[m.storage_path]} alt="" className="w-full h-full object-cover" /> : <video src={urls[m.storage_path]} className="w-full h-full object-cover" muted preload="metadata" />) : <ImageIcon className="w-6 h-6 text-gray-400" />}
          </button>
          {m.media_type === 'video' && <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1 rounded flex items-center gap-0.5"><Film className="w-3 h-3" />{m.duration_seconds ? `${Math.round(m.duration_seconds)}s` : ''}</span>}
          <button onClick={() => onDelete(m)} className="absolute top-1 right-1 bg-black/60 text-white rounded p-0.5 opacity-0 group-hover:opacity-100 sm:opacity-0 max-sm:opacity-100" title="Delete"><X className="w-3 h-3" /></button>
        </div>
      ))}
    </div>
  );
}

function UploadButton({ onFiles, busy, label }: { onFiles: (f: FileList | null) => void; busy: boolean; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => { onFiles(e.target.files); if (ref.current) ref.current.value = ''; }} />
      <button type="button" onClick={() => ref.current?.click()} disabled={busy} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-teal-300 text-teal-800 bg-white hover:bg-teal-50 rounded-lg disabled:opacity-50"><Camera className="w-3.5 h-3.5" />{busy ? 'Uploading…' : label}</button>
    </>
  );
}

interface Props { problemId: string; onBack: () => void; onDeleted: () => void; }

export default function FactoryProblemDetail({ problemId, onBack, onDeleted }: Props) {
  const [problem, setProblem] = useState<FactoryProblem | null>(null);
  const [machine, setMachine] = useState('');
  const [date, setDate] = useState('');
  const [problemText, setProblemText] = useState('');
  const [answer, setAnswer] = useState('');
  const [media, setMedia] = useState<FactoryMedia[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [steps, setSteps] = useState<FactoryStep[]>([]);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // 'problem' | step id
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<FactoryMedia | null>(null);
  const [newStep, setNewStep] = useState('');
  const [editStep, setEditStep] = useState<{ id: string; text: string } | null>(null);
  const dirty = useRef(false);

  useEffect(() => { load(); }, [problemId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const [p, m, s] = await Promise.all([
      supabase.from('factory_problems').select('*').eq('id', problemId).single(),
      supabase.from('factory_problem_media').select('*').eq('problem_id', problemId).order('created_at'),
      supabase.from('factory_steps').select('*').eq('problem_id', problemId).order('step_no'),
    ]);
    if (p.data) {
      setProblem(p.data);
      if (!dirty.current) {
        setMachine(p.data.machine_no ?? '');
        setDate(p.data.problem_date ?? '');
        setProblemText(p.data.description ?? p.data.title ?? '');
        setAnswer(p.data.final_solution ?? '');
      }
    }
    const md = (m.data ?? []) as FactoryMedia[];
    setMedia(md);
    setUrls(await signedUrls(md.map((x) => x.storage_path)));
    setSteps((s.data ?? []) as FactoryStep[]);
  }

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(null), 2500); }

  async function save() {
    if (!problemText.trim()) { flash('Write the problem first'); return; }
    setSaving(true);
    const title = problemText.trim().split('\n')[0].slice(0, 80);
    const { error } = await supabase.from('factory_problems').update({
      title, description: problemText.trim(), machine_no: machine.trim() || null, problem_date: date || null,
      final_solution: answer.trim() || null,
      knowledge_status: answer.trim() ? 'confirmed_solution' : 'unresolved',
    }).eq('id', problemId);
    setSaving(false);
    if (error) flash(`Save failed: ${error.message}`); else { dirty.current = false; flash('Saved'); load(); }
  }

  async function upload(files: FileList | null, stepId: string | null) {
    if (!files || files.length === 0) return;
    setBusy(stepId ?? 'problem');
    const errors: string[] = [];
    for (const f of Array.from(files)) { try { await uploadMedia(problemId, f, stepId); } catch (e) { errors.push((e as Error).message); } }
    setBusy(null);
    if (errors.length) alert(errors.join('\n'));
    load();
  }
  async function removeMedia(m: FactoryMedia) {
    if (!confirm('Delete this photo/video?')) return;
    try { await deleteMedia(m); load(); } catch (e) { alert((e as Error).message); }
  }

  async function addStep() {
    if (!newStep.trim()) return;
    const uid = await currentUserId();
    const { error } = await supabase.from('factory_steps').insert({ problem_id: problemId, user_id: uid, step_no: steps.length + 1, description: newStep.trim(), outcome: 'worked' });
    if (error) { alert(error.message); return; }
    setNewStep(''); load();
  }
  async function saveStep() {
    if (!editStep) return;
    await supabase.from('factory_steps').update({ description: editStep.text.trim() }).eq('id', editStep.id);
    setEditStep(null); load();
  }
  async function removeStep(s: FactoryStep) {
    if (!confirm(`Delete step ${s.step_no}?`)) return;
    const stepMedia = media.filter((m) => m.step_id === s.id);
    for (const m of stepMedia) { try { await deleteMedia(m); } catch { /* ignore */ } }
    await supabase.from('factory_steps').delete().eq('id', s.id);
    // renumber
    const rest = steps.filter((x) => x.id !== s.id);
    for (let i = 0; i < rest.length; i++) if (rest[i].step_no !== i + 1) await supabase.from('factory_steps').update({ step_no: i + 1 }).eq('id', rest[i].id);
    load();
  }
  async function moveStep(s: FactoryStep, dir: -1 | 1) {
    const idx = steps.findIndex((x) => x.id === s.id); const j = idx + dir;
    if (j < 0 || j >= steps.length) return;
    const other = steps[j];
    await Promise.all([
      supabase.from('factory_steps').update({ step_no: other.step_no }).eq('id', s.id),
      supabase.from('factory_steps').update({ step_no: s.step_no }).eq('id', other.id),
    ]);
    load();
  }

  async function deleteProblem() {
    if (!confirm('Delete this problem with all its photos, videos and steps? This cannot be undone.')) return;
    try { await deleteProblemWithMedia(problemId); onDeleted(); } catch (e) { alert((e as Error).message); }
  }

  if (!problem) return <div className="p-6 text-gray-500">Loading…</div>;

  const problemMedia = media.filter((m) => !m.step_id);
  const solved = !!answer.trim();
  const mark = () => { dirty.current = true; };

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft className="w-4 h-4" />Back</button>
        <div className="flex items-center gap-2">
          {msg && <span className="text-sm text-teal-700">{msg}</span>}
          <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${solved ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{solved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <CircleDashed className="w-3.5 h-3.5" />}{solved ? 'Solved' : 'Open'}</span>
          <button onClick={save} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm disabled:opacity-50"><Save className="w-4 h-4" />{saving ? 'Saving…' : 'Save'}</button>
          <button onClick={deleteProblem} className="p-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg" title="Delete problem"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>

      {/* 1. Problem */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-gray-800">1. Problem</h3>
          <div className="flex gap-2">
            <input value={machine} onChange={(e) => { mark(); setMachine(e.target.value); }} placeholder="Machine" className={`${input} w-24 py-1`} />
            <input type="date" value={date} onChange={(e) => { mark(); setDate(e.target.value); }} className={`${input} w-36 py-1`} />
          </div>
        </div>
        <textarea rows={3} className={input} placeholder="What is wrong? e.g. Machine stops with E3 alarm after 10 minutes" value={problemText} onChange={(e) => { mark(); setProblemText(e.target.value); }} />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-gray-500">{problemMedia.length ? `${problemMedia.length} photo/video` : 'Photos or videos of the fault (videos under 60 s)'}</span>
          <UploadButton onFiles={(f) => upload(f, null)} busy={busy === 'problem'} label="Add photo / video" />
        </div>
        <div className="mt-2"><MediaGrid items={problemMedia} urls={urls} onDelete={removeMedia} onOpen={setPreview} /></div>
      </div>

      {/* 2. Answer */}
      <div className={`border rounded-lg p-4 mb-4 ${solved ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
        <h3 className="text-sm font-bold text-gray-800 mb-2">2. Answer</h3>
        <textarea rows={2} className={input} placeholder="What fixed it, in one or two lines. Leave empty until solved." value={answer} onChange={(e) => { mark(); setAnswer(e.target.value); }} />
      </div>

      {/* 3. Steps */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
        <h3 className="text-sm font-bold text-gray-800 mb-2">3. Steps — how to fix</h3>
        {steps.length === 0 && <p className="text-xs text-gray-500 mb-2">No steps yet. Add one line per step; attach a photo or video to each so a worker can follow it at the machine.</p>}
        <ol className="space-y-3">
          {steps.map((s, i) => {
            const sm = media.filter((m) => m.step_id === s.id);
            return (
              <li key={s.id} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <span className="w-6 h-6 rounded-full bg-teal-600 text-white text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  {editStep?.id === s.id ? (
                    <div className="flex-1 flex gap-2"><input autoFocus className={input} value={editStep.text} onChange={(e) => setEditStep({ ...editStep, text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveStep(); if (e.key === 'Escape') setEditStep(null); }} /><button onClick={saveStep} className="px-2 text-xs bg-teal-600 text-white rounded">OK</button></div>
                  ) : (
                    <p className="flex-1 text-sm text-gray-800 whitespace-pre-wrap cursor-text" onClick={() => setEditStep({ id: s.id, text: s.description })}>{s.description}</p>
                  )}
                  <div className="flex items-center gap-1 text-gray-400 shrink-0">
                    <button onClick={() => moveStep(s, -1)} disabled={i === 0} className="px-1 hover:text-gray-700 disabled:opacity-30" title="Move up">↑</button>
                    <button onClick={() => moveStep(s, 1)} disabled={i === steps.length - 1} className="px-1 hover:text-gray-700 disabled:opacity-30" title="Move down">↓</button>
                    <button onClick={() => removeStep(s)} className="px-1 hover:text-red-600" title="Delete step"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                <div className="mt-2 ml-8 flex items-start gap-2 flex-wrap">
                  <div className="flex-1 min-w-0"><MediaGrid items={sm} urls={urls} onDelete={removeMedia} onOpen={setPreview} small /></div>
                  <UploadButton onFiles={(f) => upload(f, s.id)} busy={busy === s.id} label={sm.length ? 'Add' : 'Photo / video'} />
                </div>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 flex gap-2">
          <input className={input} placeholder={`Step ${steps.length + 1}: what to do`} value={newStep} onChange={(e) => setNewStep(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addStep(); }} />
          <button onClick={addStep} disabled={!newStep.trim()} className="px-3 py-2 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"><Plus className="w-4 h-4" />Add</button>
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <button className="absolute top-4 right-4 text-white"><X className="w-6 h-6" /></button>
          <div onClick={(e) => e.stopPropagation()} className="max-w-4xl max-h-full">
            {preview.media_type === 'photo' ? <img src={urls[preview.storage_path]} alt="" className="max-h-[85vh] max-w-full object-contain" /> : <video src={urls[preview.storage_path]} controls autoPlay className="max-h-[85vh] max-w-full" />}
          </div>
        </div>
      )}
    </div>
  );
}
