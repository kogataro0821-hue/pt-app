import { z } from 'zod';

/**
 * AI との入出力スキーマ（設計書 §36）。
 *
 * AI からの応答は必ずこのスキーマで検証してから使う。
 * 自然言語のまま DB に保存することはしない。
 */

// -----------------------------------------------------------------------------
// 共通
// -----------------------------------------------------------------------------

export const unitSchema = z.enum([
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
]);

export const quantitySchema = z.object({
  value: z.number().min(0),
  unit: unitSchema,
});

/**
 * パッケージの栄養成分表示を読み取った値（設計書 §10 / §13 優先度2）。
 * AI が「計算」した値ではなく、写真に書いてある数字を「転記」した値だけを入れる。
 */
export const packageLabelSchema = z.object({
  basis: z.enum(['per100g', 'per100ml', 'perServing', 'perPackage']),
  servingSizeGrams: z.number().min(0).nullable(),
  kcal: z.number().min(0).nullable(),
  protein: z.number().min(0).nullable(),
  fat: z.number().min(0).nullable(),
  carbohydrate: z.number().min(0).nullable(),
  fiber: z.number().min(0).nullable(),
  salt: z.number().min(0).nullable(),
});

// -----------------------------------------------------------------------------
// 食品認識（写真 / テキスト）
// -----------------------------------------------------------------------------

export const recognizedItemSchema = z.object({
  name: z.string().min(1),
  brand: z.string().nullable(),
  productName: z.string().nullable(),

  quantity: quantitySchema,
  /** 'confirmed' はAIからは返さない。ユーザーが確認して初めて confirmed になる。 */
  quantityStatus: z.enum(['estimated', 'unknown']),
  /** 「150〜180g」のような推定幅（設計書 §39）。 */
  quantityRange: z.object({ min: z.number().min(0), max: z.number().min(0) }).nullable(),

  cookingMethod: z.string().nullable(),
  packageLabel: packageLabelSchema.nullable(),

  confidence: z.number().min(0).max(1),

  /**
   * ★ 設計書 §12 の要。
   * 画像のどこ / 原文のどの部分を根拠にしたか。ここを必須にすることで
   * 「報告されていない情報を勝手に足す」ことを機械的に検出できる。
   * テキスト解析では、この文字列が原文に含まれるかを後処理で照合する。
   */
  evidence: z.string().min(1),

  /** ユーザーに聞かないと確定できない場合 true。 */
  needsUserInput: z.boolean(),
  /** 「白米は何gでしたか？」のような質問文（設計書 §39）。 */
  question: z.string().nullable(),
});

export const mealRecognitionSchema = z.object({
  /** 「1食目」など。ユーザーが自由に変えられるので、あくまで提案（設計書 §8）。 */
  mealLabelSuggestion: z.string().nullable(),
  items: z.array(recognizedItemSchema),
  /** 判別できなかったもの。勝手に食品名を当てはめず、ここに逃がす（設計書 §12 / §39）。 */
  unidentified: z.array(
    z.object({
      description: z.string().min(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
  notes: z.array(z.string()),
});

// -----------------------------------------------------------------------------
// 編集指示の解釈（設計書 §18）
// -----------------------------------------------------------------------------

export const editOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('update_quantity'),
    targetItemId: z.string().min(1),
    quantity: quantitySchema,
    evidence: z.string().min(1),
  }),
  z.object({
    op: z.literal('scale_item'),
    targetItemId: z.string().min(1),
    factor: z.number().positive(),
    evidence: z.string().min(1),
  }),
  z.object({
    op: z.literal('add_item'),
    name: z.string().min(1),
    quantity: quantitySchema,
    evidence: z.string().min(1),
  }),
  z.object({
    op: z.literal('remove_item'),
    targetItemId: z.string().min(1),
    evidence: z.string().min(1),
  }),
  z.object({
    op: z.literal('rename_meal'),
    label: z.string().min(1),
    evidence: z.string().min(1),
  }),
]);

export const editResultSchema = z.object({
  operations: z.array(editOperationSchema),
  /** 解釈できなかった指示。勝手に推測しない（設計書 §12）。 */
  unresolved: z.array(z.string()),
});

// -----------------------------------------------------------------------------
// 日次評価（設計書 §26）
// -----------------------------------------------------------------------------

export const reviewModeSchema = z.enum(['gentle', 'standard', 'strict', 'very_strict']);

export const dailyReviewSchema = z.object({
  /** そのまま画面に出す本文。Markdown の ** による太字は使わない（設計書 §27）。 */
  text: z.string().min(1),
  /** 良かった点・改善点を構造化して持つ（画面で色分けするため）。 */
  highlights: z.array(z.string()),
  improvements: z.array(z.string()),
});

// -----------------------------------------------------------------------------
// 入力側
// -----------------------------------------------------------------------------

export const photoInputSchema = z.object({
  /** data URL ではなく base64 本体のみ。 */
  imageBase64: z.string().min(1),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  /** ユーザーが添えた補足（「ごはんは軽め」など）。任意。 */
  hint: z.string().nullable(),
});

export const textInputSchema = z.object({
  text: z.string().min(1),
});

export const editInputSchema = z.object({
  instruction: z.string().min(1),
  /** 現在の食事の中身。AI が対象を特定するために必要な最小限だけ渡す（設計書 §35）。 */
  currentItems: z.array(
    z.object({
      itemId: z.string().min(1),
      name: z.string().min(1),
      quantity: quantitySchema,
    }),
  ),
});

export const reviewInputSchema = z.object({
  mode: reviewModeSchema,
  /**
   * ★ 設計書 §35: 契約者ID・氏名・年齢・連絡先は渡さない。
   * 渡すのは匿名の数値と目標だけ。
   */
  totals: z.object({
    kcal: z.number(),
    p: z.number(),
    f: z.number(),
    c: z.number(),
  }),
  target: z.object({
    kcal: z.number(),
    p: z.number(),
    f: z.number(),
    c: z.number(),
  }),
  meals: z.array(
    z.object({
      label: z.string(),
      items: z.array(z.object({ name: z.string(), grams: z.number() })),
    }),
  ),
  exercises: z.array(z.string()),
  note: z.string().nullable(),
});

// -----------------------------------------------------------------------------
// 型
// -----------------------------------------------------------------------------

export type Unit = z.infer<typeof unitSchema>;
export type Quantity = z.infer<typeof quantitySchema>;
export type PackageLabel = z.infer<typeof packageLabelSchema>;
export type RecognizedItem = z.infer<typeof recognizedItemSchema>;
export type MealRecognition = z.infer<typeof mealRecognitionSchema>;
export type EditOperation = z.infer<typeof editOperationSchema>;
export type EditResult = z.infer<typeof editResultSchema>;
export type ReviewMode = z.infer<typeof reviewModeSchema>;
export type DailyReview = z.infer<typeof dailyReviewSchema>;
export type PhotoInput = z.infer<typeof photoInputSchema>;
export type TextInput = z.infer<typeof textInputSchema>;
export type EditInput = z.infer<typeof editInputSchema>;
export type ReviewInput = z.infer<typeof reviewInputSchema>;
