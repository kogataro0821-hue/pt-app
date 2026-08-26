import { describe, expect, it } from 'vitest';
import { toInternal } from '../nutrition/convert';
import { sumNutrients } from '../nutrition/sum';
import { NUTRIENT_KEYS, type Nutrients } from '../nutrition/types';
import {
  computeItemNutrients,
  dayTotals,
  flatItemTotals,
  kcalMismatchWarning,
  mealTotals,
  nextMealLabel,
  renumber,
  validateItemInput,
  type Meal,
  type MealItem,
} from './meal';

// 実在する食品の値（日本食品標準成分表の概数）
const PER_100G = {
  白米: toInternal({ kcal: 156, p: 2.5, f: 0.3, c: 34.6 }),
  鶏むね肉: toInternal({ kcal: 191, p: 19.5, f: 11.6, c: 0 }),
  卵: toInternal({ kcal: 142, p: 12.2, f: 10.2, c: 0.4 }),
  ブロッコリー: toInternal({ kcal: 37, p: 5.4, f: 0.6, c: 6.6 }),
  オリーブ油: toInternal({ kcal: 894, p: 0, f: 100, c: 0 }),
  納豆: toInternal({ kcal: 190, p: 16.5, f: 10, c: 12.1 }),
};

let seq = 0;
function item(name: keyof typeof PER_100G, grams: number): MealItem {
  seq += 1;
  return {
    id: `i${seq}`,
    name,
    grams,
    per100g: PER_100G[name],
    nutrients: computeItemNutrients(PER_100G[name], grams),
    foodId: null,
  };
}

function meal(order: number, items: MealItem[]): Meal {
  return {
    id: `m${order}`,
    order,
    label: `${order + 1}食目`,
    items,
    memo: '',
    createdAt: null,
    updatedAt: null,
  };
}

describe('★ 食材合計 == 食事合計 == 日合計（設計書 §15 の絶対条件）', () => {
  const day = [
    meal(0, [item('白米', 180), item('鶏むね肉', 150), item('ブロッコリー', 80)]),
    meal(1, [item('卵', 55), item('納豆', 45), item('オリーブ油', 7)]),
    meal(2, [item('白米', 120), item('鶏むね肉', 95)]),
  ];

  it('日合計は、食材を平らに並べて足したものと完全に一致する', () => {
    expect(dayTotals(day)).toEqual(flatItemTotals(day));
  });

  it('日合計は、食事合計を足したものと完全に一致する', () => {
    expect(dayTotals(day)).toEqual(sumNutrients(day.map((m) => mealTotals(m))));
  });

  it('食事合計は、その食事の食材を足したものと完全に一致する', () => {
    for (const m of day) {
      expect(mealTotals(m)).toEqual(sumNutrients(m.items.map((i) => i.nutrients)));
    }
  });

  // 足す順番を変えても結果が変わらないこと。
  // 整数だからこそ成り立つ性質で、浮動小数点数では成り立たない。
  it('食事の並び順を変えても日合計は変わらない', () => {
    const reversed = [...day].reverse();
    expect(dayTotals(reversed)).toEqual(dayTotals(day));
  });

  it('食材の並び順を変えても食事合計は変わらない', () => {
    const m = day[0]!;
    const shuffled = { ...m, items: [m.items[2]!, m.items[0]!, m.items[1]!] };
    expect(mealTotals(shuffled)).toEqual(mealTotals(m));
  });

  it('端数の出る量を大量に足しても一致する', () => {
    const names = Object.keys(PER_100G) as (keyof typeof PER_100G)[];
    const meals: Meal[] = [];
    let n = 0;
    for (let mi = 0; mi < 7; mi += 1) {
      const items: MealItem[] = [];
      for (let ii = 0; ii < 9; ii += 1) {
        n += 1;
        // 3.3g, 6.6g, 9.9g … と、必ず端数が出る量にする
        items.push(item(names[n % names.length]!, Math.round(n * 3.3 * 10) / 10));
      }
      meals.push(meal(mi, items));
    }
    expect(dayTotals(meals)).toEqual(flatItemTotals(meals));
  });

  it('空の食事があっても壊れない', () => {
    const withEmpty = [meal(0, []), day[0]!, meal(2, [])];
    expect(dayTotals(withEmpty)).toEqual(mealTotals(day[0]!));
  });

  it('食事が1件も無ければ、すべて0', () => {
    const totals = dayTotals([]);
    for (const key of NUTRIENT_KEYS) {
      expect(totals[key]).toBe(0);
    }
  });
});

