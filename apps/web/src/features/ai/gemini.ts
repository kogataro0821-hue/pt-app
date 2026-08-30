import {
  aiFoodDraftSchema,
  aiLabelResultSchema,
  aiPhotoResultSchema,
  aiTextResultSchema,
  toMealRecognition,
  toPhotoRecognition,
  type AiFoodDraft,
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
  /** その人の、その日の利用回数の上限に達した（設計書 §7.6） */
  | 'daily_limit'
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
    case 'daily_limit':
      // ★ 「混み合っています」と同じ言い方にしてはいけません。
      //   数分待てば戻ると思われると、一日じゅう押し続けることになります。
      //   いつ戻るのかを、はっきり書きます。
      return '今日のAIの利用回数が上限に達しました。日付が変わると、また使えます。手で入力することもできます。';
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

/**
 * 中継役が断ってきたときに、画面へ出す理由を決める。
 *
 * ★ 429 には意味が2つあります。
 *
 *     daily_limit_reached … こちらで決めた1日の上限（翌日まで戻りません）
 *     それ以外            … Gemini 側が混み合っている（数分で戻ります）
 *
 *   同じ「しばらくお待ちください」で済ませると、
 *   上限に達した人が、戻らないものを一日じゅう待つことになります。
 *   中継役が返す名前を見て、言い方を変えます。
 *
 * ★ 4か所（文章・写真・成分表示・AI評価）で同じ判断をします。
 *   別々に書くと、片方だけ直して食い違います。ここ1か所にまとめて、
 *   テストもここに対して書きます。
 */
export async function relayFailure(response: Response, tooLarge?: string): Promise<AiError> {
  if (response.status === 401) return new AiError('unauthenticated');

  if (response.status === 429) {
    let kind: AiErrorKind = 'rate_limited';
    let detail: string | undefined;
    try {
      const body = (await response.json()) as { error?: unknown; limit?: unknown };
      if (body.error === 'daily_limit_reached') {
        kind = 'daily_limit';
        if (typeof body.limit === 'number') detail = `1日${body.limit}回まで`;
      }
    } catch {
      // 本文が読めなければ、混み合いとして扱います（待てば戻る、という穏当なほう）
    }
    return new AiError(kind, detail);
  }

  if (response.status === 413 && tooLarge !== undefined) {
    return new AiError('unavailable', tooLarge);
  }

  // ★ 状態番号を画面に出します。
  //   「接続できませんでした」だけだと、
  //   キーの問題なのか、要求の形の問題なのかが切り分けられません。
  return new AiError('unavailable', `中継役の応答: ${response.status}`);
}

/**
 * 「考える時間」を使わせない設定（追加仕様: 読み取りの待ち時間）。
 *
 * ★ gemini-2.5-flash は、既定で答える前に内部で考えます。
 *   それは筋道を立てる問いには効きますが、
 *   **成分表示の数字を書き写すような仕事には要りません。**
 *   考えるぶんだけ、待ち時間が伸びます。
 *
 * ★ 評価文（requestDayReview）には付けません。
 *   あちらは人に読ませる文章を組み立てる仕事で、考える価値があります。
 */
const NO_THINKING = { thinkingConfig: { thinkingBudget: 0 } } as const;

/**
 * 中継役に投げる。
 *
 * ★ 「考えない」設定が通らない相手だったときのために、1回だけやり直します。
 *
 *   この設定はモデルによっては受け付けられず、400 で返ってきます。
 *   そのとき読み取りごと失敗させると、**速くしようとして壊した**ことになります。
 *   速さより、動くことが先です。
 *
 *   やり直すのは「考えない設定が原因だ」と分かるときだけです。
 *   どんな 400 でもやり直すと、鍵の設定ミスのようなときに
 *   1日の回数を2つ食べてしまいます。
 */
async function postToRelay(
  idToken: string,
  body: Record<string, unknown>,
  tooLarge?: string,
): Promise<Response> {
  if (AI_RELAY_URL === null) throw new AiError('not_configured');
  const url = AI_RELAY_URL;

  const send = async (payload: Record<string, unknown>): Promise<Response> => {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new AiError('network');
    }
  };

  let response = await send(body);

  if (response.status === 400 && hasThinkingConfig(body)) {
    const detail = await peekDetail(response);
    if (detail.includes('thinking')) {
      response = await send(withoutThinkingConfig(body));
    } else {
      // 本文をもう読んでしまったので、同じ内容の応答を作り直します
      response = new Response(detail, { status: 400 });
    }
  }

  if (!response.ok) throw await relayFailure(response, tooLarge);
  return response;
}

function hasThinkingConfig(body: Record<string, unknown>): boolean {
  const config = body.generationConfig;
  return typeof config === 'object' && config !== null && 'thinkingConfig' in config;
}

