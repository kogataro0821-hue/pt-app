import { NUTRIENT_KEYS, SCALE, ZERO, type DecimalNutrients, type Nutrients } from './types';

/**
 * 人間の単位（kcal / g）→ 内部表現（1/1000 単位の整数）。
 * ここが「丸めが起きる唯一の入口」。以降の加算では一切丸めない。
 */
export function toInternal(value: DecimalNutrients): Nutrients {
  return {
    kcal: encode(value.kcal),
    p: encode(value.p),
    f: encode(value.f),
    c: encode(value.c),
    fiber: encode(value.fiber ?? 0),
    salt: encode(value.salt ?? 0),
  };
}

/** 内部表現 → 人間の単位。丸めずに正確な小数へ戻す。 */
export function toDecimal(value: Nutrients): Required<DecimalNutrients> {
  return {
    kcal: value.kcal / SCALE,
    p: value.p / SCALE,
    f: value.f / SCALE,
    c: value.c / SCALE,
    fiber: value.fiber / SCALE,
    salt: value.salt / SCALE,
  };
}

function encode(n: number): number {
  if (!Number.isFinite(n)) {
    throw new RangeError(`栄養値が数値ではありません: ${String(n)}`);
  }
  if (n < 0) {
    throw new RangeError(`栄養値が負の数です: ${String(n)}`);
  }
  return Math.round(n * SCALE);
}

/**
 * 「100gあたりの栄養値」から「実際に食べた量の栄養値」を求める。
 *
 * 設計書 §14 の中心的な処理:
 *   白米180g → 食品マスタの100gあたり栄養値 → 180gへ換算 → PFC
 *
 * 丸めはこの関数の中で「食品1件につき1回だけ」行う。
 * 食品ごとの確定値が整数になるため、そのあとの合計は何度足しても誤差が出ない。
 */
export function scaleByGrams(per100g: Nutrients, grams: number): Nutrients {
  if (!Number.isFinite(grams) || grams < 0) {
    throw new RangeError(`重量が不正です: ${String(grams)}`);
  }
  const ratio = grams / 100;
  return mapNutrients(per100g, (v) => Math.round(v * ratio));
}

/**
 * 栄養値を任意の倍率にする（「おにぎり半量」＝ 0.5 倍 など。設計書 §18）。
 */
export function scaleByRatio(value: Nutrients, ratio: number): Nutrients {
  if (!Number.isFinite(ratio) || ratio < 0) {
    throw new RangeError(`倍率が不正です: ${String(ratio)}`);
  }
  return mapNutrients(value, (v) => Math.round(v * ratio));
}

/** 全栄養素に同じ変換を適用する。キーの追加漏れを防ぐための共通関数。 */
export function mapNutrients(value: Nutrients, fn: (v: number) => number): Nutrients {
  const out: Record<string, number> = {};
  for (const key of NUTRIENT_KEYS) {
    out[key] = fn(value[key]);
  }
  return out as unknown as Nutrients;
}

/** すべての栄養素が 0 か。 */
export function isZero(value: Nutrients): boolean {
  return NUTRIENT_KEYS.every((key) => value[key] === ZERO[key]);
}
