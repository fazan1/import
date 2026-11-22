// Vercel serverless function: /api/chinese  (source: source/api/chinese.cjs -> copied to /api/chinese.js at the repo root)
// Learn Chinese -> "Talk": a spoken role-play with an AI partner that uses ONLY the words of the lessons the learner has done.
// The page sends the allowed words, the scene and the conversation so far; this returns the partner's next line
// (Chinese + pinyin + English), feedback on the learner's last line, and a hint for what to say next.
// The API key lives only in Vercel (ANTHROPIC_API_KEY). Caller must be a logged-in CRM user.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mhvkhqexkorjjzuldqzp.supabase.co';
// Conversation quality matters more than a second of speed (the learner himself needs time to answer).
const MODEL = process.env.CHINESE_MODEL || 'claude-sonnet-5-5';   // the fast model asked odd questions and judged misheard lines literally

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

  // ---- "Ask about this lesson": a teacher chat inside each lesson (plain text answer)
  if (body.mode === 'ask') {
    const lesson = str(body.lesson, 30000), earlier = str(body.earlier, 12000), question = str(body.question, 2000).trim();
    if (!lesson || !question) return send(res, 400, { error: 'Nothing asked' });
    const sysAsk = [
      'You are the teacher of a 16-lesson spoken business Chinese course. The learner, Fazeem, is a beginner importer who reads on a phone. He is studying ONE lesson (given as LESSON) and asks you a doubt about it.',
      'Answer the doubt directly, in simple English, short: 3 to 7 lines. No markdown, no headings, no bullet symbols; plain lines.',
      'Every Chinese word or sentence you write must be given as: pinyin with tone marks, then the characters, then the English meaning. Example: wǒ yào huò (我要货) = I want goods.',
      'Explain with the words of this lesson and of the EARLIER LESSONS first. If the doubt needs a word he has not learned, you may give it but mark it "(new word, not in your lessons yet)".',
      'Base grammar explanations on the lesson\'s own pattern and notes; do not contradict them. If the lesson text itself answers the doubt, point to it ("as the note says...").',
      'If he asks for more examples, give at most 5. If he asks you to test him, ask ONE question at a time and wait for his answer; then say if it is right and why.',
      'If the question is not about Chinese, say in one line that this chat is only for the lesson.',
    ].join('\n');
    const hist = (Array.isArray(body.messages) ? body.messages.slice(-10) : []).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim()).map((m) => ({ role: m.role, content: m.text.slice(0, 2500) }));
    while (hist.length && hist[0].role !== 'user') hist.shift();
    hist.push({ role: 'user', content: question });
    for (let k = hist.length - 2; k >= 0; k--) if (hist[k].role === hist[k + 1].role) hist.splice(k, 1);
    const c2 = new AbortController(); const tm = setTimeout(() => c2.abort(), 60000);
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: c2.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: process.env.CHINESE_ASK_MODEL || process.env.ASSISTANT_MODEL || 'claude-sonnet-5-5', max_tokens: 900, system: [{ type: 'text', text: sysAsk }, { type: 'text', text: 'LESSON:\n' + lesson + (earlier ? '\n\nEARLIER LESSONS (words he already knows):\n' + earlier : ''), cache_control: { type: 'ephemeral' } }], messages: hist }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return send(res, 502, { error: 'AI_ERROR', message: (data && data.error && data.error.message) || ('AI service answered ' + r.status) });
      const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
      if (!text) return send(res, 502, { error: 'EMPTY', message: 'The teacher gave no answer (' + (data.stop_reason || '?') + '). Ask again.' });
      return send(res, 200, { text });
    } catch (e) {
      return send(res, 504, { error: 'TIMEOUT', message: e && e.name === 'AbortError' ? 'The teacher took too long. Ask again.' : String(e && e.message || e) });
    } finally { clearTimeout(tm); }
  }

  const vocab = str(body.vocab, 30000);
  const examples = str(body.examples, 12000);
  const scene = str(body.scene, 600) || 'Free talk between a buyer and a Chinese supplier.';
  const history = Array.isArray(body.messages) ? body.messages.slice(-14) : [];
  if (!vocab) return send(res, 400, { error: 'No words sent' });

  const system = [
    'You are a patient Chinese speaking partner for a beginner, Fazeem, an importer who buys from Chinese suppliers. You play the OTHER person in a short spoken role-play (usually the supplier / factory boss). He speaks into his phone; his line reaches you as Chinese characters from speech recognition (it may contain wrong characters that SOUND the same) or as pinyin typed without tone marks.',
    'HARD RULE (checked by a program after you answer; a line with any other word is rejected): speak ONLY with the words in ALLOWED WORDS (plus numbers built from the number words there, and the particles in the list). Never use a word that is not in the list. Keep your line to ONE or TWO short sentences, at most 10 words, in the sentence patterns shown in EXAMPLE SENTENCES. End with a question when you can, so he has something to answer.',
    'The scene and the mood are only a direction: show them ONLY with allowed words. If the list has no greeting, do not greet; if it has no word for a mood (busy, hurry...), do not say it. Stay in the SCENE and move it forward naturally. After about 8 exchanges, close the conversation politely.',
    'FEEDBACK on his last line: judge by SOUND and meaning, not by the characters (他/她, homophones and missing tone marks are fine). ok=true when a Chinese listener would understand it. If it has a real mistake (wrong word, wrong order, missing word), ok=false, give the corrected sentence in "better" and ONE short plain-English reason in "note" (max 18 words, name the word). If ok=true, "note" is a few encouraging words about what he did right (max 10 words) and "better" may be null. If you cannot understand the line at all, ok=false, note = "I could not follow that. Try the hint.", and repeat your previous question as the reply.',
    'In feedback ALWAYS fill "heard" (his line in pinyin with tone marks) and "english" (the plain English meaning of what he actually said, even if it was wrong or odd), so he can see what he said.',
    'MISHEARD SPEECH (very important): the phone often mishears a beginner. When his line contains characters that are NOT in the allowed list, or makes no sense as an answer (e.g. 嘻嘻 xīxī, 他他, 西, 细), do NOT take it literally. Convert it to its SOUND and find the allowed word or short sentence that sounds closest, ignoring tones and treating these pairs as the same sound: x/sh/s, q/ch/c, j/zh/z, n/l, in/ing, en/eng, an/ang, and a doubled syllable as one word said twice. Example: 嘻嘻 (xī xī) as an answer to a 是-question is almost certainly 是是 / 是 (shì) = "yes". If a close allowed word exists and it fits as an answer, ACCEPT it as that: ok=true, heard = the intended words in pinyin, english = their meaning, and note = "The phone heard <what it wrote>; I took it as <intended>." plus, when the confusion is x/sh, q/ch or j/zh, one short pronunciation tip (for sh/ch/zh: curl the tongue tip back, no "ee" sound). Only if nothing close exists, say you could not follow.',
    'Your own lines must be sensible things a real supplier or business friend would say. Never ask absurd or empty questions (for example "are you a person?"). With a small word list, prefer simple real questions about goods, money, wanting, having, who someone is, whose something is.',
    'OPTIONS: give exactly 3 DIFFERENT lines HE could say next, each a correct and natural answer to your line but with a different meaning (for example a yes, a no, and a question back), each with chinese, pinyin and english, using only the allowed words. He taps one to send it, so they must all be good Chinese.',
    'HINT: one good line HE could say next, using only the allowed words.',
    'On the first turn (no line from him yet) there is no feedback: set "feedback" to null and open the scene.',
    'Answer with ONE JSON object and nothing else, exactly this shape:',
    '{"reply":{"chinese":"…","pinyin":"… (with tone marks)","english":"…"},"feedback":null | {"ok":true|false,"heard":"his line in pinyin with tone marks","english":"what his line means in English","better":null | {"chinese":"…","pinyin":"…","english":"…"},"note":"…"},"hint":{"chinese":"…","pinyin":"…","english":"…"},"options":[{"chinese":"…","pinyin":"…","english":"…"},{…},{…}],"done":false}',
    'Set "done" to true on the line that closes the conversation.',
  ].join('\n');

  const messages = [];
  history.forEach((m) => { if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim()) messages.push({ role: m.role, content: m.text.slice(0, 600) }); });
  // Guard: every Chinese character the partner uses must come from the learner's lessons (the model sometimes slips in a later word).
  const allowed = new Set(((str(body.chars, 8000) || '') + vocab + examples).replace(/[^\u4e00-\u9fff]/g, '').split(''));
  const outside = (o) => { if (!o) return ''; const t = [o.reply, o.hint, o.feedback && o.feedback.better].concat(Array.isArray(o.options) ? o.options : []).map((l) => (l && l.chinese) || '').join(''); return [...new Set(t.replace(/[^\u4e00-\u9fff]/g, '').split('').filter((c) => !allowed.has(c)))].join(''); };
  // the word list is the same on every turn -> its own cached system block (faster and cheaper from the 2nd line on)
  const words = 'ALLOWED CHARACTERS (every Chinese character you write must be one of these, nothing else): ' + [...allowed].join('') + '\n\nALLOWED WORDS (pinyin | characters | meaning):\n' + vocab + (examples ? '\n\nEXAMPLE SENTENCES:\n' + examples : '');
  const ctx = 'SCENE: ' + scene;
  // the request must end with HIS line: a trailing partner line (e.g. a retry with nothing new said) is dropped and asked again
  while (messages.length && messages[messages.length - 1].role === 'assistant') messages.pop();
  if (!messages.length || messages[0].role !== 'user') messages.unshift({ role: 'user', content: '(start the conversation)' });
  messages[0] = { role: 'user', content: ctx + '\n\n' + messages[0].content };

  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  // The answer comes back through a forced tool call, so it is always a well-formed object (plain-text JSON was sometimes cut off or wrapped in prose).
  const line = { type: 'object', properties: { chinese: { type: 'string' }, pinyin: { type: 'string' }, english: { type: 'string' } }, required: ['chinese', 'pinyin', 'english'] };
  const tool = { name: 'say', description: 'Give the partner\'s next line, the feedback on the learner\'s last line, and a hint.', input_schema: { type: 'object', properties: {
    reply: line,
    feedback: { type: ['object', 'null'], properties: { ok: { type: 'boolean' }, heard: { type: 'string' }, english: { type: 'string', description: 'English meaning of what the learner said' }, better: { anyOf: [line, { type: 'null' }] }, note: { type: 'string' } } },
    hint: { anyOf: [line, { type: 'null' }] },
    options: { type: 'array', items: line, description: 'Exactly 3 different lines the learner could say next' },
    done: { type: 'boolean' },
  }, required: ['reply', 'options', 'done'] } };
  const ask = async (forced, note) => {
    const msgs = note ? messages.slice(0, -1).concat([{ role: 'user', content: messages[messages.length - 1].content + '\n\n' + note }]) : messages;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(Object.assign({ model: MODEL, max_tokens: 1200, system: [{ type: 'text', text: system }, { type: 'text', text: words, cache_control: { type: 'ephemeral' } }], messages: msgs }, forced ? { tools: [tool], tool_choice: { type: 'tool', name: 'say' } } : {})),
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
    // words from later lessons? ask again (up to twice), naming the characters that are not allowed
    for (let n = 0; n < 2 && a.out && a.out.reply && a.out.reply.chinese && outside(a.out); n++) {
      const bad = outside(a.out);
      const b = await ask(true, '(SYSTEM NOTE: your last attempt used characters he has NOT learned: ' + bad + '. Write the line again using ONLY words from ALLOWED WORDS. The reply, the hint and the corrected sentence must all stay inside the list. If you cannot ask that question with the list, ask a simpler one.)');
      if (b.out && b.out.reply && b.out.reply.chinese) a = b; else break;
    }
    const out = a.out;
    if (!out || !out.reply || !out.reply.chinese) return send(res, 502, { error: 'EMPTY', message: 'The AI gave no usable line (' + (a.why || 'no answer') + ', model ' + MODEL + '). Tap again.' });
    // still outside the lessons after the retries: use a real sentence from his own lessons instead (always inside the list)
    if (outside(out)) {
      const ex = examples.split('\n').map((l) => l.split(' | ')).filter((x) => x.length >= 3 && x[1]);
      const qs = ex.filter((x) => /[吗?？]/.test(x[1])), pool = qs.length ? qs : ex;
      if (pool.length) {
        const pk = (arr) => arr[Math.floor(Math.random() * arr.length)];
        const q = pk(pool), hx = pk(ex.filter((x) => !/[吗?？]/.test(x[1])).concat(ex.length ? [] : []));
        out.reply = { chinese: q[1], pinyin: q[0], english: q[2] };
        if (out.hint && outside({ reply: out.hint })) out.hint = hx ? { chinese: hx[1], pinyin: hx[0], english: hx[2] } : null;
        if (out.feedback && out.feedback.better && outside({ reply: out.feedback.better })) out.feedback.better = null;
        out.fallback = true;
      }
    }
    if (!out.hint) { const ex2 = examples.split('\n').map((l) => l.split(' | ')).filter((x) => x.length >= 3 && x[1] && !/[吗?？]/.test(x[1])); if (ex2.length) { const h2 = ex2[Math.floor(Math.random() * ex2.length)]; out.hint = { chinese: h2[1], pinyin: h2[0], english: h2[2] }; } }
    // tap-to-send options: keep only the ones inside his lessons, top up from his own example sentences
    {
      const exAll = examples.split('\n').map((l) => l.split(' | ')).filter((x) => x.length >= 3 && x[1]).map((x) => ({ chinese: x[1], pinyin: x[0], english: x[2] }));
      let opts = (Array.isArray(out.options) ? out.options : []).filter((o) => o && o.chinese && o.pinyin && !outside({ reply: o }));
      const seen = new Set(opts.map((o) => o.chinese));
      const pool = exAll.filter((o) => !seen.has(o.chinese)).sort(() => Math.random() - 0.5);
      while (opts.length < 3 && pool.length) opts.push(pool.pop());
      out.options = out.done ? [] : opts.slice(0, 3);
    }
    out.outside = outside(out);
    out.ms = Date.now() - t0;
    return send(res, 200, out);
  } catch (e) {
    return send(res, 504, { error: 'TIMEOUT', message: e && e.name === 'AbortError' ? 'The AI took too long. Try again.' : String(e && e.message || e) });
  } finally { clearTimeout(timer); }
};
