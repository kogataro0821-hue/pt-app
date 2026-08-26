import { describe, expect, it } from 'vitest';
import { toInternal } from './convert';
import { formatGramLabel, formatKcalLabel, formatNutrients, roundTo } from './format';
import { sumNutrients } from './sum';

describe('formatNutrients（設計書 §38）', () => {
  it('kcal は整数、PFC は小数第1位に丸める', () => {
    const value = toInternal({ kcal: 123.4567, p: 35.0421, f: 10.06, c: 60.449 });
    expect(formatNutrients(value)).toMatchObject({
      kcal: 123,
      p: 35.0,
      f: 10.1,
      c: 60.4,
    });
  });

  it('丸めても内部値は変わらない（表示専用であることの確認）', () => {
    const value = toInternal({ kcal: 123.4567, p: 35.0421, f: 0, c: 0 });
    formatNutrients(value);
    expect(value.kcal).toBe(123457); // 123.4567 → 123457（1/1000単位）
  });

  it('丸めた値を足しても、内部値の合計とは別物になる（だから計算に使ってはいけない）', () => {
    const a = toInternal({ kcal: 0, p: 0.44, f: 0, c: 0 });
    const b = toInternal({ kcal: 0, p: 0.44, f: 0, c: 0 });

    const correct = formatNutrients(sumNutrients([a, b])).p; // 0.88 → 0.9
    const wrong = formatNutrients(a).p + formatNutrients(b).p; // 0.4 + 0.4 = 0.8

    expect(correct).toBe(0.9);
    expect(wrong).toBe(0.8);
    expect(correct).not.toBe(wrong);
  });
});

describe('roundTo', () => {
  it.each([
    [0, 0, 0],
    [1.4, 0, 1],
    [1.5, 0, 2],
    [1.05, 1, 1.1],
    [10.04999, 1, 10.0],
    [123.4567, 0, 123],
  ])('roundTo(%s, %s) === %s', (value, digits, expected) => {
    expect(roundTo(value, digits)).toBe(expected);
  });
});

describe('表示ラベル（設計書 §27 コピペ出力で使う）', () => {
  it('kcal ラベル', () => {
    expect(formatKcalLabel(toInternal({ kcal: 499.6, p: 0, f: 0, c: 0 }))).toBe('約500kcal');
  });

  it('g ラベル', () => {
    expect(formatGramLabel(180_000)).toBe('約180g');
  });
});
