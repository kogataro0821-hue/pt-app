import { describe, expect, it } from 'vitest';
import { AiError, aiErrorMessage } from './gemini';

/**
 * AIが使えなかったときの伝え方。
 *
 * ★ どの場合でも「手で入力すればできる」と分かるようにしています。
 *   AIが動かない＝記録できない、と受け取られると、その日の記録が丸ごと止まります。
 */

describe('aiErrorMessage', () => {
  it('設定がまだのときは、契約者ではなくトレーナーに向ける', () => {
    // 契約者には直しようがないので、連絡先を示します
    expect(aiErrorMessage('not_configured')).toContain('トレーナー');
  });

  it('混んでいるとき・つながらないときは、手で入力できると伝える', () => {
    expect(aiErrorMessage('rate_limited')).toContain('手で入力');
    expect(aiErrorMessage('unavailable')).toContain('手で入力');
    expect(aiErrorMessage('invalid_output')).toContain('手で入力');
  });

  it('ログインが切れたときは、入力し直しではなくログインを促す', () => {
    expect(aiErrorMessage('unauthenticated')).toContain('ログイン');
  });

  it('通信の失敗は電波の話にする', () => {
    expect(aiErrorMessage('network')).toContain('電波');
  });

  it('細かい原因があれば、うしろに添える', () => {
    const msg = aiErrorMessage('unavailable', '502');
    expect(msg).toContain('手で入力');
    expect(msg).toContain('502');
  });

  it('細かい原因が無いときは、余計な括弧を付けない', () => {
    expect(aiErrorMessage('unavailable')).not.toContain('（');
  });
});

describe('AiError', () => {
  it('種類と、あれば詳細を持ち歩く', () => {
    const e = new AiError('rate_limited', '429');
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe('rate_limited');
    expect(e.detail).toBe('429');
  });
});
