import { describe, expect, it } from 'vitest';
import {
  applyGrant,
  canClaimToday,
  claimDaily,
  DEFAULT_DAILY_POINTS,
  EMPTY_POINTS,
  formatDelta,
  formatPoints,
  isValidDailyPoints,
  isValidGrant,
  MAX_GRANT,
  nextClaimAt,
  pointDayKey,
  readPoints,
  type PointsState,
} from './points';

/**
 * ポイント（追加仕様: ログインポイント）。
 *
 * ★ ここで守りたいのは、次の4つです。
 *
 *   1. 1日の区切りは朝4時
 *   2. 1日に2回は受け取れない
 *   3. 残高はマイナスにならない
 *   4. 壊れた値を読んでも落ちない
 */

/** JST の時刻から実時刻(ms)を作る小道具。 */
function jst(y: number, m: number, d: number, h: number, min = 0): number {
  return Date.UTC(y, m - 1, d, h - 9, min, 0, 0);
}

describe('★ 1日の区切りは朝4時', () => {
  it('朝4時ちょうどから、新しい日', () => {
    expect(pointDayKey(jst(2026, 9, 6, 4, 0))).toBe('2026-09-06');
  });

  it('朝3時59分は、まだ前の日', () => {
    // ★ ここが要です。夜中に記録する人にとって、午前1時はまだ「昨日」です。
    expect(pointDayKey(jst(2026, 9, 6, 3, 59))).toBe('2026-09-05');
  });

  it('深夜0時は、前の日のまま', () => {
    expect(pointDayKey(jst(2026, 9, 6, 0, 0))).toBe('2026-09-05');
  });

  it('昼は、その日', () => {
    expect(pointDayKey(jst(2026, 9, 6, 12, 0))).toBe('2026-09-06');
  });

  it('夜11時も、その日', () => {
    expect(pointDayKey(jst(2026, 9, 6, 23, 59))).toBe('2026-09-06');
  });

  it('月をまたぐところ', () => {
    expect(pointDayKey(jst(2026, 10, 1, 3, 0))).toBe('2026-09-30');
    expect(pointDayKey(jst(2026, 10, 1, 4, 0))).toBe('2026-10-01');
  });

  it('年をまたぐところ', () => {
    expect(pointDayKey(jst(2027, 1, 1, 2, 0))).toBe('2026-12-31');
    expect(pointDayKey(jst(2027, 1, 1, 5, 0))).toBe('2027-01-01');
  });

  it('★ 夜更かしして日をまたいでも、受け取れるのは1回', () => {
    // 9/5 の 23:00 に受け取った人が、日付が変わった 9/6 の 01:00 に開き直す。
    const at23 = pointDayKey(jst(2026, 9, 5, 23, 0));
    const at01 = pointDayKey(jst(2026, 9, 6, 1, 0));
    expect(at23).toBe(at01);

    const after = claimDaily({ ...EMPTY_POINTS }, at23);
    expect(after).not.toBeNull();
    expect(canClaimToday(after!.next, at01)).toBe(false);
  });

  it('つぎに受け取れるのは、あすの朝4時', () => {
    const now = jst(2026, 9, 5, 23, 0);
    expect(nextClaimAt(now)).toBe(jst(2026, 9, 6, 4, 0));
  });

  it('深夜に開いた人にとっての「あす朝4時」は、その日の朝4時', () => {
    const now = jst(2026, 9, 6, 1, 0); // ポイント日は 9/5
    expect(nextClaimAt(now)).toBe(jst(2026, 9, 6, 4, 0));
  });
});

describe('日ぶんを受け取る', () => {
  it('初めての日は、設定された額そのまま', () => {
    const claim = claimDaily(EMPTY_POINTS, '2026-09-05');
    expect(claim?.gained).toBe(DEFAULT_DAILY_POINTS);
    expect(claim?.next.points).toBe(100);
    expect(claim?.next.totalDays).toBe(1);
    expect(claim?.next.lastDate).toBe('2026-09-05');
  });

  it('管理者が額を変えたら、その額で増える', () => {
    const state: PointsState = { ...EMPTY_POINTS, dailyPoints: 250 };
    expect(claimDaily(state, '2026-09-05')?.gained).toBe(250);
  });

  it('0に設定してあれば、増えない（受け取り自体は成立する）', () => {
    const state: PointsState = { ...EMPTY_POINTS, dailyPoints: 0 };
    const claim = claimDaily(state, '2026-09-05');
    expect(claim?.gained).toBe(0);
    expect(claim?.next.totalDays).toBe(1);
  });

  it('★ 同じ日に2回目は受け取れない', () => {
    const state: PointsState = { ...EMPTY_POINTS, points: 100, lastDate: '2026-09-05', totalDays: 1 };
    expect(claimDaily(state, '2026-09-05')).toBeNull();
  });

  it('★ 時計を戻しても受け取れない', () => {
    const state: PointsState = { ...EMPTY_POINTS, points: 100, lastDate: '2026-09-05', totalDays: 1 };
    expect(claimDaily(state, '2026-09-04')).toBeNull();
    expect(claimDaily(state, '2025-01-01')).toBeNull();
  });

  it('★ 何日空いても、ちゃんと受け取れる（休んだ罰は無い）', () => {
    const away: PointsState = { ...EMPTY_POINTS, points: 500, lastDate: '2026-06-01', totalDays: 5 };
    const claim = claimDaily(away, '2026-09-05');
    expect(claim?.next.points).toBe(600);
    expect(claim?.next.totalDays).toBe(6);
  });

  it('日付が空なら、何もしない', () => {
    expect(claimDaily(EMPTY_POINTS, '')).toBeNull();
  });

  it('管理者が減らしたあとでも、翌日はちゃんと受け取れる', () => {
    // ★ 交換で残高を使い切った翌日に受け取れないと、交換した人が損をします。
    const spent: PointsState = { ...EMPTY_POINTS, points: 0, lastDate: '2026-09-05', totalDays: 10 };
    const claim = claimDaily(spent, '2026-09-06');
    expect(claim?.next.points).toBe(100);
  });
});

