import type { DateKey } from '@pt/core';

/**
 * 1日ぶんの記録（設計書 §5.3 / §7）。
 *
 * 置き場所は clients/{clientId}/days/{yyyy-MM-dd} です。
 * ドキュメントIDが日付そのものなので、
 *   ・同じ日が二重に作られない
 *   ・Security Rules が「その日を編集してよいか」をID比較だけで判定できる
 * という2つが自動的に満たされます。
 */

export type DayStatus = 'open' | 'finalized';

export interface Day {
  /** ドキュメントIDと同じ日付。範囲検索に使うため中にも持つ */
  date: DateKey;

  /** open = まだ記録できる / finalized = 1日確定済み */
  status: DayStatus;

  /** 体重（kg）。未入力は null */
  weightKg: number | null;
  /** 体脂肪率（%）。未入力は null */
  bodyFatPct: number | null;

  /**
   * カレンダーに印を出すための要約。
   *
   * ★ 食事も運動も下位コレクションにありますが、
   *   月表示のたびに31日ぶんの下位コレクションを読むと通信量が跳ね上がります。
   *   そこで「あるか無いか」だけをこの日ドキュメントに持たせ、
   *   カレンダーは1回のクエリで済むようにしています。
   *   （食事を書き込むときに同時に更新します。Phase 6）
   */
  hasMeals: boolean;
  hasExercise: boolean;

  /** AI評価が済んだ時刻。未評価は null */
  reviewedAt: number | null;
  /** 1日確定した時刻。未確定は null */
  finalizedAt: number | null;

  /**
   * 管理者が中身を見て「確認しました」を押した時刻（Phase 11）。
   *
   * ★ 1日確定とは別ものです。
   *   確定は契約者の「今日はもう食べません」という意思表示で、
   *   本人がいつでも解除できます。
   *   こちらはトレーナーが「見ました」と記録するもので、
   *   押すと同時にその日の写真が消えます。
   *   2つを1つにまとめると、どちらが起きたのか分からなくなります。
   */
  checkedAt: number | null;
  /** 確認した管理者のUID */
  checkedBy: string | null;

  /**
   * その日に残っている写真のうち、いちばん古いものが撮られた時刻。
   *
   * ★ 「もうすぐ消える写真」を1回のクエリで探すために置いています。
   *   これが無いと、探すのに1年ぶんの日を読むことになり、
   *   それだけで無料枠を使い切ります。
   *   写真が1枚も無い日では null です。
   */
  photoOldestAt: number | null;

  updatedAt: number | null;
}

export function emptyDay(date: DateKey): Day {
  return {
    date,
    status: 'open',
    weightKg: null,
    bodyFatPct: null,
    hasMeals: false,
    hasExercise: false,
    reviewedAt: null,
    finalizedAt: null,
    checkedAt: null,
    checkedBy: null,
    photoOldestAt: null,
    updatedAt: null,
  };
}

/** カレンダーに出す4種類の印（設計書 §6 / Q11）。 */
export interface DayMarkers {
  meals: boolean;
  exercise: boolean;
  weight: boolean;
  /** 確定済み、またはAI評価済み */
  done: boolean;
}

export function markersOf(day: Day | undefined): DayMarkers {
  if (day === undefined) {
    return { meals: false, exercise: false, weight: false, done: false };
  }
  return {
    meals: day.hasMeals,
    exercise: day.hasExercise,
    weight: day.weightKg !== null,
    // 確定・AI評価・トレーナーの確認のどれかが済んでいれば印を出す
    done: day.status === 'finalized' || day.reviewedAt !== null || day.checkedAt !== null,
  };
}

export function hasAnyMarker(m: DayMarkers): boolean {
  return m.meals || m.exercise || m.weight || m.done;
}
