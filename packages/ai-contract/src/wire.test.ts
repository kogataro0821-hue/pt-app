import { describe, expect, it } from 'vitest';
import {
  PHOTO_MIN_CONFIDENCE,
  aiPhotoResultSchema,
  aiTextResultSchema,
  formatRange,
  toMealRecognition,
  toPhotoRecognition,
  toRecognizedItem,
  toRecognizedPhotoItem,
  type AiItem,
  type AiPhotoItem,
} from './wire';
import { guardRecognition } from './guard';

function item(overrides: Partial<AiItem> = {}): AiItem {
  return {
    name: '白米',
    amount: 180,
    unit: 'g',
    amountStated: true,
    confidence: 0.9,
    evidence: '白米180g',
    question: '',
    ...overrides,
  };
}

describe('AIの応答を取り込む', () => {
  it('gで書かれた量は、そのまま使える状態になる', () => {
    const out = toRecognizedItem(item());
    expect(out.quantity).toEqual({ value: 180, unit: 'g' });
    expect(out.needsUserInput).toBe(false);
    expect(out.quantityStatus).toBe('estimated');
  });

  // ★ ここが設計書 §12 / §39 の要。
  //   「1個」を勝手に「50g」に換算してしまうと、
  //   利用者が言っていない数字が記録として残る。
  it('個・杯などの単位は換算せず、利用者に聞く', () => {
    for (const unit of ['個', '枚', '本', '杯', '食', 'パック', '大さじ', '小さじ'] as const) {
      const out = toRecognizedItem(item({ name: 'たまご', amount: 2, unit }));
      expect(out.needsUserInput).toBe(true);
      expect(out.question).toContain('グラム');
      expect(out.quantityStatus).toBe('unknown');
    }
  });

  it('量が書かれていなければ、利用者に聞く', () => {
    const out = toRecognizedItem(item({ amount: 0, unit: 'unknown', amountStated: false }));
    expect(out.needsUserInput).toBe(true);
    expect(out.question).toContain('何グラム');
  });

  it('AIが用意した質問文があれば、それを使う', () => {
    const out = toRecognizedItem(
      item({ amountStated: false, question: 'ごはんは茶碗何杯ぶんでしたか？' }),
    );
    expect(out.question).toBe('ごはんは茶碗何杯ぶんでしたか？');
  });

  // ★ AIに栄養値を答えさせない設計なので、取り込んだ結果にも入らない。
  it('栄養値の情報は一切入らない', () => {
    const out = toRecognizedItem(item());
    expect(out.packageLabel).toBeNull();
    expect(out).not.toHaveProperty('kcal');
    expect(out).not.toHaveProperty('protein');
  });

  it('ブランド名や調理法を勝手に埋めない', () => {
    const out = toRecognizedItem(item());
    expect(out.brand).toBeNull();
    expect(out.productName).toBeNull();
    expect(out.cookingMethod).toBeNull();
  });
});

describe('スキーマの検証', () => {
  it('正しい応答を受け入れる', () => {
    const parsed = aiTextResultSchema.safeParse({
      items: [item()],
      unidentified: [],
      notes: [],
    });
    expect(parsed.success).toBe(true);
  });

  // ★ evidence が空だと、原文照合ができなくなる。必須にしてある。
  it('根拠が空の項目は受け付けない', () => {
    const parsed = aiTextResultSchema.safeParse({
      items: [item({ evidence: '' })],
      unidentified: [],
      notes: [],
    });
    expect(parsed.success).toBe(false);
  });

  it('名前が空の項目は受け付けない', () => {
    expect(
      aiTextResultSchema.safeParse({ items: [item({ name: '' })], unidentified: [], notes: [] })
        .success,
    ).toBe(false);
  });

  it('負の量は受け付けない', () => {
    expect(
      aiTextResultSchema.safeParse({ items: [item({ amount: -1 })], unidentified: [], notes: [] })
        .success,
    ).toBe(false);
  });

  // ★ 想定外の単位で応答全体を捨てると、正しい項目まで失われる。
  //   'unknown' に寄せて「何グラムでしたか」と聞く動きにする。
  it('知らない単位は unknown に寄せる（応答全体は捨てない）', () => {
    const parsed = aiTextResultSchema.safeParse({
      items: [{ ...item(), unit: '切れ' }],
      unidentified: [],
      notes: [],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.items[0]!.unit).toBe('unknown');
      // 単位が unknown なので、量は利用者に聞く
      expect(toRecognizedItem(parsed.data.items[0]!).needsUserInput).toBe(true);
    }
  });
});

