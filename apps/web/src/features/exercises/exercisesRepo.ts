import { collection, deleteDoc, doc, getDocs, orderBy, query, setDoc } from 'firebase/firestore';
import type { DateKey } from '@pt/core';
import { getDb } from '@/lib/firebase';

/**
 * 運動の記録（設計書 §5.3 / §22）。
 *
 * 置き場所: clients/{cid}/days/{date}/exercises/{id}
 *
 * ★ 消費カロリーは、いまは扱いません。
 *   運動の消費カロリーはどう計算しても推定値にしかならず、
 *   それを摂取カロリーと同じ画面に並べると、食事の数字まで
 *   「だいたいの値」に見えてしまいます。
 *   このアプリの価値は数字が正確なことなので、
 *   推定値を混ぜるのは慎重に判断します（Phase 7以降で検討）。
 */

export interface Exercise {
  id: string;
  order: number;
  /** 種目名。「ベンチプレス」「ランニング」など */
  name: string;
  /**
   * 重量(kg)。
   *
   * ★ 種目以外は、すべて未入力（null）で通します。
   *
   *   運動によって、埋まる欄が違います。
   *     ベンチプレス … 重量・回数・セット
   *     ランニング   … 時間だけ
   *     懸垂         … 回数とセットだけ（自重なので重量は無い）
   *
   *   全部を必須にすると、埋めるために**嘘の数字**を入れることになります。
   *   0 と書かせるのも同じです。「0kgで挙げた」という記録が残ります。
   *   入れなかったことは、入れないまま残します。
   */
  weight: number | null;
  /** カウント数（回）。未入力可 */
  reps: number | null;
  /** セット数。未入力可 */
  sets: number | null;
  /** 時間（分）。入力しない運動もあるので null を許す */
  minutes: number | null;
  /**
   * メモ。
   *
   * ★ 以前は「内容」という名前で、「60kg 10回 3セット」のように
   *   手で書いてもらっていた欄です。数で持つようにしたので、
   *   名前だけ「メモ」に変えました。
   *
   *   **置き場所（detail）は変えていません。** 変えると、過去に書かれた
   *   内容が全部消えます。古い記録は、そのままメモとして読めます。
   */
  detail: string;
  createdAt: number | null;
  updatedAt: number | null;
}

export function emptyExercise(order: number): Exercise {
  return {
    id: newExerciseId(),
    order,
    name: '',
    weight: null,
    reps: null,
    sets: null,
    minutes: null,
    detail: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function col(clientId: string, date: DateKey) {
  return collection(getDb(), 'clients', clientId, 'days', date, 'exercises');
}

export async function listExercises(clientId: string, date: DateKey): Promise<Exercise[]> {
  const snap = await getDocs(query(col(clientId, date), orderBy('order')));
  return snap.docs.map((d) => toExercise(d.id, d.data()));
}

export async function saveExercise(
  clientId: string,
  date: DateKey,
  exercise: Exercise,
): Promise<void> {
  await setDoc(doc(col(clientId, date), exercise.id), {
    order: exercise.order,
    name: exercise.name,
    weight: exercise.weight,
    reps: exercise.reps,
    sets: exercise.sets,
    minutes: exercise.minutes,
    detail: exercise.detail,
    createdAt: exercise.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  });
}

export async function deleteExercise(
  clientId: string,
  date: DateKey,
  exerciseId: string,
): Promise<void> {
  await deleteDoc(doc(col(clientId, date), exerciseId));
}

export function newExerciseId(): string {
  return `e${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * 極端な値だけ止める。目的は打ち間違いに気づいてもらうこと。
 *
 * ★ 止めるのは「ありえない値」だけです。
 *
 *   範囲は広めに取ってあります。狭くすると、本当にその値だった人が
 *   記録できなくなります。1000kg は明らかに打ち間違いですが、
 *   300kg は本当にありえます。
 *
 * ★ 未入力は通します。種目以外は全部そうです。
 */
export function validateExercise(exercise: Exercise): string | null {
  if (exercise.name.trim().length === 0) return '種目名を入力してください。';
  if (exercise.weight !== null && (exercise.weight < 0 || exercise.weight > 1000)) {
    return '重量は0〜1000kgの範囲で入力してください。';
  }
  if (exercise.reps !== null && (exercise.reps < 0 || exercise.reps > 10000)) {
    return 'カウント数は0〜10000の範囲で入力してください。';
  }
  if (exercise.sets !== null && (exercise.sets < 0 || exercise.sets > 100)) {
    return 'セット数は0〜100の範囲で入力してください。';
  }
  if (exercise.minutes !== null && (exercise.minutes < 0 || exercise.minutes > 1440)) {
    return '時間は0〜1440分の範囲で入力してください。';
  }
  return null;
}

function toExercise(id: string, data: Record<string, unknown>): Exercise {
  return {
    id,
    order: typeof data.order === 'number' ? data.order : 0,
    name: typeof data.name === 'string' ? data.name : '',
    // ★ 古い記録には、この3つがそもそも入っていません。
    //   入っていなければ未入力として読みます（0 にはしません）。
    weight: numOrNull(data.weight),
    reps: numOrNull(data.reps),
    sets: numOrNull(data.sets),
    minutes: numOrNull(data.minutes),
    detail: typeof data.detail === 'string' ? data.detail : '',
    createdAt: numOrNull(data.createdAt),
    updatedAt: numOrNull(data.updatedAt),
  };
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
