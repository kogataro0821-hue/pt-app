import { describe, expect, it } from 'vitest';
import { labelBasisLabel, labelToPer100g, type LabelReading } from './label';

/** 何も書かれていない状態を出発点にする */
const EMPTY: LabelReading = {
  basis: 'per100g',
  servingGrams: null,
  kcal: 0,
  p: 0,
  f: 0,
  c: null,
  sugar: null,
  fiber: null,
  salt: null,
  sodiumMg: null,
};

function reading(over: Partial<LabelReading>): LabelReading {
  return { ...EMPTY, ...over };
}

describe('100g当たりの表示', () => {
  it('そのまま使う', () => {
    const r = labelToPer100g(reading({ kcal: 156, p: 2.5, f: 0.3, c: 37.1 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.per100g).toMatchObject({ kcal: 156, p: 2.5, f: 0.3, c: 37.1 });
  });
});

// ★ 実物での確認。送られてきたカップヌードルの表示そのまま。
describe('1食(57g)当たりの表示 — カップヌードル', () => {
  const cupNoodle = reading({
    basis: 'perServing',
    servingGrams: 57,
    kcal: 263,
    p: 6.6,
    f: 11.2,
    c: 34.0,
    salt: 3.9,
  });

  it('100gあたりに直す', () => {
    const r = labelToPer100g(cupNoodle);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // 263 ÷ 57 × 100 = 461.40…
    expect(r.per100g.kcal).toBe(461.4);
    expect(r.per100g.p).toBe(11.6);
    expect(r.per100g.f).toBe(19.6);
    expect(r.per100g.c).toBe(59.6);
    expect(r.per100g.salt).toBe(6.8);
  });

  it('何倍したかを残す', () => {
    const r = labelToPer100g(cupNoodle);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notes.join()).toContain('57g');
  });

  // ★ 1食ぶんに戻すと、表示の数字におおよそ戻る。
  //   ここがずれていたら、換算そのものが間違っている。
  it('1食分に戻すと元の数字になる', () => {
    const r = labelToPer100g(cupNoodle);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.per100g.kcal * 57) / 100).toBeCloseTo(263, 0);
  });
});

// ★ ここが「賢くしてはいけない」ところ。
//   1本当たり・1個当たりでグラム数が無いと、原理的に換算できない。
describe('グラム数が書かれていない表示', () => {
  it('換算せずに止める', () => {
    const r = labelToPer100g(reading({ basis: 'perServing', kcal: 200, p: 5, f: 3, c: 30 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('need-serving-grams');
    expect(r.message).toContain('グラム');
  });

  it('0gや負の数も受け付けない', () => {
    for (const g of [0, -57]) {
      const r = labelToPer100g(
        reading({ basis: 'perServing', servingGrams: g, kcal: 200, p: 5, f: 3, c: 30 }),
      );
      expect(r.ok).toBe(false);
    }
  });
});

describe('炭水化物の書き方', () => {
  // ★ 「炭水化物」ではなく「糖質／食物繊維」に分けている表示は多い。
  it('糖質と食物繊維に分かれていれば足す', () => {
    const r = labelToPer100g(reading({ kcal: 100, p: 1, f: 1, sugar: 30.2, fiber: 3.8 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.per100g.c).toBe(34);
    expect(r.per100g.fiber).toBe(3.8);
    expect(r.notes.join()).toContain('糖質と食物繊維');
  });

  it('糖質だけなら糖質を使い、そう記録する', () => {
    const r = labelToPer100g(reading({ kcal: 100, p: 1, f: 1, sugar: 30.2 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.per100g.c).toBe(30.2);
    expect(r.notes.join()).toContain('糖質');
  });

  it('炭水化物が優先される（糖質と両方あっても足さない）', () => {
    const r = labelToPer100g(reading({ kcal: 100, p: 1, f: 1, c: 34, sugar: 30.2, fiber: 3.8 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.per100g.c).toBe(34);
  });

  it('どちらも無ければ止める', () => {
    const r = labelToPer100g(reading({ kcal: 100, p: 1, f: 1 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('need-carbs');
  });
});

describe('食塩相当量', () => {
  it('そのまま使う', () => {
    const r = labelToPer100g(reading({ kcal: 100, p: 1, f: 1, c: 10, salt: 1.2 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.per100g.salt).toBe(1.2);
  });

  // ★ ナトリウムと食塩相当量は別物。混同すると2.5倍ずれる。
  it('ナトリウム(mg)しか無ければ換算する', () => {
    const r = labelToPer100g(reading({ kcal: 100, p: 1, f: 1, c: 10, sodiumMg: 500 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 500 × 2.54 ÷ 1000 = 1.27
    expect(r.per100g.salt).toBe(1.3);
    expect(r.notes.join()).toContain('ナトリウム');
  });

  it('食塩相当量があれば、ナトリウムは使わない', () => {
    const r = labelToPer100g(
      reading({ kcal: 100, p: 1, f: 1, c: 10, salt: 1.2, sodiumMg: 9999 }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.per100g.salt).toBe(1.2);
  });
});

describe('100ml当たりの表示', () => {
  // ★ mlとgは同じではない。同じとして扱ったことを必ず伝える。
  it('100gとして扱い、そのことを残す', () => {
    const r = labelToPer100g(reading({ basis: 'per100ml', kcal: 67, p: 3.3, f: 3.8, c: 4.8 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.per100g.kcal).toBe(67);
    expect(r.notes.join()).toContain('100ml');
  });
});

describe('おかしな値', () => {
  it('負の数は受け付けない', () => {
    expect(labelToPer100g(reading({ kcal: -100, p: 1, f: 1, c: 10 })).ok).toBe(false);
  });

  it('数値でないものは受け付けない', () => {
    expect(labelToPer100g(reading({ kcal: Number.NaN, p: 1, f: 1, c: 10 })).ok).toBe(false);
  });
});

describe('何として読んだかの表示', () => {
  it('人が確認できる文言になる', () => {
    expect(labelBasisLabel({ basis: 'per100g', servingGrams: null })).toBe('100g当たり');
    expect(labelBasisLabel({ basis: 'per100ml', servingGrams: null })).toBe('100ml当たり');
    expect(labelBasisLabel({ basis: 'perServing', servingGrams: 57 })).toBe('1回分(57g)当たり');
    expect(labelBasisLabel({ basis: 'perServing', servingGrams: null })).toContain('不明');
  });
});
