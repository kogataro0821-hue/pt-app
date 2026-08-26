/**
 * 栄養値の内部表現。
 *
 * ★重要（設計書 §15 / §38）
 * すべての値を「1/1000 単位の整数」で保持する。
 *
 *   kcal: 123456  →  123.456 kcal
 *   p:      35042 →   35.042 g
 *
 * なぜ整数なのか:
 *   浮動小数だと (a + b) + (c + d) と ((a + b) + c) + d が一致しない場合がある。
 *   つまり「食事ごとに合計してから足した日合計」と「全食品を一度に足した合計」が
 *   1e-13 レベルでズレる。§15 の「食材合計 == 食事合計 == 日合計」を
 *   “ほぼ一致” ではなく “厳密に一致” で保証したいので、整数で持つ。
 *
 *   1/1000 単位なら 1日分（〜5000kcal = 5,000,000）でも
 *   Number.MAX_SAFE_INTEGER に対して十分に小さく、桁あふれの心配はない。
 *
 * 表示するときだけ `formatNutrients()` で丸める。計算経路では絶対に丸めない。
 */
export interface Nutrients {
  /** ミリキロカロリー（1000 = 1kcal） */
  readonly kcal: number;
  /** たんぱく質・ミリグラム（1000 = 1g） */
  readonly p: number;
  /** 脂質・ミリグラム */
  readonly f: number;
  /** 炭水化物・ミリグラム */
  readonly c: number;
  /** 食物繊維・ミリグラム */
  readonly fiber: number;
  /** 食塩相当量・ミリグラム */
  readonly salt: number;
}

/** 人間が読み書きする単位（kcal / g）での栄養値。UI と Firestore の入出力で使う。 */
export interface DecimalNutrients {
  readonly kcal: number;
  readonly p: number;
  readonly f: number;
  readonly c: number;
  readonly fiber?: number;
  readonly salt?: number;
}

/** 栄養素のキー一覧。加算・変換はすべてこの配列を回して行う（漏れを防ぐため）。 */
export const NUTRIENT_KEYS = ['kcal', 'p', 'f', 'c', 'fiber', 'salt'] as const;

export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

/** 内部表現のスケール。1 g / 1 kcal = 1000。 */
export const SCALE = 1000;

export const ZERO: Nutrients = Object.freeze({
  kcal: 0,
  p: 0,
  f: 0,
  c: 0,
  fiber: 0,
  salt: 0,
});
