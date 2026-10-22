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

  // data comes in two parts: the guides (large, stable -> cached by the AI service when big) and the owner's problems (small)
  const guides = String(body.guides || '').slice(0, MAX_CONTEXT_CHARS);
  const problems = String(body.problems || body.context || '').slice(0, 60000);
  const history = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  const question = String(body.question || '').slice(0, 8000);
  const images = (Array.isArray(body.images) ? body.images : []).slice(0, MAX_IMAGES)
    .filter((im) => im && typeof im.data === 'string' && im.data.length <= MAX_IMAGE_B64 && /^image\/(jpeg|png|webp|gif)$/.test(im.type || ''));
  if (!question && !images.length) return send(res, 400, { error: 'Nothing asked' });

  const system = [
    'You are the Factory Assistant inside the HDR&CO / BLINE Traders CRM. The owner, Fazeem, runs 10-gauge glove knitting machines in Sri Lanka. He is not an engineer and reads on a phone.',
    'DATA YOU GET (JSON): machine_setting_guides = every setting of HIS three guide menus (Pattern Settings, Mechanical Settings, Other Parameters) with: guide, page, name, value (the value on HIS machine), kind, what, high{title,items,action}, low{title,items,action}; programmable_tables = his Density / Sub yarn / Knot / Blow / Head location tables; logged_problems = his Factory Problems with steps tried and what worked.',
    'RULE 1 — ONLY FROM THIS DATA. Every setting you name must exist in machine_setting_guides, written exactly as there, with its value in brackets like "(now 130)". Reasons come from the guide\'s own high/low/action text, cut to a few words. If nothing fits: one line "Your guides do not cover this." plus at most 2 settings to look at. No general advice from outside the data.',
    'RULE 2 — PRECISE. First find WHERE and WHEN the fault happens (start of glove, wrist, elastic feed, finger change, cut-off, overlock, end). Then pick the settings whose name or "what" text is about THAT exact stage and part. Example: elastic breaking at the START → the Mechanical Settings elastic settings (Starting / Ending position for releasing elastic yarn, elastic release speed) and the head speed while inserting elastic come BEFORE general density values. Mechanical Settings (kind "tech") MUST be included when they are about the faulty stage: give them as a CHECK line with their values, to be done with the technician, not as a value to change blindly.',
    'RULE 3 — SHORT. Maximum 6 lines, each line one sentence. No introduction, no repetition, no closing, no markdown. Exact shape:',
    'FAULT: <one line: what + where/when>',
    'CHECK: <Mechanical Settings → page → setting (now X) and setting (now Y)> — <why in a few words> (only when a mechanical setting is about this stage)',
    'DO FIRST: <Menu> → <page> → <setting> (now X) → try Y. <reason in a few words>',
    'THEN: <one more step, same shape> (only if clearly needed)',
    'BEFORE: <date, machine: what worked, in one sentence> (only if logged_problems has a similar case)',
    'LOG AS: <short title>',
    'RULE 4 — one change at a time, test one glove between steps (say it once, in DO FIRST). Greeting only → one line asking what is wrong, where, which machine, photo.',
    'PHOTOS — machine screen: name the page, list values that differ from the guide as "screen X vs guide Y", then the shape above. Glove photo: FAULT describes what you see, then the shape above.',
  ].join('\n');

  const content = [];
  images.forEach((im) => content.push({ type: 'image', source: { type: 'base64', media_type: im.type, data: im.data } }));
  if (guides) {
    const block = { type: 'text', text: 'MACHINE SETTING GUIDES (JSON, the owner\'s own guide menus):\n' + guides };
    if (guides.length > 12000) block.cache_control = { type: 'ephemeral' };   // same guide text within 5 min = 90% cheaper
    content.push(block);
  }
  content.push({ type: 'text', text: (problems ? 'LOGGED PROBLEMS (JSON):\n' + problems + '\n\n' : '') + 'QUESTION:\n' + (question || 'What do you see in the photo and what should I do?') });

  const messages = [];
  history.forEach((m) => { if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim()) messages.push({ role: m.role, content: m.text.slice(0, 6000) }); });
  messages.push({ role: 'user', content });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 110000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, system, messages }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return send(res, 502, { error: 'AI_ERROR', message: (data && data.error && data.error.message) || ('AI service answered ' + r.status) });
    const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    const u = data.usage || {};
    if (!text) {
      const types = (data.content || []).map((c) => c.type).join(',') || 'none';
      return send(res, 502, { error: 'EMPTY', message: 'The AI returned no text (stop reason: ' + (data.stop_reason || '?') + ', content: ' + types + '). Try asking again, or shorter.', usage: u });
    }
    return send(res, 200, { text, model: data.model, usage: { input: u.input_tokens, output: u.output_tokens, cache_read: u.cache_read_input_tokens, cache_write: u.cache_creation_input_tokens } });
  } catch (e) {
    return send(res, 504, { error: 'TIMEOUT', message: e && e.name === 'AbortError' ? 'The AI took too long. Try again with a smaller photo.' : String(e && e.message || e) });
  } finally { clearTimeout(timer); }
};
