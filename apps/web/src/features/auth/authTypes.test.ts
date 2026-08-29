import { describe, expect, it } from 'vitest';
import { authErrorMessage, classifyAuthError } from './authTypes';

/**
 * ログインの失敗の伝え方（設計書 §6.2）。
 *
 * ★ 「IDが無い」と「パスワードが違う」を区別しません。
 *   区別すると、契約者IDが実在するかどうかを外から総当たりで調べられます。
 *   ここは親切さより、契約者IDを守るほうを取っています。
 */

describe('classifyAuthError', () => {
  it('IDが無い・パスワードが違う・形式が変、はすべて同じ扱いにする', () => {
    for (const code of [
      'auth/invalid-credential',
      'auth/wrong-password',
      'auth/user-not-found',
      'auth/invalid-email',
    ]) {
      expect(classifyAuthError(code)).toBe('invalidCredential');
    }
  });

  it('回数のかけすぎと通信の失敗は、別のものとして伝える', () => {
    expect(classifyAuthError('auth/too-many-requests')).toBe('tooManyRequests');
    expect(classifyAuthError('auth/network-request-failed')).toBe('network');
  });

  it('知らないコードは unknown', () => {
    expect(classifyAuthError('auth/internal-error')).toBe('unknown');
    expect(classifyAuthError('')).toBe('unknown');
  });
});

describe('authErrorMessage', () => {
  it('IDとパスワードのどちらが違うのかを書かない', () => {
    const msg = authErrorMessage('invalidCredential');
    expect(msg).toBe('IDまたはパスワードが違います。');
    expect(msg).not.toContain('存在しません');
    expect(msg).not.toContain('登録されていません');
  });

  it('4つの分類すべてに文言がある', () => {
    for (const kind of ['invalidCredential', 'tooManyRequests', 'network', 'unknown'] as const) {
      expect(authErrorMessage(kind).length).toBeGreaterThan(0);
    }
  });
});
