// Vercel serverless function: /api/assistant
// The CRM's Factory Assistant sends the owner's question (+ photos) and a snapshot of his factory data;
// this function calls Claude and returns the answer. The API key lives ONLY here (Vercel env ANTHROPIC_API_KEY).
// Caller must be a logged-in CRM user: the request carries the Supabase access token, checked against Supabase auth.
// Source of truth: source/api/assistant.cjs (CommonJS; copied to /api/assistant.js at the repo root on deploy, where no package.json = CommonJS).

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mhvkhqexkorjjzuldqzp.supabase.co';
const MODEL = process.env.ASSISTANT_MODEL || 'claude-sonnet-5-5';
const MAX_CONTEXT_CHARS = 180000;   // ~45k tokens of data per question
const MAX_IMAGES = 4;
const MAX_IMAGE_B64 = 1800000;      // ~1.3 MB per image after the page compresses it

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
  if (!key) return send(res, 503, { error: 'NO_KEY', message: 'The assistant is not switched on yet: add ANTHROPIC_API_KEY in Vercel → Project → Settings → Environment Variables, then redeploy.' });

  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { error: 'Bad JSON' }); }
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || body.token;
  const anonKey = req.headers['x-supabase-key'] || body.anonKey || process.env.SUPABASE_ANON_KEY;
  if (!(await userIsMember(token, anonKey))) return send(res, 401, { error: 'Not signed in', message: 'Sign in to the CRM again and retry.' });

  const context = String(body.context || '').slice(0, MAX_CONTEXT_CHARS);
  const history = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  const question = String(body.question || '').slice(0, 8000);
  const images = (Array.isArray(body.images) ? body.images : []).slice(0, MAX_IMAGES)
    .filter((im) => im && typeof im.data === 'string' && im.data.length <= MAX_IMAGE_B64 && /^image\/(jpeg|png|webp|gif)$/.test(im.type || ''));
  if (!question && !images.length) return send(res, 400, { error: 'Nothing asked' });

  const system = [
    'You are the Factory Assistant inside the HDR&CO / BLINE Traders CRM. The owner, Fazeem, runs glove knitting machines (10-gauge) in Sri Lanka and is not an engineer.',
    'Answer in plain, short English. Lead with what to do. Use numbered steps when there is a procedure. One setting change at a time, then knit one test glove.',
    'You are given FACTORY DATA: the owner\'s logged problems (with steps tried and what worked), and the machine SETTING GUIDES (each setting: what it is, too high, too low, action). Base your answer on this data first; say clearly when you are going beyond it.',
    'When a photo shows a machine screen: read the setting names and values, name the page, point out values that differ from the guide values, and say which setting to look at for the fault described.',
    'When a photo shows a glove fault: describe the fault, list the 2 or 3 most likely settings or mechanical causes from the guides, and give the first thing to try.',
    'If a similar problem exists in the logged problems, say so, quote its solution, and suggest trying that first.',
    'Never invent machine values. If the data does not cover something, say so and suggest what to check or photograph.',
    'End with one line: "Log this in Factory Problems as: <short title>" when the question describes a new fault.',
  ].join('\n');

  const content = [];
  images.forEach((im) => content.push({ type: 'image', source: { type: 'base64', media_type: im.type, data: im.data } }));
  content.push({ type: 'text', text: (context ? 'FACTORY DATA (JSON):\n' + context + '\n\n' : '') + 'QUESTION:\n' + (question || 'What do you see in the photo and what should I do?') });

  const messages = [];
  history.forEach((m) => { if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim()) messages.push({ role: m.role, content: m.text.slice(0, 6000) }); });
  messages.push({ role: 'user', content });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 110000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, temperature: 0.2, system, messages }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return send(res, 502, { error: 'AI_ERROR', message: (data && data.error && data.error.message) || ('AI service answered ' + r.status) });
    const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    return send(res, 200, { text, model: data.model, usage: data.usage });
  } catch (e) {
    return send(res, 504, { error: 'TIMEOUT', message: e && e.name === 'AbortError' ? 'The AI took too long. Try again with a smaller photo.' : String(e && e.message || e) });
  } finally { clearTimeout(timer); }
};
