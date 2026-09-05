import { foodKey } from '../food/matching';
import { scaleByGrams } from '../nutrition/convert';
import { sumNutrients } from '../nutrition/sum';
import { ZERO, type Nutrients } from '../nutrition/types';
import type { EnteredAmount } from '../units/conversion';

/**
 * 食事の構造と、その合計（設計書 §14 / §15）。
 *
 * ★ このアプリの絶対条件（設計書 §15）:
 *
 *       食材の合計 == 食事の合計 == その日の合計
 *
 *   1円も、1kcalもズレてはいけません。トレーナーが数字を根拠に指導する以上、
 *   「画面によって数字が違う」ことが起きた時点で、このアプリは信用を失います。
 *
 *   これを保証しているのは、次の2点だけです。
 *
 *     1. 栄養値を 1/1000 単位の**整数**で持つ（浮動小数点数を使わない）
 *     2. 丸めを「食材1件につき1回」に限定し、合計では一切丸めない
 *
 *   整数の足し算には結合法則が成り立つため、どんな順序で足しても、
 *   何段階に分けて足しても、結果は完全に一致します。
 *
 * ★ AI はここに一切関与しません（設計書 §37）。
 *   AI がするのは「何を・何グラム食べたか」の推定までで、
 *   kcal / PFC はすべてこのファイルの決定論的な関数が計算します。
 */

/** 食材1件。食事の中に並ぶ最小単位。 */
export interface MealItem {
  /** 画面での識別用。Firestore のドキュメントIDではない */
  id: string;
  name: string;
  /**
   * 実際に食べた量（g）。
   *
   * ★ 「2個」と入れた場合でも、ここに入るのは**換算後のグラム**です。
   *   計算の土台は、いつでもグラムひとつだけです（下の enteredAs を参照）。
   */
  grams: number;
  /** 100gあたりの栄養値（内部表現） */
  per100g: Nutrients;
  /**
   * この食材の確定した栄養値（内部表現）。
   *
   * ★ per100g と grams から再計算せず、**保存された値をそのまま使います**。
   *   確定した記録が、あとからアプリの都合で変わってはいけないためです
   *   （設計書 §47「確定 → 保存」）。
   */
  nutrients: Nutrients;
  /**
   * 元になった共通食品マスタのID。
   * まだマスタに登録されていない食材（＝管理者へ登録依頼中）は null。
   */
  foodId: string | null;

  /**
   * 栄養値がまだ確定していないか（設計書 §13 / Phase 9）。
   *
   * ★ 栄養値を決められるのは管理者だけです（共通マスタ）。
   *   契約者が使った食材がマスタに無い場合、その場では栄養値が分かりません。
   *
   *   そこで「名前と量だけ記録し、栄養値は未確定」という状態を許します。
   *   記録を止めてしまうと続かなくなるからです。
   *
   *   未確定の食材は、既定では nutrients が 0 なので、合計には影響しません。
   *   ただし画面には「未確定が◯件あります」と必ず出し、
   *   合計が実際より少ないことが分かるようにします。
   *
   *   例外が `provisional` です（下を参照）。
   */
  pending: boolean;

  /**
   * 契約者が入れた「仮の値」か（追加仕様: 仮の栄養値）。
   *
   * ★ ここは、設計の原則と実際の使い勝手がぶつかった場所です。
   *
   *   原則: 栄養値を決めるのは管理者だけ（共通マスタ）。
   *         「白米」が人によって156kcalだったり200kcalだったりすると、
   *         数字を根拠にした指導ができなくなります。
   *
   *   現実: マスタに無い食材を食べた日は、合計が実際より少なく出ます。
   *         記録したのに数字が0のままだと、続ける気がなくなります。
   *
   *   折り合いとして、こうしました。
   *
   *     ・**マスタにある食材の値は、契約者は触れません**（原則はここで守られます）
   *     ・マスタに無い食材にかぎり、契約者が仮の値を入れられます
   *     ・仮の値は合計に入りますが、画面では「うち仮」として分けて出します
   *     ・管理者がマスタに登録すると、マスタの値に置き換わり、この印は消えます
   *
   *   つまり契約者が決めているのではなく、**管理者が決めるまでの間に合わせ**です。
   *   値がぶつかりうる場所（マスタにある食材）には、そもそも入力欄が出ません。
   *
   * ★ true のとき pending も必ず true です。
   *   per100g / nutrients には、契約者が入れた値が入っています。
   */
  provisional: boolean;

