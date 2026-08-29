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

import worker from './worker.js';

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
