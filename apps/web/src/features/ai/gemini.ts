import {
  aiLabelResultSchema,
  aiPhotoResultSchema,
  aiTextResultSchema,
  toMealRecognition,
  toPhotoRecognition,
  type AiLabelResult,
  type MealRecognition,
} from '@pt/ai-contract';
import { getAuthClient } from '@/lib/firebase';
import { AI_RELAY_URL } from '@/config/firebase';

/**
 * AI への依頼（設計書 §9 / §30 / §35）。
 *
 * ★ APIキーはここにありません。中継役（Cloudflare Worker）が持っています。
 *   このファイルがやるのは「ログイン証明を付けて中継役に頼む」ことだけです。
 *
 * ★ 送るのは、利用者がその場で書いた文章だけです。
 *   契約者ID・氏名・体重・目標値・他の日の記録は一切送りません（設計書 §35）。
 */

export type AiErrorKind =
  | 'not_configured'
  | 'unauthenticated'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_output'
  | 'network';

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    /** 切り分けのための手がかり。利用者にもそのまま見せる */
    readonly detail?: string,
  ) {
    super(kind);
    this.name = 'AiError';
  }
}

export function aiErrorMessage(kind: AiErrorKind, detail?: string): string {
  const suffix = detail === undefined ? '' : `（${detail}）`;
  return baseMessage(kind) + suffix;
}

function baseMessage(kind: AiErrorKind): string {
  switch (kind) {
    case 'not_configured':
      return 'AIの設定がまだ済んでいません。トレーナーにご連絡ください。';
    case 'unauthenticated':
      return 'ログインし直してから、もう一度お試しください。';
    case 'rate_limited':
      return 'AIの利用が混み合っています。しばらく待ってからお試しください。手で入力することもできます。';
    case 'unavailable':
      return 'AIに接続できませんでした。手で入力してください。';
    case 'invalid_output':
      return 'AIの回答を読み取れませんでした。表現を変えてお試しいただくか、手で入力してください。';
    case 'network':
      return '通信に失敗しました。電波の状態を確認してください。';
  }
}

/**
 * AI に返させる形（Gemini の responseSchema）。
 *
 * ★ 欄を絞ることが、そのまま「勝手な補完の防止」になります。
 *   栄養値の欄はありません。AI に栄養値を答えさせないためです（設計書 §37）。
 */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          amount: { type: 'number' },
          // ★ ここに enum を書くと、Gemini が 400 を返すことがあります。
          //   単位の候補は指示文（SYSTEM_PROMPT）の側で伝え、
          //   受け取ってから wire.ts 側で正規化します。
          //   知らない単位が来ても 'unknown' に寄せるので、
          //   スキーマを緩めても「勝手な補完」は防げます。
          unit: { type: 'string' },
          amountStated: { type: 'boolean' },
          confidence: { type: 'number' },
          evidence: { type: 'string' },
          question: { type: 'string' },
        },
        required: ['name', 'amount', 'unit', 'amountStated', 'confidence', 'evidence', 'question'],
      },
    },
    unidentified: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['items', 'unidentified', 'notes'],
} as const;

/**
 * AIへの指示（設計書 §12 の第1層）。
 *
 * ★ 「補完しないで」と1行書くだけでは足りません。
 *   何が禁止なのかを具体例で示し、代わりにどうすべきかまで書きます。
 *   そのうえで、スキーマ（第2層）と原文照合（第3層）で二重三重に受け止めます。
 */