function withoutThinkingConfig(body: Record<string, unknown>): Record<string, unknown> {
  const config = { ...(body.generationConfig as Record<string, unknown>) };
  delete config.thinkingConfig;
  return { ...body, generationConfig: config };
}

/** 応答の本文を、あとでもう一度使えるように読み出す */
async function peekDetail(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
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
      ...NO_THINKING,
    },
  };

  const response = await postToRelay(idToken, body);

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
      ...NO_THINKING,
    },
  };

  const response = await postToRelay(idToken, body, '写真が大きすぎます');

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
// 栄養成分表示の読み取り（設計書 §47 / 追加仕様: 成分表示の読み取り）
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
      ...NO_THINKING,
    },
  };

  const response = await postToRelay(idToken, body, '写真が大きすぎます');

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

// -----------------------------------------------------------------------------
// AI評価（設計書 §26 / §9.4 / Phase 10）
// -----------------------------------------------------------------------------

const REVIEW_RESPONSE_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
} as const;

/** 評価モードごとの言い方の指定。渡すのはこの文字列だけ。 */
const TONE: Record<string, string> = {
  gentle: 'できている点を中心に、前向きに伝えてください。改善点は最後に1つだけ、やわらかく添えてください。',
  standard: 'できている点と、改善できる点を同じくらいの分量で伝えてください。',
  strict: '改善点をはっきり指摘してください。できている点にも1文だけ触れてください。',
  very_strict:
    '妥協せず、目標との差を厳しく指摘してください。ただし人格を否定する言い方はしないでください。',
};

/**
 * AI評価への指示（設計書 §13 リスク12 / §26）。
 *
 * ★ 医療の話をさせません。
 *
 *   トレーナーは医師ではありません。病名や検査値に踏み込んだ文章が
 *   契約者に届くと、受け取った側はそれを医療的な助言として読みます。
 *
 *   ただし、この指示文は第1層でしかありません。
 *   守られることを期待しているだけで、確かめてはいないからです。
 *   生成後に @pt/core の checkReviewText で機械的に検査し、
 *   引っかかったら表示しません。期待ではなく判定にします。
 *
 * ★ 数字も作らせません。
 *   合計や差はすべてこちら側で計算済みのものを渡します。
 *   AIがやるのは「その数字をどう言葉にするか」だけです。
 */
const REVIEW_PROMPT = `あなたはパーソナルトレーナーの補助として、1日の食事と運動の記録に短い講評を書く役です。

■ 絶対にしてはいけないこと

・病名、診断、検査値の解釈に触れないでください。
  （糖尿病、高血圧、血糖値、コレステロール値 などの言葉を使わない）
・受診、通院、服薬、サプリメントをすすめないでください。
・断食、絶食、食事を抜く、極端に減らす、といったやり方をすすめないでください。
  厳しく言うことと、体に負担のかかるやり方をすすめることは違います。

あなたが扱うのは、食事の内容と量、運動、そして目標との差だけです。

■ 数字について

渡された数字をそのまま使ってください。計算し直さないでください。
新しい数字を作らないでください。渡されていない項目（体重の増減など）に触れないでください。

■ 相手のことを想像しないでください

あなたに渡されているのは、その日の数字だけです。
その人がどんな生活をしていて、何を考えているかは分かりません。

次のような書き方をしてはいけません。

  ×「忙しいなかでも運動できていますね」    忙しいかどうかは分かりません
  ×「習慣化しようという意識が伝わります」  気持ちは分かりません
  ×「頑張っていますね」「意識が高いですね」 人柄を評価しないでください
  ×「疲れがたまっているのでしょう」        体調は分かりません

褒めるときは、数字にもとづいて褒めてください。

  ○「たんぱく質が目標に届いています」
  ○「運動が25分できています」

■ 書き方

・200〜300文字。長くしないでください。
・「〜してください」「〜しましょう」のような、次にやることが分かる言い方で終えてください。

・**同じことを2回書かないでください。**
  ×「運動が25分できています。運動を25分実施できたのは良い取り組みです。」
  ○「運動が25分できています。」

・**前置きを付けないでください。** そのまま書いてください。
  ×「できている点としては、〜が挙げられます。改善できる点としては、〜です。」
  ○「たんぱく質は目標に届いています。一方、脂質が12g超えています。」

  これは報告書ではありません。人が毎日読むものです。
  型にはまった言い回しは、続くほど読み飛ばされます。

・**この指示文の言葉を、そのまま文章に使わないでください。**
  「数字として残る」「改善できる点」などは、
  あなたへの説明であって、相手に見せる言葉ではありません。

・食事の記録が0件の日は、**最初にそれを伝えてください。**
  褒める文を先に置かないでください。伝えるべきことが後ろに行きます。
  食べていない日の献立を推測してはいけません。
  また、0件の日に P・F・C それぞれの不足量を並べないでください。
  何も食べていなければ全部不足するので、書いても何も伝わりません。

■ 出力

text に講評だけを入れてください。見出しや箇条書きは要りません。`;

