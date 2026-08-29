import { describe, expect, it } from 'vitest';
import { validateBodyMetrics } from './daysRepo';

/**
 * 体重・体脂肪率の入力チェック。
 *
 * ★ 目的は「打ち間違いに気づいてもらうこと」であって、
 *   痩せすぎ・太りすぎを判定することではありません。
 *   だから幅は広く取ってあります。ここを狭めると、
 *   本当にその体重の人が記録できなくなります。
 */

describe('validateBodyMetrics', () => {
  it('未入力は通る', () => {
    expect(validateBodyMetrics({ weightKg: null, bodyFatPct: null })).toBeNull();
  });

  it('ふつうの値は通る', () => {
    expect(validateBodyMetrics({ weightKg: 53.4, bodyFatPct: 25.1 })).toBeNull();
  });

  it('体重は20〜300kg', () => {
    expect(validateBodyMetrics({ weightKg: 20, bodyFatPct: null })).toBeNull();
    expect(validateBodyMetrics({ weightKg: 300, bodyFatPct: null })).toBeNull();
    expect(validateBodyMetrics({ weightKg: 19.9, bodyFatPct: null })).toBe(
      '体重は20〜300kgの範囲で入力してください。',
    );
    expect(validateBodyMetrics({ weightKg: 534, bodyFatPct: null })).toBe(
      '体重は20〜300kgの範囲で入力してください。',
    );
  });

  it('体脂肪率は1〜70%', () => {
    expect(validateBodyMetrics({ weightKg: null, bodyFatPct: 1 })).toBeNull();
    expect(validateBodyMetrics({ weightKg: null, bodyFatPct: 70 })).toBeNull();
    expect(validateBodyMetrics({ weightKg: null, bodyFatPct: 0 })).toBe(
      '体脂肪率は1〜70%の範囲で入力してください。',
    );
    expect(validateBodyMetrics({ weightKg: null, bodyFatPct: 71 })).toBe(
      '体脂肪率は1〜70%の範囲で入力してください。',
    );
  });

  it('両方おかしいときは、体重のほうを先に伝える', () => {
    // 一度に2つ言われても直しにくいので、上から1つずつ出します
    expect(validateBodyMetrics({ weightKg: 999, bodyFatPct: 999 })).toBe(
      '体重は20〜300kgの範囲で入力してください。',
    );
  });
});
