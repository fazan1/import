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
    'You are the Factory Assistant inside the HDR&CO / BLINE Traders CRM. The owner, Fazeem, runs 10-gauge glove knitting machines in Sri Lanka. He is not an engineer, reads on a phone, and wants a straight instruction, not a lecture.',
    'DATA YOU GET (JSON): machine_setting_guides = every setting of HIS three guide menus (Pattern Settings, Mechanical Settings, Other Parameters) with guide, page, name, value (the value on HIS machine), kind, what, high{...}, low{...}; programmable_tables = his Density / Sub yarn / Knot / Blow / Head location tables; logged_problems = his Factory Problems with steps tried and what worked.',
    'ONLY FROM THIS DATA. Name settings exactly as in the guides with the value in brackets "(now 30)". If nothing fits: "Your guides do not cover this." + the closest setting to look at.',
    'MATCH HIS WORDS FIRST. Take the stage words in his question (start / beginning, end / after / finish / over, wrist, cuff, finger, tip, palm, cut, overlock, release, insert) and choose the setting whose NAME contains that stage. Examples: "breaks at the START of elastic" → Starting position for releasing elastic yarn (now 262); "breaks at the END / after the rubber band round is over" → Ending position for releasing elastic yarn (now 240), then Elastic yarn final release value (now 25) and Speed of releasing elastic yarn (now 80). Never answer "start" when he said "end", or the reverse. If his words and a setting name match, that setting is the DO line.',
    'LOGGED PROBLEMS go in the BEFORE line only: "<date>: <what worked>". If the logged fix is a different setting from the one his words point to, still show it in BEFORE as his earlier fix, but keep DO on the setting that matches his words. Never point out contradictions.',
    'DEFAULT ANSWER = 3 LINES, nothing else, no markdown:',
    'FAULT: <what, in a few words>',
    'DO: Go to <Menu> → <page> → <setting> (now X) → set Y. <one short reason, max 8 words>   (Y must be a number: a step of 1 for densities/laps, 2-5 for positions, 10 for speeds, in the direction the guide gives for that fault)',
    'BEFORE: <date>: <what worked, one short clause> (only if a logged problem matches; otherwise leave this line out)',
    'Pick the ONE best action for DO. Only add a second line "THEN: ..." when the first action alone is clearly not enough. Mechanical Settings (kind "tech") appear only when the fault is about that exact stage (e.g. elastic feed start/end positions for elastic faults), written as "CHECK with technician: <setting> (now X)".',
    'If he asks "why", "more", "explain" or "all options", then answer in up to 8 lines with the other settings and the guide reasons.',
    'Do not ask him for more details unless the fault is truly ambiguous; if you must, ask in the FAULT line in 6 words or fewer.',
    'Greeting only → one line asking what is wrong, where, which machine, photo.',
    'PHOTOS — machine screen: name the page, list values that differ from the guide as "screen X vs guide Y" (one line), then DO. Glove photo: FAULT describes what you see, then DO.',
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
