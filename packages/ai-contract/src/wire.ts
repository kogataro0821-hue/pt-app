import { z } from 'zod';
import type { RecognizedItem, MealRecognition } from './schemas';

/**
 * AI に返させる形（設計書 §36）。
 *
 * ★ なぜ schemas.ts の型をそのまま使わないのか
 *
 *   RecognizedItem には brand / productName / packageLabel など、
 *   写真解析で使う項目が含まれます。テキスト解析でそこまで返させると、
 *   AI が「返す欄があるから」という理由で埋めにきます。
 *   それは §12 が禁じている「勝手な補完」そのものです。
 *
 *   そこで AI に見せる形は、そのとき本当に必要な項目だけに絞り、
 *   受け取ってからアプリ側の型へ広げます。欄が無ければ埋めようがありません。
 */

const KNOWN_UNITS = [
  'g',
  'ml',
  '個',
  '枚',
  '本',
  '杯',
  '食',
  'パック',
  '大さじ',
  '小さじ',
  'unknown',
] as const;

/**
 * 単位。
 *
 * ★ 知らない単位が来たら 'unknown' に寄せます。
 *   AIが「切れ」「玉」など想定外の単位を返したとき、
 *   応答全体を捨ててしまうと、他の正しい項目まで失われるためです。
 *   'unknown' になれば「何グラムでしたか」と聞く動きになるので、
 *   勝手な換算が起きる心配はありません。
 */
export const aiUnitSchema = z.preprocess(
  (value) =>
    typeof value === 'string' && (KNOWN_UNITS as readonly string[]).includes(value)
      ? value
      : 'unknown',
  z.enum(KNOWN_UNITS),
);

export const aiItemSchema = z.object({
  /** 食材の名前。商品名ではなく、一般的な food の名前 */
  name: z.string().min(1),
  /** 量。分からなければ 0 を返させ、unitKnown を false にする */
  amount: z.number().min(0),
  unit: aiUnitSchema,
  /** 量が原文に書かれていたか。書かれていなければ false */
  amountStated: z.boolean(),
  /** 0〜1。自信の度合い */
  confidence: z.number().min(0).max(1),
  /** ★ 原文のどの部分を根拠にしたか。ここが原文に無ければ、その項目は捨てる */
  evidence: z.string().min(1),
  /** 利用者に聞きたいこと。無ければ空文字 */
  question: z.string(),
});

export const aiTextResultSchema = z.object({
  items: z.array(aiItemSchema),
  /** 食べ物と判断できなかった部分。勝手に食品名を当てはめずここへ逃がす */
  unidentified: z.array(z.string()),
  /** 補足。利用者に見せる */
  notes: z.array(z.string()),
});

export type AiUnit = z.infer<typeof aiUnitSchema>;
export type AiItem = z.infer<typeof aiItemSchema>;
export type AiTextResult = z.infer<typeof aiTextResultSchema>;

/**
 * AI の応答を、アプリ内の型へ広げる。
 *
 * ★ 埋められなかった項目は null のままにします。
 *   「たぶんこうだろう」で埋めると、AIが答えていないことが
 *   AIの回答として保存されてしまいます。
 */
export function toRecognizedItem(item: AiItem): RecognizedItem {
  const unitIsMeasurable = item.unit === 'g' || item.unit === 'ml';

  return {
    name: item.name,
    brand: null,
    productName: null,
    quantity: {
      value: item.amount,
      // g / ml 以外（個・杯・unknown）は、そのままでは計算に使えません。
      // 単位は 'g' に寄せたうえで needsUserInput を立て、量を聞き直します。
      // ★ ここで勝手に換算しないことが重要です（設計書 §12 / §39）。
      unit: item.unit === 'ml' ? 'ml' : 'g',
    },
    quantityStatus: item.amountStated && unitIsMeasurable ? 'estimated' : 'unknown',
    quantityRange: null,
    cookingMethod: null,
    packageLabel: null,
    confidence: item.confidence,
    evidence: item.evidence,
    // グラム以外の単位（個・杯など）は、そのままでは栄養計算ができません。
    // 勝手に換算せず、利用者に聞きます（設計書 §39）。
    needsUserInput: !item.amountStated || !unitIsMeasurable,
    question:
      item.question.length > 0
        ? item.question
        : !unitIsMeasurable && item.unit !== 'unknown'
          ? `${item.name}は何グラムでしたか？（${item.amount}${item.unit}）`
          : !item.amountStated
            ? `${item.name}は何グラムでしたか？`
            : null,
  };
}

export function toMealRecognition(result: AiTextResult): MealRecognition {
  return {
    mealLabelSuggestion: null,
    items: result.items.map(toRecognizedItem),
    unidentified: result.unidentified.map((description) => ({ description, confidence: 0 })),
    notes: result.notes,
  };
}

