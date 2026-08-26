import { toInternal } from '../nutrition/convert';
import type { Nutrients } from '../nutrition/types';

/**
 * 契約者ごとの目標値（設計書 §4）。
 *
 * ★ Firestore には「人間の単位」（kcal / g / %）で保存します。
 *   コンソールから覗いたときに読めるほうが、運用上ずっと安全だからです。
 *   計算に使うときは targetsToNutrients() で内部表現に変換します。
 */
export interface Targets {
  /** 1日の目標カロリー（kcal） */
  kcal: number;
  /** たんぱく質（g） */
  p: number;
  /** 脂質（g） */
  f: number;
  /** 炭水化物（g） */
  c: number;
  /** 目標体重（kg）。設定しない場合は null */
  weightKg: number | null;
  /** 目標体脂肪率（%）。設定しない場合は null */
  bodyFatPct: number | null;
  /** 運動目標。「週3回 / 1回45分」など自由記述（設計書 §4） */
  exercise: string;
}

export const DEFAULT_TARGETS: Targets = {
  kcal: 1800,
  p: 130,
  f: 50,
  c: 200,
  weightKg: null,
  bodyFatPct: null,
  exercise: '',
};

/** 計算エンジンに渡すための内部表現へ変換する。 */
export function targetsToNutrients(targets: Targets): Nutrients {
  return toInternal({ kcal: targets.kcal, p: targets.p, f: targets.f, c: targets.c });
}

// -----------------------------------------------------------------------------
// 入力の検証
// -----------------------------------------------------------------------------

export type TargetField = 'kcal' | 'p' | 'f' | 'c' | 'weightKg' | 'bodyFatPct';

export interface TargetIssue {
  field: TargetField;
  message: string;
}

/** 各項目の妥当な範囲。極端な値を弾いて、入力ミスに気づけるようにする。 */
const RANGES: Record<TargetField, { min: number; max: number; label: string; unit: string }> = {
  kcal: { min: 500, max: 6000, label: '目標カロリー', unit: 'kcal' },
  p: { min: 0, max: 500, label: 'たんぱく質', unit: 'g' },
  f: { min: 0, max: 300, label: '脂質', unit: 'g' },
  c: { min: 0, max: 800, label: '炭水化物', unit: 'g' },
  weightKg: { min: 20, max: 300, label: '目標体重', unit: 'kg' },
  bodyFatPct: { min: 1, max: 60, label: '目標体脂肪率', unit: '%' },
};

/**
 * 目標値を検証する。
 *
 * ここでは「明らかな入力ミス」だけを弾きます。
 * PFCとカロリーの整合（4/9/4kcal換算）はあえて強制しません。
 * トレーナーが意図的にずらすことがあるためです。代わりに §注意 として警告だけ返します。
 */
export function validateTargets(targets: Targets): TargetIssue[] {
  const issues: TargetIssue[] = [];

  for (const field of ['kcal', 'p', 'f', 'c'] as const) {
    issues.push(...checkRange(field, targets[field]));
  }
  if (targets.weightKg !== null) issues.push(...checkRange('weightKg', targets.weightKg));
  if (targets.bodyFatPct !== null) issues.push(...checkRange('bodyFatPct', targets.bodyFatPct));

  return issues;
}

function checkRange(field: TargetField, value: number): TargetIssue[] {
  const range = RANGES[field];
  if (!Number.isFinite(value)) {
    return [{ field, message: `${range.label}を数字で入力してください。` }];
  }
  if (value < range.min || value > range.max) {
    return [
      {
        field,
        message: `${range.label}は ${range.min}〜${range.max}${range.unit} の範囲で入力してください。`,
      },
    ];
  }
  return [];
}

/**
 * PFC から計算したカロリーと、目標カロリーのズレ。
 *
 * たんぱく質 4kcal/g、脂質 9kcal/g、炭水化物 4kcal/g で計算します。
 * 大きくズレている場合は入力ミスの可能性があるので、画面で注意を出すために使います。
 * ★ エラーにはしません。意図的にずらす運用もあり得るためです。
 */
export function kcalFromMacros(targets: Pick<Targets, 'p' | 'f' | 'c'>): number {
  return targets.p * 4 + targets.f * 9 + targets.c * 4;
}

/** 目標カロリーと PFC の差が 10% を超えていれば警告する。 */
export function macroMismatchWarning(targets: Targets): string | null {
  const calculated = kcalFromMacros(targets);
  if (targets.kcal <= 0) return null;

  const diff = Math.abs(calculated - targets.kcal);
  if (diff / targets.kcal <= 0.1) return null;

  return `PFCから計算すると約${Math.round(calculated)}kcalですが、目標カロリーは${targets.kcal}kcalです。意図した設定であればそのままで構いません。`;
}
