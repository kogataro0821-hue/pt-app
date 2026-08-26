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

export const aiUnitSchema = z.enum([
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
]);

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
