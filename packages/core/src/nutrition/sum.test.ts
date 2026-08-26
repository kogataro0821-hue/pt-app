import { describe, expect, it } from 'vitest';
import { scaleByGrams, scaleByRatio, toInternal } from './convert';
import { diffFromTarget, sumNutrients } from './sum';
import { ZERO, type Nutrients } from './types';

/** テスト用: 100gあたりの栄養値を人間の単位で書く。 */
const per100g = {
  白米: toInternal({ kcal: 156, p: 2.5, f: 0.3, c: 34.6 }),
  鶏ささみ: toInternal({ kcal: 98, p: 23.9, f: 0.8, c: 0.1 }),
  卵: toInternal({ kcal: 142, p: 12.2, f: 10.2, c: 0.4 }),
  赤魚: toInternal({ kcal: 105, p: 20.6, f: 2.1, c: 0.1 }),
};

describe('sumNutrients', () => {
  it('空配列を足すと 0 になる', () => {
    expect(sumNutrients([])).toEqual(ZERO);
  });

  it('1件だけならその値がそのまま返る', () => {
    const one = scaleByGrams(per100g.白米, 150);
    expect(sumNutrients([one])).toEqual(one);
  });

  it('複数の食品を足せる', () => {
    const items = [scaleByGrams(per100g.白米, 180), scaleByGrams(per100g.鶏ささみ, 150)];
    const total = sumNutrients(items);
    expect(total.kcal).toBe(items[0]!.kcal + items[1]!.kcal);
    expect(total.p).toBe(items[0]!.p + items[1]!.p);
  });
});

describe('★ 設計書 §15: 食材合計 == 食事合計 == 日合計', () => {
  /** 3食 + 間食、計12品の1日分を組み立てる。 */
  function buildDay(): Nutrients[][] {
    return [
      // 1食目
      [
        scaleByGrams(per100g.白米, 180),
        scaleByGrams(per100g.卵, 60),
        scaleByGrams(per100g.鶏ささみ, 100),
      ],
      // 2食目
      [
        scaleByGrams(per100g.白米, 150),
        scaleByGrams(per100g.赤魚, 150),
        scaleByGrams(per100g.卵, 50),
        scaleByGrams(per100g.鶏ささみ, 120),
      ],
      // 3食目
      [
        scaleByGrams(per100g.白米, 120),
        scaleByGrams(per100g.鶏ささみ, 150),
        scaleByGrams(per100g.赤魚, 80),
      ],
      // 間食
      [scaleByGrams(per100g.卵, 55), scaleByGrams(per100g.鶏ささみ, 60)],
    ];
  }

  it('食材を一度に足した値と、食事ごとに足してから足した値が「厳密に」一致する', () => {
    const meals = buildDay();

    const allItems = meals.flat();
    const itemSum = sumNutrients(allItems); // 食材ごとの合計
    const mealTotals = meals.map(sumNutrients); // 各食事の合計
    const daySum = sumNutrients(mealTotals); // 日合計

    // toEqual は誤差を許容しない。整数で保持しているため完全一致する。
    expect(daySum).toEqual(itemSum);
  });

  it('どんなグループ分けをしても合計が変わらない（結合則）', () => {
    const items = buildDay().flat();
    const expected = sumNutrients(items);

    // 1件ずつ / 2件ずつ / 3件ずつ / 5件ずつ に分けて集計しても同じ結果になる
    for (const size of [1, 2, 3, 5, 7]) {
      const groups: Nutrients[][] = [];
      for (let i = 0; i < items.length; i += size) {
        groups.push(items.slice(i, i + size));
      }
      const grouped = sumNutrients(groups.map(sumNutrients));
      expect(grouped).toEqual(expected);
    }
  });

  it('順序を入れ替えても合計が変わらない（交換則）', () => {
    const items = buildDay().flat();
    const expected = sumNutrients(items);
    const reversed = sumNutrients([...items].reverse());
    expect(reversed).toEqual(expected);
  });

  it('ランダムな構成 200 ケースでも常に一致する', () => {
    // 疑似乱数（テストを再現可能にするためシード固定）
    let seed = 20260826;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const foods = Object.values(per100g);

    for (let n = 0; n < 200; n++) {
      const mealCount = 1 + Math.floor(rand() * 6);
      const meals: Nutrients[][] = [];
      for (let m = 0; m < mealCount; m++) {
        const itemCount = 1 + Math.floor(rand() * 8);
        const items: Nutrients[] = [];
        for (let i = 0; i < itemCount; i++) {
          const food = foods[Math.floor(rand() * foods.length)]!;
          items.push(scaleByGrams(food, Math.round(rand() * 400)));
        }
        meals.push(items);
      }
      expect(sumNutrients(meals.map(sumNutrients))).toEqual(sumNutrients(meals.flat()));
    }
  });
});

