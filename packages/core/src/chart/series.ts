import { addDays, type DateKey } from '../date/day';

/**
 * 折れ線グラフの座標計算（設計書 §25）。
 *
 * ★ グラフ用の外部ライブラリは入れません。
 *   必要なのは「点を線でつなぐ」だけで、そのために数十KBの部品を
 *   読み込ませるのは、通信の遅い場所で開く利用者に対して割に合いません。
 *   計算はここで行い、描画は SVG で素直に書きます。
 *
 * ★ 純粋な計算なのでテストできます。目盛りの数や範囲の決め方は
 *   目で見て判断しにくいので、機械的に確認できる形にしてあります。
 */

export interface Point {
  date: DateKey;
  value: number;
}

export interface PlottedPoint extends Point {
  /** 描画領域内の座標（0〜width, 0〜height） */
  x: number;
  y: number;
}

export interface ChartLayout {
  points: PlottedPoint[];
  /** 目盛りの値（下から上へ） */
  ticks: number[];
  min: number;
  max: number;
  /** 目標線の y 座標。目標が範囲外・未設定なら null */
  targetY: number | null;
  /** SVG の path に渡す文字列。点が1つ以下なら空 */
  path: string;
}

/**
 * 縦軸の範囲を決める。
 *
 * 体重は 60kg 前後を 0 から描くと、変化がまったく見えません。
 * そこで実データの範囲に合わせ、上下に少し余白を足します。
 * ただし変化が小さすぎるときは、細かい上下が大きく見えて
 * 一喜一憂の元になるので、最低でも 2kg の幅を確保します。
 */
export function niceRange(
  values: readonly number[],
  target: number | null,
  minSpan = 2,
): { min: number; max: number } {
  const all = target === null ? [...values] : [...values, target];
  if (all.length === 0) return { min: 0, max: minSpan };

  let lo = Math.min(...all);
  let hi = Math.max(...all);

  if (hi - lo < minSpan) {
    const center = (hi + lo) / 2;
    lo = center - minSpan / 2;
    hi = center + minSpan / 2;
  }

  const pad = (hi - lo) * 0.12;
  return { min: round1(lo - pad), max: round1(hi + pad) };
}

/** 目盛りの値を等間隔で作る。 */
export function makeTicks(min: number, max: number, count = 4): number[] {
  if (count < 2 || max <= min) return [min, max];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => round1(min + step * i));
}

/**
 * 点を描画座標に変換する。
 *
 * 横軸は「日付の並び順」ではなく「実際の日数」を使います。
 * 記録が飛んでいる日があるとき、等間隔に並べると
 * 「毎日測っている」ように見えてしまうためです。
 */
export function layoutChart(
  points: readonly Point[],
  options: {
    width: number;
    height: number;
    from: DateKey;
    to: DateKey;
    target?: number | null;
  },
): ChartLayout {
  const { width, height, from, to } = options;
  const target = options.target ?? null;

  const { min, max } = niceRange(
    points.map((p) => p.value),
    target,
  );
  const ticks = makeTicks(min, max);

  const totalDays = Math.max(1, daysBetween(from, to));
  const span = Math.max(1e-9, max - min);

  const plotted: PlottedPoint[] = points.map((p) => ({
    ...p,
    x: (daysBetween(from, p.date) / totalDays) * width,
    // SVG は上が 0 なので、値が大きいほど上に来るよう反転する
    y: height - ((p.value - min) / span) * height,
  }));

  const targetY =
    target === null || target < min || target > max
      ? null
      : height - ((target - min) / span) * height;

  const path =
    plotted.length < 2
      ? ''
      : plotted
          .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
          .join(' ');

  return { points: plotted, ticks, min, max, targetY, path };
}

/** 2つの日付の間の日数。同じ日なら 0。 */
export function daysBetween(from: DateKey, to: DateKey): number {
  if (from === to) return 0;
  let count = 0;
  let cursor = from;
  // 期間は最長1年に制限しているので、素直に数えて問題ない
  while (cursor < to && count < 400) {
    cursor = addDays(cursor, 1);
    count += 1;
  }
  return count;
}

/**
 * 最初と最後の差。「この期間でどれだけ変わったか」。
 * 点が1つ以下なら null（変化を語れないため）。
 */
export function changeOverPeriod(points: readonly Point[]): number | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return null;
  return round1(last.value - first.value);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
