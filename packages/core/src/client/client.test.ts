import { describe, expect, it } from 'vitest';
import { checkClientId, normalizeClientId } from './id';
import {
  DEFAULT_TARGETS,
  kcalFromMacros,
  macroMismatchWarning,
  targetsToNutrients,
  validateTargets,
  type Targets,
} from './targets';
import { toInternal } from '../nutrition/convert';

describe('契約者ID の検証（設計書 §6.2）', () => {
  it('ふつうのIDは通る', () => {
    for (const id of ['tanaka01', 'yamada', 'a1b2c3', 'user_2026', 'sato-t', 'k.suzuki']) {
      expect(checkClientId(id)).toEqual({ ok: true, id });
    }
  });

  it('大文字と前後の空白は自動で整える', () => {
    expect(checkClientId('  Tanaka01 ')).toEqual({ ok: true, id: 'tanaka01' });
    expect(normalizeClientId('  YAMADA  ')).toBe('yamada');
  });

  it('短すぎるIDは弾く', () => {
    expect(checkClientId('ab')).toEqual({ ok: false, reason: 'tooShort' });
  });

  it('長すぎるIDは弾く', () => {
    expect(checkClientId('a'.repeat(31))).toEqual({ ok: false, reason: 'tooLong' });
  });

  it('空は弾く', () => {
    expect(checkClientId('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('メールアドレスとして使えない文字は弾く', () => {
    for (const id of ['tanaka 01', 'tanaka@01', '田中01', 'tanaka+01', 'tanaka/01']) {
      const result = checkClientId(id);
      expect(result.ok).toBe(false);
    }
  });

  it('記号で始まるIDは弾く', () => {
    for (const id of ['_tanaka', '-tanaka', '.tanaka']) {
      expect(checkClientId(id)).toEqual({ ok: false, reason: 'startsWithSymbol' });
    }
  });

  it('予約語は弾く', () => {
    for (const id of ['admin', 'root', 'users', 'clients', 'config']) {
      expect(checkClientId(id)).toEqual({ ok: false, reason: 'reserved' });
    }
  });

  it('大文字で書いた予約語も弾く', () => {
    expect(checkClientId('ADMIN')).toEqual({ ok: false, reason: 'reserved' });
  });
});

describe('目標値の検証（設計書 §4）', () => {
  function targets(overrides: Partial<Targets> = {}): Targets {
    return { ...DEFAULT_TARGETS, ...overrides };
  }

  it('既定値は問題なし', () => {
    expect(validateTargets(DEFAULT_TARGETS)).toEqual([]);
  });

  it('極端なカロリーは弾く', () => {
    expect(validateTargets(targets({ kcal: 100 }))).toHaveLength(1);
    expect(validateTargets(targets({ kcal: 10000 }))).toHaveLength(1);
  });

  it('数字でない値は弾く', () => {
    expect(validateTargets(targets({ kcal: Number.NaN }))).toHaveLength(1);
  });

  it('体重・体脂肪率は未設定（null）でも通る', () => {
    expect(validateTargets(targets({ weightKg: null, bodyFatPct: null }))).toEqual([]);
  });

  it('体重が設定されていれば範囲を見る', () => {
    expect(validateTargets(targets({ weightKg: 5 }))).toHaveLength(1);
    expect(validateTargets(targets({ weightKg: 62.5 }))).toEqual([]);
  });

  it('複数の問題をまとめて返す', () => {
    const issues = validateTargets(targets({ kcal: 100, p: 999, f: 999 }));
    expect(issues.map((i) => i.field).sort()).toEqual(['f', 'kcal', 'p']);
  });
});

describe('PFCと目標カロリーの整合チェック', () => {
  it('P4 / F9 / C4 kcal で計算する', () => {
    expect(kcalFromMacros({ p: 100, f: 50, c: 200 })).toBe(100 * 4 + 50 * 9 + 200 * 4);
  });

  it('ズレが小さければ警告しない', () => {
    // P130 F50 C200 = 520 + 450 + 800 = 1770kcal（目標1800との差は約1.7%）
    expect(macroMismatchWarning(DEFAULT_TARGETS)).toBeNull();
  });

  it('ズレが大きければ警告する（エラーにはしない）', () => {
    const warning = macroMismatchWarning({ ...DEFAULT_TARGETS, kcal: 3000 });
    expect(warning).not.toBeNull();
    expect(warning).toContain('1770');
  });
});

describe('目標値を計算エンジンの表現に変換する', () => {
  it('内部表現（1/1000単位の整数）になる', () => {
    const nutrients = targetsToNutrients(DEFAULT_TARGETS);
    expect(nutrients).toEqual(toInternal({ kcal: 1800, p: 130, f: 50, c: 200 }));
    expect(nutrients.kcal).toBe(1_800_000);
    expect(nutrients.p).toBe(130_000);
  });
});
