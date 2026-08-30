import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSign, webcrypto } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { extractSpkiFromCertificate, pemToArrayBuffer, verifyFirebaseToken } from './worker.js';

/**
 * ★ AI中継役の入口の検証（設計書 §9.2）。
 *
 * この Worker は、外部の部品を一切読み込まない方針で書いています
 * （Cloudflare の管理画面に貼り付けるだけで動くようにするため）。
 * そのぶん、証明書から公開鍵を取り出す処理も、トークンの検証も自前です。
 *
 * ここが甘いと、URLを知った誰でも AI の無料枠を使えてしまいます。
 * 自分で書いた security の要なので、CI で毎回検証します。
 *
 * 本物の Firebase の鍵は使えないので、その場で作った証明書で試します。
 * 検証の仕組みは同じです。
 */

const PROJECT = 'pt-app-test';
let dir: string;
let certPem: string;
let keyPem: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pt-worker-'));
  // 使い捨ての鍵と証明書。テストが終われば消えます。
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048',
    '-keyout', join(dir, 'key.pem'),
    '-out', join(dir, 'cert.pem'),
    '-days', '1', '-nodes', '-subj', '/CN=test',
  ]);
  certPem = readFileSync(join(dir, 'cert.pem'), 'utf8');
  keyPem = readFileSync(join(dir, 'key.pem'), 'utf8');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// -----------------------------------------------------------------------------

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/** Firebase が発行するのと同じ形のトークンを、テスト用の鍵で作る。 */
function makeToken(overrides: Record<string, unknown> = {}, kid = 'test-kid'): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: 'user-123',
    iat: now - 60,
    exp: now + 3600,
    ...overrides,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(keyPem);

  return `${signingInput}.${signature.toString('base64url')}`;
}

/** Google の公開鍵一覧の代わりを返す。 */
function stubKeyEndpoint(keys: Record<string, string>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      headers: new Map([['Cache-Control', 'max-age=3600']]) as unknown as Headers,
      json: async () => keys,
    })),
  );
}

// -----------------------------------------------------------------------------

