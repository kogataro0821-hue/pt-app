import { describe, expect, it } from 'vitest';
import {
  AI_CONSENT_VERSION,
  DEFAULT_PERMISSIONS,
  NO_CONSENT,
  REVIEW_MODES,
  emptyClient,
  hasValidAiConsent,
  reviewModeLabel,
  sexLabel,
  todayInJst,
} from './clientTypes';

describe('hasValidAiConsent', () => {
  it('同意していなければ false', () => {
    expect(hasValidAiConsent(NO_CONSENT)).toBe(false);
  });

  it('いまの版に同意していれば true', () => {
    expect(hasValidAiConsent({ granted: true, updatedAt: 1, version: AI_CONSENT_VERSION })).toBe(
      true,
    );
  });

  it('古い版への同意は無効になる', () => {
    // ★ ここが要点です。
    //   説明文を書き換えたのに古い同意が生き続けると、
    //   「読んでいない内容に同意したことになっている」状態ができます。
    //   版を上げたら取り直す、を機械的に守らせます。
    expect(
      hasValidAiConsent({ granted: true, updatedAt: 1, version: AI_CONSENT_VERSION - 1 }),
    ).toBe(false);
  });

  it('新しい版への同意は有効なまま（版を上げても既存の同意を壊さない）', () => {
    expect(
      hasValidAiConsent({ granted: true, updatedAt: 1, version: AI_CONSENT_VERSION + 1 }),
    ).toBe(true);
  });
});

describe('emptyClient', () => {
  it('作りたてはログインできない状態（provisioning）で始まる', () => {
    // 途中で失敗したものを「使える契約者」として一覧に出さないための印です
    const c = emptyClient('tanaka01');
    expect(c.provisionStatus).toBe('provisioning');
    expect(c.authUid).toBeNull();
  });

  it('パスワードは未変更、AIは未同意で始まる', () => {
    const c = emptyClient('tanaka01');
    expect(c.passwordChangedAt).toBeNull();
    expect(hasValidAiConsent(c.aiConsent)).toBe(false);
  });

  it('既定の目標と権限が入る', () => {
    const c = emptyClient('tanaka01');
    expect(c.targets.kcal).toBe(1800);
    expect(c.targets.p).toBe(130);
    expect(c.permissions).toEqual(DEFAULT_PERMISSIONS);
    expect(c.reviewMode).toBe('standard');
  });

  it('目標と権限は使い回さず、契約者ごとに別の入れ物になる', () => {
    // 同じオブジェクトを共有していると、1人の目標を変えたとき
    // 別の契約者の目標まで変わります
    const a = emptyClient('a01');
    const b = emptyClient('b01');
    a.targets.kcal = 9999;
    a.permissions.pastEditWindowDays = 0;
    expect(b.targets.kcal).toBe(1800);
    expect(b.permissions.pastEditWindowDays).toBe(7);
  });

  it('既定では有効なアカウント', () => {
    expect(emptyClient('tanaka01').active).toBe(true);
  });
});

describe('過去を直せる期間の既定値', () => {
  it('7日', () => {
    // 説明書にも「既定は7日」と書いてあります。両方が同時にずれないよう固定します。
    expect(DEFAULT_PERMISSIONS.pastEditWindowDays).toBe(7);
  });
});

describe('表示用のことば', () => {
  it('性別', () => {
    expect(sexLabel('female')).toBe('女性');
    expect(sexLabel('male')).toBe('男性');
    expect(sexLabel('unspecified')).toBe('未設定');
  });

  it('評価のトーンは4つあり、すべてに名前が付いている', () => {
    expect(REVIEW_MODES).toHaveLength(4);
    for (const mode of REVIEW_MODES) {
      expect(reviewModeLabel(mode.value)).toBe(mode.label);
      expect(mode.description.length).toBeGreaterThan(0);
    }
  });

  it('トーンの並びは やさしめ → 標準 → 辛口 → 非常に辛口', () => {
    // 画面の並び順そのものです。入れ替わると、選び間違いが起きます。
    expect(REVIEW_MODES.map((m) => m.value)).toEqual([
      'gentle',
      'standard',
      'strict',
      'very_strict',
    ]);
  });
});

describe('todayInJst', () => {
  it('yyyy-MM-dd の形で返す', () => {
    expect(todayInJst()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
