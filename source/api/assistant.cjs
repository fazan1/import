// Vercel serverless function: /api/assistant  (source: source/api/assistant.cjs -> copied to /api/assistant.js at the repo root)
// "Ask about this setting": the guide pages send ONE selected setting (+ the other settings of the same page) and the
// owner's question; this calls Claude and returns a short plain-English explanation. The API key lives only in Vercel
// (ANTHROPIC_API_KEY). Caller must be a logged-in CRM user: the Supabase access token is checked against Supabase auth.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mhvkhqexkorjjzuldqzp.supabase.co';
const MODEL = process.env.ASSISTANT_MODEL || 'claude-sonnet-5-5';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function userIsMember(token, anonKey) {
  if (!token || !anonKey) return false;
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: anonKey, Authorization: 'Bearer ' + token } });
    if (!r.ok) return false;
    const u = await r.json();
    return !!(u && u.id);
  } catch { return false; }
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return send(res, 503, { error: 'NO_KEY', message: 'Not switched on yet: add ANTHROPIC_API_KEY in Vercel → Project → Settings → Environment Variables, then redeploy.' });

  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { error: 'Bad JSON' }); }
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || body.token;
  const anonKey = req.headers['x-supabase-key'] || body.anonKey || process.env.SUPABASE_ANON_KEY;
  if (!(await userIsMember(token, anonKey))) return send(res, 401, { error: 'Not signed in', message: 'Sign in to the CRM again and retry.' });

  const setting = String(body.setting || '').slice(0, 20000);
  const page = String(body.page || '').slice(0, 60000);
  const table = String(body.table || '').slice(0, 20000);
  const pageName = String(body.pageName || '').slice(0, 300);
  const question = String(body.question || '').trim().slice(0, 4000);
  const history = Array.isArray(body.messages) ? body.messages.slice(-8) : [];
  if (!setting || !question) return send(res, 400, { error: 'Nothing asked' });

  const system = [
    'You explain the settings of a 10-gauge seamless glove knitting machine (Chinese make, computerised controller) to its owner, Fazeem, who is not an engineer and reads on a phone.',
    'You get: SELECTED SETTING (the setting he tapped: name, value on HIS machine, what it is, what happens too high / too low, action), TABLE ON THIS PAGE (the real values programmed on his machine, when the page has a table) and OTHER SETTINGS OF THE SAME PAGE.',
    'Treat the table and the settings as ONE thing: the table holds the numbers, the settings explain them. When he asks about a table column or row, read the actual numbers from the table and explain them together with the setting text (e.g. "row 1: front rows 1-2 density 7, rear rows 1-2 density 10"). Never say the table is separate from the setting.',
    'FIXED FACTS of this machine (use them even if the guide text disagrees): DENSITY = stitch length; a HIGHER density number knits a LONGER stitch, so that zone comes out LONGER and LOOSER; a LOWER number knits TIGHTER and SHORTER. Example: middle finger 54 (longest finger), little finger 42 (shortest), start rows 7/10 (tightest). Positions are in courses or rows; speeds in machine units; laps = turns of elastic.',
    'Use the guide text first. Where the guide is silent, use general knowledge of glove knitting machines and say "(general knowledge)" after that sentence. Never invent a number that is not in the data; a recommended change is always relative to HIS value ("now 262 -> try 258").',
    'Plain English, short: 2 to 5 lines, phone-sized. Give a concrete example with his value when it helps. No markdown, no headings, no introductions.',
    'If he asks what value to set for a fault, answer with one number and one reason, in the right direction.',
  ].join('\n');

  const messages = [];
  history.forEach((m) => { if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim()) messages.push({ role: m.role, content: m.text.slice(0, 3000) }); });
  messages.push({ role: 'user', content: (pageName ? 'PAGE: ' + pageName + '\n\n' : '') + 'SELECTED SETTING:\n' + setting + (table ? '\n\nTABLE ON THIS PAGE (values on his machine):\n' + table : '') + (page ? '\n\nOTHER SETTINGS OF THE SAME PAGE:\n' + page : '') + '\n\nQUESTION:\n' + question });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, system, messages }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return send(res, 502, { error: 'AI_ERROR', message: (data && data.error && data.error.message) || ('AI service answered ' + r.status) });
    const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    if (!text) return send(res, 502, { error: 'EMPTY', message: 'The AI returned no text (' + (data.stop_reason || '?') + '). Ask again.' });
    return send(res, 200, { text });
  } catch (e) {
    return send(res, 504, { error: 'TIMEOUT', message: e && e.name === 'AbortError' ? 'The AI took too long. Try again.' : String(e && e.message || e) });
  } finally { clearTimeout(timer); }
};
