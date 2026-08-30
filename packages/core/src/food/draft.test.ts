import { describe, expect, it } from 'vitest';
import {
  MAX_SUGGESTED_ALIASES,
  refineFoodDraft,
  type FoodDraftInput,
} from './draft';
import type { NameableFood } from './matching';

/**
 * AI が作った登録の下書きをふるう関門（追加仕様: 登録依頼のAI）。
 *
 * ★ ここが、この機能でいちばん大事な場所です。
 *
 *   マスタの1件は、全契約者の集計に効きます。
 *   AI が返したものを画面にそのまま出すと、人は「AIが言うなら」と通します。
 *   **機械で分かる嘘は、人に見せる前に落とします。**
 *
 * ★ 落とすときは、必ず理由を残します。
 *   黙って消すと、AIが何を言ったのか分からなくなります。
 */

function master(): NameableFood[] {
  return [
    { id: 'しろまい', name: '白米', aliases: ['ごはん', '白飯'] },
    { id: 'とりむね', name: '鶏むね肉', aliases: ['鶏ムネ肉'] },
    { id: 'さらだちきん', name: 'サラダチキン', aliases: [] },
  ];
}

function draft(over: Partial<FoodDraftInput> = {}): FoodDraftInput {
  return {
    per100g: { kcal: 105, p: 23.3, f: 1.9, c: 0.1 },
    confidence: 0.8,
    assumed: '皮なしの鶏むね肉（生）',
    aliases: [],
    sameAs: null,
    sameAsReason: '',
    ...over,
  };
}

describe('数値', () => {
  it('ありえる値は、そのまま通す', () => {
    const r = refineFoodDraft(draft(), master(), '蒸し鶏');
    expect(r.per100g).toEqual({ kcal: 105, p: 23.3, f: 1.9, c: 0.1 });
    expect(r.plausibility?.level).toBe('ok');
  });

  it('★ ありえない値は、画面にも出さない', () => {
    // ★ 出すと「まあ近いかも」で採用されます。理由だけを伝えます。
    const r = refineFoodDraft(
      draft({ per100g: { kcal: 400, p: 50, f: 30, c: 40 } }),
      master(),
      '謎の食品',
    );
    expect(r.per100g).toBeNull();
    expect(r.plausibility?.level).toBe('impossible');
    expect(r.plausibility?.reason).toContain('100g を超えています');
  });

  it('辻褄が怪しいだけなら、値は残して印を付ける', () => {
    const r = refineFoodDraft(
      draft({ per100g: { kcal: 400, p: 2.5, f: 0.3, c: 37.1 } }),
      master(),
      'なにか',
    );
    expect(r.per100g).not.toBeNull();
    expect(r.plausibility?.level).toBe('warn');
  });

  it('★ 「分からない」を、そのまま受け取る', () => {
    // ★ AIが分からないときに何か埋めるより、分からないと言うほうが上です
    const r = refineFoodDraft(draft({ per100g: null }), master(), 'なにか');
    expect(r.per100g).toBeNull();
    expect(r.plausibility).toBeNull();
  });
});

describe('★ 既存の食材とまとめる', () => {
  it('マスタにある名前なら、通す', () => {
    const r = refineFoodDraft(draft({ sameAs: '鶏むね肉' }), master(), '蒸し鶏');
    expect(r.sameAs).toBe('鶏むね肉');
    expect(r.sameAsDropped).toBeNull();
  });

  it('別名で返してきても、正しい名前に直す', () => {
    const r = refineFoodDraft(draft({ sameAs: '鶏ムネ肉' }), master(), '蒸し鶏');
    expect(r.sameAs).toBe('鶏むね肉');
  });

  it('★ マスタに無い名前は、捨てる', () => {
    // ★ ここが要です。AIは一覧に無い名前を平気で返します。
    //   そのまままとめると、存在しない食材へ寄せることになります。
    const r = refineFoodDraft(draft({ sameAs: '鶏胸肉（皮なし）' }), master(), '蒸し鶏');
    expect(r.sameAs).toBeNull();
    expect(r.sameAsDropped).toContain('マスタにありません');
  });

  it('捨てたときは、何を言われたのかを残す', () => {
    const r = refineFoodDraft(draft({ sameAs: 'ありえない食材' }), master(), '蒸し鶏');
    expect(r.sameAsDropped).toContain('ありえない食材');
  });

  it('まとめ先が無ければ null のまま', () => {
    const r = refineFoodDraft(draft({ sameAs: null }), master(), '蒸し鶏');
    expect(r.sameAs).toBeNull();
    expect(r.sameAsDropped).toBeNull();
  });

  it('空文字も、無しとして扱う', () => {
    const r = refineFoodDraft(draft({ sameAs: '  ' }), master(), '蒸し鶏');
    expect(r.sameAs).toBeNull();
    expect(r.sameAsDropped).toBeNull();
  });
});

