import { describe, expect, it } from 'vitest';
import { checkPlausibility, kcalFromPfc, type Per100g } from './plausible';

/**
 * 栄養値のありえなさ検査（追加仕様: 登録依頼のAI）。
 *
 * ★ ここはマスタの手前に置く関門です。
 *
 *   マスタの1件は、全契約者の集計に効きます。
 *   AIが返した数値を人の目だけで見ると、忙しい日に素通りします。
 *   計算で分かることは、計算で止めます。
 *
 * ★ 見ているのは「ありえるか」で、「正しいか」ではありません。
 *   白米が 156 か 168 かは、ここでは判断できません。
 */

function n(over: Partial<Per100g> = {}): Per100g {
  return { kcal: 156, p: 2.5, f: 0.3, c: 37.1, ...over };
}

describe('kcalFromPfc', () => {
  it('たんぱく質4・脂質9・炭水化物4 で計算する', () => {
    expect(kcalFromPfc({ p: 10, f: 10, c: 10 })).toBe(40 + 90 + 40);
  });

  it('すべて0なら0', () => {
    expect(kcalFromPfc({ p: 0, f: 0, c: 0 })).toBe(0);
  });
});

describe('辻褄が合っているとき', () => {
  it('白米は通る', () => {
    // 4*2.5 + 9*0.3 + 4*37.1 = 161.1。156 との差は 5.1kcal
    expect(checkPlausibility(n()).level).toBe('ok');
  });

  it('鶏むね肉（皮なし）は通る', () => {
    expect(checkPlausibility({ kcal: 105, p: 23.3, f: 1.9, c: 0.1 }).level).toBe('ok');
  });

  it('サラダ油は通る（脂質だけで900kcal近い）', () => {
    expect(checkPlausibility({ kcal: 885, p: 0, f: 100, c: 0 }).level).toBe('ok');
  });

  it('水は通る（すべて0）', () => {
    expect(checkPlausibility({ kcal: 0, p: 0, f: 0, c: 0 }).level).toBe('ok');
  });

  it('通ったときは、何も言わない', () => {
    expect(checkPlausibility(n()).reason).toBe('');
  });
});

describe('★ ありえないとき', () => {
  it('★ P+F+C が 100g を超えたら、ありえない', () => {
    // ★ 100g の中に 100g より多くは入りません。
    //   水分も灰分も0になってしまいます。
    const r = checkPlausibility({ kcal: 400, p: 50, f: 30, c: 40 });
    expect(r.level).toBe('impossible');
    expect(r.reason).toContain('100g を超えています');
  });

  it('ちょうど100gは、ありえる（サラダ油など）', () => {
    expect(checkPlausibility({ kcal: 900, p: 0, f: 100, c: 0 }).level).not.toBe('impossible');
  });

  it('★ 100gあたり900kcalを超えたら、ありえない', () => {
    // ★ いちばん高いのは純粋な脂質で900kcalです。それを超える食品はありません
    const r = checkPlausibility({ kcal: 950, p: 0, f: 100, c: 0 });
    expect(r.level).toBe('impossible');
    expect(r.reason).toContain('900');
  });

  it('マイナスの値は、ありえない', () => {
    expect(checkPlausibility(n({ p: -1 })).level).toBe('impossible');
    expect(checkPlausibility(n({ kcal: -10 })).level).toBe('impossible');
  });

  it('★ 中身が空なのに熱量だけあるのは、ありえない', () => {
    // ★ AIが名前だけ見て kcal を埋め、PFC を0のままにする形です
    const r = checkPlausibility({ kcal: 240, p: 0, f: 0, c: 0 });
    expect(r.level).toBe('impossible');
    expect(r.reason).toContain('すべて0');
  });

  it('ごくわずかな熱量なら、空でも許す（丸めの範囲）', () => {
    expect(checkPlausibility({ kcal: 2, p: 0, f: 0, c: 0 }).level).toBe('ok');
  });
});

describe('★ 辻褄が合わないとき（注意）', () => {
  it('★ kcal だけ大きく外れていたら、注意する', () => {
    // PFC からは 161kcal。そこに 400kcal は説明が付きません
    const r = checkPlausibility(n({ kcal: 400 }));
    expect(r.level).toBe('warn');
    expect(r.reason).toContain('確かめてください');
  });

  it('計算した値も一緒に出す（人が確かめられるように）', () => {
    const r = checkPlausibility(n({ kcal: 400 }));
    expect(r.computed).toBeCloseTo(161.1, 1);
    expect(r.gap).toBeCloseTo(238.9, 1);
  });

  it('★ 少しのずれでは、注意しない', () => {
    // ★ 厳しくしすぎると、正しい値まで警告だらけになります。
    //   警告だらけの画面では、本当の警告も読まれません。
    //   食物繊維・糖アルコール・アルコールで、この程度は普通にずれます。
    expect(checkPlausibility({ kcal: 180, p: 2.5, f: 0.3, c: 37.1 }).level).toBe('ok');
  });

  it('小さい値では、割合だけで警告しない', () => {
    // 10kcal と 15kcal は 50% 違いますが、実害のある差ではありません
    expect(checkPlausibility({ kcal: 15, p: 0, f: 0, c: 2.5 }).level).toBe('ok');
  });

  it('★ 注意止まりで、採用を止めはしない', () => {
    // ★ 成分表の値そのものが Atwater 係数と合わない食品があります。
    //   合わない＝間違い、ではありません。人が決められるようにします。
    expect(checkPlausibility(n({ kcal: 400 })).level).not.toBe('impossible');
  });
});
