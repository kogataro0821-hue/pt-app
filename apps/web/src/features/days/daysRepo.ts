import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { monthRange, type DateKey, type MonthKey } from '@pt/core';
import { getDb } from '@/lib/firebase';
import { emptyDay, type Day } from './dayTypes';

/**
 * 日次データの読み書き（設計書 §5.3）。
 *
 * ★ 通信量の方針
 *   カレンダーは「月に1回のクエリ」で必要な情報を全部取ります。
 *   日ごとに読むと1か月で31回の通信になり、無料枠を無駄に消費します。
 *   そのため、印に使う情報（食事の有無など）は日ドキュメントに要約して持たせています。
 */

function daysCol(clientId: string) {
  return collection(getDb(), 'clients', clientId, 'days');
}

/** 1日ぶんを取得する。まだ記録が無ければ null。 */
export async function getDay(clientId: string, date: DateKey): Promise<Day | null> {
  const snap = await getDoc(doc(daysCol(clientId), date));
  return snap.exists() ? toDay(snap.id, snap.data()) : null;
}

/**
 * その月の記録をまとめて取得する。
 * 戻り値は日付をキーにした Map。記録が無い日はキー自体が存在しません。
 */
export async function listMonth(clientId: string, month: MonthKey): Promise<Map<DateKey, Day>> {
  const { first, last } = monthRange(month);
  const snap = await getDocs(
    query(daysCol(clientId), where('date', '>=', first), where('date', '<=', last)),
  );

  const map = new Map<DateKey, Day>();
  for (const d of snap.docs) {
    map.set(d.id, toDay(d.id, d.data()));
  }
  return map;
}

/**
 * 体重・体脂肪率を保存する（設計書 §4 / Q6）。
 *
 * 日ドキュメントが無ければ、この保存で作られます。
 * 既にある他の項目（食事の有無など）は merge により保たれます。
 */
export async function saveBodyMetrics(
  clientId: string,
  date: DateKey,
  metrics: { weightKg: number | null; bodyFatPct: number | null },
): Promise<void> {
  await setDoc(
    doc(daysCol(clientId), date),
    {
      date, // 範囲検索に使うので必ず入れる
      weightKg: metrics.weightKg,
      bodyFatPct: metrics.bodyFatPct,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}

function toDay(id: string, data: Record<string, unknown>): Day {
  const base = emptyDay(id);
  return {
    ...base,
    status: data.status === 'finalized' ? 'finalized' : 'open',
    weightKg: num(data.weightKg),
    bodyFatPct: num(data.bodyFatPct),
    hasMeals: data.hasMeals === true,
    hasExercise: data.hasExercise === true,
    reviewedAt: num(data.reviewedAt),
    finalizedAt: num(data.finalizedAt),
    updatedAt: num(data.updatedAt),
  };
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 体重の入力チェック。
 * 極端な値は打ち間違いなので止めますが、幅は広めに取ってあります。
 */
export function validateBodyMetrics(input: {
  weightKg: number | null;
  bodyFatPct: number | null;
}): string | null {
  const { weightKg, bodyFatPct } = input;
  if (weightKg !== null && (weightKg < 20 || weightKg > 300)) {
    return '体重は20〜300kgの範囲で入力してください。';
  }
  if (bodyFatPct !== null && (bodyFatPct < 1 || bodyFatPct > 70)) {
    return '体脂肪率は1〜70%の範囲で入力してください。';
  }
  return null;
}