// -----------------------------------------------------------------------------
// 写真からの認識（設計書 §10 / §39 / Phase 8B）
// -----------------------------------------------------------------------------

/**
 * ★ 写真では「原文照合」が使えません。
 *
 *   テキスト解析では、AIが返した根拠が入力文に含まれるかを機械的に照合し、
 *   含まれなければ捨てていました（§12 の第3層）。
 *   写真には照合する原文が無いので、この防御が丸ごと使えません。
 *
 *   代わりに3つで受け止めます。
 *
 *   1. 量を必ず「幅」で答えさせる（150〜200g のように）
 *      幅が広い＝自信が無い、が数字として現れます。
 *      「180g」と1点で言い切らせると、推定が事実に見えてしまいます。
 *
 *   2. 写真から来た項目は、1つも自動で採用しない
 *      すべて「確認待ち」として人に見せます。テキストの場合と違い、
 *      そのまま登録される経路を作りません。
 *
 *   3. 自信の低いものは捨てる
 *      根拠の照合ができないぶん、テキストより厳しい閾値にします。
 */
export const aiPhotoItemSchema = z.object({
  name: z.string().min(1),
  /** 推定の中心値（g） */
  amountGrams: z.number().min(0),
  /** 推定の下限・上限（g）。自信が無いほど幅が広くなる */
  amountMinGrams: z.number().min(0),
  amountMaxGrams: z.number().min(0),
  confidence: z.number().min(0).max(1),
  /** 写真のどこに、どう写っているか。人が見比べるための手がかり */
  evidence: z.string().min(1),
  question: z.string(),
});

export const aiPhotoResultSchema = z.object({
  items: z.array(aiPhotoItemSchema),
  /** 何か写っているが、食品として特定できなかったもの */
  unidentified: z.array(z.string()),
  notes: z.array(z.string()),
});

export type AiPhotoItem = z.infer<typeof aiPhotoItemSchema>;
export type AiPhotoResult = z.infer<typeof aiPhotoResultSchema>;

/** 写真から来た項目は、すべて確認待ちにする。 */
export function toRecognizedPhotoItem(item: AiPhotoItem): RecognizedItem {
  const min = Math.min(item.amountMinGrams, item.amountMaxGrams);
  const max = Math.max(item.amountMinGrams, item.amountMaxGrams);

  return {
    name: item.name,
    brand: null,
    productName: null,
    quantity: { value: item.amountGrams, unit: 'g' },
    // ★ 'confirmed' には決してしません。写真から分かるのは推定までです。
    quantityStatus: 'estimated',
    quantityRange: max > min ? { min, max } : null,
    cookingMethod: null,
    packageLabel: null,
    confidence: item.confidence,
    evidence: item.evidence,
    // ★ 写真から来たものは、例外なく人の確認を通します。
    needsUserInput: true,
    question: item.question.length > 0 ? item.question : null,
  };
}

export function toPhotoRecognition(result: AiPhotoResult): MealRecognition {
  return {
    mealLabelSuggestion: null,
    items: result.items.map(toRecognizedPhotoItem),
    unidentified: result.unidentified.map((description) => ({ description, confidence: 0 })),
    notes: result.notes,
  };
}

/**
 * 写真から来た項目に使う、確信度の下限。
 *
 * テキストの 0.6 より高くしてあります。
 * 原文照合という後ろ盾が無いぶん、入口を厳しくして釣り合いを取ります。
 */
export const PHOTO_MIN_CONFIDENCE = 0.75;

/** 推定幅を「150〜200g」の形にする。幅が無ければ null。 */
export function formatRange(item: RecognizedItem): string | null {
  if (item.quantityRange === null) return null;
  const { min, max } = item.quantityRange;
  return `${Math.round(min)}〜${Math.round(max)}g`;
}

// -----------------------------------------------------------------------------
// 栄養成分表示の読み取り（設計書 §47 / 追加仕様: 成分表示の読み取り）
// -----------------------------------------------------------------------------

/**
 * ★ AIには「表示に何と書いてあるか」だけを答えさせます。
 *   100gあたりへの換算はこちらでやります（@pt/core の labelToPer100g）。
 *
 *   AIに換算までやらせると、263kcal が 461kcal になった理由が
 *   説明できなくなります。間違っていたときに気づけない数字は、
 *   全員のマスタに入れてはいけません。
 *
 * ★ 読めなかった項目は null にさせます。0 にさせません。
 *   「書いていない」と「0と書いてある」は別のことです。
 *   0で埋められると、脂質0gの食品として登録されてしまいます。
 */
const nullableNumber = z.preprocess(
  (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null),
  z.number().nullable(),
);

