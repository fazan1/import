import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Users, Plus, KeyRound, Shield, X, Check, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { MODULE_GROUPS, ALL_MODULE_IDS, PRESETS } from '../lib/modules';
import type { AppUser } from '../lib/modules';
import { BOOK_BRO } from '../lib/book';

const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm';

// A second client that never touches the admin's own session — used only to create accounts.
function tempClient() {
  return createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export default function UsersPanel({ isAdmin, myId }: { isAdmin: boolean; myId: string }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [edit, setEdit] = useState<AppUser | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [pw, setPw] = useState({ a: '', b: '' });
  const [pwMsg, setPwMsg] = useState('');

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from('app_users').select('*').order('role').order('email');
    setUsers((data ?? []) as AppUser[]);
  }

  async function changeMyPassword() {
    if (pw.a.length < 6) { setPwMsg('At least 6 characters'); return; }
    if (pw.a !== pw.b) { setPwMsg('Passwords do not match'); return; }
    const { error } = await supabase.auth.updateUser({ password: pw.a });
    setPwMsg(error ? error.message : 'Password changed');
    if (!error) setPw({ a: '', b: '' });
  }

  async function deleteUser(u: AppUser) {
    if (!confirm(`Delete the login ${u.email}?\n\nThey will not be able to sign in any more.\nEverything they entered STAYS in its book${u.book ? ` (${u.book})` : ''} — only the login is removed.\n\nThis cannot be undone.`)) return;
    if (prompt(`Type DELETE to confirm removing ${u.email}`) !== 'DELETE') return;
    const { error } = await supabase.rpc('admin_delete_user', { p_user: u.user_id });
    if (error) { alert(error.message.includes('admin_delete_user') ? 'Run user-delete-setup.sql in Supabase first.' : error.message); return; }
    load();
  }

  async function saveUser(u: AppUser) {
    const { error } = await supabase.from('app_users').update({ name: u.name, role: u.role, modules: u.modules, is_active: u.is_active, book: u.role === 'admin' ? null : (u.book || null) }).eq('user_id', u.user_id);
    if (error) { alert(error.message); return; }
    setEdit(null); load();
  }

  return (
    <div className="space-y-6">
      {/* own password — everyone */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3"><KeyRound className="w-4 h-4 text-teal-600" />Change my password</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input type="password" className={input} placeholder="New password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} />
          <input type="password" className={input} placeholder="Repeat" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} />
          <button onClick={changeMyPassword} className="px-3 py-2 bg-teal-600 text-white rounded-lg text-sm">Change</button>
        </div>
        {pwMsg && <p className={`text-xs mt-2 ${pwMsg === 'Password changed' ? 'text-green-700' : 'text-red-600'}`}>{pwMsg}</p>}
      </div>

      {isAdmin && (
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Users className="w-4 h-4 text-teal-600" />Users & permissions</h3>
            <button onClick={() => setShowNew(true)} className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm"><Plus className="w-4 h-4" />Create account</button>
          </div>
          <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
            {users.map((u) => (
              <div key={u.user_id} className={`px-4 py-3 flex items-center gap-3 ${u.is_active ? '' : 'opacity-50'}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900">{u.name || u.email}</span>
                    {u.role === 'admin' && <span className="text-[10px] uppercase bg-gray-900 text-white px-1.5 py-0.5 rounded flex items-center gap-1"><Shield className="w-3 h-3" />Admin</span>}
                    {!u.is_active && <span className="text-[10px] uppercase bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Disabled</span>}
                    {u.user_id === myId && <span className="text-[10px] text-gray-400">(you)</span>}
                  </div>
                  <div className="text-xs text-gray-500 truncate">{u.email} · {u.role === 'admin' ? 'all modules' : `${u.modules.length} of ${ALL_MODULE_IDS.length} modules`}</div>
                </div>
                <button onClick={() => setEdit({ ...u })} className="text-sm text-teal-700 hover:underline">Edit</button>
                {u.user_id !== myId && <button onClick={() => deleteUser(u)} className="text-sm text-red-600 hover:underline flex items-center gap-1" title="Delete this login"><Trash2 className="w-3.5 h-3.5" />Delete</button>}
              </div>
            ))}
            {users.length === 0 && <div className="px-4 py-6 text-sm text-gray-500 text-center">No users yet — run users-permissions.sql first.</div>}
          </div>
          <p className="text-xs text-gray-400 mt-2">Permissions hide screens in the menu. To change a login's password, tap Edit. Delete removes only the login — its records stay.</p>
        </div>
      )}

      {edit && <UserModal title={`Edit — ${edit.email}`} user={edit} onChange={setEdit} onClose={() => setEdit(null)} onSave={() => saveUser(edit)} lockRole={edit.user_id === myId} />}
      {showNew && <NewUserModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}
    </div>
  );
}

function ModulePicker({ modules, role, onChange }: { modules: string[]; role: 'admin' | 'staff'; onChange: (m: string[]) => void }) {
  const has = (id: string) => role === 'admin' || modules.includes(id);
  const toggle = (id: string) => onChange(modules.includes(id) ? modules.filter((x) => x !== id) : [...modules, id]);
  const toggleGroup = (ids: string[]) => { const all = ids.every((i) => modules.includes(i)); onChange(all ? modules.filter((x) => !ids.includes(x)) : Array.from(new Set([...modules, ...ids]))); };
  return (
    <div className={role === 'admin' ? 'opacity-50 pointer-events-none' : ''}>
      <div className="flex gap-1 flex-wrap mb-3">
        {PRESETS.map((p) => <button key={p.label} type="button" onClick={() => onChange(p.modules)} className="px-2.5 py-1 text-xs border border-gray-300 rounded-full hover:bg-gray-50">{p.label}</button>)}
        <button type="button" onClick={() => onChange([])} className="px-2.5 py-1 text-xs border border-gray-300 rounded-full hover:bg-gray-50">None</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {MODULE_GROUPS.map((g) => (
          <div key={g.group} className="border border-gray-200 rounded-lg p-2">
            <button type="button" onClick={() => toggleGroup(g.items.map((i) => i.id))} className="text-xs font-semibold text-gray-700 mb-1 hover:text-teal-700">{g.group}</button>
            {g.items.map((i) => (
              <label key={i.id} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer">
                <input type="checkbox" checked={has(i.id)} onChange={() => toggle(i.id)} className="rounded" />{i.label}
              </label>
            ))}
          </div>
        ))}
      </div>
      {role === 'admin' && <p className="text-xs text-gray-500 mt-2">Admins always see everything.</p>}
    </div>
  );
}

function Shell({ title, children, onClose, footer }: { title: string; children: React.ReactNode; onClose: () => void; footer: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200"><h3 className="font-semibold text-gray-900">{title}</h3><button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button></div>
        <div className="p-5 overflow-y-auto">{children}</div>
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

function UserModal({ title, user, onChange, onClose, onSave, lockRole }: { title: string; user: AppUser; onChange: (u: AppUser) => void; onClose: () => void; onSave: () => void; lockRole: boolean }) {
  return (
    <Shell title={title} onClose={onClose} footer={<><button onClick={onClose} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">Cancel</button><button onClick={onSave} className="px-4 py-1.5 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1"><Check className="w-4 h-4" />Save</button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div><label className="text-xs text-gray-500">Name</label><input className={input} value={user.name ?? ''} onChange={(e) => onChange({ ...user, name: e.target.value })} /></div>
        <div><label className="text-xs text-gray-500">Role</label>
          <select className={input} value={user.role} disabled={lockRole} onChange={(e) => onChange({ ...user, role: e.target.value as 'admin' | 'staff' })}><option value="staff">Staff</option><option value="admin">Admin</option></select>
          {lockRole && <p className="text-[10px] text-gray-400">You can't change your own role.</p>}
        </div>
        <div><label className="text-xs text-gray-500">Login</label>
          <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" checked={user.is_active} disabled={lockRole} onChange={(e) => onChange({ ...user, is_active: e.target.checked })} />Enabled</label>
        </div>
      </div>
      {!lockRole && <SetPassword userId={user.user_id} email={user.email} />}
      <BookPick user={user} onChange={onChange} />
      <ModulePicker modules={user.modules} role={user.role} onChange={(m) => onChange({ ...user, modules: m })} />
    </Shell>
  );
}

function NewUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [u, setU] = useState<AppUser>({ user_id: '', email: '', name: '', role: 'staff', modules: [], is_active: true });
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function create() {
    setErr('');
    if (!u.email.trim() || !u.email.includes('@')) { setErr('Enter a valid email'); return; }
    if (password.length < 6) { setErr('Password: at least 6 characters'); return; }
    setSaving(true);
    const tc = tempClient();
    const { data, error } = await tc.auth.signUp({ email: u.email.trim(), password });
    if (error || !data.user) { setErr(error?.message ?? 'Could not create account'); setSaving(false); return; }
    const { error: e2 } = await supabase.from('app_users').insert({ user_id: data.user.id, email: u.email.trim(), name: u.name || null, role: u.role, modules: u.role === 'admin' ? ALL_MODULE_IDS : u.modules, is_active: true, book: u.role === 'admin' ? null : (u.book || null) });
    setSaving(false);
    if (e2) { setErr('Account created but permissions not saved: ' + e2.message); return; }
    if (!data.session && data.user && !data.user.email_confirmed_at) alert('Account created. If "Confirm email" is ON in Supabase Auth settings, they must click the link in their email before logging in.');
    onCreated();
  }

  return (
    <Shell title="Create account" onClose={onClose} footer={<><button onClick={onClose} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">Cancel</button><button onClick={create} disabled={saving} className="px-4 py-1.5 bg-teal-600 text-white rounded-lg text-sm disabled:opacity-50">{saving ? 'Creating…' : 'Create account'}</button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div><label className="text-xs text-gray-500">Name</label><input className={input} value={u.name ?? ''} onChange={(e) => setU({ ...u, name: e.target.value })} placeholder="e.g. Fazan" /></div>
        <div><label className="text-xs text-gray-500">Email (login)</label><input className={input} type="email" value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} placeholder="name@bline.lk" /></div>
        <div><label className="text-xs text-gray-500">Password</label><input className={input} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="give them this" /></div>
        <div><label className="text-xs text-gray-500">Role</label><select className={input} value={u.role} onChange={(e) => setU({ ...u, role: e.target.value as 'admin' | 'staff' })}><option value="staff">Staff</option><option value="admin">Admin</option></select></div>
      </div>
      {err && <p className="text-sm text-red-600 mb-3">{err}</p>}
      <BookPick user={u} onChange={setU} />
      <ModulePicker modules={u.modules} role={u.role} onChange={(m) => setU({ ...u, modules: m })} />
    </Shell>
  );
}

function BookPick({ user, onChange }: { user: AppUser; onChange: (u: AppUser) => void }) {
  if (user.role === 'admin') return null;
  return (
    <div className="mb-4 border border-amber-200 bg-amber-50 rounded-lg p-3">
      <label className="text-xs font-semibold text-amber-900">Books this login works in</label>
      <select className={input} value={user.book ?? ''} onChange={(e) => onChange({ ...user, book: e.target.value || null })}>
        <option value="">Your books (OLD / LCL 2026) — switch allowed</option>
        <option value={BOOK_BRO}>{BOOK_BRO} only — separate, cannot see your books</option>
      </select>
      <p className="text-[11px] text-amber-800 mt-1">{user.book ? `Locked: this login sees and saves only in ${user.book}. Your records stay invisible to it. Masters (items, suppliers, customers) are shared — it can add new ones but not edit or delete yours.` : 'This login works in your books.'}</p>
    </div>
  );
}

function SetPassword({ userId, email }: { userId: string; email: string }) {
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setMsg('');
    if (pw.length < 6) { setMsg('At least 6 characters'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('admin_set_password', { p_user: userId, p_password: pw });
    setBusy(false);
    if (error) { setMsg(error.message.includes('admin_set_password') ? 'Run staff-password-setup.sql in Supabase first.' : error.message); return; }
    setMsg(`Done — ${email} now logs in with the new password.`); setPw('');
  }
  return (
    <div className="mb-4 border border-gray-200 rounded-lg p-3">
      <label className="text-xs font-semibold text-gray-700">Set a new password for this login</label>
      <div className="flex gap-2 mt-1">
        <input className={input} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="new password (min 6)" />
        <button type="button" onClick={go} disabled={busy} className="shrink-0 px-3 py-2 bg-gray-900 text-white rounded-lg text-sm disabled:opacity-50">{busy ? 'Saving…' : 'Set password'}</button>
      </div>
      {msg && <p className={`text-xs mt-1 ${msg.startsWith('Done') ? 'text-green-700' : 'text-red-600'}`}>{msg}</p>}
    </div>
  );
}
