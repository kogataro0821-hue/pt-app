import { describe, expect, it } from 'vitest';
import { QUOTES, quoteOfDay, quoteToText } from './quote';

/**
 * ログイン前に出す言葉（追加仕様: 導入の演出）。
 *
 * ★ 守りたいのは3つです。
 *
 *   1. 同じ日なら、必ず同じ言葉
 *   2. 日が変われば、別の言葉になること
 *   3. **自分を責めさせる言葉・極端を勧める言葉を入れないこと**
 */

describe('★ 同じ日なら、同じ言葉', () => {
  it('何度呼んでも変わらない', () => {
    // ★ 開くたびに変わると、くじを引いている感じになって
    //   言葉そのものが軽くなります
    const a = quoteOfDay('2026-09-17');
    for (let i = 0; i < 20; i += 1) {
      expect(quoteOfDay('2026-09-17')).toEqual(a);
    }
  });

  it('必ず、用意した中のどれか', () => {
    expect(QUOTES).toContain(quoteOfDay('2026-09-17'));
  });

  it('日付が変われば、だいたい別のものになる', () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 28; d += 1) {
      seen.add(quoteToText(quoteOfDay(`2026-09-${String(d).padStart(2, '0')}`)));
    }
    // 28日ぶんで、半分以上は違う言葉が出てほしい
    expect(seen.size).toBeGreaterThan(QUOTES.length / 2);
  });

  it('おかしな日付でも落ちない', () => {
    expect(QUOTES).toContain(quoteOfDay(''));
    expect(QUOTES).toContain(quoteOfDay('へんな文字'));
  });

  it('★ 次の日は、ほぼ別の言葉になる', () => {
    // ★ ここは実際に踏んだ穴です。
    //   最初は「文字コードを足して余りを取る」だけにしていて、
    //   日付が1日進んでもちょうど言葉の数ぶんずれるため、
    //   **次の日も同じ言葉**が出ていました。
    let same = 0;
    let days = 0;
    let prev: string | null = null;
    for (let m = 1; m <= 12; m += 1) {
      for (let d = 1; d <= 28; d += 1) {
        const key = `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const now = quoteToText(quoteOfDay(key));
        if (prev !== null) {
          days += 1;
          if (now === prev) same += 1;
        }
        prev = now;
      }
    }
    // 1年ぶんで、前日と同じになるのは1割未満であってほしい
    expect(same / days).toBeLessThan(0.1);
  });

  it('★ 1年のうちに、用意した言葉が全部出る', () => {
    const seen = new Set<string>();
    for (let m = 1; m <= 12; m += 1) {
      for (let d = 1; d <= 28; d += 1) {
        seen.add(quoteToText(quoteOfDay(`2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)));
      }
    }
    expect(seen.size).toBe(QUOTES.length);
  });

  it('★ どれも、ちょうど3行', () => {
    // ★ 行数がばらつくと、浮かび上がる間隔も画面の重心もずれます
    for (const q of QUOTES) expect(q).toHaveLength(3);
  });
});

describe('★ 言葉の中身', () => {
  it('ひとつ以上ある', () => {
    expect(QUOTES.length).toBeGreaterThan(0);
  });

  it('空の行が無い', () => {
    for (const q of QUOTES) for (const line of q) expect(line.trim().length).toBeGreaterThan(0);
  });

  it('同じ言葉が二重に入っていない', () => {
    expect(new Set(QUOTES.map(quoteToText)).size).toBe(QUOTES.length);
  });

  it('★ 句点（。）を使わない', () => {
    // ★ 短い一行の最後に丸が付くと、それだけで重く見えます。
    //   1文字ずつ浮かび上がる作りなので、最後の丸がよけいに目立ちます。
    //   文中に1つだけ残るのも浮くので、まるごと使いません。
    for (const q of QUOTES) for (const line of q) expect(line).not.toContain('。');
  });

  it('1行が長すぎない（画面からはみ出さない）', () => {
    // ★ 折り返されると、決めた切れ目が崩れます
    for (const q of QUOTES) for (const line of q) expect(line.length).toBeLessThanOrEqual(18);
  });

  it('★ 自分を責めさせる言い方を入れない', () => {
    // ★ 記録アプリを開くたびに責められるのは、続ける妨げになります。
    //   毎日目に入る場所なので、ここがいちばん気をつけるところです。
    const blame = ['甘え', '怠け', 'サボ', '言い訳', 'ダメな', '情けない', '逃げるな'];
    for (const q of QUOTES) {
      const text = quoteToText(q);
      for (const word of blame) expect(text).not.toContain(word);
    }
  });

  it('★ 極端を勧める言い方を入れない', () => {
    // ★ 絶食・限界まで・毎日必ず、のような煽りは、
    //   体を壊す方向にしか働きません
    const extreme = ['絶食', '抜け', '限界まで', '死ぬ', '吐く', '毎日必ず', '一切'];
    for (const q of QUOTES) {
      const text = quoteToText(q);
      for (const word of extreme) expect(text).not.toContain(word);
    }
  });

  it('★ 休んだ日を否定する言い方を入れない', () => {
    const deny = ['休むな', '休んだら終わり', '一日でも'];
    for (const q of QUOTES) {
      const text = quoteToText(q);
      for (const word of deny) expect(text).not.toContain(word);
    }
  });
});
