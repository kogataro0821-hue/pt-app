import { NUTRIENT_KEYS, ZERO, type Nutrients } from './types';

/**
 * ★ アプリ内で唯一の「栄養値を足す」関数。
 *
 * 設計書 §15（絶対ルール）
 *   総合計は必ず「各食品の栄養値を積み上げた結果」から算出する。
 *   総合計だけを別計算してはいけない。
 *
 * この関数以外に加算の経路を作らないこと。
 * 食事合計も日合計も、すべてこの関数を通す。
 *
 * 値が整数（1/1000単位）で保持されているため加算は結合則を満たし、
 *   sum([a, b, c, d]) === sum([sum([a, b]), sum([c, d])])
 * が「厳密に」成立する。つまり
 *   食材ごとの合計 === 食事合計 === 日合計
 * が誤差なしで保証される。
 */
export function sumNutrients(list: readonly Nutrients[]): Nutrients {
  const acc: Record<string, number> = {};
  for (const key of NUTRIENT_KEYS) {
    acc[key] = 0;
  }

  for (const item of list) {
    for (const key of NUTRIENT_KEYS) {
      acc[key] = (acc[key] as number) + item[key];
    }
  }

  return acc as unknown as Nutrients;
}

/**
 * 目標値との差分。プラスなら超過、マイナスなら不足（設計書 §26）。
 * 差分は負の値になり得るため、`Nutrients` の「非負」前提とは別の型として扱う。
 */
export function diffFromTarget(totals: Nutrients, target: Nutrients): Nutrients {
  const out: Record<string, number> = {};
  for (const key of NUTRIENT_KEYS) {
    out[key] = totals[key] - target[key];
  }
  return out as unknown as Nutrients;
}

/** 空配列を足したときに 0 が返ることを型と実装の両方で保証するための定数。 */
export const EMPTY_SUM: Nutrients = ZERO;
