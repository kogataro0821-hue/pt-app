/**
 * ポイント（追加仕様: ログインポイント）。
 *
 * ★ このポイントは「実物と交換できます」。
 *
 *   貯まったポイントは、トレーナーと直接やり取りして何かと交換します。
 *   つまり **本物の価値を持つ数字** です。
 *   飾りのバッジなら多少ずれても困りませんが、これは違います。
 *
 *   なので、置き場所と守り方を前の作り（extra.loginBonus）から変えました。
 *
 *   - 契約者ドキュメントの **決まった項目** に置きます（extra の中ではない）
 *   - 契約者が書き換えられるのは「今日ぶんを1回受け取る」ときだけ
 *   - その1回も、**サーバーの時刻**と**設定された額ぴったり**でなければ通りません
 *
 *   条件は Firestore Security Rules に書いてあります（firebase/firestore.rules）。
 *   画面の作りを直しても、ブラウザの開発者ツールから直接書いても、
 *   通らないものは通りません。
 *
 * ★ 1日の区切りは **朝4時** です。
 *
 *   夜中に記録する人がいます。午前1時に開いた人にとって、
 *   その日はまだ「昨日」です。0時で切ると、
 *   夜更かしした日だけ2日ぶん受け取れてしまい、
 *   早く寝た日は1日ぶんも受け取れないことが起きます。
 *
 *   4時で切ると、普通に寝起きする限り「1日1回」が素直に一致します。
 */

import { toJstDateKey, type DateKey } from '../date/day';

/**
 * 1日の区切り（朝4時）。
 *
 * ★ 「JSTの時刻から4時間戻した日」が、そのポイント日です。
 *   朝4時より前は、まだ前の日として数えられます。
 *
 * ★ 下では実時刻から4時間**引いて** toJstDateKey に渡しています。
 *   toJstDateKey は中で9時間足すので、差し引き +5時間の暦日になります。
 *   Rules 側には、その足し算の形（request.time + 5時間）で書いてあります。
 *   ずらすときは両方直してください。
 */
const POINT_DAY_SHIFT_HOURS = 4;

const HOUR_MS = 60 * 60 * 1000;

/**
 * 画面に出す名前。
 *
 * ★ コードの中では points（ポイント）のままにしてあります。
 *
 *   Firestore に保存されている項目名（points / pointsDailyAmount / …）と
 *   Rules の条件が、その名前で書かれているためです。
 *   名前を揃えるためだけに項目名を変えると、Rules の貼り直しと
 *   既存データの移行が必要になります。割に合いません。
 *   **画面に出る言葉だけ「かけら」にしてあります。**
 */
export const SHARD_NAME = 'タンパク質のかけら';

/** 数のうしろに付ける短い呼び方。 */
export const SHARD_UNIT = 'かけら';

/** 1日にたまる数の既定値。管理者が契約者ごとに変えられます。 */
export const DEFAULT_DAILY_POINTS = 1;

/** 1日にたまる数に認める範囲。 */
export const MIN_DAILY_POINTS = 0;
export const MAX_DAILY_POINTS = 100;

/**
 * 一度に付け外しできる数の上限。
 *
 * ★ 上限を置くのは、桁を打ち間違えたときのためです。
 *   3 のつもりで 3000 と打っても、交換の場で気づけません。
 */
export const MAX_GRANT = 1000;

/**
 * その時刻が属する「ポイント日」。
 *
 * ★ 朝4時までは前の日として数えます。
 *   2026-09-06 03:59 JST → '2026-09-05'
 *   2026-09-06 04:00 JST → '2026-09-06'
 */
export function pointDayKey(nowMs: number = Date.now()): DateKey {
  return toJstDateKey(nowMs - POINT_DAY_SHIFT_HOURS * HOUR_MS);
}

/** 契約者ドキュメントに入っている、ポイントまわりの中身。 */
export interface PointsState {
  /** いまの残高。管理者が減らすことがあります */
  points: number;
  /** 1日の付与ポイント。管理者だけが変えられます */
  dailyPoints: number;
  /** 最後に日ぶんを受け取ったポイント日。まだなら空文字 */
  lastDate: DateKey | '';
  /** 累計で受け取った日数（表示用） */
  totalDays: number;
}

export const EMPTY_POINTS: PointsState = {
  points: 0,
  dailyPoints: DEFAULT_DAILY_POINTS,
  lastDate: '',
  totalDays: 0,
};

