import { describe, expect, it } from 'vitest';
import { AiError, aiErrorMessage, relayFailure } from './gemini';

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
    expect(aiErrorMessage('daily_limit')).toContain('手で入力');
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

// -----------------------------------------------------------------------------
// Phase 11E — 1日の上限（設計書 §7.6）
//
// ★ 中継役は、2つの理由で 429 を返します。
//     ・こちらで決めた1日の上限に達した … 翌日まで戻りません
//     ・Gemini 側が混み合っている       … 数分で戻ります
//   同じ言い方にすると、上限に達した人が、戻らないものを待ち続けます。
// -----------------------------------------------------------------------------

/** 中継役からの応答の代わり。 */
function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe('1日の上限と、混み合いを言い分ける', () => {
  it('上限に達したときは「日付が変わればまた使える」と伝える', () => {
    const msg = aiErrorMessage('daily_limit');
    expect(msg).toContain('日付が変わる');
    // ★ 数分待てば戻ると思わせない
    expect(msg).not.toContain('しばらく');
  });

  it('混み合いのときは、待てば戻ると伝える', () => {
    expect(aiErrorMessage('rate_limited')).toContain('しばらく');
    expect(aiErrorMessage('rate_limited')).not.toContain('日付');
  });
});

describe('中継役の断り方を読み分ける', () => {
  it('1日の上限に達した 429 は daily_limit', async () => {
    const e = await relayFailure(reply(429, { error: 'daily_limit_reached', limit: 50 }));
    expect(e.kind).toBe('daily_limit');
    // 何回までなのかも画面に出す（トレーナーが上限を上げる判断ができるように）
    expect(e.detail).toContain('50');
  });

  it('Gemini 側の混み合いの 429 は rate_limited', async () => {
    expect((await relayFailure(reply(429, { error: 'rate_limited' }))).kind).toBe('rate_limited');
  });

  it('429 の中身が読めないときは、混み合い扱いにする', async () => {
    // ★ 迷ったら「待てば戻る」ほうへ寄せます。
    //   戻らないと言って実は戻るより、害が小さいためです
    expect((await relayFailure(reply(429))).kind).toBe('rate_limited');
  });

  it('401 はログインし直し', async () => {
    expect((await relayFailure(reply(401))).kind).toBe('unauthenticated');
  });

  it('413 は、写真の画面でだけ「大きすぎます」と言う', async () => {
    expect((await relayFailure(reply(413), '写真が大きすぎます')).detail).toBe('写真が大きすぎます');
    // 文章の画面では、写真の話をしない
    expect((await relayFailure(reply(413))).detail).toContain('413');
  });

  it('そのほかは、状態番号を添えて返す（原因の切り分けのため）', async () => {
    const e = await relayFailure(reply(500));
    expect(e.kind).toBe('unavailable');
    expect(e.detail).toContain('500');
  });
});
