import { describe, expect, it } from 'vitest';
import { guardRecognition, isEvidenceGrounded, normalizeForMatch } from './guard';
import type { MealRecognition, RecognizedItem } from './schemas';

function item(overrides: Partial<RecognizedItem> = {}): RecognizedItem {
  return {
    name: '白米',
    brand: null,
    productName: null,
    quantity: { value: 180, unit: 'g' },
    quantityStatus: 'estimated',
    quantityRange: null,
    cookingMethod: null,
    packageLabel: null,
    confidence: 0.9,
    evidence: '白米180g',
    needsUserInput: false,
    question: null,
    ...overrides,
  };
}

function recognition(items: RecognizedItem[]): MealRecognition {
  return { mealLabelSuggestion: null, items, unidentified: [], notes: [] };
}

describe('normalizeForMatch', () => {
  it('全角・半角と空白のゆれを吸収する', () => {
    expect(normalizeForMatch('白米 １８０ｇ')).toBe(normalizeForMatch('白米180g'));
  });
});

describe('isEvidenceGrounded', () => {
  it('原文に含まれていれば true', () => {
    expect(isEvidenceGrounded('白米180g', '朝は白米180gと卵を食べた')).toBe(true);
  });

  it('原文に無ければ false', () => {
    expect(isEvidenceGrounded('納豆1パック', '朝は白米180gと卵を食べた')).toBe(false);
  });

  it('空の根拠は false', () => {
    expect(isEvidenceGrounded('', '朝は白米180gを食べた')).toBe(false);
  });
});

describe('★ 設計書 §12: AIが報告されていない情報を足すのを防ぐ', () => {
  const source = '今日は徒歩で出勤した。朝は白米180gと卵1個。';

  it('原文にある食品は通す', () => {
    const result = guardRecognition(recognition([item()]), {
      minConfidence: 0.6,
      sourceText: source,
    });
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('原文に無い食品を勝手に足してきたら破棄する', () => {
    const hallucinated = item({ name: '納豆', evidence: '納豆1パック' });
    const result = guardRecognition(recognition([item(), hallucinated]), {
      minConfidence: 0.6,
      sourceText: source,
    });
    expect(result.accepted.map((i) => i.name)).toEqual(['白米']);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.item.name).toBe('納豆');
  });

  it('「徒歩出勤」から「徒歩帰宅」を推測してきたら破棄する', () => {
    const invented = item({ name: '徒歩帰宅', evidence: '徒歩で帰宅した' });
    const result = guardRecognition(recognition([invented]), {
      minConfidence: 0.6,
      sourceText: source,
    });
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
  });

  it('確信度が低いものは破棄せず「要確認」に回す', () => {
    const unsure = item({ confidence: 0.3 });
    const result = guardRecognition(recognition([unsure]), {
      minConfidence: 0.6,
      sourceText: source,
    });
    expect(result.flagged).toHaveLength(1);
    expect(result.accepted).toHaveLength(0);
  });

  it('ユーザーへの質問が必要なものは「要確認」に回す', () => {
    const asking = item({ needsUserInput: true, question: '白米は何gでしたか？' });
    const result = guardRecognition(recognition([asking]), {
      minConfidence: 0.6,
      sourceText: source,
    });
    expect(result.flagged).toHaveLength(1);
  });

  it('写真解析（原文なし）では根拠照合を行わず、確信度だけで判定する', () => {
    const result = guardRecognition(recognition([item({ evidence: '画像中央の茶碗' })]), {
      minConfidence: 0.6,
      sourceText: null,
    });
    expect(result.accepted).toHaveLength(1);
  });
});
