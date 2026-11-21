// Vercel serverless function: /api/chinese  (source: source/api/chinese.cjs -> copied to /api/chinese.js at the repo root)
// Learn Chinese -> "Talk": a spoken role-play with an AI partner that uses ONLY the words of the lessons the learner has done.
// The page sends the allowed words, the scene and the conversation so far; this returns the partner's next line
// (Chinese + pinyin + English), feedback on the learner's last line, and a hint for what to say next.
// The API key lives only in Vercel (ANTHROPIC_API_KEY). Caller must be a logged-in CRM user.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mhvkhqexkorjjzuldqzp.supabase.co';
// A fast model on purpose: a spoken conversation must answer in about a second or two.
const MODEL = process.env.CHINESE_MODEL || 'claude-haiku-5-5';

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
function extractJson(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

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

  const vocab = str(body.vocab, 30000);
  const examples = str(body.examples, 12000);
  const scene = str(body.scene, 600) || 'Free talk between a buyer and a Chinese supplier.';
  const history = Array.isArray(body.messages) ? body.messages.slice(-14) : [];
  if (!vocab) return send(res, 400, { error: 'No words sent' });

  const system = [
    'You are a patient Chinese speaking partner for a beginner, Fazeem, an importer who buys from Chinese suppliers. You play the OTHER person in a short spoken role-play (usually the supplier / factory boss). He speaks into his phone; his line reaches you as Chinese characters from speech recognition (it may contain wrong characters that SOUND the same) or as pinyin typed without tone marks.',
    'HARD RULE: speak ONLY with the words in ALLOWED WORDS (plus numbers built from the number words there, and the particles in the list). Never use a word that is not in the list. Keep your line to ONE or TWO short sentences, at most 10 words, in the sentence patterns shown in EXAMPLE SENTENCES. End with a question when you can, so he has something to answer.',
    'Stay in the SCENE and move it forward naturally (greet, ask, price, bargain, pay, ship, thank). After about 8 exchanges, close the conversation politely.',
    'FEEDBACK on his last line: judge by SOUND and meaning, not by the characters (他/她, homophones and missing tone marks are fine). ok=true when a Chinese listener would understand it. If it has a real mistake (wrong word, wrong order, missing word), ok=false, give the corrected sentence in "better" and ONE short plain-English reason in "note" (max 18 words, name the word). If ok=true, "note" is a few encouraging words about what he did right (max 10 words) and "better" may be null. If you cannot understand the line at all, ok=false, note = "I could not follow that. Try the hint.", and repeat your previous question as the reply.',
    'HINT: one good line HE could say next, using only the allowed words.',
    'On the first turn (no line from him yet) there is no feedback: set "feedback" to null and open the scene.',
    'Answer with ONE JSON object and nothing else, exactly this shape:',
    '{"reply":{"chinese":"…","pinyin":"… (with tone marks)","english":"…"},"feedback":null | {"ok":true|false,"heard":"his line in pinyin with tone marks","better":null | {"chinese":"…","pinyin":"…","english":"…"},"note":"…"},"hint":{"chinese":"…","pinyin":"…","english":"…"},"done":false}',
    'Set "done" to true on the line that closes the conversation.',
  ].join('\n');

  const messages = [];
  history.forEach((m) => { if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim()) messages.push({ role: m.role, content: m.text.slice(0, 600) }); });
  // the word list is the same on every turn -> its own cached system block (faster and cheaper from the 2nd line on)
  const words = 'ALLOWED WORDS (pinyin | characters | meaning):\n' + vocab + (examples ? '\n\nEXAMPLE SENTENCES:\n' + examples : '');
  const ctx = 'SCENE: ' + scene;
  if (!messages.length || messages[0].role !== 'user') messages.unshift({ role: 'user', content: '(start the conversation)' });
  messages[0] = { role: 'user', content: ctx + '\n\n' + messages[0].content };

  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  // The answer comes back through a forced tool call, so it is always a well-formed object (plain-text JSON was sometimes cut off or wrapped in prose).
  const line = { type: 'object', properties: { chinese: { type: 'string' }, pinyin: { type: 'string' }, english: { type: 'string' } }, required: ['chinese', 'pinyin', 'english'] };
  const tool = { name: 'say', description: 'Give the partner\'s next line, the feedback on the learner\'s last line, and a hint.', input_schema: { type: 'object', properties: {
    reply: line,
    feedback: { type: ['object', 'null'], properties: { ok: { type: 'boolean' }, heard: { type: 'string' }, better: { anyOf: [line, { type: 'null' }] }, note: { type: 'string' } } },
    hint: { anyOf: [line, { type: 'null' }] },
    done: { type: 'boolean' },
  }, required: ['reply', 'done'] } };
  const ask = async (forced) => {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(Object.assign({ model: MODEL, max_tokens: 1200, system: [{ type: 'text', text: system }, { type: 'text', text: words, cache_control: { type: 'ephemeral' } }], messages }, forced ? { tools: [tool], tool_choice: { type: 'tool', name: 'say' } } : {})),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { err: (data && data.error && data.error.message) || ('AI service answered ' + r.status), status: r.status };
    const blocks = data.content || [];
    const tu = blocks.find((c) => c.type === 'tool_use' && c.input);
    let out = tu ? tu.input : extractJson(blocks.filter((c) => c.type === 'text').map((c) => c.text).join('\n'));
    if (out && typeof out.reply === 'string') out.reply = extractJson(out.reply) || { chinese: out.reply, pinyin: '', english: '' };
    return { out, why: (data.stop_reason || '?') + ' / ' + blocks.map((c) => c.type).join(',') };
  };
  try {
    let a = await ask(true);
    if (a.err && a.status === 400) a = await ask(false);          // a model that refuses forced tools: plain JSON instead
    if (!a.err && !(a.out && a.out.reply && a.out.reply.chinese)) { const b = await ask(false); if (b.out && b.out.reply && b.out.reply.chinese) a = b; else if (!a.why && b.why) a.why = b.why; }
    if (a.err) return send(res, 502, { error: 'AI_ERROR', message: a.err });
    const out = a.out;
    if (!out || !out.reply || !out.reply.chinese) return send(res, 502, { error: 'EMPTY', message: 'The AI gave no usable line (' + (a.why || 'no answer') + ', model ' + MODEL + '). Tap again.' });
    out.ms = Date.now() - t0;
    return send(res, 200, out);
  } catch (e) {
    return send(res, 504, { error: 'TIMEOUT', message: e && e.name === 'AbortError' ? 'The AI took too long. Try again.' : String(e && e.message || e) });
  } finally { clearTimeout(timer); }
};
