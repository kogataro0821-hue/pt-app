import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  currentMonthKey,
  daysInMonth,
  formatDateLong,
  formatMonth,
  isValidDateKey,
  isValidMonthKey,
  isWithinEditWindow,
  monthGrid,
  monthOf,
  monthRange,
  todayKey,
  toJstDateKey,
  weekdayOf,
} from './day';

/** 2026-08-27 12:00 JST を UTC ミリ秒で表したもの */
const NOON_JST = Date.UTC(2026, 7, 27, 3, 0, 0);

describe('JSTの暦日', () => {
  it('正午は当日になる', () => {
    expect(toJstDateKey(NOON_JST)).toBe('2026-08-27');
  });

  // ★ ここが一番大事。UTCで日付を出すと、日本の夜が前日になってしまう。
  it('日本の23時はまだ当日（UTCでは前日15時）', () => {
    expect(toJstDateKey(Date.UTC(2026, 7, 27, 14, 0, 0))).toBe('2026-08-27');
  });

  it('日本の0時5分は翌日として扱われる', () => {
    expect(toJstDateKey(Date.UTC(2026, 7, 27, 15, 5, 0))).toBe('2026-08-28');
  });

  it('todayKey は基準時刻を差し込める', () => {
    expect(todayKey(NOON_JST)).toBe('2026-08-27');
    expect(currentMonthKey(NOON_JST)).toBe('2026-08');
  });
});

describe('日付の検証', () => {
  it('正しい日付を通す', () => {
    expect(isValidDateKey('2026-08-27')).toBe(true);
    expect(isValidDateKey('2024-02-29')).toBe(true); // うるう年
  });

  it('ありえない日付を弾く', () => {
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('2025-02-29')).toBe(false); // 平年
    expect(isValidDateKey('2026-13-01')).toBe(false);
    expect(isValidDateKey('2026-00-10')).toBe(false);
    expect(isValidDateKey('2026-8-27')).toBe(false); // ゼロ埋めなし
    expect(isValidDateKey('')).toBe(false);
    expect(isValidDateKey('../../etc')).toBe(false);
  });

  it('月の検証', () => {
    expect(isValidMonthKey('2026-08')).toBe(true);
    expect(isValidMonthKey('2026-8')).toBe(false);
    expect(isValidMonthKey('2026-13')).toBe(false);
  });
});

describe('月と日の移動', () => {
  it('月をまたぐ', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-08', 0)).toBe('2026-08');
  });

  it('日をまたぐ', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
  });

  it('月の日数', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 8)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it('月の範囲', () => {
    expect(monthRange('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28' });
    expect(monthRange('2024-02')).toEqual({ first: '2024-02-01', last: '2024-02-29' });
  });

  it('monthOf', () => {
    expect(monthOf('2026-08-27')).toBe('2026-08');
  });
});

describe('カレンダーのマス目', () => {
  it('必ず7の倍数になる', () => {
    for (const m of ['2026-01', '2026-02', '2024-02', '2026-08', '2026-11']) {
      expect(monthGrid(m).length % 7).toBe(0);
    }
  });

  it('先頭は日曜、末尾は土曜', () => {
    const cells = monthGrid('2026-08');
    expect(cells[0]?.weekday).toBe(0);
    expect(cells[cells.length - 1]?.weekday).toBe(6);
  });

  it('その月の日がすべて1回ずつ含まれる', () => {
    const cells = monthGrid('2026-08').filter((c) => c.inMonth);
    expect(cells).toHaveLength(31);
    expect(cells[0]?.date).toBe('2026-08-01');
    expect(cells[30]?.date).toBe('2026-08-31');
    expect(new Set(cells.map((c) => c.date)).size).toBe(31);
  });

  it('日付が連続していて、隙間も重複もない', () => {
    const cells = monthGrid('2026-03');
    for (let i = 1; i < cells.length; i += 1) {
      expect(cells[i]?.date).toBe(addDays(cells[i - 1]!.date, 1));
    }
  });

  it('ちょうど4週で収まる月は、はみ出しが1マスも出ない', () => {
    // 2026年2月は1日が日曜で28日ある＝ちょうど4週
    expect(weekdayOf('2026-02-01')).toBe(0);
    const cells = monthGrid('2026-02');
    expect(cells).toHaveLength(28);
    expect(cells.every((c) => c.inMonth)).toBe(true);
  });

  it('はみ出す月は前後が月外として入る', () => {
    // 2026年8月は1日が土曜
    expect(weekdayOf('2026-08-01')).toBe(6);
    const cells = monthGrid('2026-08');
    expect(cells[0]?.date).toBe('2026-07-26');
    expect(cells[0]?.inMonth).toBe(false);
    expect(cells[cells.length - 1]?.inMonth).toBe(false);
  });
});

describe('表示用の整形', () => {
  it('日付', () => {
    expect(formatDateLong('2026-08-27')).toBe('2026年8月27日（木）');
    expect(formatDateLong('2026-01-04')).toBe('2026年1月4日（日）');
  });

  it('月', () => {
    expect(formatMonth('2026-08')).toBe('2026年8月');
  });
});

describe('過去編集ウィンドウ（画面側の目安）', () => {
  it('既定7日なら7日前まで編集できる', () => {
    expect(isWithinEditWindow('2026-08-27', 7, NOON_JST)).toBe(true);
    expect(isWithinEditWindow('2026-08-20', 7, NOON_JST)).toBe(true);
    expect(isWithinEditWindow('2026-08-19', 7, NOON_JST)).toBe(false);
  });

  it('0日なら今日だけ', () => {
    expect(isWithinEditWindow('2026-08-27', 0, NOON_JST)).toBe(true);
    expect(isWithinEditWindow('2026-08-26', 0, NOON_JST)).toBe(false);
  });

  it('未来の日付は常に対象内（入力自体は別途制限する）', () => {
    expect(isWithinEditWindow('2026-09-01', 7, NOON_JST)).toBe(true);
  });
});
