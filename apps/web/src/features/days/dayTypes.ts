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
   * 筋肉量（kg）。未入力は null（追加仕様: 筋肉量）。
   *
   * ★ 体重と体脂肪率からは出せません。
   *   体脂肪率から分かるのは「除脂肪量」で、骨も水分も含みます。
   *   体組成計が別に出す数字なので、別の欄として持ちます。
   */
  muscleKg: number | null;

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
   * 管理者が中身を見て「確認しました」を押した時刻（追加仕様: 写真の保存期間）。
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

  /**
   * トレーナーが「提出扱い」にした印（追加仕様: 提出扱い）。
   *
   * ★ 何のためにあるか。
   *
   *   やむを得ない事情で、いつもの記録ができない日があります。
   *   相談のうえ写真だけ出してもらった、というような日です。
   *   そのままだと連続記録が途切れますが、**本人は約束を守っています**。
   *   続けるための仕掛けが、続けている人を罰する形になってはいけません。
   *
   * ★ 印を残すのは、**あとから嘘にしないため**です。
   *
   *   黙って hasMeals を立てると、普通に記録した日と見分けが付きません。
   *   数か月後に見返したときに「この日は本当に記録したのか」が
   *   分からなくなります。誰が、いつ、なぜ立てたかを残します。
   *
   * ★ 取り消せます。そのときは印を付ける前の状態に戻します。
   */
  mealsSubmit: SubmitMark | null;
  exerciseSubmit: SubmitMark | null;

  updatedAt: number | null;
}

/** 提出扱いの印1件（追加仕様: 提出扱い）。 */
export interface SubmitMark {
  /** 押した時刻 */
  at: number;
  /** 押した管理者のUID */
  by: string;
  /** なぜ提出扱いにしたか */
  reason: string;
  /**
   * 印を付ける**前**の値。
   *
   * ★ 取り消したときに、ここへ戻します。
   *
   *   戻す先を覚えていないと、取り消しのたびに
   *   「本当に記録があったかどうか」を数え直すことになります。
   *   本人が記録した日に押してしまって取り消した場合に、
   *   **本人の記録まで消す**のがいちばん困ります。
   */
  prev: boolean;
}

/** 提出扱いの理由に書ける長さ。 */
export const MAX_SUBMIT_REASON = 60;

export function emptyDay(date: DateKey): Day {
  return {
    date,
    status: 'open',
    weightKg: null,
    bodyFatPct: null,
    muscleKg: null,
    hasMeals: false,
    hasExercise: false,
    reviewedAt: null,
    finalizedAt: null,
    checkedAt: null,
    checkedBy: null,
    photoOldestAt: null,
    mealsSubmit: null,
    exerciseSubmit: null,
    updatedAt: null,
  };
}

/** 保存されている印を読む。壊れていても落ちません。 */
export function toSubmitMark(raw: unknown): SubmitMark | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const at = typeof row.at === 'number' && Number.isFinite(row.at) ? row.at : null;
  if (at === null) return null;
  return {
    at,
    by: typeof row.by === 'string' ? row.by : '',
    reason: typeof row.reason === 'string' ? row.reason.slice(0, MAX_SUBMIT_REASON) : '',
    prev: row.prev === true,
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