describe('★ 勝手な補完を落とす（設計書 §12）', () => {
  const sourceText = '白米180gと鶏むね肉';

  it('原文にある根拠の項目は残る', () => {
    const recognition = toMealRecognition({
      items: [item(), item({ name: '鶏むね肉', amount: 0, unit: 'unknown', amountStated: false, evidence: '鶏むね肉' })],
      unidentified: [],
      notes: [],
    });
    const guard = guardRecognition(recognition, { minConfidence: 0.6, sourceText });
    expect(guard.rejected).toHaveLength(0);
    expect([...guard.accepted, ...guard.flagged]).toHaveLength(2);
  });

  // ★ 「サラダ」としか書いていないのに中身を分解してくる、という典型例。
  it('原文に無い根拠の項目は捨てる', () => {
    const recognition = toMealRecognition({
      items: [item(), item({ name: 'レタス', amount: 30, unit: 'g', evidence: 'サラダのレタス' })],
      unidentified: [],
      notes: [],
    });
    const guard = guardRecognition(recognition, { minConfidence: 0.6, sourceText });
    expect(guard.rejected).toHaveLength(1);
    expect(guard.rejected[0]!.item.name).toBe('レタス');
  });

  it('量が不明な項目は、確認待ちに回る', () => {
    const recognition = toMealRecognition({
      items: [item({ name: '鶏むね肉', amount: 0, unit: 'unknown', amountStated: false, evidence: '鶏むね肉' })],
      unidentified: [],
      notes: [],
    });
    const guard = guardRecognition(recognition, { minConfidence: 0.6, sourceText });
    expect(guard.accepted).toHaveLength(0);
    expect(guard.flagged).toHaveLength(1);
  });

  it('自信の低い項目も、確認待ちに回る', () => {
    const recognition = toMealRecognition({
      items: [item({ confidence: 0.2 })],
      unidentified: [],
      notes: [],
    });
    const guard = guardRecognition(recognition, { minConfidence: 0.6, sourceText });
    expect(guard.flagged).toHaveLength(1);
  });

  // 全角・半角や空白のゆれで、正しい項目まで捨ててしまわないこと。
  it('表記のゆれでは捨てない', () => {
    const recognition = toMealRecognition({
      items: [item({ evidence: '白米１８０ｇ' })],
      unidentified: [],
      notes: [],
    });
    const guard = guardRecognition(recognition, { minConfidence: 0.6, sourceText: '白米180gと鶏むね肉' });
    expect(guard.rejected).toHaveLength(0);
  });

  it('判別できなかった部分は、食品として登録されない', () => {
    const recognition = toMealRecognition({
      items: [],
      unidentified: ['なにか茶色いもの'],
      notes: [],
    });
    expect(recognition.items).toHaveLength(0);
    expect(recognition.unidentified[0]!.description).toBe('なにか茶色いもの');
  });
});

