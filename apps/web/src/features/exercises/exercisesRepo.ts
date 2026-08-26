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
  /** 時間（分）。入力しない運動もあるので null を許す */
  minutes: number | null;
  /** 内容の自由記述。「60kg 10回 3セット」など */
  detail: string;
  createdAt: number | null;
  updatedAt: number | null;
}

export function emptyExercise(order: number): Exercise {
  return {
    id: newExerciseId(),
    order,
    name: '',
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

/** 極端な値だけ止める。目的は打ち間違いに気づいてもらうこと。 */
export function validateExercise(exercise: Exercise): string | null {
  if (exercise.name.trim().length === 0) return '種目名を入力してください。';
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
    minutes: typeof data.minutes === 'number' && Number.isFinite(data.minutes) ? data.minutes : null,
    detail: typeof data.detail === 'string' ? data.detail : '',
    createdAt: numOrNull(data.createdAt),
    updatedAt: numOrNull(data.updatedAt),
  };
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
