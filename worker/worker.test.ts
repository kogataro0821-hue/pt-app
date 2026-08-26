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
