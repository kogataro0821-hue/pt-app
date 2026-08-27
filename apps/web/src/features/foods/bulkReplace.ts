import { addDoc, collection } from 'firebase/firestore';
import { applyFoodToPending, toInternal, type DateKey } from '@pt/core';
import { getDb } from '@/lib/firebase';
import { listMeals, saveMeal } from '@/features/meals/mealsRepo';
import type { Food } from './foodsRepo';
import type { FoodRequest } from './requestsRepo';

/**
 * 過去の記録の一括置き換え（設計書 §19 / §21 / Phase 9）。
 *
 * 未登録のまま記録された食材（pending）は、量だけが入っていて栄養値が 0 です。
 * 管理者がその食材を登録したあと、過去のぶんにも新しい値を入れるための処理です。
 *
 * ★ 勝手には走りません。
 *   管理者が「置き換える」を押したときだけ実行します。
 *   過去の数字が黙って変わると、契約者が自分の記録を信用できなくなります。
 *
 * ★ 調べる範囲は依頼に記録された「使った日」だけです。
 *   全員の全日を走査すると、それだけで無料枠の読み取り上限に届きます。
 *   依頼を積むときに日付も一緒に残しているのは、このためです。
 *
 * ★ 置き換えの中身そのものは @pt/core の applyFoodToPending にあります。
 *   通信を伴わない純粋な処理なので、そちらでテストしています。
 */

export interface ReplaceTarget {
  clientId: string;
  date: DateKey;
}

export interface ReplaceResult {
  /** 置き換えた食材の件数 */
  items: number;
  /** 書き換えた食事の件数 */
  meals: number;
  /** 対象になった日の件数 */
  days: number;
}

/** 依頼から「調べるべき日」を作る。同じ日が2回入らないようにする。 */
export function replaceTargets(request: FoodRequest): ReplaceTarget[] {
  const seen = new Set<string>();
  const out: ReplaceTarget[] = [];

  for (const entry of request.from) {
    for (const date of entry.dates) {
      const id = `${entry.clientId}/${date}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ clientId: entry.clientId, date });
    }
  }

  return out.sort((a, b) =>
    a.clientId === b.clientId
      ? a.date.localeCompare(b.date)
      : a.clientId.localeCompare(b.clientId),
  );
}

/**
 * 実際に置き換える。
 *
 * 1日ずつ順番に処理します。並列にすると、途中で失敗したときに
 * 「どこまで進んだか」が分からなくなります。
 */
export async function replacePastRecords(
  request: FoodRequest,
  food: Food,
  adminUid: string,
): Promise<ReplaceResult> {
  const key = request.id;
  const per100g = toInternal(food.per100g);
  const targets = replaceTargets(request);

  let items = 0;
  let mealCount = 0;
  const touchedByClient = new Map<string, DateKey[]>();

  for (const target of targets) {
    const meals = await listMeals(target.clientId, target.date);
    let dayTouched = false;

    for (const meal of meals) {
      const next = applyFoodToPending(meal, key, {
        id: food.id,
        name: food.name,
        per100g,
      });
      if (next.changed === 0) continue;

      await saveMeal(target.clientId, target.date, next.meal);
      mealCount += 1;
      items += next.changed;
      dayTouched = true;
    }

    if (dayTouched) {
      const list = touchedByClient.get(target.clientId) ?? [];
      list.push(target.date);
      touchedByClient.set(target.clientId, list);
    }
  }

  // ★ 変更履歴を残します（設計書 §19）。
  //   あとから「この日の数字はいつ、誰が、なぜ変わったのか」を説明できるようにします。
  for (const [clientId, dates] of touchedByClient) {
    await writeAudit(clientId, {
      type: 'food-bulk-replace',
      foodId: food.id,
      foodName: food.name,
      requestKey: key,
      dates,
      by: adminUid,
      at: Date.now(),
    });
  }

  return { items, meals: mealCount, days: touchedByClient.size };
}

async function writeAudit(clientId: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await addDoc(collection(getDb(), 'clients', clientId, 'audits'), payload);
  } catch {
    // 履歴が残せなくても、置き換えそのものは成立している
  }
}
