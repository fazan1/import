// Vercel serverless function: /api/backup  (source: source/api/backup.cjs -> copied to /api/backup.js at the repo root)
// NIGHTLY OFF-SITE BACKUP. Vercel Cron calls this once a day (vercel.json "crons"). It reads EVERY table of the
// Supabase database with the service-role key (bypasses RLS, all books) and saves one JSON file per day into a
// private GitHub repository (backups/YYYY-MM-DD.json + latest.json). If Supabase is ever lost, the data is in GitHub.
// Needs Vercel env: SUPABASE_SERVICE_ROLE_KEY, BACKUP_GITHUB_TOKEN (repo scope), BACKUP_GITHUB_REPO ("owner/name"),
// CRON_SECRET (Vercel sends it as "Authorization: Bearer <secret>"; a manual run passes ?key=<secret>).
// Optional: SUPABASE_URL, BACKUP_BRANCH (default main). Writes a row to public.backup_log when that table exists.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mhvkhqexkorjjzuldqzp.supabase.co';
const PAGE = 1000;
const SKIP = new Set(['schema_migrations', 'spatial_ref_sys']);

function send(res, status, body) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); }

async function sb(path, key, init) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { ...(init || {}), headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...((init && init.headers) || {}) } });
  return r;
}

async function listTables(key) {
  // PostgREST serves an OpenAPI document at the root: every table the key can see is in "definitions"
  const r = await sb('', key, { headers: { Accept: 'application/openapi+json' } });
  if (!r.ok) throw new Error('Could not list tables: ' + r.status);
  const doc = await r.json();
  return Object.keys(doc.definitions || {}).filter((t) => !SKIP.has(t)).sort();
}

async function dumpTable(table, key) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const r = await sb(`${table}?select=*`, key, { headers: { Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items', Prefer: 'count=exact' } });
    if (r.status === 416) break;
    if (!r.ok) { const t = await r.text(); throw new Error(`${table}: ${r.status} ${t.slice(0, 200)}`); }
    const data = await r.json();
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

async function gh(path, token, init) {
  const r = await fetch((process.env.GITHUB_API || 'https://api.github.com') + path, { ...(init || {}), headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', ...((init && init.headers) || {}) } });
  return r;
}

async function putFile(repo, branch, path, contentB64, message, token) {
  let sha;
  const cur = await gh(`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`, token);
  if (cur.ok) { const j = await cur.json(); sha = j.sha; }
  const r = await gh(`/repos/${repo}/contents/${path}`, token, { method: 'PUT', body: JSON.stringify({ message, content: contentB64, branch, ...(sha ? { sha } : {}) }) });
  if (!r.ok) { const t = await r.text(); throw new Error(`GitHub ${path}: ${r.status} ${t.slice(0, 200)}`); }
  return r.json();
}

async function logRun(key, row) {
  try { await sb('backup_log', key, { method: 'POST', body: JSON.stringify(row), headers: { Prefer: 'return=minimal' } }); } catch { /* table may not exist yet */ }
}

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const url = new URL(req.url, 'http://x');
  if (!secret || (auth !== secret && url.searchParams.get('key') !== secret)) return send(res, 401, { error: 'Not allowed' });

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY, token = process.env.BACKUP_GITHUB_TOKEN, repo = process.env.BACKUP_GITHUB_REPO;
  const branch = process.env.BACKUP_BRANCH || 'main';
  const missing = [!key && 'SUPABASE_SERVICE_ROLE_KEY', !token && 'BACKUP_GITHUB_TOKEN', !repo && 'BACKUP_GITHUB_REPO'].filter(Boolean);
  if (missing.length) return send(res, 503, { error: 'NOT_SET_UP', message: 'Add in Vercel → Settings → Environment Variables: ' + missing.join(', ') });

  const started = Date.now();
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    const tables = await listTables(key);
    const out = { taken_at: new Date().toISOString(), database: SUPABASE_URL, tables: {} };
    const counts = {};
    for (const t of tables) { const rows = await dumpTable(t, key); out.tables[t] = rows; counts[t] = rows.length; }
    const json = JSON.stringify(out);
    const b64 = Buffer.from(json).toString('base64');
    const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
    const msg = `Backup ${stamp}: ${tables.length} tables, ${totalRows} rows`;
    await putFile(repo, branch, `backups/${stamp}.json`, b64, msg, token);
    await putFile(repo, branch, 'latest.json', b64, msg + ' (latest)', token);
    await putFile(repo, branch, 'README.md', Buffer.from(`# Import CRM backups\n\nAutomatic nightly copies of the Supabase database (all books, all tables).\n\nLatest: ${stamp} — ${tables.length} tables, ${totalRows} rows, ${(json.length / 1048576).toFixed(1)} MB.\n\nRestore: Settings → Backup → "Import data (.json)" in the CRM, or ask for the SQL.\n`).toString('base64'), 'README ' + stamp, token);
    const row = { taken_at: out.taken_at, tables: tables.length, rows: totalRows, bytes: json.length, where: `github:${repo}/backups/${stamp}.json`, ok: true, note: null, seconds: Math.round((Date.now() - started) / 1000) };
    await logRun(key, row);
    return send(res, 200, { ok: true, ...row, counts });
  } catch (e) {
    const note = String((e && e.message) || e);
    await logRun(key, { taken_at: new Date().toISOString(), tables: 0, rows: 0, bytes: 0, where: `github:${repo}`, ok: false, note, seconds: Math.round((Date.now() - started) / 1000) });
    return send(res, 500, { ok: false, error: note });
  }
};
