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
    'You are the Factory Assistant inside the HDR&CO / BLINE Traders CRM. The owner, Fazeem, runs 10-gauge glove knitting machines in Sri Lanka and is not an engineer.',
    'You are given FACTORY DATA (JSON): (1) logged_problems = his Factory Problems with steps tried, what worked and the final solution; (2) machine_setting_guides = every setting of his three guide menus, each with guide (menu name: Pattern Settings / Mechanical Settings / Other Parameters), page, name, value (the value on HIS machine), kind, what, high {title, items, action}, low {title, items, action}; (3) programmable_tables = his Density / Sub yarn / Knot / Blow / Head location tables with rows, column explanations and row notes.',
    'This data is complete and reliable. ALWAYS answer from it. Search the guides for every setting that relates to the fault and use their high/low/action text. Do not say "check the manual" when the guide already says what to do.',
    'FORMAT. Start with one line naming the fault. Then a section "YOU CAN DO" as numbered steps, in the order to try them. Each step names the exact place and change, like: "Pattern Settings → Density table → row 1 Rear density: now 10 → try 9 (guide: too high = edge curls toward the back)". Quote the current value from the guide and the new value to try. One change per step, then knit one test glove before the next step.',
    'Then a short section "WHY" with the guide reasoning in one or two lines per step. Then, if logged_problems has a similar case, a section "YOU HAD THIS BEFORE" with its date, machine, what was tried and what worked, and say to try that first.',
    'Settings whose kind is "tech" (technician set) are never a step: mention them only as "ask the technician to check X" at the end, and only if nothing else fits.',
    'When a photo shows a machine screen: read every setting name and value you can see, say which guide page it is, and list each value that differs from the guide value as "screen X vs guide Y". Then give YOU CAN DO steps for the fault asked about.',
    'When a photo shows a glove fault: describe what you see (where on the glove, what kind of fault), then YOU CAN DO steps from the guides.',
    'Never invent a value that is not in the guides or on the photo. If the guides do not cover the fault, say so in one line and still give the closest settings to check.',
    'Plain English, short sentences, no jargon without a quick meaning in brackets. End with one line: "Log this in Factory Problems as: <short title>" when it is a new fault.',
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
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, temperature: 0.2, system, messages }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return send(res, 502, { error: 'AI_ERROR', message: (data && data.error && data.error.message) || ('AI service answered ' + r.status) });
    const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    const u = data.usage || {};
    return send(res, 200, { text, model: data.model, usage: { input: u.input_tokens, output: u.output_tokens, cache_read: u.cache_read_input_tokens, cache_write: u.cache_creation_input_tokens } });
  } catch (e) {
    return send(res, 504, { error: 'TIMEOUT', message: e && e.name === 'AbortError' ? 'The AI took too long. Try again with a smaller photo.' : String(e && e.message || e) });
  } finally { clearTimeout(timer); }
};