describe('★ 別名', () => {
  it('新しい表記なら、通す', () => {
    const r = refineFoodDraft(draft({ aliases: ['むしどり', '蒸しどり'] }), master(), '蒸し鶏');
    expect(r.aliases).toEqual(['むしどり', '蒸しどり']);
  });

  it('★ 他の食材が使っている名前は、捨てる', () => {
    // ★ 入れると、その言葉がどちらの食材に当たるか決まらなくなります。
    //   マスタの引き当てが壊れる、いちばん静かな壊れ方です。
    const r = refineFoodDraft(draft({ aliases: ['ごはん', 'むしどり'] }), master(), '蒸し鶏');
    expect(r.aliases).toEqual(['むしどり']);
    expect(r.droppedAliases[0]?.name).toBe('ごはん');
    expect(r.droppedAliases[0]?.reason).toContain('白米');
  });

  it('いま登録する名前そのものは、別名にしない', () => {
    const r = refineFoodDraft(draft({ aliases: ['蒸し鶏', 'むしどり'] }), master(), '蒸し鶏');
    expect(r.aliases).toEqual(['むしどり']);
  });

  it('同じものを2回返してきても、1つにする', () => {
    const r = refineFoodDraft(draft({ aliases: ['むしどり', 'むしどり'] }), master(), '蒸し鶏');
    expect(r.aliases).toEqual(['むしどり']);
  });

  it('表記がゆれているだけの重複も、1つにする', () => {
    const r = refineFoodDraft(draft({ aliases: ['むし どり', 'むしどり'] }), master(), '蒸し鶏');
    expect(r.aliases).toHaveLength(1);
  });

  it(`★ ${MAX_SUGGESTED_ALIASES}個までしか採らない`, () => {
    // ★ 多いほど良さそうに見えますが、1つ間違えると別の食材に当たります。
    //   確かめられる数に絞ります。
    const many = ['あ1', 'い2', 'う3', 'え4', 'お5', 'か6', 'き7'];
    const r = refineFoodDraft(draft({ aliases: many }), master(), '蒸し鶏');
    expect(r.aliases).toHaveLength(MAX_SUGGESTED_ALIASES);
    expect(r.droppedAliases.length).toBeGreaterThan(0);
  });

  it('空文字や空白だけのものは、黙って飛ばす', () => {
    const r = refineFoodDraft(draft({ aliases: ['', '   ', 'むしどり'] }), master(), '蒸し鶏');
    expect(r.aliases).toEqual(['むしどり']);
  });

  it('★ 捨てた別名は、理由と一緒に残す', () => {
    // ★ 黙って消すと、AIが何を言ったのか分からなくなります。
    //   「白米が使っているから捨てた」と分かれば、人が判断し直せます。
    const r = refineFoodDraft(draft({ aliases: ['白飯'] }), master(), '蒸し鶏');
    expect(r.aliases).toEqual([]);
    expect(r.droppedAliases).toEqual([
      { name: '白飯', reason: 'すでに「白米」が使っています。' },
    ]);
  });
});

describe('そのまま持ち越すもの', () => {
  it('自信の度合いと、何として答えたかは、そのまま出す', () => {
    const r = refineFoodDraft(
      draft({ confidence: 0.35, assumed: 'コンビニの調理済み鶏肉' }),
      master(),
      '蒸し鶏',
    );
    expect(r.confidence).toBe(0.35);
    expect(r.assumed).toBe('コンビニの調理済み鶏肉');
  });
});

describe('マスタが空のとき', () => {
  it('別名はすべて通り、まとめ先は無しになる', () => {
    const r = refineFoodDraft(draft({ aliases: ['ごはん'], sameAs: '白米' }), [], '蒸し鶏');
    expect(r.aliases).toEqual(['ごはん']);
    expect(r.sameAs).toBeNull();
  });
});
