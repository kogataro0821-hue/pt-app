/**
 * 管理者が足した単位の読み書き（追加仕様: 単位を増やす）。
 *
 * ★ 置き場所は config です。専用のコレクションを作っていません。
 *
 *   config はすでに「管理者が書けて、契約者全員が読める」形になって
 *   います。専用の場所を作るとルールを足すことになり、そのたびに
 *   Firebase の画面を開いて貼り直す必要が出ます。
 *   **開かずに済むなら、開かないほうがいい。**
 *
 * ★ ここに入るのは単位の名前だけです。誰のものでもない情報なので、
 *   全契約者が同じものを読んで構いません。
 *
 * ★ 読めなかったときは、最初からある単位だけで動きます。
 *   ここが読めないだけで記録が止まるのは、明らかにやりすぎです。
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { isCountableUnit, MAX_CUSTOM_UNITS } from '@pt/core';
import { getDb } from '@/lib/firebase';

const PATH = ['config', 'units'] as const;

function unitsRef() {
  return doc(getDb(), PATH[0], PATH[1]);
}

/**
 * 覚えておく。
 *
 * ★ 入力欄を開くたびに読むと、記録のたびに1回ずつ読み取りが増えます。
 *   単位はめったに変わらないので、一度読んだら使い回します。
 */
let cache: string[] | null = null;

export function cachedCustomUnits(): string[] {
  return cache ?? [];
}

export function clearUnitsCache(): void {
  cache = null;
}

export async function loadCustomUnits(force = false): Promise<string[]> {
  if (cache !== null && !force) return cache;

  try {
    const snap = await getDoc(unitsRef());
    const raw = (snap.data() ?? {}).units;
    const list = Array.isArray(raw) ? raw : [];

    const out: string[] = [];
    for (const item of list) {
      if (!isCountableUnit(item)) continue;
      const t = String(item).trim();
      if (!out.includes(t)) out.push(t);
      if (out.length >= MAX_CUSTOM_UNITS) break;
    }

    cache = out;
    return out;
  } catch {
    // ★ 読めなくても止めません。最初からある単位だけで動きます
    cache = [];
    return [];
  }
}

/** 足した単位を保存する（管理者だけ）。 */
export async function saveCustomUnits(units: readonly string[]): Promise<void> {
  const out: string[] = [];
  for (const item of units) {
    if (!isCountableUnit(item)) continue;
    const t = item.trim();
    if (!out.includes(t)) out.push(t);
    if (out.length >= MAX_CUSTOM_UNITS) break;
  }

  await setDoc(unitsRef(), { units: out, updatedAt: Date.now() }, { merge: true });
  cache = out;
}
