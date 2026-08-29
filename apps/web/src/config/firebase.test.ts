import { describe, expect, it } from 'vitest';
import { APP_NAME, clientIdToEmail, isFirebaseConfigured } from './firebase';

/**
 * 契約者ID → ログイン用のアドレス（設計書 §6.2）。
 *
 * ★ サーバーに問い合わせずに、その場で機械的に変換します。
 *   問い合わせる作りにすると、「そのIDは存在しますか」を
 *   外から何度でも聞けることになり、契約者IDの一覧が漏れます。
 */

describe('clientIdToEmail', () => {
  it('契約者IDにドメインを付けるだけ', () => {
    expect(clientIdToEmail('tanaka01')).toBe('tanaka01@pt-app.local');
  });

  it('大文字や前後の空白は、打ち間違いとして直す', () => {
    // ログイン画面で 'Tanaka01' と打っても入れるようにするためです
    expect(clientIdToEmail('  Tanaka01 ')).toBe('tanaka01@pt-app.local');
  });

  it('実在しないドメインを使う（メールは送られない）', () => {
    expect(clientIdToEmail('x')).toContain('@pt-app.local');
  });
});

describe('設定', () => {
  it('Firebase の接続情報が埋まっている', () => {
    expect(isFirebaseConfigured()).toBe(true);
  });

  it('アプリ名が決まっている', () => {
    expect(APP_NAME).toBe('PT Manager');
  });
});
