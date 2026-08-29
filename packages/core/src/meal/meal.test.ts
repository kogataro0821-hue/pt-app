import { describe, expect, it } from 'vitest';
import { foodKey } from '../food/matching';
import { toInternal } from '../nutrition/convert';
import { sumNutrients } from '../nutrition/sum';
import { NUTRIENT_KEYS, ZERO, type Nutrients } from '../nutrition/types';
import {
  applyFoodToPending,
  computeItemNutrients,
  countNoValue,
  countPending,
  countProvisional,
  provisionalTotals,
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
    pending: false, provisional: false,
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

describe('★ 栄養値が未確定の食材（設計書 §13 / Phase 9）', () => {
  const pendingItem: MealItem = {
    id: 'p1',
    name: 'サラダチキン',
    grams: 120,
    per100g: { kcal: 0, p: 0, f: 0, c: 0, fiber: 0, salt: 0 },
    nutrients: { kcal: 0, p: 0, f: 0, c: 0, fiber: 0, salt: 0 },
    foodId: null,
    pending: true, provisional: false,
  };

  // ★ 未確定は0として扱う。適当な数字で埋めると、合計が嘘になる。
  it('未確定の食材は合計に影響しない', () => {
    const withPending = meal(0, [item('白米', 180), pendingItem]);
    const withoutPending = meal(0, [item('白米', 180)]);
    expect(mealTotals(withPending)).toEqual(mealTotals(withoutPending));
  });

  // ★ そのぶん「合計が実際より少ない」ことは必ず伝える必要がある。
  it('未確定の件数を数えられる', () => {
    expect(countPending([meal(0, [item('白米', 180), pendingItem])])).toBe(1);
    expect(countPending([meal(0, [item('白米', 180)])])).toBe(0);
    expect(countPending([])).toBe(0);
  });

  it('複数の食事にまたがっても数えられる', () => {
    expect(countPending([meal(0, [pendingItem]), meal(1, [pendingItem, item('卵', 55)])])).toBe(2);
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

// -----------------------------------------------------------------------------
// 未確定の食材への後追い反映（Phase 9）
// -----------------------------------------------------------------------------

describe('未確定の食材にあとから栄養値を入れる', () => {
  const CHICKEN = {
    id: 'torimune',
    name: '鶏むね肉',
    per100g: toInternal({ kcal: 105, p: 23.3, f: 1.9, c: 0.1 }),
  };

  /** 未確定の食材1件だけを持つ食事を作る */
  function pendingMeal(name: string, grams: number, rest: MealItem[] = []): Meal {
    return {
      id: 'm1',
      order: 0,
      label: '1食目',
      memo: '',
      items: [
        {
          id: 'i1',
          name,
          grams,
          per100g: ZERO,
          nutrients: ZERO,
          foodId: null,
          pending: true, provisional: false,
        },
        ...rest,
      ],
      createdAt: null,
      updatedAt: null,
    };
  }

  it('照合キーが一致する未確定の食材に値が入る', () => {
    const { meal, changed } = applyFoodToPending(pendingMeal('鶏むね肉', 200), '鶏むね肉', CHICKEN);

    expect(changed).toBe(1);
    expect(meal.items[0]?.pending).toBe(false);
    expect(meal.items[0]?.foodId).toBe('torimune');
    expect(meal.items[0]?.nutrients).toEqual(computeItemNutrients(CHICKEN.per100g, 200));
  });

  // ★ ここが「予測変換のぶれ」対策の効き目。
  //   別の書き方で記録されていても、同じキーになるので拾えます。
  it('書き方が違っても、同じ照合キーなら拾う（鶏ムネ肉 → 鶏むね肉）', () => {
    const { meal, changed } = applyFoodToPending(pendingMeal('鶏ムネ肉', 100), '鶏むね肉', CHICKEN);

    expect(changed).toBe(1);
    // 名前もマスタ側に揃える。一覧に2つの書き方が並び続けないように。
    expect(meal.items[0]?.name).toBe('鶏むね肉');
  });

  it('照合キーが違う食材には触らない', () => {
    const { meal, changed } = applyFoodToPending(pendingMeal('白米', 150), '鶏むね肉', CHICKEN);

    expect(changed).toBe(0);
    expect(meal.items[0]?.pending).toBe(true);
    expect(meal.items[0]?.name).toBe('白米');
  });

  // ★ すでに誰かが確認して入った数字を、あとから黙って変えてはいけない。
  it('確定済みの食材は、名前が同じでも書き換えない', () => {
    const confirmed: MealItem = {
      id: 'i2',
      name: '鶏むね肉',
      grams: 100,
      per100g: toInternal({ kcal: 999, p: 1, f: 1, c: 1 }),
      nutrients: computeItemNutrients(toInternal({ kcal: 999, p: 1, f: 1, c: 1 }), 100),
      foodId: 'べつのなにか',
      pending: false, provisional: false,
    };

    const meal: Meal = { ...pendingMeal('白米', 150), items: [confirmed] };
    const { changed, meal: after } = applyFoodToPending(meal, '鶏むね肉', CHICKEN);

    expect(changed).toBe(0);
    expect(after.items[0]).toEqual(confirmed);
  });

  it('変化が無ければ同じ食事をそのまま返す（保存を省けるように）', () => {
    const meal = pendingMeal('白米', 150);
    expect(applyFoodToPending(meal, '鶏むね肉', CHICKEN).meal).toBe(meal);
  });

  it('1つの食事に同じ食材が2件あれば、どちらも入る', () => {
    const second: MealItem = {
      id: 'i2',
      name: '鶏ムネ肉',
      grams: 50,
      per100g: ZERO,
      nutrients: ZERO,
      foodId: null,
      pending: true, provisional: false,
    };

    const { changed } = applyFoodToPending(
      pendingMeal('鶏むね肉', 100, [second]),
      '鶏むね肉',
      CHICKEN,
    );

    expect(changed).toBe(2);
  });

  // ★ 置き換えたあとも「食材合計 == 食事合計」が崩れないことを確かめる（設計書 §15）
  it('置き換えたあとも食事の合計が食材の積み上げと一致する', () => {
    const { meal } = applyFoodToPending(pendingMeal('鶏むね肉', 175), '鶏むね肉', CHICKEN);

    expect(mealTotals(meal)).toEqual(sumNutrients(meal.items.map((i) => i.nutrients)));
  });

  it('置き換えたぶんが日合計にも反映される', () => {
    const before = pendingMeal('鶏むね肉', 200);
    expect(dayTotals([before]).kcal).toBe(0);

    const { meal } = applyFoodToPending(before, '鶏むね肉', CHICKEN);
    expect(dayTotals([meal]).kcal).toBe(computeItemNutrients(CHICKEN.per100g, 200).kcal);
  });

  it('置き換えると未確定の件数が減る', () => {
    const before = pendingMeal('鶏むね肉', 200);
    expect(countPending([before])).toBe(1);

    const { meal } = applyFoodToPending(before, '鶏むね肉', CHICKEN);
    expect(countPending([meal])).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// 追加仕様: 仮の栄養値
//
// ★ ここは、設計の原則と使い勝手がぶつかった場所です。
//
//   原則:「栄養値を決めるのは管理者だけ」。守らないと、白米が人によって
//        156kcal だったり 200kcal だったりして、数字を根拠にした指導ができません。
//
//   現実: マスタに無い食材を食べた日は、合計が実際より少なく出ます。
//        記録したのに0のままだと、続ける気がなくなります。
//
//   折り合いは「マスタに無い食材にかぎり、契約者が仮の値を入れられる。
//   ただし合計とは分けて見せ、管理者が登録したら置き換わる」です。
//   その約束を、ここで固定します。
// -----------------------------------------------------------------------------

describe('仮の栄養値', () => {
  const RICE = toInternal({ kcal: 156, p: 2.5, f: 0.3, c: 37.1 });
  const CHICKEN = {
    id: 'torimune',
    name: '鶏むね肉',
    per100g: toInternal({ kcal: 105, p: 23.3, f: 1.9, c: 0.1 }),
  };

  /** 契約者が仮の値を入れた食材 */
  function provisionalItem(name: string, grams: number, per100g: Nutrients): MealItem {
    return {
      id: `p-${name}`,
      name,
      grams,
      per100g,
      nutrients: computeItemNutrients(per100g, grams),
      foodId: null,
      pending: true,
      provisional: true,
    };
  }

  function mealOf(items: MealItem[]): Meal {
    return { id: 'm1', order: 0, label: '1食目', memo: '', items, createdAt: null, updatedAt: null };
  }

  it('仮の値は、その日の合計に入る', () => {
    // ★ ここが「A案」の核心です。記録した日が0のままになりません
    const m = mealOf([provisionalItem('ささみジャーキー', 100, RICE)]);
    expect(dayTotals([m]).kcal).toBe(156_000);
  });

  it('仮のぶんだけを取り出せる（「うち仮◯kcal」を出すため）', () => {
    const m = mealOf([
      item('白米', 150),
      provisionalItem('ささみジャーキー', 100, RICE),
    ]);

    expect(provisionalTotals([m]).kcal).toBe(156_000);
    // 全体の合計は、確かな分と仮の分の和
    expect(dayTotals([m]).kcal).toBe(computeItemNutrients(PER_100G.白米, 150).kcal + 156_000);
  });

  it('仮の値が無ければ、仮の合計は0', () => {
    expect(provisionalTotals([mealOf([item('白米', 150)])])).toEqual(ZERO);
  });

  it('件数を3通りに数え分ける', () => {
    // ★ 「未確定」と「合計に入っていない」は別ものです。
    //   仮の値が入っているものは未確定ですが、合計には入っています。
    const m = mealOf([
      item('白米', 150), // 確定
      provisionalItem('ささみジャーキー', 100, RICE), // 仮の値あり
      {
        id: 'x',
        name: '謎の惣菜',
        grams: 80,
        per100g: ZERO,
        nutrients: ZERO,
        foodId: null,
        pending: true,
        provisional: false,
      }, // 値なし
    ]);

    expect(countPending([m])).toBe(2); // 未確定なもの全部
    expect(countProvisional([m])).toBe(1); // うち、仮の値が入っているもの
    expect(countNoValue([m])).toBe(1); // うち、合計に入っていないもの
  });

  it('★ 管理者が登録すると、仮の値はマスタの値に置き換わり、印も消える', () => {
    const before = mealOf([provisionalItem('鶏むね肉', 200, RICE)]);
    expect(dayTotals([before]).kcal).toBe(312_000); // 仮の値での合計

    const { meal, changed } = applyFoodToPending(before, '鶏むね肉', CHICKEN);

    expect(changed).toBe(1);
    expect(meal.items[0]?.provisional).toBe(false);
    expect(meal.items[0]?.pending).toBe(false);
    expect(meal.items[0]?.foodId).toBe('torimune');
    // 合計はマスタの値になる。契約者が入れた値は残らない
    expect(dayTotals([meal]).kcal).toBe(computeItemNutrients(CHICKEN.per100g, 200).kcal);
    expect(provisionalTotals([meal])).toEqual(ZERO);
  });

  it('★ 置き換えのあと、「うち仮」は0になる（印の消し忘れがないこと）', () => {
    const before = mealOf([
      provisionalItem('鶏むね肉', 100, RICE),
      provisionalItem('鶏むね肉', 50, RICE),
    ]);
    const { meal } = applyFoodToPending(before, '鶏むね肉', CHICKEN);

    expect(countProvisional([meal])).toBe(0);
    expect(countNoValue([meal])).toBe(0);
  });

  it('確定した食材は、仮の値では上書きされない', () => {
    // ★ マスタにある食材の値を、契約者が動かせないことの裏付け
    const confirmed = item('白米', 150);
    const m = mealOf([confirmed]);
    const { meal, changed } = applyFoodToPending(m, foodKey('白米'), CHICKEN);

    expect(changed).toBe(0);
    expect(meal.items[0]).toEqual(confirmed);
  });
});