export interface ReviewInput {
  /** 実績（人間の単位） */
  actual: { kcal: number; p: number; f: number; c: number };
  /** 目標（人間の単位） */
  target: { kcal: number; p: number; f: number; c: number };
  /** その日の運動時間（分）。無ければ 0 */
  exerciseMinutes: number;
  /** 食事の件数。0 なら記録が無い日 */
  mealCount: number;
  /**
   * 栄養値がまったく無く、上の摂取量に**入っていない**食材の数。
   * ここが0でないと、AIは実際より少ない数字を見て語ることになります。
   */
  noValueCount: number;
  /**
   * 契約者が仮に入れた値で計算されている食材の数。
   * こちらは摂取量に**入っています**。ただし確定した数字ではありません。
   */
  provisionalCount: number;
  /** 'gentle' | 'standard' | 'strict' | 'very_strict' */
  reviewMode: string;
}

/**
 * その日の記録に講評をもらう。
 *
 * ★ 送るのは数字と評価モードだけです（設計書 §9.4 / §35）。
 *   契約者ID・氏名・生年月日・体重・他の日の記録は送りません。
 *   AIから見れば、誰のものか分からない数字の組です。
 */
export async function requestDayReview(input: ReviewInput): Promise<string> {
  if (AI_RELAY_URL === null) throw new AiError('not_configured');

  const user = getAuthClient().currentUser;
  if (user === null) throw new AiError('unauthenticated');

  let idToken: string;
  try {
    idToken = await user.getIdToken();
  } catch {
    throw new AiError('unauthenticated');
  }

  const tone = TONE[input.reviewMode] ?? TONE.standard!;

  // ★ 文章にして渡します。ここに名前の入る余地がないことが、
  //   目で見て分かる形にしておきたいためです。
  const facts = [
    `【言い方の指定】${tone}`,
    '',
    '【この日の記録】',
    `食事の件数: ${input.mealCount}件`,
    `摂取: ${round(input.actual.kcal)}kcal / P ${round(input.actual.p)}g / F ${round(input.actual.f)}g / C ${round(input.actual.c)}g`,
    `目標: ${round(input.target.kcal)}kcal / P ${round(input.target.p)}g / F ${round(input.target.f)}g / C ${round(input.target.c)}g`,
    `目標との差: ${signed(input.actual.kcal - input.target.kcal)}kcal / P ${signed(input.actual.p - input.target.p)}g / F ${signed(input.actual.f - input.target.f)}g / C ${signed(input.actual.c - input.target.c)}g`,
    `運動: ${input.exerciseMinutes}分`,
    input.noValueCount > 0
      ? `※ 栄養値がまだ登録されていない食材が${input.noValueCount}件あり、上の摂取量には含まれていません。実際はこれより多く食べています。その前提で書いてください。`
      : '',
    // ★ 仮の値が混ざっていることは、AIにも伝えます。
    //   伝えないと、確定した数字と同じ確からしさで語ります。
    //   「167gちょうど摂れています」のような言い方は、仮の数字にはふさわしくありません。
    input.provisionalCount > 0
      ? `※ 上の摂取量には、本人が仮に入力した値で計算されている食材が${input.provisionalCount}件ぶん含まれています。まだトレーナーが確認していない数字なので、細かい数値の断定は避けてください。`
      : '',
  ]
    .filter((line) => line.length > 0)
    .join('\n');

  const body = {
    systemInstruction: { parts: [{ text: REVIEW_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: facts }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: REVIEW_RESPONSE_SCHEMA,
      temperature: 0.4,
    },
  };

  const response = await postToRelay(idToken, body);

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

  const text = (parsed as { text?: unknown }).text;
  if (typeof text !== 'string') throw new AiError('invalid_output');

  return text.trim();
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

function signed(v: number): string {
  const r = round(v);
  return r > 0 ? `+${r}` : String(r);
}

// -----------------------------------------------------------------------------
// 登録依頼のAI（追加仕様: 登録依頼のAI）
// -----------------------------------------------------------------------------

const FOOD_DRAFT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    per100g: {
      type: 'object',
      nullable: true,
      properties: {
        kcal: { type: 'number' },
        p: { type: 'number' },
        f: { type: 'number' },
        c: { type: 'number' },
      },
      required: ['kcal', 'p', 'f', 'c'],
    },
    confidence: { type: 'number' },
    assumed: { type: 'string' },
    aliases: { type: 'array', items: { type: 'string' } },
    sameAs: { type: 'string', nullable: true },
    sameAsReason: { type: 'string' },
  },
  required: ['per100g', 'confidence', 'assumed', 'aliases', 'sameAs', 'sameAsReason'],
} as const;