  /**
   * 「2個」と入れた、その入力そのもの（追加仕様: 単位換算）。
   *
   * ★ これは**表示のための控え**です。計算には使いません。
   *
   *   計算に使うのは、上の grams（換算後のグラム）だけです。
   *   ここを計算に使うと、管理者があとで「1個＝50g → 55g」に直したとき、
   *   3月に食べた卵のカロリーが9月に変わります。
   *   確定した記録が、あとからアプリの都合で動いてはいけません（設計書 §47）。
   *
   * ★ グラムで入れたとき、および換算の仕組みより前の記録では null です。
   *   古い記録に無い項目なので、省略されていることもあります。
   */
  enteredAs?: EnteredAmount | null;
}

/** 1回の食事。「1食目」「2食目」…と自由に増やせる（Q12の決定）。 */
export interface Meal {
  id: string;
  /** 並び順。小さいほど先 */
  order: number;
  /** 「1食目」など。あとから書き換えられる */
  label: string;
  items: MealItem[];
  memo: string;
  createdAt: number | null;
  updatedAt: number | null;
}

/**
 * 食材の栄養値を計算する。
 * 丸めが起きるのはここだけ（scaleByGrams の中で1回）。
 */
export function computeItemNutrients(per100g: Nutrients, grams: number): Nutrients {
  return scaleByGrams(per100g, grams);
}

/** 1回の食事の合計。 */
export function mealTotals(meal: Pick<Meal, 'items'>): Nutrients {
  return sumNutrients(meal.items.map((i) => i.nutrients));
}

/** その日の合計。 */
export function dayTotals(meals: readonly Pick<Meal, 'items'>[]): Nutrients {
  return sumNutrients(meals.map((m) => mealTotals(m)));
}

/** 食材をすべて平らに並べた合計。日合計と一致することの検証に使う。 */
export function flatItemTotals(meals: readonly Pick<Meal, 'items'>[]): Nutrients {
  return sumNutrients(meals.flatMap((m) => m.items.map((i) => i.nutrients)));
}

/** 栄養値がまだ確定していない食材の数。 */
export function countPending(meals: readonly Pick<Meal, 'items'>[]): number {
  return meals.reduce((sum, m) => sum + m.items.filter((i) => i.pending).length, 0);
}

/**
 * 契約者が仮の値を入れた食材の数（追加仕様: 仮の栄養値）。
 *
 * この分は合計に**入っています**。画面では「うち仮」として分けて出します。
 */
export function countProvisional(meals: readonly Pick<Meal, 'items'>[]): number {
  return meals.reduce((sum, m) => sum + m.items.filter((i) => i.provisional).length, 0);
}

/**
 * 栄養値がまったく無い食材の数。
 *
 * ★ `countPending` との違いに意味があります。
 *   未確定のうち、仮の値が入っているものは合計に入っています。
 *   「合計に含まれていません」と伝えるべきなのは、こちらの数です。
 */
export function countNoValue(meals: readonly Pick<Meal, 'items'>[]): number {
  return meals.reduce(
    (sum, m) => sum + m.items.filter((i) => i.pending && !i.provisional).length,
    0,
  );
}

/**
 * 仮の値のぶんだけを足した合計。
 *
 * 「1,850kcal（うち仮 95kcal）」の、括弧の中を出すために使います。
 * どれだけが確かな数字で、どれだけが間に合わせかを、画面で見分けられるようにします。
 */
export function provisionalTotals(meals: readonly Pick<Meal, 'items'>[]): Nutrients {
  return sumNutrients(meals.flatMap((m) => m.items.filter((i) => i.provisional).map((i) => i.nutrients)));
}

/** 次に使う既定のラベル。「1食目」「2食目」… */
export function nextMealLabel(existing: readonly Pick<Meal, 'label'>[]): string {
  return `${existing.length + 1}食目`;
}

/** 並び順を振り直す。挿入や削除のあとに使う。 */
export function renumber(meals: readonly Meal[]): Meal[] {
  return meals
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((m, index) => ({ ...m, order: index }));
}

// -----------------------------------------------------------------------------
// 入力の検証
// -----------------------------------------------------------------------------

/** 100gあたりの栄養値として、人間が入力する形。 */
export interface Per100gInput {
  kcal: number;
  p: number;
  f: number;
  c: number;
}

export type ItemIssueField = 'name' | 'grams' | 'kcal' | 'p' | 'f' | 'c';

export interface ItemIssue {
  field: ItemIssueField;
  message: string;
}

/**
 * 食材の入力を検証する。
 *
 * 範囲は広めに取ってあります。目的は「打ち間違いに気づいてもらうこと」であって、
 * 珍しい食品を拒むことではありません。
 */