describe('★ 管理者が付ける・減らす', () => {
  it('付ける', () => {
    expect(applyGrant(100, 500)).toEqual({ points: 600, applied: 500 });
  });

  it('減らす（交換した）', () => {
    expect(applyGrant(1000, -300)).toEqual({ points: 700, applied: -300 });
  });

  it('★ 残高より多く引いても、マイナスにはならない', () => {
    // 300 しか無い人から 500 引く → 引けるのは 300 まで
    expect(applyGrant(300, -500)).toEqual({ points: 0, applied: -300 });
  });

  it('0 の人から引いても、0 のまま', () => {
    expect(applyGrant(0, -100)).toEqual({ points: 0, applied: 0 });
  });

  it('打ってよい数', () => {
    expect(isValidGrant(100)).toBe(true);
    expect(isValidGrant(-100)).toBe(true);
    expect(isValidGrant(MAX_GRANT)).toBe(true);
  });

  it('★ 0 は打てない（付けるでも減らすでもない）', () => {
    expect(isValidGrant(0)).toBe(false);
  });

  it('★ 桁を打ち間違えたら止める', () => {
    expect(isValidGrant(MAX_GRANT + 1)).toBe(false);
    expect(isValidGrant(-(MAX_GRANT + 1))).toBe(false);
  });

  it('小数や壊れた数は打てない', () => {
    expect(isValidGrant(1.5)).toBe(false);
    expect(isValidGrant(NaN)).toBe(false);
    expect(isValidGrant(Infinity)).toBe(false);
  });
});

describe('1日の付与ポイントの設定', () => {
  it('ふつうの数', () => {
    expect(isValidDailyPoints(100)).toBe(true);
    expect(isValidDailyPoints(0)).toBe(true);
    expect(isValidDailyPoints(10000)).toBe(true);
  });

  it('範囲の外は受け付けない', () => {
    expect(isValidDailyPoints(-1)).toBe(false);
    expect(isValidDailyPoints(10001)).toBe(false);
    expect(isValidDailyPoints(1.5)).toBe(false);
  });
});

describe('保存されたものを読む', () => {
  it('ふつうに読める', () => {
    expect(
      readPoints({
        points: 1200,
        pointsDailyAmount: 150,
        pointsLastDate: '2026-09-05',
        pointsTotalDays: 12,
      }),
    ).toEqual({ points: 1200, dailyPoints: 150, lastDate: '2026-09-05', totalDays: 12 });
  });

  it('まだ無ければ、ゼロと既定の100から', () => {
    expect(readPoints({})).toEqual({
      points: 0,
      dailyPoints: DEFAULT_DAILY_POINTS,
      lastDate: '',
      totalDays: 0,
    });
  });

  it('★ 壊れた値でも落ちない', () => {
    const broken = readPoints({
      points: 'たくさん',
      pointsDailyAmount: null,
      pointsLastDate: 42,
      pointsTotalDays: NaN,
    });
    expect(broken.points).toBe(0);
    expect(broken.dailyPoints).toBe(DEFAULT_DAILY_POINTS);
    expect(broken.lastDate).toBe('');
    expect(broken.totalDays).toBe(0);
  });

  it('マイナスが入っていても0として読む', () => {
    expect(readPoints({ points: -500 }).points).toBe(0);
  });

  it('1日の付与が範囲外なら、範囲に収める', () => {
    expect(readPoints({ pointsDailyAmount: 999999 }).dailyPoints).toBe(10000);
    expect(readPoints({ pointsDailyAmount: -5 }).dailyPoints).toBe(0);
  });
});

describe('表示', () => {
  it('桁区切りが入る', () => {
    expect(formatPoints(1200)).toBe('1,200 pt');
    expect(formatPoints(0)).toBe('0 pt');
  });

  it('符号が付く', () => {
    expect(formatDelta(100)).toBe('+100 pt');
    expect(formatDelta(-50)).toBe('−50 pt');
  });
});