const FOOD_DRAFT_PROMPT = `あなたは、日本の食品成分表にくわしい管理栄養士です。
食材の名前を1つ渡すので、マスタ登録の**下書き**を作ってください。

これは下書きです。人が必ず見てから確定します。
ですから「それらしく埋める」ことに価値はありません。**分からないことは分からないと言ってください。**

■ per100g（100gあたりの値）

日本食品標準成分表にあるような、一般的な値を入れてください。
**分からない場合、思い当たらない場合、商品名で中身が特定できない場合は null にしてください。**
それらしい数字を作らないでください。null は失敗ではなく、正しい答えです。

調理法が書かれていなければ「生」の値にしてください。
「ゆで」「焼き」などが名前に含まれていれば、その状態の値にしてください。

■ assumed

どういう食品として答えたかを、一文で書いてください。
例:「皮なしの鶏むね肉（生）」「小麦粉のうどん（ゆで）」
人が「その食品ではない」と気づくための欄です。per100g が null でも書いてください。

■ confidence

0〜1。一般的な食材で成分表に載っているものは高く、
商品名・店名・あいまいな名前は低くしてください。

■ aliases（表記ゆれ）

**同じ食材を指す、日本語の書き方の違いだけ**を挙げてください。
例:「鶏むね肉」→「鶏ムネ肉」「とりむね」

次のものは入れないでください。
  ・商品名、メーカー名、店名
  ・調理法や状態が違うもの（「ゆで卵」は「卵」の別名ではありません）
  ・説明文（「高たんぱくな肉」など）
  ・部分が違うもの（「鶏もも肉」は「鶏むね肉」の別名ではありません）

思い当たらなければ空の配列にしてください。無理に挙げないでください。

■ sameAs（すでにある食材と同じか）

「登録済みの食材」の一覧を渡します。
渡した食材が、その一覧のどれかと**同じ食材**なら、その名前を**一覧に書かれたとおりそのまま**返してください。

一覧に無い名前は、絶対に返さないでください。
少しでも違う食材（部位が違う、調理法が違う、味付きと素材）なら null にしてください。
迷ったら null にしてください。まとめる判断は人がします。

sameAsReason には、そう判断した理由を一文で書いてください。null のときは空文字で構いません。`;

/** AI に見せるマスタの件数の上限。全部渡すと依頼が大きくなりすぎます */
const MASTER_LIMIT = 300;

/**
 * 食材名から、マスタ登録の下書きを作らせる（追加仕様: 登録依頼のAI）。
 *
 * ★ 送るのは**食材名と、マスタにある食材の名前だけ**です。
 *
 *   誰が依頼したか、いつ食べたか、何回食べたか、
 *   契約者が入れた仮の値は、一切送りません（設計書 §35）。
 *   送らなければ、AI 側で誰の記録かを結び付けられません。
 *
 * ★ マスタの名前を送るのは、「すでにある食材と同じか」を見るためです。
 *   これは全員で使う辞書であって、誰か個人の情報ではありません。
 *   数値も送りません（名前だけで足ります）。
 *
 * ★ 返ってきたものは、そのまま使ってはいけません。
 *   @pt/core の refineFoodDraft を必ず通してください。
 */
export async function suggestFoodDraft(
  name: string,
  masterNames: readonly string[],
): Promise<AiFoodDraft> {
  if (AI_RELAY_URL === null) throw new AiError('not_configured');

  const user = getAuthClient().currentUser;
  if (user === null) throw new AiError('unauthenticated');

  let idToken: string;
  try {
    idToken = await user.getIdToken();
  } catch {
    throw new AiError('unauthenticated');
  }

  const listed = masterNames.slice(0, MASTER_LIMIT);
  const prompt =
    `食材名: ${name}\n\n` +
    (listed.length > 0
      ? `登録済みの食材:\n${listed.map((n) => `- ${n}`).join('\n')}`
      : '登録済みの食材: （まだありません。sameAs は必ず null にしてください）');

  const body = {
    systemInstruction: { parts: [{ text: FOOD_DRAFT_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: FOOD_DRAFT_RESPONSE_SCHEMA,
      temperature: 0,
      ...NO_THINKING,
    },
  };

  const response = await postToRelay(idToken, body);

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

  const result = aiFoodDraftSchema.safeParse(parsed);
  if (!result.success) throw new AiError('invalid_output');

  return result.data;
}