export function validateItemInput(input: {
  name: string;
  grams: number | null;
  per100g: Partial<Per100gInput>;
}): ItemIssue[] {
  const issues: ItemIssue[] = [];

  if (input.name.trim().length === 0) {
    issues.push({ field: 'name', message: '食材の名前を入力してください。' });
  }

  const g = input.grams;
  if (g === null || !Number.isFinite(g)) {
    issues.push({ field: 'grams', message: '量（g）を入力してください。' });
  } else if (g <= 0) {
    issues.push({ field: 'grams', message: '量は0より大きい値にしてください。' });
  } else if (g > 5000) {
    issues.push({ field: 'grams', message: '量が大きすぎます。5000g以内で入力してください。' });
  }

  const ranges: Record<keyof Per100gInput, { max: number; label: string }> = {
    kcal: { max: 1000, label: 'カロリー' },
    p: { max: 100, label: 'たんぱく質' },
    f: { max: 100, label: '脂質' },
    c: { max: 100, label: '炭水化物' },
  };

  for (const key of ['kcal', 'p', 'f', 'c'] as const) {
    const v = input.per100g[key];
    if (v === undefined || v === null || !Number.isFinite(v)) {
      issues.push({ field: key, message: `100gあたりの${ranges[key].label}を入力してください。` });
    } else if (v < 0) {
      issues.push({ field: key, message: `${ranges[key].label}に負の数は入力できません。` });
    } else if (v > ranges[key].max) {
      issues.push({
        field: key,
        message: `100gあたりの${ranges[key].label}が大きすぎます（${ranges[key].max}以内）。`,
      });
    }
  }

  return issues;
}

/**
 * PFCから計算したカロリーと、入力されたカロリーの食い違いを知らせる。
 *
 * ★ これは警告であって、エラーではありません。
 *
 * ★ 判定を「2倍以上ずれたら」と粗くしてあるのには理由があります。
 *   野菜は食物繊維が炭水化物に含まれるため、P×4+F×9+C×4 で計算すると
 *   実際のカロリーより4割ほど高く出ます（例: ブロッコリー 37kcal に対し計算値53kcal）。
 *   これは正常な値なので、警告してはいけません。
 *
 *   一方、桁の打ち間違い（191 を 19、あるいは 1910 と入力）は
 *   必ず2倍以上ずれます。そこだけを拾います。
 */
export function kcalMismatchWarning(per100g: Per100gInput): string | null {
  const calculated = per100g.p * 4 + per100g.f * 9 + per100g.c * 4;
  if (per100g.kcal <= 0 || calculated <= 0) return null;

  const ratio = calculated / per100g.kcal;
  if (ratio < 2 && ratio > 0.5) return null;

  return `PFCから計算すると約${Math.round(calculated)}kcalですが、${per100g.kcal}kcalと入力されています。桁の入力ミスがないか確認してください。`;
}

/** 空の合計。食事が1件も無い日に使う。 */
export const EMPTY_TOTALS: Nutrients = ZERO;

/**
 * 未確定の食材に、あとから決まった栄養値を入れる（設計書 §21 / Phase 9）。
 *
 * 契約者がマスタに無い食材を記録すると、量だけが入って栄養値は 0 のまま残ります。
 * 管理者がその食材を登録したあと、過去のぶんに正しい値を入れるための処理です。
 *
 * ★ 触るのは pending の食材だけです。
 *   すでに数値が入っている食材は、名前が同じでも書き換えません。
 *   誰かが確認して入った数字を、あとから黙って変える根拠がないためです。
 *
 * ★ 名前も揃えます。
 *   「鶏ムネ肉」で記録されていたものはマスタの「鶏むね肉」になります。
 *   ここで揃えておかないと、一覧に同じ食材が2つの書き方で並び続けます。
 *
 * 変化が無ければ changed が 0 になります。呼び出し側は保存を省けます。
 */
export function applyFoodToPending(
  meal: Meal,
  /** 照合キー（foodKey で作ったもの）。この値と一致する食材だけを対象にする */
  key: string,
  food: { id: string; name: string; per100g: Nutrients },
): { meal: Meal; changed: number } {
  let changed = 0;

  const items = meal.items.map((item) => {
    if (!item.pending) return item;
    if (foodKey(item.name) !== key) return item;

    changed += 1;
    return {
      ...item,
      name: food.name,
      per100g: food.per100g,
      nutrients: computeItemNutrients(food.per100g, item.grams),
      foodId: food.id,
      pending: false,
      // ★ 仮の値だったものも、ここでマスタの値に置き換わります。
      //   印を消し忘れると、確定したのに「仮」と表示され続けます。
      provisional: false,
    };
  });

  return changed === 0 ? { meal, changed: 0 } : { meal: { ...meal, items }, changed };
}
