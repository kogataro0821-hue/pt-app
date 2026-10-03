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

/**
 * 運動記録の項目を増やした（追加仕様: 運動記録の項目）。
 *
 * ★ 守りたいのは2つです。
 *
 *   1. **古い記録が壊れないこと。** 以前は「内容」に
 *      「60kg 10回 3セット」と手で書いてもらっていました。
 *      置き場所を変えていないので、そのままメモとして読めます。
 *   2. **未入力と 0 を分けること。** 混ぜると、入れなかった欄が
 *      「0で記録した」として残ります。
 */
describe('★ 重量・カウント・セット', () => {
  it('新しく作ると、種目以外は全部 未入力', () => {
    // ★ 0 で埋めません。「0kgで挙げた」という記録になってしまいます
    const e = emptyExercise(0);
    expect(e.weight).toBeNull();
    expect(e.reps).toBeNull();
    expect(e.sets).toBeNull();
    expect(e.minutes).toBeNull();
  });

  it('未入力のままでも保存できる（種目だけ入っていればよい）', () => {
    const e = { ...emptyExercise(0), name: 'ランニング' };
    expect(validateExercise(e)).toBeNull();
  });

  it('時間だけ入れても通る（ランニングなど）', () => {
    const e = { ...emptyExercise(0), name: 'ランニング', minutes: 30 };
    expect(validateExercise(e)).toBeNull();
  });

  it('カウントとセットだけ入れても通る（自重の種目）', () => {
    const e = { ...emptyExercise(0), name: '懸垂', reps: 10, sets: 3 };
    expect(validateExercise(e)).toBeNull();
  });

  it('★ 0 は入れた値として扱う（未入力ではない）', () => {
    const e = { ...emptyExercise(0), name: 'ベンチプレス', weight: 0 };
    expect(validateExercise(e)).toBeNull();
    expect(e.weight).toBe(0);
  });

  it('種目が空なら、やはり止める', () => {
    expect(validateExercise({ ...emptyExercise(0), weight: 60 })).toContain('種目名');
  });

  it('★ ありえない値だけ止める', () => {
    // ★ 範囲は広めです。300kg は本当にありえます。
    //   狭くすると、本当にその値だった人が記録できなくなります
    const base = { ...emptyExercise(0), name: 'ベンチプレス' };

    expect(validateExercise({ ...base, weight: 300 })).toBeNull();
    expect(validateExercise({ ...base, weight: 1001 })).toContain('重量');
    expect(validateExercise({ ...base, weight: -1 })).toContain('重量');

    expect(validateExercise({ ...base, reps: 10001 })).toContain('カウント');
    expect(validateExercise({ ...base, sets: 101 })).toContain('セット');
    expect(validateExercise({ ...base, minutes: 1441 })).toContain('時間');
  });
});
