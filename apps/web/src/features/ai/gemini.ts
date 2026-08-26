import { aiTextResultSchema, toMealRecognition, type MealRecognition } from '@pt/ai-contract';
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