describe('証明書から公開鍵を取り出す', () => {
  // ★ ここを間違えると、署名の検証が常に失敗する（または、もっと悪いことに、
  //   別の鍵で検証してしまう）。openssl の出力と1バイト単位で突き合わせます。
  it('openssl が出力する公開鍵と完全に一致する', () => {
    const expected = execFileSync('openssl', ['x509', '-pubkey', '-noout', '-in', join(dir, 'cert.pem')])
      .toString()
      .replace(/-----[^-]+-----/g, '')
      .replace(/\s/g, '');

    const got = Buffer.from(pemToArrayBuffer(certPem)).toString('base64');
    expect(got).toBe(expected);
  });

  it('取り出した鍵は WebCrypto で読み込める', async () => {
    const key = await webcrypto.subtle.importKey(
      'spki',
      pemToArrayBuffer(certPem),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    expect((key.algorithm as RsaHashedKeyAlgorithm).modulusLength).toBe(2048);
  });

  it('証明書でないものを渡すと例外になる', () => {
    expect(() => extractSpkiFromCertificate(new Uint8Array([1, 2, 3]))).toThrow();
  });
});

describe('★ ログイン証明の検証（ここが甘いとAI枠を他人に使われる）', () => {
  beforeAll(() => {
    stubKeyEndpoint({ 'test-kid': certPem });
  });

  it('正しいトークンは通り、利用者IDが取れる', async () => {
    await expect(verifyFirebaseToken(makeToken(), PROJECT)).resolves.toBe('user-123');
  });

  // ★ 一番危ないのがこれ。中身を書き換えたトークンを通してはいけない。
  it('中身を書き換えたトークンは拒否される', async () => {
    const token = makeToken();
    const [h, , s] = token.split('.');
    const forged = JSON.stringify({
      iss: `https://securetoken.google.com/${PROJECT}`,
      aud: PROJECT,
      sub: 'attacker',
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    await expect(verifyFirebaseToken(`${h}.${b64url(forged)}.${s}`, PROJECT)).rejects.toThrow();
  });

  it('署名が壊れたトークンは拒否される', async () => {
    const token = makeToken();
    const [h, p] = token.split('.');
    await expect(verifyFirebaseToken(`${h}.${p}.AAAA`, PROJECT)).rejects.toThrow();
  });

  it('別のプロジェクト宛のトークンは拒否される', async () => {
    await expect(verifyFirebaseToken(makeToken({ aud: 'other-project' }), PROJECT)).rejects.toThrow(
      /audience/,
    );
  });

  it('発行元が違うトークンは拒否される', async () => {
    await expect(
      verifyFirebaseToken(makeToken({ iss: 'https://evil.example.com' }), PROJECT),
    ).rejects.toThrow(/issuer/);
  });

  it('期限切れのトークンは拒否される', async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    await expect(verifyFirebaseToken(makeToken({ exp: past }), PROJECT)).rejects.toThrow(/expired/);
  });

  it('未来に発行されたトークンは拒否される', async () => {
    const future = Math.floor(Date.now() / 1000) + 10_000;
    await expect(verifyFirebaseToken(makeToken({ iat: future }), PROJECT)).rejects.toThrow(/future/);
  });

  it('利用者IDが無いトークンは拒否される', async () => {
    await expect(verifyFirebaseToken(makeToken({ sub: '' }), PROJECT)).rejects.toThrow();
  });

  // ★ alg を none にして署名検証を素通りさせる、という古典的な攻撃。
  it('署名方式を none に変えたトークンは拒否される', async () => {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT', kid: 'test-kid' }));
    const payload = b64url(
      JSON.stringify({
        iss: `https://securetoken.google.com/${PROJECT}`,
        aud: PROJECT,
        sub: 'attacker',
        iat: now - 60,
        exp: now + 3600,
      }),
    );
    await expect(verifyFirebaseToken(`${header}.${payload}.`, PROJECT)).rejects.toThrow(/algorithm/);
  });

  it('知らない鍵IDのトークンは拒否される', async () => {
    await expect(verifyFirebaseToken(makeToken({}, 'unknown-kid'), PROJECT)).rejects.toThrow(
      /unknown key/,
    );
  });

  it('形が壊れたトークンは拒否される', async () => {
    await expect(verifyFirebaseToken('not-a-token', PROJECT)).rejects.toThrow(/malformed/);
  });

  it('プロジェクトが設定されていなければ、そもそも通さない', async () => {
    await expect(verifyFirebaseToken(makeToken(), '')).rejects.toThrow(/not configured/);
  });
});

// =============================================================================
// Phase 11D — 入口そのものの検証
//
// ★ ここまでのテストは、トークンの検証（verifyFirebaseToken）だけを見ていました。
//   実際に外から叩かれるのは fetch ハンドラのほうで、そこには1件もありませんでした。
//
//   このWorkerのURLは公開情報です。知られる前提で守る必要があります。
//   守りが1枚でも抜けると、あなたのAI枠を他人に使われ、
//   無料枠が尽きて契約者全員のAIが止まります。
// =============================================================================

import worker, { countUse, dailyLimit, todayInJst, byteLength } from './worker.js';

const GOOGLE_KEYS =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

const API_KEY = 'SECRET-GEMINI-KEY-do-not-leak';

function env(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    GEMINI_API_KEY: API_KEY,
    FIREBASE_PROJECT: PROJECT,
    ALLOWED_ORIGIN: 'https://example.github.io',
    ...over,
  };
}

interface UpstreamReply {
  ok?: boolean;
  status?: number;
  body?: string;
  throws?: boolean;
}

/** 記録された、Gemini への呼び出し */
let calls: { url: string; init?: RequestInit }[] = [];

/**
 * 外への通信を、まとめて偽物に差し替える。
 *
 * ★ Google の鍵置き場と Gemini の2か所へ出ていきます。
 *   URLで振り分けて、どちらも本物には触らせません。
 */
function stubNetwork(upstream: UpstreamReply = {}) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });

      if (String(url).startsWith(GOOGLE_KEYS)) {
        return {
          ok: true,
          headers: new Map([['Cache-Control', 'max-age=3600']]) as unknown as Headers,
          json: async () => ({ 'test-kid': certPem }),
        };
      }

      if (upstream.throws === true) throw new Error('network down');

      return {
        ok: upstream.ok ?? true,
        status: upstream.status ?? 200,
        text: async () => upstream.body ?? '{"candidates":[]}',
        json: async () => JSON.parse(upstream.body ?? '{"models":[]}'),
      };
    }),
  );
}

