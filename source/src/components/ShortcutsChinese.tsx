import { ArrowLeft, Volume2 } from 'lucide-react';

/* Learn Chinese -> Shortcuts: the owner's cheat sheet (asked for after working through translations in chat).
   Written content, not from chinese_lessons.json: the blocks and rules that fix his usual slips (de without an owner,
   yǒu / yào, his / has, swapping for questions, ma on statements). Every Chinese item can be heard. */

type Row = { p: string; c: string; e: string; note?: string };
type Sec = { title: string; tip?: string; rows?: Row[]; steps?: string[]; from?: number };

const SECS: Sec[] = [
  { title: '1. The three steps to translate', steps: [
    'Question in English? Undo the swap first: "Is this yours?" → "This is yours." A statement needs no swap.',
    'Put one Chinese word under each English word, in the same order. Drop do / does / a / the.',
    'If it was a question, add ma at the end. If it has "not", put bù or méi in front of the action word.',
  ], tip: 'Before you send: (1) is there an action word — shì, yǒu or yào? (2) does every my / your / his have its owner AND de together?' },
  { title: '2. People', tip: 'Add men to make it more than one. Only for people.', rows: [
    { p: 'wǒ', c: '我', e: 'I, me' }, { p: 'nǐ', c: '你', e: 'you' }, { p: 'tā', c: '他', e: 'he, him' },
    { p: 'wǒmen', c: '我们', e: 'we, us' }, { p: 'nǐmen', c: '你们', e: 'you all' }, { p: 'tāmen', c: '他们', e: 'they, them' },
  ] },
  { title: '3. Owner blocks — learn each as ONE piece', tip: 'de never stands alone. The owner always comes in front of it.', rows: [
    { p: 'wǒ de', c: '我的', e: 'my, mine' }, { p: 'nǐ de', c: '你的', e: 'your, yours' }, { p: 'tā de', c: '他的', e: 'his' },
    { p: 'wǒmen de', c: '我们的', e: 'our, ours' }, { p: 'nǐmen de', c: '你们的', e: 'your (you all)' }, { p: 'tāmen de', c: '他们的', e: 'their, theirs' },
    { p: 'lǎobǎn de', c: '老板的', e: "the boss's" }, { p: 'shéi de', c: '谁的', e: 'whose', note: 'Lesson 3' },
    { p: 'nǐ de lǎobǎn de qián', c: '你的老板的钱', e: "your boss's money", note: 'two owners = de twice' },
  ] },
  { title: '4. The three action words', tip: 'One action word per sentence.', rows: [
    { p: 'shì', c: '是', e: 'am, is, are', note: 'joins two things or people: tā shì lǎobǎn' },
    { p: 'yǒu', c: '有', e: 'have, has', note: 'tā yǒu qián = he has money' },
    { p: 'yào', c: '要', e: 'want', note: 'tā yào qián = he wants money' },
  ] },
  { title: '5. Easy to mix up', rows: [
    { p: 'yǒu / yào', c: '有 / 要', e: 'have / want', note: 'yǒu dips and rises; yào falls' },
    { p: 'tā yǒu huò', c: '他有货', e: 'he HAS goods', note: 'has = action word yǒu' },
    { p: 'tā de huò', c: '他的货', e: 'HIS goods', note: 'his = owner block tā de' },
    { p: 'zhège / nàge', c: '这个 / 那个', e: 'this / that', note: 'zh = this (near), n = that (over there)' },
    { p: 'tā / tāmen', c: '他 / 他们', e: 'he / they' },
  ] },
  { title: '6. Saying "not"', tip: 'The "not" goes straight in front of the action word.', rows: [
    { p: 'bú shì', c: '不是', e: 'am not, is not, are not' }, { p: 'bú yào', c: '不要', e: "don't want" },
    { p: 'méi yǒu', c: '没有', e: "don't have", note: 'never bù yǒu' },
  ] },
  { title: '7. Yes and no — repeat the action word of the question', rows: [
    { p: 'nǐ yào zhège ma? — yào / bú yào', c: '你要这个吗? 要 / 不要', e: 'Do you want this? — yes / no' },
    { p: 'nǐ yǒu huò ma? — yǒu / méi yǒu', c: '你有货吗? 有 / 没有', e: 'Do you have stock? — yes / no' },
    { p: 'nǐ shì lǎobǎn ma? — shì / bú shì', c: '你是老板吗? 是 / 不是', e: 'Are you the boss? — yes / no' },
  ] },
  { title: '8. Asking — Chinese never swaps', tip: 'Keep the statement and add ma. English moves "is" to the front; Chinese moves nothing.', rows: [
    { p: 'zhège shì nǐ de', c: '这个是你的', e: 'This is yours.' },
    { p: 'zhège shì nǐ de ma?', c: '这个是你的吗?', e: 'Is this yours?' },
    { p: 'tāmen yǒu qián ma?', c: '他们有钱吗?', e: 'Do they have money?' },
  ] },
  { title: '9. Question words sit where the answer sits', from: 3, tip: 'Write the answer sentence, then replace the answer with the question word. No ma.', rows: [
    { p: 'nǐ yào shénme?', c: '你要什么?', e: 'What do you want?', note: 'answer: nǐ yào huò' },
    { p: 'shéi shì lǎobǎn?', c: '谁是老板?', e: 'Who is the boss?', note: 'answer: tā shì lǎobǎn' },
    { p: 'lǎobǎn zài nǎr?', c: '老板在哪儿?', e: 'Where is the boss?', note: 'answer: lǎobǎn zài gōngchǎng' },
  ] },
  { title: '10. English words that disappear', rows: [
    { p: 'nǐ yǒu huò ma?', c: '你有货吗?', e: 'DO you have goods?', note: 'do / does / did: no Chinese word' },
    { p: 'wǒ shì lǎobǎn', c: '我是老板', e: 'I am THE boss', note: 'a / an / the: no Chinese word' },
    { p: 'zhège hěn guì', c: '这个很贵', e: 'This IS expensive', note: 'is before a describing word: hěn, not shì (Lesson 6)' },
  ] },
  { title: '11. The sentence skeleton', from: 7, tip: 'Who + When + Where + (not) + Action + What + (ma). Fill the seats you need, skip the rest.', rows: [
    { p: 'wǒ míngtiān fù qián', c: '我明天付钱', e: 'I pay tomorrow', note: 'time goes before the action' },
    { p: 'nǐ míngtiān zài nǎr?', c: '你明天在哪儿?', e: 'Where are you tomorrow?' },
    { p: 'wǒ zài gōngchǎng', c: '我在工厂', e: 'I am at the factory', note: 'are / am / is + a place = zài, not shì (Lesson 3)' },
  ] },
];

