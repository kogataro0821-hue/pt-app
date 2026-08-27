import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import {
  foodKey,
  shouldAddAlias,
  toInternal,
  type NameableFood,
  type Nutrients,
  type Per100gInput,
} from '@pt/core';
import { getDb } from '@/lib/firebase';

/**
 * 共通食品マスタ（設計書 §13 / §21 / Phase 9）。
 *
 * ★ 栄養値を決められるのは管理者だけです。
 *
 *   以前は契約者ごとの個人マスタがあり、各自が自由に栄養値を入れられました。
 *   その結果、田中さんの「白米 156kcal」と鈴木さんの「白米 168kcal」が
 *   平気で共存してしまいます。トレーナーが数字を根拠に指導する以上、
 *   これは成り立ちません。
 *
 *   そこで個人マスタを廃止し、`foods` 一本にしました。
 *   契約者が触れるのは「量(g)」だけで、100gあたりの値は管理者の領分です。
 *
 * ★ 別名（aliases）を持たせているのは、名前のぶれで
 *   同じ食材が分裂するのを防ぐためです（matching.ts の説明を参照）。
 */

export interface Food extends NameableFood {
  id: string;
  name: string;
  aliases: string[];
  /** 100gあたり（人間の単位で保存する。コンソールから読めるように） */
  per100g: Per100gInput;
  /** 補足。「皮なし」「ゆで」など、管理者が残すメモ */
  note: string;
  createdAt: number | null;
  updatedAt: number | null;
}

export function foodPer100gInternal(food: Food): Nutrients {
  return toInternal(food.per100g);
}

// -----------------------------------------------------------------------------
// 読み込み
// -----------------------------------------------------------------------------

/**
 * 一度読んだら覚えておきます。
 * 食材を1つ入力するたびに全件読み直していたら、無料枠がすぐ尽きます。
 */
let cache: Food[] | null = null;

export async function loadFoods(force = false): Promise<Food[]> {
  if (cache !== null && !force) return cache;
  const snap = await getDocs(collection(getDb(), 'foods'));
  cache = snap.docs.map((d) => toFood(d.id, d.data()));
  return cache;
}

export function clearFoodCache(): void {
  cache = null;
}

/** キャッシュを読み直さずに1件だけ差し替える。 */
function upsertCache(food: Food): void {
  if (cache === null) return;
  cache = [...cache.filter((f) => f.id !== food.id), food];
}

// -----------------------------------------------------------------------------
// 書き込み（管理者のみ。Rules 側でも管理者に限定しています）
// -----------------------------------------------------------------------------

export function newFoodId(name: string): string {
  // ★ 照合キーをそのままIDに使います。
  //   こうすると、同じ食材を二重に作れなくなります（IDが衝突するため）。
  //   IDに使えない文字を落とすのは foodKey の中でやっています。
  const key = foodKey(name);
  return key.length > 0 ? key : `f${Date.now().toString(36)}`;
}

export async function saveFood(food: Food): Promise<Food> {
  const saved: Food = {
    ...food,
    name: food.name.trim(),
    aliases: food.aliases.map((a) => a.trim()).filter((a) => a.length > 0),
    updatedAt: Date.now(),
    createdAt: food.createdAt ?? Date.now(),
  };

  await setDoc(doc(getDb(), 'foods', saved.id), {
    name: saved.name,
    aliases: saved.aliases,
    // ★ 照合キーも保存します。将来サーバー側で検索する必要が出たときのためです。
    key: foodKey(saved.name),
    per100g: saved.per100g,
    note: saved.note,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
  });

  upsertCache(saved);
  return saved;
}

/** 既存の食材に別名を足す。依頼を「これは◯◯と同じ」で吸収するときに使う。 */
export async function addAlias(food: Food, alias: string): Promise<Food> {
  if (!shouldAddAlias(food, alias)) return food;
  return await saveFood({ ...food, aliases: [...food.aliases, alias.trim()] });
}

export async function deleteFood(foodId: string): Promise<void> {
  await deleteDoc(doc(getDb(), 'foods', foodId));
  if (cache !== null) cache = cache.filter((f) => f.id !== foodId);
}

// -----------------------------------------------------------------------------

export function emptyFood(name = ''): Food {
  return {
    id: newFoodId(name),
    name,
    aliases: [],
    per100g: { kcal: 0, p: 0, f: 0, c: 0 },
    note: '',
    createdAt: null,
    updatedAt: null,
  };
}

function toFood(id: string, data: Record<string, unknown>): Food {
  const p = (data.per100g ?? {}) as Partial<Per100gInput>;
  return {
    id,
    name: typeof data.name === 'string' ? data.name : '(名称なし)',
    aliases: Array.isArray(data.aliases)
      ? data.aliases.filter((a): a is string => typeof a === 'string')
      : [],
    per100g: { kcal: num(p.kcal), p: num(p.p), f: num(p.f), c: num(p.c) },
    note: typeof data.note === 'string' ? data.note : '',
    createdAt: numOrNull(data.createdAt),
    updatedAt: numOrNull(data.updatedAt),
  };
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 100gあたりの値が入っているか。0 のままの食材は「未設定」とみなす。 */
export function hasNutrition(food: Food): boolean {
  return food.per100g.kcal > 0 || food.per100g.p > 0 || food.per100g.f > 0 || food.per100g.c > 0;
}