function post(token: string | null, body = '{"contents":[]}'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return new Request('https://relay.example.workers.dev/', { method: 'POST', headers, body });
}

describe('★ AI中継役の入口（このURLは公開情報）', () => {
  describe('ログイン証明が無い・おかしい依頼は通さない', () => {
    it('Authorization が無ければ 401', async () => {
      stubNetwork();
      const res = await worker.fetch(post(null), env());
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: 'missing_token' });
    });

    it('Bearer が付いていなければ 401', async () => {
      stubNetwork();
      const req = new Request('https://relay.example.workers.dev/', {
        method: 'POST',
        headers: { Authorization: makeToken() },
        body: '{}',
      });
      expect((await worker.fetch(req, env())).status).toBe(401);
    });

    it('中身を書き換えたトークンは 401', async () => {
      stubNetwork();
      const [h, , s] = makeToken().split('.');
      const forged = b64url(
        JSON.stringify({
          iss: `https://securetoken.google.com/${PROJECT}`,
          aud: PROJECT,
          sub: 'attacker',
          iat: Math.floor(Date.now() / 1000) - 60,
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      );
      const res = await worker.fetch(post(`${h}.${forged}.${s}`), env());
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: 'invalid_token' });
    });

    it('期限切れのトークンは 401', async () => {
      stubNetwork();
      const res = await worker.fetch(
        post(makeToken({ exp: Math.floor(Date.now() / 1000) - 10 })),
        env(),
      );
      expect(res.status).toBe(401);
    });

    it('別のプロジェクト宛のトークンは 401', async () => {
      stubNetwork();
      expect((await worker.fetch(post(makeToken({ aud: 'other' })), env())).status).toBe(401);
    });

    it('通らなかった依頼は、Gemini まで届かない', async () => {
      // ★ ここが要です。門で止まっていなければ、AI枠は使われます。
      stubNetwork();
      await worker.fetch(post(null), env());
      await worker.fetch(post('garbage'), env());
      expect(calls.filter((c) => c.url.includes('generativelanguage'))).toHaveLength(0);
    });
  });

  describe('APIキーが外に出ないこと', () => {
    it('鍵はURLに付き、返事の本文には出てこない', async () => {
      stubNetwork({ body: '{"candidates":[{"text":"ok"}]}' });
      const res = await worker.fetch(post(makeToken()), env());

      const sent = calls.find((c) => c.url.includes('generativelanguage'));
      expect(sent?.url).toContain(`key=${API_KEY}`);
      expect(await res.text()).not.toContain(API_KEY);
    });

    it('Gemini が失敗しても、鍵は返事に混ざらない', async () => {
      // 上流のエラー本文をそのまま返すと、鍵が混ざることがあります
      stubNetwork({
        ok: false,
        status: 400,
        body: `{"error":{"message":"API key not valid: ${API_KEY}"}}`,
      });
      const res = await worker.fetch(post(makeToken()), env());
      const text = await res.text();

      expect(res.status).toBe(400);
      expect(text).not.toContain(API_KEY);
      expect(JSON.parse(text)).toMatchObject({ error: 'rejected' });
    });

    it('Cloudflare のログにも、鍵は残らない', async () => {
      // ★ ここは実際に見つかった漏れ道です。
      //
      //   Gemini はキーが不正なとき、エラー文にキーを入れて返します。
      //   その本文をそのままログに書いていたので、キーが平文で残っていました。
      //
      //   しかも起きるのは「キーがおかしいとき」＝ログを見て人に相談する場面です。
      //   画面を撮って送った先に、キーごと渡ります。
      stubNetwork({
        ok: false,
        status: 400,
        body: `{"error":{"message":"API key not valid: ${API_KEY}"}}`,
      });
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await worker.fetch(post(makeToken()), env());

      const written = log.mock.calls.map((c) => String(c[0])).join('\n');
      expect(written).not.toContain(API_KEY);
      // 伏せたうえで、原因を追えるだけの情報は残す
      expect(written).toContain('400');
      expect(written).toContain('user-123');
      log.mockRestore();
    });

    it('鍵が長くても、切り詰めのすき間から漏れない', async () => {
      // 500文字で切る処理があります。切ってから伏せると、
      // 切れ目でキーが半分になり、前半だけが残ります
      stubNetwork({
        ok: false,
        status: 400,
        body: `{"error":{"message":"${'x'.repeat(480)} ${API_KEY}"}}`,
      });
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await worker.fetch(post(makeToken()), env());

      const written = log.mock.calls.map((c) => String(c[0])).join('\n');
      expect(written).not.toContain(API_KEY);
      expect(written).not.toContain(API_KEY.slice(0, 12));
      log.mockRestore();
    });

    it('動作確認の画面にも、鍵は出てこない', async () => {
      stubNetwork({ body: '{"models":[{"name":"models/gemini-2.5-flash","supportedGenerationMethods":["generateContent"]}]}' });
      const res = await worker.fetch(
        new Request('https://relay.example.workers.dev/', { method: 'GET' }),
        env(),
      );
      expect(await res.text()).not.toContain(API_KEY);
    });
  });

  describe('上流の失敗を、種類ごとに伝える', () => {
    it('429 は混み合いとして伝える', async () => {
      stubNetwork({ ok: false, status: 429, body: '{"error":"quota"}' });
      const res = await worker.fetch(post(makeToken()), env());
      expect(res.status).toBe(429);
      expect(await res.json()).toMatchObject({ error: 'rate_limited' });
    });

    it('500番台は「つながらない」として伝える', async () => {
      stubNetwork({ ok: false, status: 503, body: '{}' });
      expect(await (await worker.fetch(post(makeToken()), env())).json()).toMatchObject({
        error: 'unavailable',
      });
    });

    it('400番台は「断られた」として伝える', async () => {
      stubNetwork({ ok: false, status: 400, body: '{}' });
      expect(await (await worker.fetch(post(makeToken()), env())).json()).toMatchObject({
        error: 'rejected',
      });
    });

    it('そもそも届かなければ 502', async () => {
      stubNetwork({ throws: true });
      const res = await worker.fetch(post(makeToken()), env());
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ error: 'upstream_unreachable' });
    });

    it('どのモデルで失敗したかを返す（設定間違いの切り分けのため）', async () => {
      stubNetwork({ ok: false, status: 404, body: '{}' });
      const res = await worker.fetch(post(makeToken()), env({ GEMINI_MODEL: 'gemini-9-ultra' }));
      expect(await res.json()).toMatchObject({ model: 'gemini-9-ultra' });
    });
  });

  describe('うまくいったとき', () => {
    it('Gemini の返事を、そのまま返す', async () => {
      const body = '{"candidates":[{"content":{"parts":[{"text":"講評"}]}}]}';
      stubNetwork({ body });
      const res = await worker.fetch(post(makeToken()), env());
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(body);
    });

    it('送った本文を、そのまま上流へ渡す', async () => {
      stubNetwork();
      const body = '{"contents":[{"role":"user","parts":[{"text":"白米180g"}]}]}';
      await worker.fetch(post(makeToken(), body), env());
      expect(calls.find((c) => c.url.includes('generativelanguage'))?.init?.body).toBe(body);
    });

    it('設定したモデルを使う', async () => {
      stubNetwork();
      await worker.fetch(post(makeToken()), env({ GEMINI_MODEL: 'gemini-2.5-pro' }));
      expect(calls.find((c) => c.url.includes('generativelanguage'))?.url).toContain(
        'models/gemini-2.5-pro:generateContent',
      );
    });

    it('モデルの設定が無ければ、既定のモデルを使う', async () => {
      stubNetwork();
      await worker.fetch(post(makeToken()), env({ GEMINI_MODEL: undefined }));
      expect(calls.find((c) => c.url.includes('generativelanguage'))?.url).toContain(
        'models/gemini-2.5-flash:generateContent',
      );
    });

    it('記録に残すのは誰が使ったかと大きさだけ。食事の中身は残さない', async () => {
      // ★ Cloudflare のログに食事の内容が残ると、
      //   「AIには最小限だけ渡す」と決めた意味が無くなります
      stubNetwork();
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await worker.fetch(
        post(makeToken(), '{"contents":[{"parts":[{"text":"焼肉とビール"}]}]}'),
        env(),
      );

      const written = log.mock.calls.map((c) => String(c[0])).join('\n');
      expect(written).toContain('user-123');
      expect(written).not.toContain('焼肉');
      log.mockRestore();
    });
  });

  describe('入口の作法', () => {
    it('OPTIONS には 204 と、通信を許す印を返す', async () => {
      stubNetwork();
      const res = await worker.fetch(
        new Request('https://relay.example.workers.dev/', { method: 'OPTIONS' }),
        env(),
      );
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.github.io');
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('POST でも GET でも OPTIONS でもない依頼は 405', async () => {
      stubNetwork();
      for (const method of ['DELETE', 'PUT', 'PATCH']) {
        const res = await worker.fetch(
          new Request('https://relay.example.workers.dev/', { method }),
          env(),
        );
        expect(res.status).toBe(405);
      }
    });

    it('断るときにも、通信を許す印を付ける（画面にエラーが出るように）', async () => {
      // ★ これが無いと、ブラウザは応答そのものを読めず、
      //   画面には原因の分からない失敗しか出ません
      stubNetwork();
      const res = await worker.fetch(post(null), env());
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.github.io');
    });

    it('大きすぎる本文は 413 で止める', async () => {
      stubNetwork();
      const huge = 'x'.repeat(2_000_001);
      const res = await worker.fetch(post(makeToken(), huge), env());
      expect(res.status).toBe(413);
      expect(calls.filter((c) => c.url.includes('generativelanguage'))).toHaveLength(0);
    });

    it('鍵が設定されていなければ、通信せずに 500', async () => {
      stubNetwork();
      const res = await worker.fetch(post(makeToken()), env({ GEMINI_API_KEY: undefined }));
      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({ error: 'server_not_configured' });
      expect(calls.filter((c) => c.url.includes('generativelanguage'))).toHaveLength(0);
    });

    it('動作確認の画面は、鍵が無ければ理由を返す', async () => {
      stubNetwork();
      const res = await worker.fetch(
        new Request('https://relay.example.workers.dev/', { method: 'GET' }),
        env({ GEMINI_API_KEY: undefined }),
      );
      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({ ok: false });
    });

    it('動作確認の画面は、使えるモデルの一覧を返す', async () => {
      stubNetwork({
        body: JSON.stringify({
          models: [
            { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
          ],
        }),
      });
      const res = await worker.fetch(
        new Request('https://relay.example.workers.dev/', { method: 'GET' }),
        env(),
      );
      const data = (await res.json()) as { ok: boolean; usableModels: string[] };
      expect(data.ok).toBe(true);
      // 文章を作れないモデルは省く（選んでも動かないため）
      expect(data.usableModels).toEqual(['models/gemini-2.5-flash']);
    });
  });
});

// =============================================================================
// Phase 11E — 使いすぎを止める（設計書 §7.6）
//
// ★ ここは「攻撃を防ぐ壁」ではありません。門番はトークンの検証のほうです。
//   受け止めるのは、通ってよい人が使いすぎることです。
//   不具合による繰り返し、連打、盗まれた端末からの1時間。
//   結果はどれも「無料枠が尽きて、翌日まで全員のAIが止まる」です。
//
// ★ 設計書は3か所で「1日50回まで」と書いていましたが、
//   Phase 11D の点検で、**数える処理がどこにも無い**ことが分かりました。
//   ここがそのやり直しです。
// =============================================================================

/** Workers KV の代わり。中身はただの Map です。 */
function fakeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const puts: { key: string; value: string; ttl: number | undefined }[] = [];
  return {
    store,
    puts,
    get: async (key: string): Promise<string | null> => store.get(key) ?? null,
    put: async (key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> => {
      puts.push({ key, value, ttl: opts?.expirationTtl });
      store.set(key, value);
    },
  };
}

/** 応答しなくなった KV。 */
function brokenKv() {
  return {
    get: async (): Promise<string> => {
      throw new Error('kv down');
    },
    put: async (): Promise<void> => {
      throw new Error('kv down');
    },
  };
}

describe('日付の変わり目（日本時間）', () => {
  // ★ 世界標準時のままだと、日本の朝9時に回数が戻ります。
  //   利用者から見れば「昼前に急に使えるようになる」ので、日本時間に合わせます。
  it('日本の午前0時で、翌日になる', () => {
    expect(todayInJst(Date.parse('2026-08-28T14:59:59Z'))).toBe('2026-08-28');
    expect(todayInJst(Date.parse('2026-08-28T15:00:00Z'))).toBe('2026-08-29');
  });

  it('日本の朝9時（世界標準時の午前0時）では、日付は変わらない', () => {
    expect(todayInJst(Date.parse('2026-08-29T00:00:00Z'))).toBe('2026-08-29');
  });
});

describe('1日に使える回数の設定', () => {
  it('設定が無ければ 50 回', () => {
    expect(dailyLimit({})).toBe(50);
  });

  it('設定した回数を使う（コードを貼り直さずに変えられる）', () => {
    expect(dailyLimit({ DAILY_LIMIT: '200' })).toBe(200);
  });

  it('おかしな値は既定に戻す（0や空文字で全員止まらないように）', () => {
    for (const bad of ['0', '-5', 'たくさん', '', undefined]) {
      expect(dailyLimit({ DAILY_LIMIT: bad })).toBe(50);
    }
  });
});

describe('本文の大きさは、文字数ではなくバイト数で見る', () => {
  // ★ ここは間違えていました。`body.length` は文字の数です。
  //   日本語は1文字3バイトなので、上限2,000,000は
  //   実際には約6MBまで通っていました。
  it('日本語1文字は3バイトと数える', () => {
    expect(byteLength('あ')).toBe(3);
    expect(byteLength('abc')).toBe(3);
  });

  it('文字数では収まるが、バイト数では超える本文は 413 で止まる', async () => {
    stubNetwork();
    // 700,000文字 = 2,100,000バイト。文字数で見ていた頃は通っていました
    const res = await worker.fetch(post(makeToken(), 'あ'.repeat(700_000)), env());
    expect(res.status).toBe(413);
    expect(calls.filter((c) => c.url.includes('generativelanguage'))).toHaveLength(0);
  });
});

describe('回数を数える', () => {
  it('使うたびに1つ増える', async () => {
    const kv = fakeKv();
    expect(await countUse({ RATE_LIMIT: kv }, 'u1')).toMatchObject({ allowed: true, used: 1 });
    expect(await countUse({ RATE_LIMIT: kv }, 'u1')).toMatchObject({ allowed: true, used: 2 });
  });

  it('上限に達したら止める', async () => {
    const kv = fakeKv({ [`use:u1:${todayInJst()}`]: '50' });
    expect(await countUse({ RATE_LIMIT: kv }, 'u1')).toMatchObject({ allowed: false, used: 50 });
  });

  it('ちょうど上限の1つ手前までは通る', async () => {
    const kv = fakeKv({ [`use:u1:${todayInJst()}`]: '49' });
    expect(await countUse({ RATE_LIMIT: kv }, 'u1')).toMatchObject({ allowed: true, used: 50 });
  });

  it('人ごとに別々に数える（誰かが使い切っても、他の人は使える）', async () => {
    const kv = fakeKv({ [`use:u1:${todayInJst()}`]: '50' });
    expect(await countUse({ RATE_LIMIT: kv }, 'u1')).toMatchObject({ allowed: false });
    expect(await countUse({ RATE_LIMIT: kv }, 'u2')).toMatchObject({ allowed: true, used: 1 });
  });

  it('日付ごとに別々に数える（昨日ぶんは持ち越さない）', async () => {
    const kv = fakeKv({ 'use:u1:2020-01-01': '50' });
    expect(await countUse({ RATE_LIMIT: kv }, 'u1')).toMatchObject({ allowed: true, used: 1 });
  });

  it('数え札には期限を付ける（放っておいても溜まらない）', async () => {
    const kv = fakeKv();
    await countUse({ RATE_LIMIT: kv }, 'u1');
    expect(kv.puts[0]?.ttl).toBeGreaterThan(60 * 60 * 24);
  });

  it('壊れた値が入っていても、0から数え直す', async () => {
    const kv = fakeKv({ [`use:u1:${todayInJst()}`]: 'こわれた' });
    expect(await countUse({ RATE_LIMIT: kv }, 'u1')).toMatchObject({ allowed: true, used: 1 });
  });

  // --- ここから「数えられないとき」------------------------------------------
  //
  // ★ 数えられないときは通します。止めません。
  //   ここで守っているのは無料枠であって、利用者のデータではありません。
  //   KVの結び付け忘れでAIが全員使えなくなるのは、行き過ぎです。

  it('KV が結び付けられていなければ、数えないが、止めもしない', async () => {
    expect(await countUse({}, 'u1')).toMatchObject({ allowed: true, counted: false });
  });

  it('KV が応答しなくても、止めない', async () => {
    expect(await countUse({ RATE_LIMIT: brokenKv() }, 'u1')).toMatchObject({
      allowed: true,
      counted: false,
    });
  });
});

describe('★ 入口で、使いすぎを止める', () => {
  it('上限内なら通り、回数が増える', async () => {
    stubNetwork();
    const kv = fakeKv();
    const res = await worker.fetch(post(makeToken()), env({ RATE_LIMIT: kv }));
    expect(res.status).toBe(200);
    expect(kv.store.get(`use:user-123:${todayInJst()}`)).toBe('1');
  });

  it('上限に達したら 429 で断る', async () => {
    stubNetwork();
    const kv = fakeKv({ [`use:user-123:${todayInJst()}`]: '50' });
    const res = await worker.fetch(post(makeToken()), env({ RATE_LIMIT: kv }));

    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'daily_limit_reached', limit: 50 });
  });

  it('上限に達したら、Gemini まで届かない', async () => {
    // ★ ここが要です。429を返していても、その前に上流を叩いていたら
    //   無料枠は減り続けます。呼び出しの記録が0回であることを直接見ます。
    stubNetwork();
    const kv = fakeKv({ [`use:user-123:${todayInJst()}`]: '50' });
    await worker.fetch(post(makeToken()), env({ RATE_LIMIT: kv }));
    expect(calls.filter((c) => c.url.includes('generativelanguage'))).toHaveLength(0);
  });

  it('Gemini の混み合い（429）とは、別の名前で伝える', async () => {
    // ★ 同じ429でも、意味が違います。
    //   混み合いは数分で戻り、上限は翌日まで戻りません。
    //   区別が付かないと、使い切った人が一日じゅう押し続けます。
    stubNetwork({ ok: false, status: 429, body: '{"error":"quota"}' });
    const busy = await worker.fetch(post(makeToken()), env({ RATE_LIMIT: fakeKv() }));
    expect(await busy.json()).toMatchObject({ error: 'rate_limited' });

    stubNetwork();
    const over = await worker.fetch(
      post(makeToken()),
      env({ RATE_LIMIT: fakeKv({ [`use:user-123:${todayInJst()}`]: '50' }) }),
    );
    expect(await over.json()).toMatchObject({ error: 'daily_limit_reached' });
  });

  it('上限で断ったことは、記録に残る（壊れたのか使い切ったのかが分かるように）', async () => {
    stubNetwork();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await worker.fetch(
      post(makeToken()),
      env({ RATE_LIMIT: fakeKv({ [`use:user-123:${todayInJst()}`]: '50' }) }),
    );

    const written = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(written).toContain('daily_limit');
    expect(written).toContain('user-123');
    log.mockRestore();
  });

  it('設定で上限を変えられる（コードを貼り直さずに）', async () => {
    stubNetwork();
    const kv = fakeKv({ [`use:user-123:${todayInJst()}`]: '50' });
    const res = await worker.fetch(post(makeToken()), env({ RATE_LIMIT: kv, DAILY_LIMIT: '200' }));
    expect(res.status).toBe(200);
  });

  it('門で止められた人は、回数を消費しない', async () => {
    // ★ トークンが無い依頼で回数が減ると、
    //   外から叩かれるだけで契約者が使えなくなります
    stubNetwork();
    const kv = fakeKv();
    await worker.fetch(post(null), env({ RATE_LIMIT: kv }));
    await worker.fetch(post('garbage'), env({ RATE_LIMIT: kv }));
    expect(kv.puts).toHaveLength(0);
  });

  it('鍵が設定されていないときは、回数を消費しない', async () => {
    // 設定が済んでいないせいで失敗した回数を、上限に数えたくない
    stubNetwork();
    const kv = fakeKv();
    await worker.fetch(post(makeToken()), env({ RATE_LIMIT: kv, GEMINI_API_KEY: undefined }));
    expect(kv.puts).toHaveLength(0);
  });

  it('KV を結び付け忘れていても、アプリは今までどおり動く', async () => {
    stubNetwork();
    const res = await worker.fetch(post(makeToken()), env());
    expect(res.status).toBe(200);
  });

  it('動作確認の画面に、数えているかどうかが出る', async () => {
    // ★ 結び付け忘れに気づける場所は、ここしかありません
    const models = JSON.stringify({ models: [] });

    stubNetwork({ body: models });
    const off = await worker.fetch(
      new Request('https://relay.example.workers.dev/', { method: 'GET' }),
      env(),
    );
    expect(JSON.stringify(await off.json())).toContain('数えていません');

    stubNetwork({ body: models });
    const on = await worker.fetch(
      new Request('https://relay.example.workers.dev/', { method: 'GET' }),
      env({ RATE_LIMIT: fakeKv(), DAILY_LIMIT: '120' }),
    );
    expect(JSON.stringify(await on.json())).toContain('120');
  });
});