/**
 * 保存されているものを読む。壊れていても既定値に落とします。
 *
 * ★ ここで落ちると、ホーム画面ごと開けなくなります。
 *   残高が0に見えるほうが、真っ白になるよりましです。
 *   （そして本当の残高はサーバーにあるので、読み直せば戻ります）
 */
export function readPoints(raw: Record<string, unknown>): PointsState {
  return {
    points: whole(raw.points, 0),
    // ★ 保存されている名前は pointsDailyAmount です。
    //   Rules も同じ名前を見ています（resource.data.get('pointsDailyAmount', 100)）。
    //   ここを取り違えると、管理者が額を変えても画面と Rules がずれ、
    //   受け取りが静かに弾かれ続けます。
    dailyPoints: clamp(
      whole(raw.pointsDailyAmount, DEFAULT_DAILY_POINTS),
      MIN_DAILY_POINTS,
      MAX_DAILY_POINTS,
    ),
    lastDate: typeof raw.pointsLastDate === 'string' ? raw.pointsLastDate : '',
    totalDays: whole(raw.pointsTotalDays, 0),
  };
}

function whole(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 今日ぶんを受け取れるか。 */
export function canClaimToday(state: PointsState, day: DateKey): boolean {
  if (day.length === 0) return false;
  // ★ 「同じ日」だけでなく「過去に戻った日」も弾きます。
  //   端末の時計を戻して何度も受け取る、を塞ぐためです。
  //   （進める側は Rules がサーバー時刻で見ています）
  if (state.lastDate.length > 0 && day <= state.lastDate) return false;
  return true;
}

/** 今日ぶんを受け取った結果。受け取れないときは null。 */
export interface Claim {
  next: PointsState;
  /** 増えた額 */
  gained: number;
}

/**
 * 今日ぶんを受け取る。
 *
 * ★ 何日空けても受け取れます。連続が途切れても罰はありません。
 *   「一度休んだら積み上げが消える」形は、休んだ日にそのまま離れます。
 */
export function claimDaily(state: PointsState, day: DateKey): Claim | null {
  if (!canClaimToday(state, day)) return null;

  const gained = state.dailyPoints;
  return {
    next: {
      ...state,
      points: state.points + gained,
      lastDate: day,
      totalDays: state.totalDays + 1,
    },
    gained,
  };
}

/**
 * 管理者がポイントを付ける／減らす。
 *
 * ★ 残高はマイナスにしません。
 *
 *   交換のときに「500ポイント引く」と打って、残高が300しかなければ、
 *   引けるのは300までです。−200 の残高を作っても意味がありません。
 *   実際にいくら引けたかを returns で返すので、
 *   画面ではその数をお知らせに書けます。
 */
export function applyGrant(points: number, delta: number): { points: number; applied: number } {
  const next = Math.max(0, points + delta);
  return { points: next, applied: next - points };
}

/** 付与額として打ってよい数か。 */
export function isValidGrant(delta: number): boolean {
  if (!Number.isFinite(delta) || !Number.isInteger(delta)) return false;
  if (delta === 0) return false;
  return Math.abs(delta) <= MAX_GRANT;
}

/** 1日の付与ポイントとして設定してよい数か。 */
export function isValidDailyPoints(value: number): boolean {
  if (!Number.isFinite(value) || !Number.isInteger(value)) return false;
  return value >= MIN_DAILY_POINTS && value <= MAX_DAILY_POINTS;
}

/** 「12 かけら」のように読みやすく。 */
export function formatPoints(points: number): string {
  return `${points.toLocaleString('ja-JP')} ${SHARD_UNIT}`;
}

/** 「+3 かけら」「−5 かけら」のように符号を付けて。 */
export function formatDelta(delta: number): string {
  const sign = delta < 0 ? '−' : '+';
  return `${sign}${Math.abs(delta).toLocaleString('ja-JP')} ${SHARD_UNIT}`;
}

/**
 * つぎに受け取れる時刻（表示用）。
 *
 * ★ 「あと何時間」ではなく「あすの朝4時」と出したいので、
 *   実時刻を返します。
 */
export function nextClaimAt(nowMs: number = Date.now()): number {
  const parts = pointDayKey(nowMs).split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  // ポイント日 D の終わりは、暦日 D+1 の朝4時（JST）。
  // JST 4時 = UTC で前日の19時なので、時に 4 - 9 を渡します。
  return Date.UTC(y, m - 1, d + 1, 4 - 9, 0, 0, 0);
}
