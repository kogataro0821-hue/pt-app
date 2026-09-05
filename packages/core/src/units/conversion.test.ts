import { describe, expect, it } from 'vitest';
import {
  COUNTABLE_UNITS,
  conversionFor,
  entryUnitsFor,
  formatAmount,
  isCountableUnit,
  normalizeConversions,
  toGrams,
  validateConversion,
  type UnitConversion,
} from './conversion';

/**
 * 「1個 = 50g」の換算（設計書 §10.5 / 追加仕様: 単位換算）。
 *
 * ★ ここで守りたいのは2つだけです。
 *
 *   1. 換算が無いときに、**0として計算しない**
 *   2. 危ない単位（杯・食・大さじ・小さじ）を、そもそも扱わない
 */

const EGG: UnitConversion[] = [{ unit: '個', grams: 50 }];

describe('扱う単位', () => {
  it('個 / 枚 / 本 / パック の4つだけ', () => {
    expect(COUNTABLE_UNITS).toEqual(['個', '枚', '本', 'パック']);
  });

  it('★ 「杯」「食」「大さじ」「小さじ」は扱わない', () => {
    // ★ 設計書 §10.5 の表には載っていますが、量が人によって違います。
    //   「1杯」が誰の茶碗かは、こちらには決めようがありません。
    //   正確そうに見えて実は目分量、が一番たちの悪い数字です。
    expect(isCountableUnit('杯')).toBe(false);
    expect(isCountableUnit('食')).toBe(false);
    expect(isCountableUnit('大さじ')).toBe(false);
    expect(isCountableUnit('小さじ')).toBe(false);
  });

  it('知らない文字列も受け付けない', () => {
    expect(isCountableUnit('こ')).toBe(false);
    expect(isCountableUnit('')).toBe(false);
    expect(isCountableUnit(null)).toBe(false);
    expect(isCountableUnit(50)).toBe(false);
  });
});

describe('グラムに直す', () => {
  it('卵2個 = 100g', () => {
    expect(toGrams(2, '個', EGG)).toBe(100);
  });

  it('半分でも計算できる', () => {
    expect(toGrams(0.5, '個', EGG)).toBe(25);
  });

  it('g はそのまま', () => {
    expect(toGrams(150, 'g', [])).toBe(150);
    expect(toGrams(150, 'g', EGG)).toBe(150);
  });

  it('★ 換算が無い単位は null（0にしない）', () => {
    // ★ ここを 0 で返すと、記録が静かに 0kcal になります。
    //   「入れたのに合計が増えない」ほど分かりにくい壊れ方はありません。
    expect(toGrams(2, '個', [])).toBeNull();
    expect(toGrams(2, '枚', EGG)).toBeNull();
    expect(toGrams(2, '個', undefined)).toBeNull();
  });

  it('数でないものは null', () => {
    expect(toGrams(Number.NaN, '個', EGG)).toBeNull();
    expect(toGrams(Number.POSITIVE_INFINITY, 'g', EGG)).toBeNull();
  });

  it('★ 小数のゴミを残さない', () => {
    // 3 × 33.3 は、そのまま掛けると 99.89999999999999 になります
    expect(toGrams(3, '個', [{ unit: '個', grams: 33.3 }])).toBe(99.9);
  });
});

describe('換算の検証', () => {
  it('ふつうの値は通る', () => {
    expect(validateConversion(50)).toBeNull();
    expect(validateConversion(0.1)).toBeNull();
    expect(validateConversion(2000)).toBeNull();
  });

  it('空欄・軽すぎ・重すぎは断る', () => {
    expect(validateConversion(null)).not.toBeNull();
    expect(validateConversion(0)).not.toBeNull();
    expect(validateConversion(-1)).not.toBeNull();
    expect(validateConversion(2001)).not.toBeNull();
    expect(validateConversion(Number.NaN)).not.toBeNull();
  });
});

describe('整える', () => {
  it('決まった順に並べ替える', () => {
    const messy: UnitConversion[] = [
      { unit: 'パック', grams: 45 },
      { unit: '個', grams: 50 },
      { unit: '枚', grams: 60 },
    ];
    expect(normalizeConversions(messy).map((c) => c.unit)).toEqual(['個', '枚', 'パック']);
  });

  it('★ 同じ単位が2件あったら、先のほうを残す', () => {
    // ★ 「1個=50g」と「1個=60g」が両方あると、どちらで計算されるか分かりません。
    //   黙って後ろ勝ちにするより、決めておくほうが安全です。
    const dup: UnitConversion[] = [
      { unit: '個', grams: 50 },
      { unit: '個', grams: 60 },
    ];
    expect(normalizeConversions(dup)).toEqual([{ unit: '個', grams: 50 }]);
  });

  it('壊れた値は落とす（読めた分は残す）', () => {
    const broken = [
      { unit: '個', grams: 50 },
      { unit: '杯', grams: 200 },
      { unit: '枚', grams: 0 },
      { unit: '本', grams: 100 },
    ] as UnitConversion[];

    expect(normalizeConversions(broken)).toEqual([
      { unit: '個', grams: 50 },
      { unit: '本', grams: 100 },
    ]);
  });

  it('未設定でも落ちない', () => {
    expect(normalizeConversions(undefined)).toEqual([]);
    expect(normalizeConversions([])).toEqual([]);
  });
});

describe('選べる単位', () => {
  it('★ g は必ず選べる', () => {
    // ★ 換算が1件も無い食材でも、量りで測れば入れられます。
    //   ここを閉じると、登録が追いつくまで記録そのものが止まります。
    expect(entryUnitsFor([])).toEqual(['g']);
    expect(entryUnitsFor(undefined)).toEqual(['g']);
  });

  it('登録されている単位が足される', () => {
    expect(entryUnitsFor(EGG)).toEqual(['g', '個']);
    expect(
      entryUnitsFor([
        { unit: 'パック', grams: 45 },
        { unit: '個', grams: 25 },
      ]),
    ).toEqual(['g', '個', 'パック']);
  });
});

describe('探す', () => {
  it('あれば返す', () => {
    expect(conversionFor(EGG, '個')).toEqual({ unit: '個', grams: 50 });
  });

  it('無ければ undefined', () => {
    expect(conversionFor(EGG, '枚')).toBeUndefined();
    expect(conversionFor(undefined, '個')).toBeUndefined();
  });
});

describe('表示', () => {
  it('整数は小数点を出さない', () => {
    expect(formatAmount(2, '個')).toBe('2個');
    expect(formatAmount(150, 'g')).toBe('150g');
  });

  it('小数は必要なぶんだけ出す', () => {
    expect(formatAmount(0.5, '個')).toBe('0.5個');
    expect(formatAmount(1.25, 'パック')).toBe('1.25パック');
  });
});
