import { collection, getDocs } from 'firebase/firestore';
import { summarizeRecords, type DateKey, type RecordStats } from '@pt/core';
import { getDb } from '@/lib/firebase';

/**
 * 会員ランクの判定に使う集計（追加仕様: 会員ランク）。
 *
 * ★ 数え方
 *
 *   「食事を記録した日」「運動を記録した日」は、日ドキュメントの
 *   `hasMeals` / `hasExercise` に既に写してあります（設計書 §6）。
 *   カレンダーの印のために元からあるもので、ランクのために増やした項目ではありません。
 *
 *   だから、日ドキュメントを1回読むだけで数えられます。
 *   下位コレクション（meals / exercises）は開きません。
 *   開くと1年ぶんで数千回の読み取りになり、無料枠が持ちません。
 *
 * ★ 日付で絞らずに全部読みます。
 *   `where('date', ...)` で絞ると、date を持たない日がすり抜けます。
 *   数え落とすと、本人には「記録したのに進んでいない」としか見えません。
 *
 * ★ 一度読んだら覚えておきます。
 *   会員証はカレンダーの下に常に出ます。画面を移るたびに数え直すと、
 *   移動しただけで読み取りが増えます。
 *   記録を足したときだけ数え直します（clearRankCache）。
 */

/** 契約者ごとの集計。画面を移っても持ち越します。 */
const cache = new Map<string, RecordStats>();

export function cachedRankStats(clientId: string): RecordStats | null {
  return cache.get(clientId) ?? null;
}

/** 記録が変わったので、次に必要になったときに数え直す。 */
export function clearRankCache(clientId?: string): void {
  if (clientId === undefined) cache.clear();
  else cache.delete(clientId);
}

export async function loadRankStats(clientId: string, force = false): Promise<RecordStats> {
  const known = cache.get(clientId);
  if (known !== undefined && !force) return known;

  const snap = await getDocs(collection(getDb(), 'clients', clientId, 'days'));

  const mealDates: DateKey[] = [];
  const exerciseDates: DateKey[] = [];

  for (const day of snap.docs) {
    const data = day.data();
    // 日付はドキュメントIDそのものです。中の date は、無いことがあります
    const date = day.id as DateKey;
    if (data.hasMeals === true) mealDates.push(date);
    if (data.hasExercise === true) exerciseDates.push(date);
  }

  const stats = summarizeRecords(mealDates, exerciseDates);
  cache.set(clientId, stats);
  return stats;
}
