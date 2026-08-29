import { collection, deleteDoc, doc, getDocs, orderBy, query, setDoc } from 'firebase/firestore';
import {
  NUTRIENT_KEYS,
  ZERO,
  mealTotals,
  type DateKey,
  type Meal,
  type MealItem,
  type Nutrients,
} from '@pt/core';
import { getDb } from '@/lib/firebase';

/**
 * 食事の読み書き（設計書 §5.3 / §14）。
 *
 * 置き場所: clients/{cid}/days/{date}/meals/{mealId}
 *
 * ★ 食材は「食事ドキュメントの中の配列」として持ちます。
 *   食材をさらに下位コレクションにすると、1食を表示するだけで
 *   食材の数だけ通信が発生します。1食あたりの食材は数個なので、
 *   1つのドキュメントにまとめたほうが、速くて安くて壊れにくい形になります。
 *
 * ★ 栄養値は内部表現（1/1000単位の整数）のまま保存します。
 *   目標値や食品マスタは読みやすさを優先して人間の単位で保存していますが、
 *   ここだけは違います。確定した記録の合計が1kcalもズレないことのほうが、
 *   コンソールでの読みやすさより重要だからです（設計書 §15）。
 */

function mealsCol(clientId: string, date: DateKey) {
  return collection(getDb(), 'clients', clientId, 'days', date, 'meals');
}

export async function listMeals(clientId: string, date: DateKey): Promise<Meal[]> {
  const snap = await getDocs(query(mealsCol(clientId, date), orderBy('order')));
  return snap.docs.map((d) => toMeal(d.id, d.data()));
}

export async function saveMeal(clientId: string, date: DateKey, meal: Meal): Promise<void> {
  await setDoc(doc(mealsCol(clientId, date), meal.id), toFirestore(meal));
}

export async function deleteMeal(clientId: string, date: DateKey, mealId: string): Promise<void> {
  await deleteDoc(doc(mealsCol(clientId, date), mealId));
}

/**
 * カレンダーの印を更新する（設計書 §6）。
 *
 * 月表示のたびに全部の食事を読むわけにはいかないので、
 * 「食事があるか」だけを日ドキュメントに写しておきます。
 */
export async function syncDayMealFlag(
  clientId: string,
  date: DateKey,
  hasMeals: boolean,
): Promise<void> {
  await setDoc(
    doc(getDb(), 'clients', clientId, 'days', date),
    { date, hasMeals, updatedAt: Date.now() },
    { merge: true },
  );
}

/** ドキュメントIDを作る。時系列に並ぶので、並び順が壊れても復元しやすい。 */
export function newMealId(): string {
  return `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function newItemId(): string {
  return `i${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// -----------------------------------------------------------------------------
// 変換
// -----------------------------------------------------------------------------

function toMeal(id: string, data: Record<string, unknown>): Meal {
  const rawItems = Array.isArray(data.items) ? data.items : [];
  return {
    id,
    order: typeof data.order === 'number' ? data.order : 0,
    label: typeof data.label === 'string' ? data.label : '食事',
    memo: typeof data.memo === 'string' ? data.memo : '',
    items: rawItems.map(toItem),
    createdAt: numOrNull(data.createdAt),
    updatedAt: numOrNull(data.updatedAt),
  };
}

function toItem(raw: unknown, index: number): MealItem {
  const data = (raw ?? {}) as Record<string, unknown>;
  return {
    id: typeof data.id === 'string' ? data.id : `i${index}`,
    name: typeof data.name === 'string' ? data.name : '(名称なし)',
    grams: typeof data.grams === 'number' ? data.grams : 0,
    per100g: toNutrients(data.per100g),
    nutrients: toNutrients(data.nutrients),
    foodId: typeof data.foodId === 'string' ? data.foodId : null,
    pending: data.pending === true,
    // ★ 印が無い古い記録は false になります。
    //   仮の値の仕組みより前の記録は、未確定なら栄養値が0なので、それで合っています。
    provisional: data.provisional === true,
  };
}

/**
 * 栄養値を読む。
 * ★ 欠けている項目は 0 として扱います。壊れた1件のせいで
 *   その日の記録全体が表示できなくなるほうが、実害が大きいためです。
 */
function toNutrients(raw: unknown): Nutrients {
  const data = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of NUTRIENT_KEYS) {
    const v = data[key];
    out[key] = typeof v === 'number' && Number.isFinite(v) ? v : ZERO[key];
  }
  return out as unknown as Nutrients;
}

function toFirestore(meal: Meal): Record<string, unknown> {
  return {
    order: meal.order,
    label: meal.label,
    memo: meal.memo,
    items: meal.items.map((i) => ({
      id: i.id,
      name: i.name,
      grams: i.grams,
      per100g: plain(i.per100g),
      nutrients: plain(i.nutrients),
      foodId: i.foodId,
      pending: i.pending,
      provisional: i.provisional,
    })),
    // 合計も一緒に保存します。読むときは items から計算し直すので、
    // これは Firebase のコンソールから確認するためのものです。
    totals: plain(mealTotals(meal)),
    createdAt: meal.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
}

function plain(n: Nutrients): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of NUTRIENT_KEYS) out[key] = n[key];
  return out;
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
