import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { monthRange, photoWarnThreshold, type DateKey, type MonthKey } from '@pt/core';
import { getDb } from '@/lib/firebase';
import { clearRankCache } from '@/features/rank/rankRepo';
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
    checkedAt: num(data.checkedAt),
    checkedBy: typeof data.checkedBy === 'string' ? data.checkedBy : null,
    photoOldestAt: num(data.photoOldestAt),
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
  // 会員ランクの「運動を記録した日数」が変わりました（追加仕様: 会員ランク）
  clearRankCache(clientId);
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

/**
 * 写真の状況をカレンダーの印と期限の検索に反映する（設計書 §8.2 / 追加仕様: 写真の保存期間）。
 *
 * `photoOldestAt` は「もうすぐ消える写真」を1回のクエリで探すためのものです。
 * 写真が1枚も無くなったら null にします。null の日は検索に引っかかりません。
 */
export async function syncDayPhotoState(
  clientId: string,
  date: DateKey,
  oldestAt: number | null,
): Promise<void> {
  await setDoc(
    doc(daysCol(clientId), date),
    { date, photoOldestAt: oldestAt, updatedAt: Date.now() },
    { merge: true },
  );
}

/**
 * 管理者が「確認しました」を押す（追加仕様: 写真の保存期間）。
 *
 * ★ 1日確定とは別ものです。確定は契約者の意思表示、これはトレーナーの記録です。
 *   取り消せるようにしてあります。押し間違いを直せないと、
 *   写真が消えたうえに「確認済み」が残る、という一番困る状態になります。
 */
export async function setDayChecked(
  clientId: string,
  date: DateKey,
  adminUid: string | null,
): Promise<void> {
  await setDoc(
    doc(daysCol(clientId), date),
    {
      date,
      checkedAt: adminUid === null ? null : Date.now(),
      checkedBy: adminUid,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}

/**
 * もうすぐ消える写真がある日を探す（設計書 §8.2 / 追加仕様: 写真の保存期間）。
 *
 * ★ 絞り込んでから読みます。
 *   1年ぶんの日を読んでから絞り込むと、画面を開くたびに数百件の読み取りになり、
 *   無料枠がそれだけで尽きます。`photoOldestAt` に絞り込みをかけ、
 *   出てくる件数も上限をつけています。
 *
 * ★ 知らせる目的は「消える前に見返す機会を作る」ことです。
 *   全部を並べる必要はないので、古いほうから数件で足ります。
 */
export async function listDaysWithExpiringPhotos(
  clientId: string,
  now: number = Date.now(),
  max = 5,
): Promise<Day[]> {
  const snap = await getDocs(
    query(
      daysCol(clientId),
      where('photoOldestAt', '<=', photoWarnThreshold(now)),
      orderBy('photoOldestAt'),
      limit(max),
    ),
  );
  return snap.docs.map((d) => toDay(d.id, d.data()));
}
