import { describe, expect, it } from 'vitest';
import {
  REVIEW_MAX_LENGTH,
  checkReviewText,
  reviewRejectionMessage,
  type ReviewRejection,
} from './safety';

describe('ふつうの評価文は通る', () => {
  it('できている点と改善点を述べた文章', () => {
    const r = checkReviewText(
      'たんぱく質は目標に届いています。よく続いていますね。' +
        '脂質がやや多めなので、次は揚げ物を1食分減らすと目標に近づきます。',
    );
    expect(r.ok).toBe(true);
    expect(r.matched).toEqual([]);
  });

  it('厳しめの言い方でも、中身が食事と運動なら通る', () => {
    expect(
      checkReviewText(
        '炭水化物が目標を大きく超えています。このままでは目標に届きません。' +
          '夜の主食を半分にしてください。',
      ).ok,
    ).toBe(true);
  });

  // ★ 「疲れ」「むくみ」まで止めると、食事指導の当たり前の会話ができなくなる。
  it('体調にふれる程度の言葉は止めない', () => {
    expect(checkReviewText('疲れが出やすい時期です。睡眠と食事のリズムを整えましょう。').ok).toBe(
      true,
    );
  });
});

// ★ ここがこの検査の目的。
//   トレーナーは医師ではないので、診断・治療に踏み込んだ文章を契約者に届けない。
describe('医療に踏み込んだ文章は止める', () => {
  it.each([
    '糖尿病のリスクがあります。',
    'この食事は高血圧につながります。',
    '一度受診をおすすめします。',
    '医師の指示にしたがってください。',
    '血糖値が上がりやすい食べ方です。',
    'コレステロール値に注意が必要です。',
    'サプリメントを飲むとよいでしょう。',
  ])('%s', (text) => {
    const r = checkReviewText(`よく頑張っています。${text}この調子で続けましょう。`);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('medical');
    expect(r.matched.length).toBeGreaterThan(0);
  });
});

// ★ 厳しく言うことと、危ないことを勧めることは違う。
//   「非常に辛口」モードがあるぶん、ここは要る。
describe('体に負担のかかるやり方は止める', () => {
  it.each([
    '明日は断食しましょう。',
    '夕食は一切食べないでください。',
    '水だけで過ごしてみてください。',
    '炭水化物を極端に減らしてください。',
  ])('%s', (text) => {
    const r = checkReviewText(`目標を超えています。${text}`);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('harmful');
  });

  // ★ 両方に当てはまるときは、危険なほうを先に出す。
  //   管理者が最初に読む理由が、深刻なほうになるように。
  it('両方に当てはまるときは危険なほうを理由にする', () => {
    expect(checkReviewText('糖尿病が心配なので断食してください。').reason).toBe('harmful');
  });
});

describe('中身が無い・長すぎる', () => {
  it('空文字は止める', () => {
    expect(checkReviewText('').reason).toBe('empty');
  });

  it('空白だけも止める', () => {
    expect(checkReviewText('　　\n  ').reason).toBe('empty');
  });

  it('短すぎるものは生成に失敗したとみなす', () => {
    expect(checkReviewText('はい').reason).toBe('empty');
  });

  // ★ 異常に長い応答は、モデルが暴走している兆候でもある。
  it('長すぎるものは止める', () => {
    expect(checkReviewText('あ'.repeat(REVIEW_MAX_LENGTH + 1)).reason).toBe('too-long');
  });

  it('上限ちょうどは通る', () => {
    expect(checkReviewText('あ'.repeat(REVIEW_MAX_LENGTH)).ok).toBe(true);
  });
});

describe('止めた理由の説明', () => {
  it.each<ReviewRejection>(['medical', 'harmful', 'empty', 'too-long'])(
    '%s に文言がある',
    (reason) => {
      expect(reviewRejectionMessage(reason).length).toBeGreaterThan(10);
    },
  );

  it('医療の説明には、このアプリが何をしないかが書いてある', () => {
    expect(reviewRejectionMessage('medical')).toContain('診断');
  });
});
