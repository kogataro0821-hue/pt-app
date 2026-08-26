import { describe, expect, it } from 'vitest';
import {
  changeOverPeriod,
  daysBetween,
  layoutChart,
  makeTicks,
  niceRange,
  type Point,
} from './series';

describe('縦軸の範囲', () => {
  // ★ 体重を0から描くと、数kgの変化がまったく見えない。
  it('0からではなく、実データの範囲に合わせる', () => {
    const r = niceRange([60, 62, 61], null);
    expect(r.min).toBeGreaterThan(55);
    expect(r.max).toBeLessThan(67);
  });

  it('実データを必ず含む', () => {
    const values = [60, 62, 61];
    const r = niceRange(values, null);
    expect(r.min).toBeLessThanOrEqual(Math.min(...values));
    expect(r.max).toBeGreaterThanOrEqual(Math.max(...values));
  });

  // ★ 変化が小さいときに拡大しすぎると、体重計の誤差が
  //   大きな増減に見えて、一喜一憂の元になる。
  it('変化が小さくても最低2kgの幅を確保する', () => {
    const r = niceRange([60.0, 60.1], null);
    expect(r.max - r.min).toBeGreaterThanOrEqual(2);
  });

  it('目標値も範囲に含める', () => {
    const r = niceRange([62, 63], 58);
    expect(r.min).toBeLessThanOrEqual(58);
  });

  it('データが無くても壊れない', () => {
    const r = niceRange([], null);
    expect(r.max).toBeGreaterThan(r.min);
  });
});

describe('目盛り', () => {
  it('指定した数だけ作る', () => {
    expect(makeTicks(60, 64, 5)).toHaveLength(5);
  });

  it('最小と最大を含み、昇順になる', () => {
    const ticks = makeTicks(60, 64, 5);
    expect(ticks[0]).toBe(60);
    expect(ticks[4]).toBe(64);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]!).toBeGreaterThan(ticks[i - 1]!);
    }
  });
});

describe('日数の計算', () => {
  it('同じ日なら0', () => {
    expect(daysBetween('2026-08-27', '2026-08-27')).toBe(0);
  });

  it('月をまたいでも正しい', () => {
    expect(daysBetween('2026-08-30', '2026-09-02')).toBe(3);
  });

  it('うるう年をまたいでも正しい', () => {
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
  });
});

describe('座標の計算', () => {
  const opts = { width: 300, height: 100, from: '2026-08-01', to: '2026-08-31' };

  it('最初の点は左端、最後の点は右端', () => {
    const points: Point[] = [
      { date: '2026-08-01', value: 62 },
      { date: '2026-08-31', value: 60 },
    ];
    const out = layoutChart(points, opts);
    expect(out.points[0]!.x).toBeCloseTo(0, 5);
    expect(out.points[1]!.x).toBeCloseTo(300, 5);
  });

  // ★ 記録が飛んでいる日があるとき、点を等間隔に並べると
  //   「毎日測っている」ように見えてしまう。
  it('記録の飛びが横方向の間隔に反映される', () => {
    const points: Point[] = [
      { date: '2026-08-01', value: 62 },
      { date: '2026-08-02', value: 62 },
      { date: '2026-08-31', value: 60 },
    ];
    const out = layoutChart(points, opts);
    const gap1 = out.points[1]!.x - out.points[0]!.x;
    const gap2 = out.points[2]!.x - out.points[1]!.x;
    expect(gap2).toBeGreaterThan(gap1 * 10);
  });

  it('値が大きいほど上（yが小さい）に来る', () => {
    const points: Point[] = [
      { date: '2026-08-01', value: 60 },
      { date: '2026-08-31', value: 64 },
    ];
    const out = layoutChart(points, opts);
    expect(out.points[1]!.y).toBeLessThan(out.points[0]!.y);
  });

  it('すべての点が描画領域の中に収まる', () => {
    const points: Point[] = [
      { date: '2026-08-01', value: 58.2 },
      { date: '2026-08-10', value: 63.9 },
      { date: '2026-08-31', value: 60.4 },
    ];
    const out = layoutChart(points, { ...opts, target: 57 });
    for (const p of out.points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(300);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
    }
  });

  it('点が1つなら線は引かない', () => {
    const out = layoutChart([{ date: '2026-08-01', value: 62 }], opts);
    expect(out.path).toBe('');
    expect(out.points).toHaveLength(1);
  });

  it('点が無くても壊れない', () => {
    const out = layoutChart([], opts);
    expect(out.path).toBe('');
    expect(out.ticks.length).toBeGreaterThan(0);
  });

  // ★ 目標が今の体重から離れていても、縦軸を広げて必ず入れます。
  //   目標線が画面の外にあると「どれだけ離れているか」が分からず、
  //   グラフを見る意味が半分になるためです。
  it('目標が離れていても、縦軸を広げて必ず描く', () => {
    const points: Point[] = [
      { date: '2026-08-01', value: 62 },
      { date: '2026-08-31', value: 61 },
    ];
    const far = layoutChart(points, { ...opts, target: 55 });
    expect(far.targetY).not.toBeNull();
    expect(far.targetY!).toBeGreaterThanOrEqual(0);
    expect(far.targetY!).toBeLessThanOrEqual(100);
    // 目標のほうが軽いので、線は実データより下に来る
    expect(far.targetY!).toBeGreaterThan(far.points[0]!.y);
  });

  it('目標が未設定なら線は引かない', () => {
    const points: Point[] = [{ date: '2026-08-01', value: 62 }];
    expect(layoutChart(points, opts).targetY).toBeNull();
  });
});

describe('期間中の変化', () => {
  it('最初と最後の差', () => {
    expect(
      changeOverPeriod([
        { date: '2026-08-01', value: 62.4 },
        { date: '2026-08-31', value: 60.9 },
      ]),
    ).toBe(-1.5);
  });

  it('点が1つなら変化を語らない', () => {
    expect(changeOverPeriod([{ date: '2026-08-01', value: 62 }])).toBeNull();
    expect(changeOverPeriod([])).toBeNull();
  });
});
