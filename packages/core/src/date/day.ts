/**
 * 日付の扱い（設計書 §6 / §7.3）。
 *
 * このアプリの「1日」は、すべて **日本時間（JST, UTC+9）** の暦日です。
 * 利用者も管理者も日本にいる前提なので、端末の時間帯設定には依存させません。
 *
 * 日付は文字列 'yyyy-MM-dd' で持ちます。理由は3つあります。
 *
 *   1. Firestore のドキュメントIDにそのまま使える
 *   2. ゼロ埋めしてあるので、文字列の大小比較が日付の前後比較と一致する
 *      （Security Rules の過去編集ウィンドウ判定がこれに依存しています）
 *   3. タイムゾーンの解釈が入り込む余地がない
 *
 * ★ Date オブジェクトを画面やDBに持ち回らないこと。
 *   端末の時間帯によって1日ずれる事故の温床になります。
 */

/** JST のオフセット（ミリ秒） */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 'yyyy-MM-dd' 形式の日付文字列。 */
export type DateKey = string;

/** 'yyyy-MM' 形式の月文字列。 */
export type MonthKey = string;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * 実時刻から JST の暦日を求める。
 *
 * UTC のミリ秒に9時間足してから UTC として読み出すことで、
 * 実行環境の時間帯設定に関係なく JST の日付になります。
 */
export function toJstDateKey(instantMs: number): DateKey {
  const shifted = new Date(instantMs + JST_OFFSET_MS);
  return (
    `${shifted.getUTCFullYear()}-` + `${pad2(shifted.getUTCMonth() + 1)}-` + `${pad2(shifted.getUTCDate())}`
  );
}

/** 今日（JST）。テストしやすいよう、基準時刻を差し込めるようにしてあります。 */
export function todayKey(nowMs: number = Date.now()): DateKey {
  return toJstDateKey(nowMs);
}

/** 今月（JST）。 */
export function currentMonthKey(nowMs: number = Date.now()): MonthKey {
  return todayKey(nowMs).slice(0, 7);
}

/** 'yyyy-MM-dd' → 'yyyy-MM' */
export function monthOf(date: DateKey): MonthKey {
  return date.slice(0, 7);
}

export function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > daysInMonth(y, m)) return false;
  return true;
}

export function isValidMonthKey(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const m = Number(value.slice(5, 7));
  return m >= 1 && m <= 12;
}

/** その月の日数。うるう年も正しく扱う。 */
export function daysInMonth(year: number, month1to12: number): number {
  // 翌月の0日目 = 当月の末日（UTC で計算するので時間帯の影響を受けない）
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** 月を前後に動かす。'2026-01' の1つ前は '2025-12'。 */
export function addMonths(month: MonthKey, delta: number): MonthKey {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const total = year * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${pad2((total % 12) + 1)}`;
}

/** 日を前後に動かす。 */
export function addDays(date: DateKey, delta: number): DateKey {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + delta));
  return (
    `${shifted.getUTCFullYear()}-` + `${pad2(shifted.getUTCMonth() + 1)}-` + `${pad2(shifted.getUTCDate())}`
  );
}

/** 曜日。0=日曜 … 6=土曜。 */
export function weekdayOf(date: DateKey): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** その月の最初の日と最後の日。Firestore の範囲クエリに使う。 */
export function monthRange(month: MonthKey): { first: DateKey; last: DateKey } {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return { first: `${month}-01`, last: `${month}-${pad2(daysInMonth(year, m))}` };
}

/** カレンダーの1マス。月外の日（前後の月のはみ出し）は inMonth: false。 */
export interface CalendarCell {
  date: DateKey;
  /** 表示する数字（1〜31） */
  dayOfMonth: number;
  /** この月の日か。false なら薄く表示する */
  inMonth: boolean;
  /** 0=日曜 … 6=土曜 */
  weekday: number;
}

/**
 * 月表示のマス目を作る。日曜始まりの7列で、常に完全な週で埋める。
 *
 * 前後の月がはみ出すのは意図的です。マスの数が月によって変わると
 * 画面がガタつくため、週の途中で切らずに埋めます。
 */
export function monthGrid(month: MonthKey): CalendarCell[] {
  const { first, last } = monthRange(month);
  const cells: CalendarCell[] = [];

  const lead = weekdayOf(first); // 月初の前に何マス必要か
  for (let i = lead; i > 0; i -= 1) {
    cells.push(cell(addDays(first, -i), false));
  }

  const total = Number(last.slice(8, 10));
  for (let d = 1; d <= total; d += 1) {
    cells.push(cell(`${month}-${pad2(d)}`, true));
  }

  const trail = (7 - (cells.length % 7)) % 7;
  for (let i = 1; i <= trail; i += 1) {
    cells.push(cell(addDays(last, i), false));
  }

  return cells;
}

function cell(date: DateKey, inMonth: boolean): CalendarCell {
  return { date, dayOfMonth: Number(date.slice(8, 10)), inMonth, weekday: weekdayOf(date) };
}

// -----------------------------------------------------------------------------
// 表示用の整形
// -----------------------------------------------------------------------------

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** '2026-08-27' → '2026年8月27日（木）' */
export function formatDateLong(date: DateKey): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return `${y}年${m}月${d}日（${WEEKDAY_JA[weekdayOf(date)]}）`;
}

/** '2026-08' → '2026年8月' */
export function formatMonth(month: MonthKey): string {
  return `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`;
}

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_JA[weekday] ?? '';
}

/**
 * 契約者が自分で編集できる日かどうか（設計書 §7.3）。
 *
 * ★ これは画面の出し分け用です。本当の判定は Security Rules が行います。
 *   ここを書き換えても、古い日付のデータは1バイトも変更できません。
 */
export function isWithinEditWindow(
  date: DateKey,
  windowDays: number,
  nowMs: number = Date.now(),
): boolean {
  return date >= addDays(todayKey(nowMs), -Math.max(0, windowDays));
}