describe('食材の換算', () => {
  it('100gちょうどなら、100gあたりの値がそのまま出る', () => {
    expect(computeItemNutrients(PER_100G.白米, 100)).toEqual(PER_100G.白米);
  });

  it('白米180gは約281kcal', () => {
    const n: Nutrients = computeItemNutrients(PER_100G.白米, 180);
    expect(n.kcal).toBe(Math.round(156_000 * 1.8));
    expect(n.kcal / 1000).toBeCloseTo(280.8, 1);
  });

  it('0gなら0', () => {
    const n = computeItemNutrients(PER_100G.白米, 0);
    for (const key of NUTRIENT_KEYS) expect(n[key]).toBe(0);
  });

  it('負の量は例外になる', () => {
    expect(() => computeItemNutrients(PER_100G.白米, -1)).toThrow();
  });
});

describe('食事の並び', () => {
  it('次のラベルは件数+1', () => {
    expect(nextMealLabel([])).toBe('1食目');
    expect(nextMealLabel([{ label: '1食目' }, { label: '朝食' }])).toBe('3食目');
  });

  it('並び順を振り直すと 0,1,2… になる', () => {
    const out = renumber([meal(5, []), meal(2, []), meal(9, [])]);
    expect(out.map((m) => m.order)).toEqual([0, 1, 2]);
  });
});

describe('入力の検証', () => {
  const ok = { name: '鶏むね肉', grams: 150, per100g: { kcal: 191, p: 19.5, f: 11.6, c: 0 } };

  it('正しい入力は通る', () => {
    expect(validateItemInput(ok)).toEqual([]);
  });

  it('名前が空なら止める', () => {
    expect(validateItemInput({ ...ok, name: '   ' }).map((i) => i.field)).toContain('name');
  });

  it('量が未入力・0・大きすぎる場合は止める', () => {
    expect(validateItemInput({ ...ok, grams: null }).map((i) => i.field)).toContain('grams');
    expect(validateItemInput({ ...ok, grams: 0 }).map((i) => i.field)).toContain('grams');
    expect(validateItemInput({ ...ok, grams: 9999 }).map((i) => i.field)).toContain('grams');
  });

  it('栄養値が未入力なら止める', () => {
    const issues = validateItemInput({ ...ok, per100g: { kcal: 191 } });
    expect(issues.map((i) => i.field)).toEqual(expect.arrayContaining(['p', 'f', 'c']));
  });

  it('負の栄養値は止める', () => {
    expect(
      validateItemInput({ ...ok, per100g: { ...ok.per100g, f: -1 } }).map((i) => i.field),
    ).toContain('f');
  });

  it('100gあたり100gを超えるPFCは止める（打ち間違い）', () => {
    expect(
      validateItemInput({ ...ok, per100g: { ...ok.per100g, p: 150 } }).map((i) => i.field),
    ).toContain('p');
  });

  it('油は100gあたり脂質100gなので通る', () => {
    expect(validateItemInput({ name: '油', grams: 5, per100g: { kcal: 894, p: 0, f: 100, c: 0 } })).toEqual([]);
  });
});

describe('カロリーとPFCの食い違いの警告', () => {
  it('だいたい合っていれば警告しない', () => {
    expect(kcalMismatchWarning({ kcal: 191, p: 19.5, f: 11.6, c: 0 })).toBeNull();
  });

  // ★ 野菜は食物繊維のぶん計算値が高く出る。これは正常なので警告してはいけない。
  it('ブロッコリー（計算値53kcal・実際37kcal）は警告しない', () => {
    expect(kcalMismatchWarning({ kcal: 37, p: 5.4, f: 0.6, c: 6.6 })).toBeNull();
  });

  it('桁を1つ落としたら警告する（191→19）', () => {
    expect(kcalMismatchWarning({ kcal: 19, p: 19.5, f: 11.6, c: 0 })).toContain('kcal');
  });

  it('桁を1つ増やしても警告する（191→1910）', () => {
    expect(kcalMismatchWarning({ kcal: 1910, p: 19.5, f: 11.6, c: 0 })).toContain('kcal');
  });

  it('カロリー未入力なら警告しない（別の検証で止まるため）', () => {
    expect(kcalMismatchWarning({ kcal: 0, p: 10, f: 10, c: 10 })).toBeNull();
  });
});