describe('設計書 §15 の例: 卵 P6.2 + 米 P3.8 + 鶏肉 P25 = P35.0', () => {
  it('内訳の合計と総合計が一致する', () => {
    const items = [
      toInternal({ kcal: 0, p: 6.2, f: 0, c: 0 }),
      toInternal({ kcal: 0, p: 3.8, f: 0, c: 0 }),
      toInternal({ kcal: 0, p: 25, f: 0, c: 0 }),
    ];
    const total = sumNutrients(items);
    expect(total.p).toBe(toInternal({ kcal: 0, p: 35, f: 0, c: 0 }).p);
  });
});

describe('scaleByGrams', () => {
  it('100g のときは 100gあたりの値そのまま', () => {
    expect(scaleByGrams(per100g.白米, 100)).toEqual(per100g.白米);
  });

  it('0g なら全て 0', () => {
    expect(scaleByGrams(per100g.白米, 0)).toEqual(ZERO);
  });

  it('白米150g のたんぱく質は 3.75g', () => {
    // 2.5g/100g × 1.5 = 3.75g → 内部表現では 3750
    expect(scaleByGrams(per100g.白米, 150).p).toBe(3750);
  });

  it('白米180g → 150g へ変更すると値が減る（設計書 §11 / §18）', () => {
    const before = scaleByGrams(per100g.白米, 180);
    const after = scaleByGrams(per100g.白米, 150);
    expect(after.kcal).toBeLessThan(before.kcal);
    expect(after.kcal).toBe(scaleByGrams(per100g.白米, 150).kcal);
  });

  it('負の重量は拒否する', () => {
    expect(() => scaleByGrams(per100g.白米, -1)).toThrow(RangeError);
  });
});

describe('scaleByRatio（設計書 §18「おにぎり半量」）', () => {
  it('0.5 倍すると全栄養素が半分になる', () => {
    const full = toInternal({ kcal: 200, p: 10, f: 4, c: 30 });
    const half = scaleByRatio(full, 0.5);
    expect(half).toEqual(toInternal({ kcal: 100, p: 5, f: 2, c: 15 }));
  });

  it('半量を2つ足すと元に戻る', () => {
    const full = toInternal({ kcal: 200, p: 10, f: 4, c: 30 });
    const half = scaleByRatio(full, 0.5);
    expect(sumNutrients([half, half])).toEqual(full);
  });
});

describe('diffFromTarget', () => {
  it('目標を超えていればプラス、不足していればマイナス', () => {
    const totals = toInternal({ kcal: 1900, p: 120, f: 60, c: 200 });
    const target = toInternal({ kcal: 1800, p: 130, f: 50, c: 200 });
    const diff = diffFromTarget(totals, target);
    expect(diff.kcal).toBeGreaterThan(0); // 100kcal 超過
    expect(diff.p).toBeLessThan(0); // 10g 不足
    expect(diff.c).toBe(0); // ちょうど
  });
});