const SYSTEM_PROMPT = `あなたは食事記録の入力を補助する役です。利用者が書いた文章を、食材と量に分解してください。

■ もっとも大切な決まり

書かれていないことを、絶対に足さないでください。

・「白米」とだけ書かれていたら、量は不明です。「茶碗1杯だろう」と補ってはいけません。
・「サラダ」とだけ書かれていたら、中身は不明です。「レタスとトマトとキュウリ」に分解してはいけません。
・「朝食」とだけ書かれていたら、献立は不明です。何も推測しないでください。
・調理法、味付け、ブランド名も、書かれていなければ足さないでください。

量が書かれていない場合は amountStated を false にし、question に利用者への質問を書いてください。
食べ物かどうか判断できない部分は、items に入れず unidentified に入れてください。

■ evidence（根拠）について

各項目について、利用者の文章の中でその項目の根拠になった部分を、
そのまま抜き出して evidence に入れてください。要約や言い換えをしないでください。

例: 「白米180gと鶏むね肉」
  → 白米の evidence は「白米180g」
  → 鶏むね肉の evidence は「鶏むね肉」

原文に無い文字列を evidence に入れた項目は、こちらで自動的に破棄されます。

■ 栄養価について

カロリー、たんぱく質、脂質、炭水化物は、絶対に答えないでください。
それらはこちらで計算します。あなたの仕事は「何を・どれだけ」までです。

■ 単位について

unit には次のいずれかを入れてください。
  g / ml / 個 / 枚 / 本 / 杯 / 食 / パック / 大さじ / 小さじ / unknown

グラムやミリリットルで書かれていればそのまま使ってください。
「1個」「1杯」のような単位は、グラムに換算しないでください。
その単位のまま返し、question に「何グラムでしたか」と書いてください。
量がまったく書かれていない場合は amount を 0、unit を unknown にしてください。

■ 名前について

商品名ではなく、一般的な食材の名前にしてください。
例: 「サラダチキン」→「鶏むね肉」ではなく「サラダチキン」のまま
（利用者が書いた言葉を尊重してください。勝手に言い換えないでください）`;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/** 文章から食材候補を作る。 */
export async function parseMealText(text: string): Promise<MealRecognition> {
  if (AI_RELAY_URL === null) throw new AiError('not_configured');

  const user = getAuthClient().currentUser;
  if (user === null) throw new AiError('unauthenticated');

  let idToken: string;
  try {
    idToken = await user.getIdToken();
  } catch {
    throw new AiError('unauthenticated');
  }

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      // ★ 温度を0にします。同じ文章からは同じ結果が出てほしいためです。
      temperature: 0,
    },
  };

  let response: Response;
  try {
    response = await fetch(AI_RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AiError('network');
  }

  if (!response.ok) {
    if (response.status === 401) throw new AiError('unauthenticated');
    if (response.status === 429) throw new AiError('rate_limited');

    // ★ 状態番号を画面に出します。
    //   「接続できませんでした」だけだと、
    //   キーの問題なのか、要求の形の問題なのかが切り分けられません。
    throw new AiError('unavailable', `中継役の応答: ${response.status}`);
  }

  let raw: GeminiResponse;
  try {
    raw = (await response.json()) as GeminiResponse;
  } catch {
    throw new AiError('invalid_output');
  }

  const jsonText = raw.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof jsonText !== 'string') throw new AiError('invalid_output');

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new AiError('invalid_output');
  }

  // ★ AIの応答は、必ずここで検証してから使います。
  //   自然言語のまま先へ流すことはしません（設計書 §36）。
  const result = aiTextResultSchema.safeParse(parsed);
  if (!result.success) throw new AiError('invalid_output');

  return toMealRecognition(result.data);
}

// -----------------------------------------------------------------------------
// 写真からの認識（設計書 §10 / Phase 8B）
// -----------------------------------------------------------------------------

const PHOTO_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          amountGrams: { type: 'number' },
          amountMinGrams: { type: 'number' },
          amountMaxGrams: { type: 'number' },
          confidence: { type: 'number' },
          evidence: { type: 'string' },
          question: { type: 'string' },
        },
        required: [
          'name',
          'amountGrams',
          'amountMinGrams',
          'amountMaxGrams',
          'confidence',
          'evidence',
          'question',
        ],
      },
    },
    unidentified: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['items', 'unidentified', 'notes'],
} as const;

/**
 * 写真解析への指示（設計書 §10 / §12 / §39）。
 *
 * ★ テキストと違い、原文照合という後ろ盾がありません。
 *   そのぶん指示を具体的にし、「幅で答えさせる」ことで
 *   自信の無さが数字として見えるようにしています。
 */
