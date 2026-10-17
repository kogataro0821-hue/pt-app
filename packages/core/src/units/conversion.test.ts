import { describe, expect, it } from 'vitest';
import {
  COUNTABLE_UNITS,
  conversionFor,
  entryUnitsFor,
  formatAmount,
  isCountableUnit,
  normalizeConversions,
  toGrams,
  unitChoices,
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
  it('最初から6つ入っている', () => {
    // ★ 「袋」は、成分表示にグラム数が書かれていない既製品を
    //   「1袋ぶん」として登録するために足しました
    //   （追加仕様: 成分表示の読み取り）。
    // ★ 「杯」は、あとから足しました（追加仕様: 単位を増やす）。
    expect(COUNTABLE_UNITS).toEqual(['個', '枚', '本', '袋', 'パック', '杯']);
  });

  it('★ 「杯」も選べる。ただし重さは別の話', () => {
    // ★ 以前は外していました。外しても目分量は無くならず、
    //   「150g」と当て推量で打たれるだけでした。そちらは
    //   目分量だと分かりません。選べないほうが危なかったのです。
    //
    //   選べるようにしたうえで、その食材の1杯が何gか登録されて
    //   いなければ栄養値を入れません（toGrams が null）。
    expect(isCountableUnit('杯')).toBe(true);
    expect(toGrams(1, '杯', EGG)).toBeNull();
  });

  it('★ 管理者が足した単位も受け付ける', () => {
    // ★ 一覧に入っているかではなく、形だけを見ます
    expect(isCountableUnit('切れ')).toBe(true);
    expect(isCountableUnit('房')).toBe(true);
  });

  it('★ 単位の名前にならない形は、受け付けない', () => {
    // ★ 長い文章や空白を単位にされると、入力欄も一覧も崩れます
    expect(isCountableUnit('')).toBe(false);
    expect(isCountableUnit('   ')).toBe(false);
    expect(isCountableUnit('大きめの茶碗に1杯ぶん')).toBe(false);
    expect(isCountableUnit('お 椀')).toBe(false);
    expect(isCountableUnit(null)).toBe(false);
    expect(isCountableUnit(50)).toBe(false);
  });

  it('★ g は単位の一覧に入れない', () => {
    // ★ g は常に選べる特別な存在です。一覧に入れると
    //   「1g = ○g」という意味のない換算が作れてしまいます
    expect(isCountableUnit('g')).toBe(false);
  });
});

describe('★ 使える単位の一覧', () => {
  it('管理者が足したぶんが、後ろに付く', () => {
    expect(unitChoices(['切れ'])).toEqual(['個', '枚', '本', '袋', 'パック', '杯', '切れ']);
  });

  it('最初からあるものと同じ名前は、増えない', () => {
    expect(unitChoices(['個', '杯'])).toEqual(['個', '枚', '本', '袋', 'パック', '杯']);
  });

  it('形のおかしいものは混ぜない', () => {
    expect(unitChoices(['', '長すぎる単位の名前', 'g', '房'])).toEqual([
      '個',
      '枚',
      '本',
      '袋',
      'パック',
      '杯',
      '房',
    ]);
  });

  it('未設定でも落ちない', () => {
    expect(unitChoices(undefined)).toEqual(['個', '枚', '本', '袋', 'パック', '杯']);
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
      { unit: '', grams: 200 },
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
  it('★ g は必ず先頭にある', () => {
    // ★ 換算が1件も無い食材でも、量りで測れば入れられます。
    //   ここを閉じると、登録が追いつくまで記録そのものが止まります。
    expect(entryUnitsFor([])[0]).toBe('g');
    expect(entryUnitsFor(undefined)[0]).toBe('g');
  });

  it('★ 登録が無くても、単位は全部出す', () => {
    // ★ 以前は登録済みのものだけでした。ほとんどの食材で g しか出ず、
    //   壊れているように見えていました。使う人は理由が分からないまま、
    //   当て推量のグラム数を打つことになります
    expect(entryUnitsFor([])).toEqual(['g', '個', '枚', '本', '袋', 'パック', '杯']);
  });

  it('★ 登録済みの単位が、先に来る', () => {
    // ★ その食材で実際に数字が出るものを上に置きます
    expect(entryUnitsFor(EGG)).toEqual(['g', '個', '枚', '本', '袋', 'パック', '杯']);
    expect(
      entryUnitsFor([
        { unit: 'パック', grams: 45 },
        { unit: '杯', grams: 25 },
      ]),
    ).toEqual(['g', 'パック', '杯', '個', '枚', '本', '袋']);
  });

  it('管理者が足した単位も出る', () => {
    expect(entryUnitsFor([], ['切れ'])).toContain('切れ');
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
