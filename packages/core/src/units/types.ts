/**
 * 数量の単位（設計書 §10.5）。
 *
 * g / ml は普遍的に換算できるが、「個」「杯」「食」などは
 * 食品ごとの換算表（Food.unitConversions）が無いとグラムに直せない。
 * 換算できない場合は 0 として計算しつつ、必ず「要確認」として画面に出す。
 */
export const UNITS = [
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
] as const;

export type Unit = (typeof UNITS)[number];

export interface Quantity {
  readonly value: number;
  readonly unit: Unit;
}

/** 数量が確定値か、AI等による推定値か、まったく不明か（設計書 §11）。 */
export type QuantityStatus = 'confirmed' | 'estimated' | 'unknown';

/** 栄養値をどこから取ってきたか。数字が小さいほど優先度が高い（設計書 §13）。 */
export const NUTRITION_SOURCES = [
  'user_input', // 1. ユーザーが直接入力した栄養成分
  'package_label', // 2. 商品パッケージの栄養表示
  'food_master', // 3. 登録済み食品マスタ
  'recipe', // 4. 登録済みレシピ
  'reference_db', // 5. 信頼できる食品成分データ
  'generic', // 6. 一般的な食品データ
  'ai_estimate', // 7. AI推定
] as const;

export type NutritionSource = (typeof NUTRITION_SOURCES)[number];

/** 優先順位（1が最優先）。上位が存在する場合、下位で上書きしてはいけない。 */
export function sourcePriority(source: NutritionSource): number {
  return NUTRITION_SOURCES.indexOf(source) + 1;
}