const PHOTO_PROMPT = `あなたは食事の写真から、写っている食品と量を読み取る役です。

■ もっとも大切な決まり

写真に写っていないものを、絶対に足さないでください。

・「定食の写真だから味噌汁もあるはず」と補ってはいけません。写っているものだけです。
・見えない部分（丼の下、器の中身が見えない など）を推測してはいけません。
・調味料、油、ドレッシングは、見えていなければ足さないでください。
・ぼやけていて判別できないものは、items ではなく unidentified に入れてください。

■ 量の答え方

グラムで答えてください。ただし **必ず幅を付けてください**。

  amountGrams     … もっとも近いと思う値
  amountMinGrams  … 最低でもこれくらい
  amountMaxGrams  … 多くてもこれくらい

自信が無いほど、幅を広く取ってください。
「たぶん180gだが100〜250gかもしれない」なら、正直にそう答えてください。
幅を狭く見せる必要はありません。狭いほど良い、ということはありません。

比較できるもの（茶碗、箸、スプーン、皿）が写っていれば、それを手がかりにしてください。
手がかりが何も無ければ、幅を大きく取ってください。

■ evidence（根拠）について

写真のどこに、どう写っているかを書いてください。

例: 「手前の茶碗に盛られた白いごはん」
    「左奥の皿にある、焼き色のついた鶏肉」

人がこれを読んで写真と見比べ、正しいか確かめます。
どこを見て判断したのかが分かるように書いてください。

■ 栄養価について

カロリー、たんぱく質、脂質、炭水化物は、絶対に答えないでください。
それらはこちらで計算します。あなたの仕事は「何が・どれだけ」までです。

■ 名前について

一般的な食材の名前にしてください。料理名ではなく、食材ごとに分けてください。
ただし、分けられないもの（カレー、シチューなど）は無理に分解せず、
料理名のまま1つの項目にして、question に「材料の内訳は分かりますか？」と書いてください。`;

/**
 * 写真から食品候補を作る。
 *
 * ★ 送るのは写真1枚と、利用者が添えた補足だけです。
 *   誰の写真かをAIに伝えることはありません（設計書 §35）。
 */
export async function analyzeMealPhoto(
  dataUrl: string,
  hint: string,
): Promise<MealRecognition> {
  if (AI_RELAY_URL === null) throw new AiError('not_configured');

  const user = getAuthClient().currentUser;
  if (user === null) throw new AiError('unauthenticated');

  // data:image/jpeg;base64,XXXX → mimeType と本体に分ける
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(dataUrl);
  if (match === null) throw new AiError('invalid_output');
  const [, mimeType, base64] = match as unknown as [string, string, string];

  let idToken: string;
  try {
    idToken = await user.getIdToken();
  } catch {
    throw new AiError('unauthenticated');
  }

  const parts: unknown[] = [{ inline_data: { mime_type: mimeType, data: base64 } }];
  if (hint.trim().length > 0) {
    parts.push({ text: `補足: ${hint.trim()}` });
  }

  const body = {
    systemInstruction: { parts: [{ text: PHOTO_PROMPT }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: PHOTO_RESPONSE_SCHEMA,
      temperature: 0,
    },
  };

  let response: Response;
  try {
    response = await fetch(AI_RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AiError('network');
  }

  if (!response.ok) {
    if (response.status === 401) throw new AiError('unauthenticated');
    if (response.status === 429) throw new AiError('rate_limited');
    if (response.status === 413) throw new AiError('unavailable', '写真が大きすぎます');
    throw new AiError('unavailable', `中継役の応答: ${response.status}`);
  }

  let raw: GeminiResponse;
  try {
    raw = (await response.json()) as GeminiResponse;
  } catch {
    throw new AiError('invalid_output');
  }

  const jsonText = raw.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof jsonText !== 'string') throw new AiError('invalid_output');

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new AiError('invalid_output');
  }

  const result = aiPhotoResultSchema.safeParse(parsed);
  if (!result.success) throw new AiError('invalid_output');

  return toPhotoRecognition(result.data);
}

// -----------------------------------------------------------------------------
// 栄養成分表示の読み取り（設計書 §47 / Phase 12）
// -----------------------------------------------------------------------------

const LABEL_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    basis: { type: 'string' },
    servingGrams: { type: 'number', nullable: true },
    kcal: { type: 'number', nullable: true },
    p: { type: 'number', nullable: true },
    f: { type: 'number', nullable: true },
    c: { type: 'number', nullable: true },
    sugar: { type: 'number', nullable: true },
    fiber: { type: 'number', nullable: true },
    salt: { type: 'number', nullable: true },
    sodiumMg: { type: 'number', nullable: true },
    productName: { type: 'string' },
    evidence: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['basis', 'productName', 'evidence', 'notes'],
} as const;

