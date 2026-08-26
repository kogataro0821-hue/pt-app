import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { monthRange, type DateKey, type MonthKey } from '@pt/core';
import { getDb } from '@/lib/firebase';
import { emptyDay, type Day, type DayStatus } from './dayTypes';

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

/**
 * 運動の有無をカレンダーの印に反映する（設計書 §6）。
 * 食事と同じ考え方で、月表示のときに1クエリで済むよう日ドキュメントへ写します。
 */
export async function syncDayExerciseFlag(
  clientId: string,
  date: DateKey,
  hasExercise: boolean,
): Promise<void> {
  await setDoc(
    doc(daysCol(clientId), date),
    { date, hasExercise, updatedAt: Date.now() },
    { merge: true },
  );
}

/**
 * 1日確定と、その解除（設計書 §7 / Q14）。
 *
 * ★ 確定は「今日はもう食べません」という本人の意思表示です。
 *   トレーナーへの提出ではないので、書き直したくなったら本人が解除できます。
 *   ただし解除という操作を一度挟ませることで、
 *   確定済みの日をうっかり上書きする事故は防ぎます。
 *
 * ★ Rules 側では、確定済みの日への書き込みは拒否したうえで、
 *   「status を open に戻すだけの更新」に限り本人に許可しています。
 *   ここを画面だけで実現してはいけません（設計書 §7.1）。
 */
export async function setDayStatus(
  clientId: string,
  date: DateKey,
  status: DayStatus,
): Promise<void> {
  await setDoc(
    doc(daysCol(clientId), date),
    {
      status,
      finalizedAt: status === 'finalized' ? Date.now() : null,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}

/**
 * 期間を指定して日ドキュメントをまとめて読む（体重グラフ用）。
 *
 * ★ 読む件数は期間の日数ぶんです。「全期間」を無制限にすると、
 *   続けるほど1回の表示が重く・高くなっていきます。
 *   そのため画面側では最長1年に区切っています。
 */
export async function listRange(
  clientId: string,
  from: DateKey,
  to: DateKey,
): Promise<Day[]> {
  const snap = await getDocs(
    query(daysCol(clientId), where('date', '>=', from), where('date', '<=', to)),
  );
  return snap.docs.map((d) => toDay(d.id, d.data())).sort((a, b) => a.date.localeCompare(b.date));
}
