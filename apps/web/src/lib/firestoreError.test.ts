import { describe, expect, it } from 'vitest';
import { isPermissionDenied, readErrorMessage, writeErrorMessage } from './firestoreError';

/**
 * Firestore の失敗を、原因の分かる日本語にする。
 *
 * ★ ここは実際に時間を溶かしたところです。
 *
 *   Rules をコンソールに貼り直し忘れていたのに、画面には
 *   「通信状態を確認してください」と出ていました。通信を疑って探し回ることになります。
 *   権限で断られたときは、**貼り直しのことを画面に書く**。それをここで固定します。
 */

const denied = { code: 'permission-denied' };
const offline = { code: 'unavailable' };

describe('isPermissionDenied', () => {
  it('権限で断られたときだけ true', () => {
    expect(isPermissionDenied(denied)).toBe(true);
    expect(isPermissionDenied(offline)).toBe(false);
    expect(isPermissionDenied(new Error('なにか'))).toBe(false);
    expect(isPermissionDenied(null)).toBe(false);
    expect(isPermissionDenied(undefined)).toBe(false);
    expect(isPermissionDenied('permission-denied')).toBe(false);
  });
});

describe('readErrorMessage', () => {
  it('権限で断られたら、Rules の貼り直しを画面で案内する', () => {
    const msg = readErrorMessage(denied, '登録依頼');
    expect(msg).toContain('登録依頼');
    expect(msg).toContain('権限がありません');
    expect(msg).toContain('firebase/firestore.rules');
    expect(msg).toContain('公開');
  });

  it('通信が届かないときは、通信の話だけをする', () => {
    const msg = readErrorMessage(offline, '食品マスタ');
    expect(msg).toContain('通信状態');
    expect(msg).not.toContain('rules');
  });

  it('原因が分からないときは、通信のせいだと決めつけない', () => {
    const msg = readErrorMessage(new Error('？'), '食品マスタ');
    expect(msg).toContain('時間をおいて');
    expect(msg).not.toContain('通信状態');
  });

  it('何を読もうとしたかが、必ず文中に入る', () => {
    for (const what of ['登録依頼', '食品マスタ', 'コメント', 'AI評価']) {
      expect(readErrorMessage(offline, what)).toContain(what);
    }
  });
});

describe('writeErrorMessage', () => {
  it('権限で断られたら、こちらも貼り直しを案内する', () => {
    const msg = writeErrorMessage(denied, 'コメント');
    expect(msg).toContain('保存する権限がありません');
    expect(msg).toContain('firebase/firestore.rules');
  });

  it('読むときの文言とは別のことばを使う（どちらで失敗したか分かるように）', () => {
    expect(writeErrorMessage(offline, '写真')).toContain('保存できませんでした');
    expect(readErrorMessage(offline, '写真')).toContain('読み込めませんでした');
  });
});
