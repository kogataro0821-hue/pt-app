import { describe, expect, it } from 'vitest';
import { summarize } from './ExercisesSection';

/**
 * 一覧に出す1行ぶんの言い方（追加仕様: 運動記録の項目）。
 *
 * ★ 守りたいのは1つだけです。**入れていない欄を書かないこと。**
 *
 *   「-」や「0」で埋めると、入れたのか入れていないのかが
 *   読み取れなくなります。トレーナーが見るのは、まさにそこです。
 *   「重量を入れ忘れている」のか「自重だから無い」のかで、
 *   かける言葉が変わります。
 */
describe('★ 入れたものだけ並べる', () => {
  it('3つそろえば、3つとも出る', () => {
    expect(summarize({ weight: 60, reps: 10, sets: 3 })).toBe('60kg × 10回 × 3セット');
  });

  it('★ 自重なら、重量を書かない', () => {
    // ★ 「0kg × 10回」と出ると、0kgで挙げたように読めます
    expect(summarize({ weight: null, reps: 10, sets: 3 })).toBe('10回 × 3セット');
  });

  it('重量だけでも出る', () => {
    expect(summarize({ weight: 60, reps: null, sets: null })).toBe('60kg');
  });

  it('セットだけでも出る', () => {
    expect(summarize({ weight: null, reps: null, sets: 3 })).toBe('3セット');
  });

  it('★ 何も入れていなければ、空のまま', () => {
    // ★ 空文字を返すので、呼ぶ側は行そのものを出しません
    expect(summarize({ weight: null, reps: null, sets: null })).toBe('');
  });

  it('★ 0 は書く（入れた値なので）', () => {
    // ★ 未入力と 0 は別ものです。0 と入れた人の記録は 0 のまま残します
    expect(summarize({ weight: 0, reps: 10, sets: null })).toBe('0kg × 10回');
  });

  it('小数も、そのまま出る', () => {
    // ★ 2.5kg刻みのプレートがあるので、小数は普通に出てきます
    expect(summarize({ weight: 2.5, reps: null, sets: null })).toBe('2.5kg');
  });
});
