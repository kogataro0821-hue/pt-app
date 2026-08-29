import { describe, expect, it } from 'vitest';
import { emptyExercise, validateExercise } from './exercisesRepo';

describe('validateExercise', () => {
  it('種目名が空なら止める', () => {
    expect(validateExercise(emptyExercise(0))).toBe('種目名を入力してください。');
    expect(validateExercise({ ...emptyExercise(0), name: '   ' })).toBe('種目名を入力してください。');
  });

  it('種目名だけあれば通る（時間は空でもよい）', () => {
    // 「45分やった」と覚えていない日でも記録できるようにしています
    expect(validateExercise({ ...emptyExercise(0), name: 'ランニング' })).toBeNull();
  });

  it('時間は0〜1440分（1日ぶん）まで', () => {
    const base = { ...emptyExercise(0), name: 'ランニング' };
    expect(validateExercise({ ...base, minutes: 0 })).toBeNull();
    expect(validateExercise({ ...base, minutes: 1440 })).toBeNull();
    expect(validateExercise({ ...base, minutes: 1441 })).toBe(
      '時間は0〜1440分の範囲で入力してください。',
    );
    expect(validateExercise({ ...base, minutes: -1 })).toBe(
      '時間は0〜1440分の範囲で入力してください。',
    );
  });
});

describe('emptyExercise', () => {
  it('渡された並び順を持ち、IDは毎回ちがう', () => {
    const a = emptyExercise(3);
    const b = emptyExercise(3);
    expect(a.order).toBe(3);
    expect(a.id).not.toBe(b.id);
  });
});