/**
 * 成分表示の読み取りへの指示（設計書 §12 / §47）。
 *
 * ★ 読むだけです。計算はさせません。
 *   割り算をAIにやらせると、途中が見えなくなり、
 *   間違っていたときに気づけません。
 *
 * ★ いちばん気をつけているのは「複数の数字が並んでいる表示」です。
 *   カップ麺には「1食(57g)当たり 263kcal」の下に
 *   「参考値: めん・かやく 243kcal / スープ 20kcal」が並びます。
 *   下の数字を拾うと、まるごと1食ぶんの値が2割ほど小さくなります。
 */
const LABEL_PROMPT = `あなたは食品パッケージの「栄養成分表示」を読み取る役です。

■ もっとも大切な決まり

書いてある数字を、そのまま読んでください。計算はしないでください。

・100gあたりに直さないでください。こちらで計算します。
・「1食(57g)当たり 263kcal」と書いてあれば、servingGrams=57、kcal=263 と答えてください。
・読めない項目は null にしてください。0 にしないでください。
  「書いていない」と「0と書いてある」は別のことです。

■ どの欄を読むか

「栄養成分表示」の本体（主たる表示）だけを読んでください。

★ 参考値・内訳・注釈は読まないでください。

  例: カップ麺には次のように並んでいることがあります。

      栄養成分表示 1食(57g)当たり
        熱量 263kcal ...          ← これを読む
      参考値: めん・かやく 243kcal / スープ 20kcal   ← これは読まない

  内訳を読むと、1食ぶんの合計より小さい値になってしまいます。
  迷ったら、いちばん大きい「合計」の欄を選んでください。

■ basis（基準量）

  per100g    … 「100g当たり」「100gあたり」
  per100ml   … 「100ml当たり」
  perServing … 「1食当たり」「1袋当たり」「1本当たり」「1個当たり」など

perServing のとき、括弧などに1回分のグラム数が書いてあれば servingGrams に入れてください。
書いていなければ servingGrams は null にしてください。**推測しないでください。**
どれにも当てはまらない、または読み取れない場合は basis を "unknown" にしてください。

■ 炭水化物

「炭水化物」と書いてあれば c に入れてください。
「糖質」「食物繊維」に分かれている場合は、足さずに sugar と fiber にそれぞれ入れてください。

■ 食塩

「食塩相当量」は salt（g）に入れてください。
「ナトリウム」しか書いていない場合は sodiumMg（mg）に入れてください。両者は別物です。

■ evidence（根拠）

読み取った欄の見出しを、そのまま書き写してください。
例:「栄養成分表示 1食(57g)当たり」

■ notes

ぼやけて読めなかった項目、複数の欄があってどれを選んだか、
迷った点があれば書いてください。`;

/**
 * 成分表示の写真から、表示されている数値を読み取る。
 *
 * ★ 戻り値は「表示そのまま」です。100gあたりへの換算は
 *   @pt/core の labelToPer100g が行います（設計書 §47）。
 */
export async function readNutritionLabel(dataUrl: string): Promise<AiLabelResult> {
  if (AI_RELAY_URL === null) throw new AiError('not_configured');

  const user = getAuthClient().currentUser;
  if (user === null) throw new AiError('unauthenticated');

  const match = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(dataUrl);
  if (match === null) throw new AiError('invalid_output');
  const [, mimeType, base64] = match as unknown as [string, string, string];

  let idToken: string;
  try {
    idToken = await user.getIdToken();
  } catch {
    throw new AiError('unauthenticated');
  }

  const body = {
    systemInstruction: { parts: [{ text: LABEL_PROMPT }] },
    contents: [
      { role: 'user', parts: [{ inline_data: { mime_type: mimeType, data: base64 } }] },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: LABEL_RESPONSE_SCHEMA,
      temperature: 0,
    },
  };

  let response: Response;
  try {
    response = await fetch(AI_RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AiError('network');
  }

  if (!response.ok) {
    if (response.status === 401) throw new AiError('unauthenticated');
    if (response.status === 429) throw new AiError('rate_limited');
    if (response.status === 413) throw new AiError('unavailable', '写真が大きすぎます');
    throw new AiError('unavailable', `中継役の応答: ${response.status}`);
  }

  let raw: GeminiResponse;
  try {
    raw = (await response.json()) as GeminiResponse;
  } catch {
    throw new AiError('invalid_output');
  }

  const jsonText = raw.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof jsonText !== 'string') throw new AiError('invalid_output');

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new AiError('invalid_output');
  }

  const result = aiLabelResultSchema.safeParse(parsed);
  if (!result.success) throw new AiError('invalid_output');

  return result.data;
}
