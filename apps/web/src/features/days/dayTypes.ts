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
    done: day.status === 'finalized' || day.reviewedAt !== null,
  };
}

export function hasAnyMarker(m: DayMarkers): boolean {
  return m.meals || m.exercise || m.weight || m.done;
}
