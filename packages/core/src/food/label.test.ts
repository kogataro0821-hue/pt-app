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

/**
 * ★ グラム数が書かれていない商品（追加仕様: 成分表示の読み取り）。
 *
 * ★ 守りたいのは3つです。
 *
 *   1. 単位を渡さなければ、これまでどおり止まること
 *   2. 単位を渡せば通り、**表示の数字がそのまま**入ること
 *   3. 「1袋ぶん」だという印が、必ず返ること
 */
describe('★ グラム数が書いていない商品', () => {
  const noGrams: LabelReading = {
    basis: 'perServing',
    servingGrams: null,
    kcal: 200,
    p: 10,
    f: 5,
    c: 30,
    sugar: null,
    fiber: null,
    salt: null,
    sodiumMg: null,
  };

  it('★ 単位を渡さなければ、これまでどおり止まる', () => {
    // ★ 黙って100gとみなすと、根拠のない数字が全員のマスタに入ります
    const out = labelToPer100g(noGrams);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('need-serving-grams');
  });

  it('★ 単位を渡すと通り、表示の数字がそのまま入る', () => {
    const out = labelToPer100g(noGrams, '袋');
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    // ★ 1袋 = 100g として置くので、割り算は起きません
    expect(out.per100g.kcal).toBe(200);
    expect(out.per100g.p).toBe(10);
    expect(out.per100g.f).toBe(5);
    expect(out.per100g.c).toBe(30);
  });

  it('★ 「1袋ぶん」だという印が返る', () => {
    // ★ この印を落とすと、あとで見た人が「100gでこのカロリー？」と誤解します
    const out = labelToPer100g(noGrams, '袋');
    expect(out.ok && out.servingUnit).toBe('袋');
  });

  it('印には、選んだ単位がそのまま入る', () => {
    const out = labelToPer100g(noGrams, '本');
    expect(out.ok && out.servingUnit).toBe('本');
  });

  it('そう決めたことが、控えに残る', () => {
    const out = labelToPer100g(noGrams, '袋');
    expect(out.ok && out.notes.join('')).toContain('1袋ぶん');
  });

  it('★ グラム数が読めているときは、単位を渡してもグラムを優先する', () => {
    // ★ 分かっているなら、本当の100gあたりのほうが価値があります
    const out = labelToPer100g({ ...noGrams, servingGrams: 50 }, '袋');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.per100g.kcal).toBe(400); // 50g で 200kcal → 100g で 400kcal
    expect(out.servingUnit).toBeNull();
  });

  it('100g当たりの表示では、単位を渡しても印は付かない', () => {
    const out = labelToPer100g({ ...noGrams, basis: 'per100g' }, '袋');
    expect(out.ok && out.servingUnit).toBeNull();
  });

  it('炭水化物が読めていなければ、単位を渡しても止まる', () => {
    // ★ グラム数の話と、数字が足りない話は別です
    const out = labelToPer100g({ ...noGrams, c: null, sugar: null }, '袋');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('need-carbs');
  });
});