/**
 * ★ 失敗の理由を、伏せ字にして返す（追加仕様: 登録依頼のAI）。
 *
 *   以前は返していませんでした。キーが漏れるのを避けるためです。
 *   ところが画面には「中継役の応答: 400」としか出ず、
 *   **原因が分からないまま何往復もする**ことになりました。実際になりました。
 *
 *   伏せ方を「形で消す」ようにしたので、返しても安全になりました。
 *   こちらが知らないキーでも、Google のキーの形をしていれば消えます。
 */
describe('★ 失敗の理由を返す（ただし伏せ字にして）', () => {
  it('理由が本文に入る', async () => {
    stubNetwork({
      ok: false,
      status: 400,
      body: '{"error":{"message":"Invalid JSON payload received. Unknown name \\"nullable\\""}}',
    });

    const res = await worker.fetch(post(makeToken()), env());
    const body = (await res.json()) as { detail?: string };

    expect(res.status).toBe(400);
    expect(body.detail).toContain('Unknown name');
  });

  it('★ 設定してあるキーは、伏せられる', async () => {
    stubNetwork({
      ok: false,
      status: 400,
      body: `{"error":{"message":"API key not valid: ${API_KEY}"}}`,
    });

    const res = await worker.fetch(post(makeToken()), env());
    const body = (await res.json()) as { detail?: string };

    expect(body.detail).not.toContain(API_KEY);
    expect(body.detail).toContain('伏せました');
  });

  it('★ こちらが知らないキーでも、形で伏せられる', async () => {
    // ★ ここが今回いちばん大事な1件です。
    //   「知っているキーだけ消す」では、URL に載って戻ってきた別のキーが素通りします。
    //   形で消せば、こちらが知らなくても消えます。
    stubNetwork({
      ok: false,
      status: 400,
      body: '{"error":{"message":"API key not valid: AIzaSyD-EXAMPLE-not-the-configured-one"}}',
    });

    const res = await worker.fetch(post(makeToken()), env());
    const body = (await res.json()) as { detail?: string };

    expect(body.detail).not.toContain('AIzaSyD');
    expect(body.detail).toContain('伏せました');
  });

  it('★ URL の key= に続く値も伏せられる', async () => {
    stubNetwork({
      ok: false,
      status: 400,
      body: '{"error":{"message":"failed on https://x/models/m:generateContent?key=zzzTOPSECRETzzz"}}',
    });

    const res = await worker.fetch(post(makeToken()), env());
    const body = (await res.json()) as { detail?: string };

    expect(body.detail).not.toContain('zzzTOPSECRETzzz');
  });

  it('長すぎる理由は、切って返す', async () => {
    stubNetwork({ ok: false, status: 400, body: `{"m":"${'あ'.repeat(2000)}"}` });

    const res = await worker.fetch(post(makeToken()), env());
    const body = (await res.json()) as { detail?: string };

    expect((body.detail ?? '').length).toBeLessThanOrEqual(300);
  });

  it('状態番号とモデル名も、いままでどおり返る', async () => {
    stubNetwork({ ok: false, status: 400, body: '{"error":{"message":"nope"}}' });

    const res = await worker.fetch(post(makeToken()), env({ GEMINI_MODEL: 'gemini-2.5-flash' }));
    const body = (await res.json()) as { status?: number; model?: string };

    expect(body.status).toBe(400);
    expect(body.model).toBe('gemini-2.5-flash');
  });
});
