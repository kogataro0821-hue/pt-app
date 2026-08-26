import { scaleByGrams } from '../nutrition/convert';
import { sumNutrients } from '../nutrition/sum';
import { ZERO, type Nutrients } from '../nutrition/types';

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
  /** 実際に食べた量（g） */
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
  /** 元になった食品マスタのID。手入力なら null */
  foodId: string | null;
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
