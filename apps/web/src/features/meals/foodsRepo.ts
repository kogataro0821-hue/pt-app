import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { toInternal, type Nutrients, type Per100gInput } from '@pt/core';
import { getDb } from '@/lib/firebase';

/**
 * 食品マスタ（設計書 §21 / Q13）。
 *
 * ★ マスタは空から始まり、使いながら育ちます。
 *   「先に食品を登録しないと食事を記録できない」作りにすると、
 *   使い始めが重すぎて続きません。そこで、食事の入力欄でそのまま入力し、
 *   保存と同時にマスタへ残す方式にしています。
 *
 * ★ 保存する値は「人間の単位」（kcal / g）です。
 *   Firebase のコンソールから覗いたときに読めるほうが、運用上ずっと安全だからです。
 *   計算に使うときに toInternal() で内部表現へ変換します。
 *
 * 置き場所は2つあります。
 *   clients/{cid}/foods/{id}  … その契約者だけの食品
 *   foods/{id}                … 全員が使える共通マスタ（管理者だけが書ける）
 */

export interface Food {
  id: string;
  name: string;
  /** 100gあたり（人間の単位） */
  per100g: Per100gInput;
  /** 'personal' = 自分のマスタ / 'common' = 共通マスタ */
  scope: 'personal' | 'common';
  usedCount: number;
}

export function foodPer100gInternal(food: Food): Nutrients {
  return toInternal(food.per100g);
}

// -----------------------------------------------------------------------------
// 読み込み（キャッシュ付き）
// -----------------------------------------------------------------------------

/**
 * 一度読んだら、画面を移動しても読み直しません。
 * 食材を1つ入力するたびに通信していたら、無料枠がすぐ尽きるためです。
 * 新しく登録した食品は、保存時にこのキャッシュへ直接足します。
 */
const cache = new Map<string, Food[]>();

export async function loadFoods(clientId: string): Promise<Food[]> {
  const cached = cache.get(clientId);
  if (cached !== undefined) return cached;

  const [personal, common] = await Promise.all([
    getDocs(collection(getDb(), 'clients', clientId, 'foods')),
    getDocs(collection(getDb(), 'foods')),
  ]);

  const list: Food[] = [
    ...personal.docs.map((d) => toFood(d.id, d.data(), 'personal')),
    ...common.docs.map((d) => toFood(d.id, d.data(), 'common')),
  ];

  cache.set(clientId, list);
  return list;
}

export function clearFoodCache(clientId?: string): void {
  if (clientId === undefined) cache.clear();
  else cache.delete(clientId);
}

/**
 * 名前で候補を探す。
 *
 * 前方一致を先に、部分一致をあとに並べます。
 * 「とり」と打ったときに「鶏むね肉」より先に「焼きとり」が出ると探しにくいためです。
 * よく使う食品ほど上に来るよう、使用回数も見ています。
 */
export function searchFoods(foods: readonly Food[], keyword: string, limit = 8): Food[] {
  const q = keyword.trim();
  if (q.length === 0) return [];

  const starts: Food[] = [];
  const contains: Food[] = [];
  for (const f of foods) {
    if (f.name.startsWith(q)) starts.push(f);
    else if (f.name.includes(q)) contains.push(f);
  }

  const byUse = (a: Food, b: Food) => b.usedCount - a.usedCount || a.name.localeCompare(b.name);
  return [...starts.sort(byUse), ...contains.sort(byUse)].slice(0, limit);
}

// -----------------------------------------------------------------------------
// 保存
// -----------------------------------------------------------------------------

/**
 * 食品を個人マスタに保存する（同じ名前があれば上書きせず、使用回数だけ増やす）。
 *
 * ★ 失敗しても食事の記録は止めません。
 *   マスタは「次回から楽になる」ための仕組みであって、記録の本体ではないためです。
 */
export async function rememberFood(
  clientId: string,
  input: { name: string; per100g: Per100gInput },
  allowed: boolean,
): Promise<string | null> {
  if (!allowed) return null;

  const name = input.name.trim();
  if (name.length === 0) return null;

  const list = cache.get(clientId) ?? [];
  const existing = list.find((f) => f.scope === 'personal' && f.name === name);

  const id = existing?.id ?? newFoodId();
  const usedCount = (existing?.usedCount ?? 0) + 1;

  try {
    await setDoc(
      doc(getDb(), 'clients', clientId, 'foods', id),
      {
        name,
        per100g: input.per100g,
        usedCount,
        updatedAt: Date.now(),
        ...(existing === undefined ? { createdAt: Date.now() } : {}),
      },
      { merge: true },
    );
  } catch {
    return null; // 記録本体は成功しているので、ここでは止めない
  }

  // キャッシュを手で更新する（読み直さない）
  const next = list.filter((f) => f.id !== id);
  next.push({ id, name, per100g: input.per100g, scope: 'personal', usedCount });
  cache.set(clientId, next);

  return id;
}

// -----------------------------------------------------------------------------

function toFood(id: string, data: Record<string, unknown>, scope: Food['scope']): Food {
  const p = (data.per100g ?? {}) as Partial<Per100gInput>;
  return {
    id,
    name: typeof data.name === 'string' ? data.name : '(名称なし)',
    per100g: {
      kcal: num(p.kcal),
      p: num(p.p),
      f: num(p.f),
      c: num(p.c),
    },
    scope,
    usedCount: typeof data.usedCount === 'number' ? data.usedCount : 0,
  };
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** ドキュメントIDを作る。衝突しにくく、時系列に並ぶ形にしている。 */
export function newFoodId(): string {
  return `f${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}
