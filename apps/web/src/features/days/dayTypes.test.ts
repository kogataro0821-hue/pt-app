import { describe, expect, it } from 'vitest';
import { emptyDay, hasAnyMarker, markersOf, type Day } from './dayTypes';

/**
 * カレンダーの印（設計書 §6）。
 *
 * ここが狂うと、契約者は「記録したのに印が付かない」と感じます。
 * 印は記録そのものではないので壊れても気づきにくく、テストで押さえます。
 */

function day(over: Partial<Day> = {}): Day {
  return { ...emptyDay('2026-08-28'), ...over };
}

describe('markersOf', () => {
  it('記録が無い日は、印がひとつも付かない', () => {
    const m = markersOf(day());
    expect(m).toEqual({ meals: false, exercise: false, weight: false, done: false });
    expect(hasAnyMarker(m)).toBe(false);
  });

  it('その日のデータが無い（undefined）ときも、落ちずに全部 false を返す', () => {
    // カレンダーは記録の無い日も描くので、ここで落ちると月表示が丸ごと出なくなります
    expect(markersOf(undefined)).toEqual({
      meals: false,
      exercise: false,
      weight: false,
      done: false,
    });
  });

  it('食事・運動の有無はそのまま印になる', () => {
    expect(markersOf(day({ hasMeals: true })).meals).toBe(true);
    expect(markersOf(day({ hasExercise: true })).exercise).toBe(true);
  });

  it('体重は「入力されているか」で判断する。0kg でも記録は記録', () => {
    expect(markersOf(day({ weightKg: null })).weight).toBe(false);
    expect(markersOf(day({ weightKg: 53.4 })).weight).toBe(true);
    expect(markersOf(day({ weightKg: 0 })).weight).toBe(true);
  });

  it('体脂肪率だけでは体重の印は付かない', () => {
    expect(markersOf(day({ bodyFatPct: 25.1 })).weight).toBe(false);
  });

  describe('「済み」の印は3つのうちどれかで付く', () => {
    it('1日を確定した', () => {
      expect(markersOf(day({ status: 'finalized' })).done).toBe(true);
    });

    it('AIの評価がある', () => {
      expect(markersOf(day({ reviewedAt: 1 })).done).toBe(true);
    });

    it('トレーナーが確認した', () => {
      expect(markersOf(day({ checkedAt: 1 })).done).toBe(true);
    });

    it('どれも無ければ付かない', () => {
      expect(markersOf(day({ hasMeals: true })).done).toBe(false);
    });
  });
});

describe('hasAnyMarker', () => {
  it('ひとつでも付いていれば true', () => {
    expect(hasAnyMarker({ meals: false, exercise: false, weight: false, done: true })).toBe(true);
    expect(hasAnyMarker({ meals: true, exercise: false, weight: false, done: false })).toBe(true);
  });
});

describe('emptyDay', () => {
  it('日付以外はすべて「まだ何も無い」状態で始まる', () => {
    const d = emptyDay('2026-08-28');
    expect(d.date).toBe('2026-08-28');
    expect(d.status).toBe('open');
    expect(d.weightKg).toBeNull();
    expect(d.checkedAt).toBeNull();
    expect(d.photoOldestAt).toBeNull();
  });
});