export const aiLabelResultSchema = z.object({
  /** 'per100g' | 'per100ml' | 'perServing' | 'unknown' */
  basis: z.preprocess(
    (v) => (v === 'per100g' || v === 'per100ml' || v === 'perServing' ? v : 'unknown'),
    z.enum(['per100g', 'per100ml', 'perServing', 'unknown']),
  ),
  servingGrams: nullableNumber,
  kcal: nullableNumber,
  p: nullableNumber,
  f: nullableNumber,
  c: nullableNumber,
  sugar: nullableNumber,
  fiber: nullableNumber,
  salt: nullableNumber,
  sodiumMg: nullableNumber,
  /** 商品名。読めなければ空文字 */
  productName: z.preprocess((v) => (typeof v === 'string' ? v : ''), z.string()),
  /** どの欄を読んだか。人が確認するために必ず書かせる */
  evidence: z.preprocess((v) => (typeof v === 'string' ? v : ''), z.string()),
  /** 読み取れなかったこと・迷ったこと */
  notes: z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((n) => typeof n === 'string') : []),
    z.array(z.string()),
  ),
});

export type AiLabelResult = z.infer<typeof aiLabelResultSchema>;

// -----------------------------------------------------------------------------
// 登録依頼のAI（追加仕様: 登録依頼のAI）
// -----------------------------------------------------------------------------

/**
 * 食材名から、マスタ登録の下書きを作らせる形。
 *
 * ★ AI に渡すのは**食材名と、いまマスタにある名前の一覧だけ**です。
 *   誰が依頼したか、いつ食べたか、契約者が入れた仮の値は渡しません。
 *   渡さなければ、AI 側で誰の記録かを結び付けられません。
 *
 * ★ 「分からない」を返せる形にしてあります。
 *
 *   per100g を必須にすると、AI は分からなくても何か入れます。
 *   埋める欄があるから埋める、というのが §12 が禁じている補完です。
 *   null を返せるようにして、分からないときは分からないと言わせます。
 */
const foodDraftWireSchema = z.object({
  /**
   * 100gあたりの値。**平らに並べます。**
   *
   * ★ 最初は per100g という入れ子の object にして、それを nullable にしていました。
   *   それだと Gemini が要求ごと 400 で断ります。
   *
   *   すでに動いていた成分表示の読み取りは、
   *   **数値を平らに並べ、nullable なものは required に入れない**形でした。
   *   同じ形にそろえます。動いているものに合わせるのが確実です。
   */
  kcal: z.number().nullish(),
  p: z.number().nullish(),
  f: z.number().nullish(),
  c: z.number().nullish(),
  confidence: z.number().min(0).max(1),
  /** どういう食品として答えたか。人が「その食品ではない」と気づくための手がかり */
  assumed: z.string(),
  /**
   * 日本語の表記ゆれ。
   *
   * ★ 上限を決めています。多いほど良さそうに見えますが、
   *   別名はマスタの引き当てを変えるものです。
   *   確かめずに10個入れるより、確かめられる数に絞ります。
   */
  aliases: z.array(z.string()).max(8).default([]),
  /**
   * すでにマスタにある同じ食材の**名前**（IDではなく）。無ければ null。
   *
   * ★ 名前で返させて、こちら側で一覧と照合します。
   *   ID を返させると、存在しないIDを作られたときに気づけません。
   */
  sameAs: z.string().nullish(),
  sameAsReason: z.string().default(''),
});

/**
 * 食材名から、マスタ登録の下書きを作らせる形。
 *
 * ★ AI に渡すのは**食材名と、いまマスタにある名前の一覧だけ**です。
 *   誰が依頼したか、いつ食べたか、契約者が入れた仮の値は渡しません。
 *   渡さなければ、AI 側で誰の記録かを結び付けられません。
 *
 * ★ 「分からない」を返せる形にしてあります。
 *
 *   数値を必須にすると、AI は分からなくても何か入れます。
 *   埋める欄があるから埋める、というのが §12 が禁じている補完です。
 *   null を返せるようにして、分からないときは分からないと言わせます。
 *
 * ★ 4つのうち1つでも欠けていたら、まるごと「分からない」にします。
 *   kcal だけ返ってきて PFC が空、というのは半端な値です。
 *   半端な値をマスタに入れるくらいなら、手で入れたほうがましです。
 */
export const aiFoodDraftSchema = foodDraftWireSchema.transform((raw) => {
  const complete =
    typeof raw.kcal === 'number' &&
    typeof raw.p === 'number' &&
    typeof raw.f === 'number' &&
    typeof raw.c === 'number';

  return {
    per100g: complete
      ? { kcal: raw.kcal as number, p: raw.p as number, f: raw.f as number, c: raw.c as number }
      : null,
    confidence: raw.confidence,
    assumed: raw.assumed,
    aliases: raw.aliases,
    sameAs: raw.sameAs ?? null,
    sameAsReason: raw.sameAsReason,
  };
});

export type AiFoodDraft = z.infer<typeof aiFoodDraftSchema>;