function speak(text: string) {
  try { const s = window.speechSynthesis; if (!s) return; s.cancel(); const u = new SpeechSynthesisUtterance(text.replace(/[\/—]/g, '，')); u.lang = 'zh-CN'; u.rate = 0.8; const v = s.getVoices().find((x) => /^zh/i.test(x.lang)); if (v) u.voice = v; s.speak(u); } catch { /* ignore */ }
}

export default function ShortcutsChinese({ onBack }: { onBack: () => void }) {
  return (
    <>
      <button onClick={onBack} className="flex items-center gap-1 text-sm mb-3"><ArrowLeft className="w-4 h-4" /> All lessons</button>
      <h1 className="text-2xl font-bold">Shortcuts</h1>
      <p className="text-neutral-600 text-sm mb-1">The blocks and rules to keep in your head. Tap the speaker to hear any line.</p>
      {SECS.map((sec) => (
        <div key={sec.title} className="mt-5">
          <h2 className="font-bold text-[17px]">{sec.title}{sec.from ? <span className="ml-2 font-mono text-[11px] font-normal text-neutral-500">from Lesson {sec.from}</span> : null}</h2>
          {sec.steps && <ol className="mt-2 border border-neutral-300 rounded-lg bg-white divide-y">{sec.steps.map((st, i) => <li key={i} className="flex gap-3 p-3 text-[15px]"><span className="w-6 h-6 rounded-full bg-[#111] text-white text-xs flex items-center justify-center shrink-0">{i + 1}</span><span>{st}</span></li>)}</ol>}
          {sec.rows && <div className="mt-2 border border-neutral-300 rounded-lg bg-white divide-y">
            {sec.rows.map((r) => (
              <div key={r.p} className="flex items-center gap-3 p-2.5">
                <div className="flex-1 min-w-0"><div className="font-mono text-[16px] font-semibold">{r.p}</div><div className="text-lg leading-tight">{r.c}</div><div className="text-sm text-neutral-700">{r.e}</div>{r.note && <div className="text-xs text-[#e8552a] mt-0.5">{r.note}</div>}</div>
                <button onClick={() => speak(r.c)} aria-label="Listen" className="shrink-0 w-9 h-9 rounded-full border border-[#111] flex items-center justify-center"><Volume2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>}
          {sec.tip && <div className="mt-2 text-sm bg-[#f4f3f1] border-l-4 border-[#e8552a] rounded-r-lg p-2.5">{sec.tip}</div>}
        </div>
      ))}
    </>
  );
}
