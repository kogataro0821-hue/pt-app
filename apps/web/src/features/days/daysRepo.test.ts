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
    expect(validateBodyMetrics({ weightKg: null, bodyFatPct: null , muscleKg: null})).toBeNull();
  });

  it('ふつうの値は通る', () => {
    expect(validateBodyMetrics({ weightKg: 53.4, bodyFatPct: 25.1 , muscleKg: null})).toBeNull();
  });

  it('体重は20〜300kg', () => {
    expect(validateBodyMetrics({ weightKg: 20, bodyFatPct: null , muscleKg: null})).toBeNull();
    expect(validateBodyMetrics({ weightKg: 300, bodyFatPct: null , muscleKg: null})).toBeNull();
    expect(validateBodyMetrics({ weightKg: 19.9, bodyFatPct: null , muscleKg: null})).toBe(
      '体重は20〜300kgの範囲で入力してください。',
    );
    expect(validateBodyMetrics({ weightKg: 534, bodyFatPct: null , muscleKg: null})).toBe(
      '体重は20〜300kgの範囲で入力してください。',
    );
  });

  it('体脂肪率は1〜70%', () => {
    expect(validateBodyMetrics({ weightKg: null, bodyFatPct: 1 , muscleKg: null})).toBeNull();
    expect(validateBodyMetrics({ weightKg: null, bodyFatPct: 70 , muscleKg: null})).toBeNull();
    expect(validateBodyMetrics({ weightKg: null, bodyFatPct: 0 , muscleKg: null})).toBe(
      '体脂肪率は1〜70%の範囲で入力してください。',
    );
    expect(validateBodyMetrics({ weightKg: null, bodyFatPct: 71 , muscleKg: null})).toBe(
      '体脂肪率は1〜70%の範囲で入力してください。',
    );
  });

  it('両方おかしいときは、体重のほうを先に伝える', () => {
    // 一度に2つ言われても直しにくいので、上から1つずつ出します
    expect(validateBodyMetrics({ weightKg: 999, bodyFatPct: 999 , muscleKg: null})).toBe(
      '体重は20〜300kgの範囲で入力してください。',
    );
  });
});

/**
 * 筋肉量（追加仕様: 筋肉量）。
 *
 * ★ 体重と体脂肪率からは計算で出せません。
 *
 *   体脂肪率から分かるのは「除脂肪量」で、そこには骨も水分も含まれます。
 *   筋肉量は体組成計が別に出す数字なので、別の欄として持ちます。
 *   計算で出そうとすると、それらしいが違う数字になります。
 */
describe('★ 筋肉量', () => {
  it('ふつうの値は通る', () => {
    expect(validateBodyMetrics({ weightKg: 70, bodyFatPct: 18, muscleKg: 32 })).toBeNull();
  });

  it('未入力でもよい', () => {
    expect(validateBodyMetrics({ weightKg: 70, bodyFatPct: 18, muscleKg: null })).toBeNull();
  });

  it('筋肉量だけを入れてもよい（体重計を持っていない日もある）', () => {
    expect(validateBodyMetrics({ weightKg: null, bodyFatPct: null, muscleKg: 32 })).toBeNull();
  });

  it('極端に小さい値は、打ち間違いとして止める', () => {
    expect(validateBodyMetrics({ weightKg: 70, bodyFatPct: null, muscleKg: 3 })).toContain('筋肉量');
  });

  it('極端に大きい値も止める', () => {
    expect(validateBodyMetrics({ weightKg: 70, bodyFatPct: null, muscleKg: 200 })).toContain(
      '筋肉量',
    );
  });

  it('★ 筋肉量が体重を超えていたら、止める', () => {
    // ★ 体重70kgの人の筋肉量が75kg、はありえません。
    //   桁や小数点の打ち間違いが、いちばん起きやすい形です。
    const problem = validateBodyMetrics({ weightKg: 70, bodyFatPct: null, muscleKg: 75 });
    expect(problem).toContain('体重を超えています');
  });

  it('体重と同じ値は、止めない（境目で弾かない）', () => {
    expect(validateBodyMetrics({ weightKg: 70, bodyFatPct: null, muscleKg: 70 })).toBeNull();
  });

  it('体重が未入力なら、その比べ方はしない', () => {
    // ★ 比べる相手が無いのに止めると、体重を入れない日に筋肉量だけ残せません
    expect(validateBodyMetrics({ weightKg: null, bodyFatPct: null, muscleKg: 120 })).toBeNull();
  });
});
