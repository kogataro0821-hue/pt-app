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
    // ★ 500番台は「相手が混み合っている」として別に扱うようになったので、
    //   ここでは、こちらの要求が疑わしい番号を使います
    const e = await relayFailure(reply(403));
    expect(e.kind).toBe('unavailable');
    expect(e.detail).toContain('403');
  });
});

/**
 * ★ 中継役が返した理由を、画面に出す（追加仕様: 登録依頼のAI）。
 *
 *   番号だけだと「中継役の応答: 400」としか出ず、
 *   キーの問題なのか、要求の形の問題なのかが切り分けられません。
 *   実際、そのせいで原因が分からないまま何往復もしました。
 */
describe('★ 失敗の理由を画面に出す', () => {
  it('中継役が理由を返したら、番号と一緒に出す', async () => {
    const res = new Response(
      JSON.stringify({ error: 'rejected', status: 400, detail: 'Unknown name "nullable"' }),
      { status: 400 },
    );

    const err = await relayFailure(res);
    expect(err.detail).toContain('400');
    expect(err.detail).toContain('Unknown name');
  });

  it('理由が無ければ、いままでどおり番号だけ', async () => {
    const res = new Response(JSON.stringify({ error: 'rejected', status: 403 }), { status: 403 });
    const err = await relayFailure(res);
    expect(err.detail).toBe('中継役の応答: 403');
  });

  it('本文が読めなくても、落ちない', async () => {
    const res = new Response('これはJSONではありません', { status: 404 });
    const err = await relayFailure(res);
    expect(err.detail).toBe('中継役の応答: 404');
  });

  it('長すぎる理由は、切って出す', async () => {
    const res = new Response(JSON.stringify({ detail: 'あ'.repeat(2000) }), { status: 400 });
    const err = await relayFailure(res);
    expect((err.detail ?? '').length).toBeLessThan(400);
  });

  it('1日の上限のときは、いままでどおりの言い方（理由で上書きしない）', async () => {
    const res = new Response(JSON.stringify({ error: 'daily_limit_reached', limit: 50 }), {
      status: 429,
    });
    const err = await relayFailure(res);
    expect(err.kind).toBe('daily_limit');
  });
});

/**
 * ★ 429 が「1分あたり」か「1日あたり」かを言い分ける。
 *
 *   ここを捨てていたため、画面には「混み合っています」としか出ず、
 *   **待てば戻るのか、その日はもう駄目なのかが分かりませんでした。**
 *   10分待っても直らない、という形で表に出ました。
 */
describe('★ どちらの上限に当たったのかを言う', () => {
  const res429 = (detail: string) =>
    new Response(JSON.stringify({ error: 'rate_limited', detail }), { status: 429 });

  it('1日あたりなら、待っても無駄だと伝える', async () => {
    const err = await relayFailure(
      res429('{"error":{"details":[{"quotaId":"GenerateRequestsPerDayPerProject"}]}}'),
    );
    expect(err.kind).toBe('rate_limited');
    expect(err.detail).toContain('1日あたり');
    expect(err.detail).toContain('日付が変わるまで');
  });

  it('1分あたりなら、待てば戻ると伝える', async () => {
    const err = await relayFailure(
      res429('{"error":{"details":[{"quotaId":"GenerateRequestsPerMinutePerProject"}]}}'),
    );
    expect(err.detail).toContain('1分あたり');
    expect(err.detail).toContain('待つと戻ります');
  });

  it('両方書いてあるときは、待てば戻るほうを優先する', async () => {
    // ★ 分からないなら、まず待ってもらうほうが穏当です
    const err = await relayFailure(res429('perMinute and perDay quotas'));
    expect(err.detail).toContain('1分あたり');
  });

  it('★ 見分けが付かないときは、元の文をそのまま出す', async () => {
    // ★ 隠すより、分からない文でも出すほうがましです。こちらに送れます。
    const err = await relayFailure(res429('Resource has been exhausted'));
    expect(err.detail).toContain('Resource has been exhausted');
  });

  it('こちらで付けた1日の上限は、いままでどおりの言い方', async () => {
    const res = new Response(JSON.stringify({ error: 'daily_limit_reached', limit: 50 }), {
      status: 429,
    });
    const err = await relayFailure(res);
    expect(err.kind).toBe('daily_limit');
    expect(err.detail).toBe('1日50回まで');
  });

  it('理由が無ければ、いままでどおり', async () => {
    const res = new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 });
    const err = await relayFailure(res);
    expect(err.kind).toBe('rate_limited');
    expect(err.detail).toBeUndefined();
  });
});

/**
 * Gemini 側が混み合っているとき（追加仕様: 混み合いの伝え方）。
 *
 * ★ 画面に英語の JSON がそのまま出ていました。
 *
 *     AIに接続できませんでした。手で入力してください。
 *     （中継役の応答: 503 / { "error": { "code": 503, "message":
 *      "This model is currently experiencing high demand..." } }）
 *
 *   読んだ人には、**自分が何か壊したのか、待てば直るのかが分かりません。**
 *   これは Google 側が混んでいるだけで、こちらは何も間違えていません。
 */
describe('★ AI側が混み合っているとき', () => {
  it('503 は「混み合い」として扱う', async () => {
    const e = await relayFailure(reply(503, { error: { code: 503, status: 'UNAVAILABLE' } }));
    expect(e.kind).toBe('overloaded');
  });

  it('500・502・504 も同じ扱い', async () => {
    // ★ どれも相手側の一時的な不調です。こちらの要求が悪いわけではありません
    for (const status of [500, 502, 504]) {
      expect((await relayFailure(reply(status))).kind).toBe('overloaded');
    }
  });

  it('★ 生の中身を画面に出さない', async () => {
    // ★ ここが本体です。英語の JSON は、読んだ人に何も教えません
    const e = await relayFailure(
      reply(503, { error: { message: 'This model is currently experiencing high demand.' } }),
    );
    const shown = aiErrorMessage(e.kind, e.detail);

    expect(shown).not.toContain('high demand');
    expect(shown).not.toContain('{');
  });

  it('待てば戻ること、こちらの問題ではないことを書く', async () => {
    const e = await relayFailure(reply(503));
    const shown = aiErrorMessage(e.kind, e.detail);

    expect(shown).toContain('少し待って');
    expect(shown).toContain('こちらの設定の問題ではありません');
  });

  it('切り分け用に、番号だけは残す', async () => {
    // ★ 何も残さないと、今度は原因が追えなくなります
    const e = await relayFailure(reply(503));
    expect(aiErrorMessage(e.kind, e.detail)).toContain('503');
  });

  it('400 は、これまでどおり理由をそのまま出す', async () => {
    // ★ こちらの要求が悪い可能性があるので、中身が手がかりになります
    const e = await relayFailure(reply(400, { detail: 'Invalid JSON payload' }));
    expect(e.kind).toBe('unavailable');
  });
});
