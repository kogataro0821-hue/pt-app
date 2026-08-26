import { SCALE, type Nutrients } from './types';

/**
 * 表示用の丸め（設計書 §38）。
 *
 *   内部: 123456 (= 123.456 kcal)
 *   表示: 約123kcal
 *
 * ★ この関数は「表示専用」。計算経路で呼んではいけない。
 *    丸めた値を足し合わせると §15 の合計一致が壊れる。
 */
export interface FormattedNutrients {
  /** 四捨五入した整数 kcal */
  readonly kcal: number;
  /** 小数第1位まで（g） */
  readonly p: number;
  readonly f: number;
  readonly c: number;
  readonly fiber: number;
  readonly salt: number;
}

export function formatNutrients(value: Nutrients): FormattedNutrients {
  return {
    kcal: roundTo(value.kcal / SCALE, 0),
    p: roundTo(value.p / SCALE, 1),
    f: roundTo(value.f / SCALE, 1),
    c: roundTo(value.c / SCALE, 1),
    fiber: roundTo(value.fiber / SCALE, 1),
    salt: roundTo(value.salt / SCALE, 1),
  };
}

/**
 * 指定した桁数で四捨五入する。
 * `Math.round(x * 10) / 10` は 1.005 のような値で誤差が出るため、
 * 指数表記を経由して丸める。
 */
export function roundTo(value: number, digits: number): number {
  if (!Number.isFinite(value)) return 0;
  if (digits === 0) return Math.round(value);
  const shifted = Number(`${value}e${digits}`);
  return Number(`${Math.round(shifted)}e-${digits}`);
}

/**
 * 「約123kcal」のような表示文字列。
 * コピペ出力（設計書 §27）と画面表示の両方でこれを使い、表記を1箇所に集約する。
 */
export function formatKcalLabel(value: Nutrients): string {
  return `約${formatNutrients(value).kcal}kcal`;
}

export function formatGramLabel(grams1000: number): string {
  return `約${roundTo(grams1000 / SCALE, 1)}g`;
}