describe('★ 写真からの認識（設計書 §10 / §39）', () => {
  function photo(overrides: Partial<AiPhotoItem> = {}): AiPhotoItem {
    return {
      name: '白米',
      amountGrams: 180,
      amountMinGrams: 150,
      amountMaxGrams: 210,
      confidence: 0.85,
      evidence: '手前の茶碗に盛られた白いごはん',
      question: '',
      ...overrides,
    };
  }

  // ★ ここが写真解析の要。
  //   写真から分かるのは推定までなので、そのまま登録される経路を作らない。
  it('写真から来た項目は、例外なく人の確認を通す', () => {
    const out = toRecognizedPhotoItem(photo({ confidence: 0.99 }));
    expect(out.needsUserInput).toBe(true);
    expect(out.quantityStatus).toBe('estimated');
  });

  it('確信度が高くても confirmed にはならない', () => {
    const out = toRecognizedPhotoItem(photo({ confidence: 1 }));
    expect(out.quantityStatus).not.toBe('confirmed');
  });

  // ★ 「180g」と言い切らせず、幅で答えさせる。
  //   幅の広さが、そのまま自信の無さとして目に見える。
  it('推定の幅を保持する', () => {
    const out = toRecognizedPhotoItem(photo());
    expect(out.quantityRange).toEqual({ min: 150, max: 210 });
    expect(formatRange(out)).toBe('150〜210g');
  });

  it('上限と下限が逆でも正しい向きに直す', () => {
    const out = toRecognizedPhotoItem(photo({ amountMinGrams: 210, amountMaxGrams: 150 }));
    expect(out.quantityRange).toEqual({ min: 150, max: 210 });
  });

  it('幅が無ければ範囲を表示しない', () => {
    const out = toRecognizedPhotoItem(photo({ amountMinGrams: 180, amountMaxGrams: 180 }));
    expect(out.quantityRange).toBeNull();
    expect(formatRange(out)).toBeNull();
  });

  it('栄養値の情報は一切入らない', () => {
    const out = toRecognizedPhotoItem(photo());
    expect(out.packageLabel).toBeNull();
    expect(out.brand).toBeNull();
    expect(out.cookingMethod).toBeNull();
  });

  // 原文照合という後ろ盾が無いぶん、入口の閾値をテキストより高くしてある。
  it('写真の閾値は、テキストの閾値より厳しい', () => {
    expect(PHOTO_MIN_CONFIDENCE).toBeGreaterThan(0.6);
  });

  it('自信の低い項目は、写真の閾値で落ちる', () => {
    const recognition = toPhotoRecognition({
      items: [photo({ confidence: 0.7 })],
      unidentified: [],
      notes: [],
    });
    // 写真では原文が無いので sourceText は null（照合はしない）
    const guard = guardRecognition(recognition, {
      minConfidence: PHOTO_MIN_CONFIDENCE,
      sourceText: null,
    });
    expect(guard.accepted).toHaveLength(0);
    expect(guard.flagged).toHaveLength(1);
  });

  it('確信度が高くても、写真の項目は accepted に入らない', () => {
    const recognition = toPhotoRecognition({
      items: [photo({ confidence: 0.95 })],
      unidentified: [],
      notes: [],
    });
    const guard = guardRecognition(recognition, {
      minConfidence: PHOTO_MIN_CONFIDENCE,
      sourceText: null,
    });
    // needsUserInput が立っているので flagged に回る
    expect(guard.accepted).toHaveLength(0);
    expect(guard.flagged).toHaveLength(1);
  });

  it('特定できなかったものは、食品として登録されない', () => {
    const recognition = toPhotoRecognition({
      items: [],
      unidentified: ['奥の小鉢に入った茶色いもの'],
      notes: [],
    });
    expect(recognition.items).toHaveLength(0);
    expect(recognition.unidentified[0]!.description).toContain('小鉢');
  });

  it('スキーマ: 根拠が空の項目は受け付けない', () => {
    expect(
      aiPhotoResultSchema.safeParse({
        items: [photo({ evidence: '' })],
        unidentified: [],
        notes: [],
      }).success,
    ).toBe(false);
  });

  it('スキーマ: 負の量は受け付けない', () => {
    expect(
      aiPhotoResultSchema.safeParse({
        items: [photo({ amountGrams: -1 })],
        unidentified: [],
        notes: [],
      }).success,
    ).toBe(false);
  });
});
