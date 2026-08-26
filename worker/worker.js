/**
 * ===========================================================================
 *  AI中継役（Cloudflare Worker）
 * ===========================================================================
 *
 *  このファイルは Cloudflare の管理画面にそのまま貼り付けて使います。
 *  外部の部品を一切読み込まないので、パソコンに何かを入れる必要はありません。
 *
 *  ---------------------------------------------------------------------
 *  なぜこれが必要なのか
 *  ---------------------------------------------------------------------
 *
 *  AIを呼ぶにはAPIキーが要ります。しかしこのアプリのコードは
 *  GitHub で公開されており、ブラウザにも全部ダウンロードされます。
 *  キーをアプリに入れれば、誰でも読めて、誰でもあなたの枠でAIを使えます。
 *
 *  そこでキーはこのWorkerの中だけに置き、アプリはWorkerに頼みます。
 *
 *      アプリ ──(ログイン証明)──▶ Worker ──(APIキー)──▶ Gemini
 *                                   ▲
 *                              キーはここだけ
 *
 *  ---------------------------------------------------------------------
 *  このWorkerがすること（3つだけ）
 *  ---------------------------------------------------------------------
 *
 *  1. 本当にこのアプリのログイン利用者からの依頼かを確かめる
 *  2. APIキーを付ける
 *  3. Gemini に転送して、返事をそのまま返す
 *
 *  1が要です。これが無いと、このURLを知った人は誰でも
 *  あなたのAI枠を使えてしまいます。Firebase が発行した
 *  ログイン証明（IDトークン）の署名を、Google の公開鍵で検証します。
 *
 *  ---------------------------------------------------------------------
 *  設定する値（Cloudflare の管理画面で登録します）
 *  ---------------------------------------------------------------------
 *
 *    GEMINI_API_KEY   … Google AI Studio で取得したキー（Secret として登録）
 *    FIREBASE_PROJECT … pt-app-54f32
 *    ALLOWED_ORIGIN   … https://kogataro0821-hue.github.io
 *
 * ===========================================================================
 */

/** 転送先。ここに固定することで、他の用途に流用されるのを防ぎます。 */
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

/** 受け取る本文の上限。写真を送る Phase 8B でも収まる大きさにしてあります。 */
const MAX_BODY_BYTES = 2_000_000;

/** Google の公開鍵。取得のたびに通信すると遅いので、しばらく覚えておきます。 */
let keyCache = { keys: null, expiresAt: 0 };

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN ?? '*';

    // ブラウザが本番の通信の前に投げてくる確認（CORS preflight）
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, origin);
    }

    // --- 1. ログイン証明の確認 -------------------------------------------
    const auth = request.headers.get('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token === '') {
      return json({ error: 'missing_token' }, 401, origin);
    }

    let uid;
    try {
      uid = await verifyFirebaseToken(token, env.FIREBASE_PROJECT);
    } catch (e) {
      return json({ error: 'invalid_token', detail: String(e && e.message) }, 401, origin);
    }

    // --- 2. 本文の大きさを確かめる ---------------------------------------
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
      return json({ error: 'payload_too_large' }, 413, origin);
    }

    // --- 3. Gemini へ転送 -------------------------------------------------
    if (!env.GEMINI_API_KEY) {
      return json({ error: 'server_not_configured' }, 500, origin);
    }

    let upstream;
    try {
      upstream = await fetch(`${GEMINI_ENDPOINT}?key=${env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch {
      return json({ error: 'upstream_unreachable' }, 502, origin);
    }

    const text = await upstream.text();

    // ★ 失敗したときも、こちらのキーが含まれる情報は返しません。
    if (!upstream.ok) {
      const kind =
        upstream.status === 429 ? 'rate_limited' : upstream.status >= 500 ? 'unavailable' : 'rejected';
      return json({ error: kind, status: upstream.status }, upstream.status, origin);
    }

    // 誰が使ったかを Cloudflare のログに残す（本文は残しません）
    console.log(JSON.stringify({ uid, bytes: body.length, status: upstream.status }));

    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  },
};

// ---------------------------------------------------------------------------
// Firebase のログイン証明（IDトークン）の検証
//
// ★ 「トークンがある」だけでは不十分です。中身は誰でも書けるので、
//   Google の秘密鍵で署名されていることを、公開鍵で確かめます。
//   そのうえで、宛先（プロジェクト）と有効期限も見ます。
// ---------------------------------------------------------------------------

async function verifyFirebaseToken(token, projectId) {
  if (!projectId) throw new Error('project not configured');

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');

  const header = JSON.parse(decodeBase64Url(parts[0]));
  const payload = JSON.parse(decodeBase64Url(parts[1]));

  if (header.alg !== 'RS256') throw new Error('unexpected algorithm');
  if (!header.kid) throw new Error('no key id');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) throw new Error('expired');
  if (typeof payload.iat !== 'number' || payload.iat > now + 300) throw new Error('issued in future');
  if (payload.aud !== projectId) throw new Error('wrong audience');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('wrong issuer');
  if (!payload.sub) throw new Error('no subject');

  const pem = await getPublicKey(header.kid);
  const key = await crypto.subtle.importKey(
    'spki',
    pemToArrayBuffer(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = base64UrlToBytes(parts[2]);

  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed);
  if (!ok) throw new Error('bad signature');

  return payload.sub;
}

async function getPublicKey(kid) {
  const now = Date.now();
  if (keyCache.keys === null || now >= keyCache.expiresAt) {
    const res = await fetch(
      'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
    );
    if (!res.ok) throw new Error('cannot fetch keys');

    const keys = await res.json();
    // Cache-Control の max-age に従う。無ければ1時間。
    const cc = res.headers.get('Cache-Control') ?? '';
    const m = /max-age=(\d+)/.exec(cc);
    const ttl = m ? Number(m[1]) * 1000 : 3600_000;
    keyCache = { keys, expiresAt: now + ttl };
  }

  const pem = keyCache.keys[kid];
  if (!pem) throw new Error('unknown key id');
  return pem;
}

// ---------------------------------------------------------------------------
// 小道具
// ---------------------------------------------------------------------------

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function base64UrlToBytes(input) {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeBase64Url(input) {
  return new TextDecoder().decode(base64UrlToBytes(input));
}

/**
 * 証明書（PEM）から公開鍵を取り出す。
 * Google が返すのは X.509 証明書なので、その中の公開鍵部分を使います。
 */
function pemToArrayBuffer(pem) {
  const body = pem
    .replace(/-----BEGIN CERTIFICATE-----/, '')
    .replace(/-----END CERTIFICATE-----/, '')
    .replace(/\s/g, '');
  const der = base64UrlToBytes(body.replace(/\+/g, '-').replace(/\//g, '_'));
  return extractSpkiFromCertificate(der);
}

/**
 * X.509 証明書（DER）から SubjectPublicKeyInfo を取り出す。
 *
 * ★ 本来は専用の部品を使うところですが、Worker に外部の部品を
 *   読み込ませたくないので、必要な範囲だけ自前で解いています。
 *   証明書は「入れ子の箱」の構造で、公開鍵はその中の
 *   「OID 1.2.840.113549.1.1.1（RSA暗号）で始まる箱」です。
 *   その箱の先頭位置を探して、そこから丸ごと切り出します。
 */
function extractSpkiFromCertificate(der) {
  // RSA の識別子（OID 1.2.840.113549.1.1.1）のバイト列。
  // 署名アルゴリズム（1.2.840.113549.1.1.11）とは最後の1バイトが違うので、
  // 証明書の中でこの並びが出てくるのは公開鍵の箱だけです。
  const marker = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];

  const oidAt = indexOfBytes(der, marker);
  if (oidAt < 0) throw new Error('rsa oid not found');

  // 1. OID を含む一番内側の SEQUENCE = AlgorithmIdentifier
  //    構造: SEQUENCE { OID, NULL }
  const algStart = findEnclosingSequence(der, oidAt);
  if (algStart < 0) throw new Error('algorithm identifier not found');

  // 2. その AlgorithmIdentifier から始まる SEQUENCE = SubjectPublicKeyInfo
  //    構造: SEQUENCE { AlgorithmIdentifier, BIT STRING }
  //
  //    「中身がちょうど AlgorithmIdentifier から始まる箱」を探すので、
  //    どの箱を取ればよいか迷いようがありません。
  for (let start = algStart - 1; start >= 0; start -= 1) {
    if (der[start] !== 0x30) continue;
    const parsed = readLength(der, start + 1);
    if (parsed === null) continue;
    if (parsed.valueStart !== algStart) continue;

    const end = parsed.valueStart + parsed.length;
    if (end > der.length) continue;
    return der.slice(start, end).buffer;
  }

  throw new Error('cannot extract public key');
}

/** バイト列の中から、別のバイト列が最初に現れる位置。無ければ -1。 */
function indexOfBytes(haystack, needle) {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** position を含む、一番内側の SEQUENCE の開始位置。 */
function findEnclosingSequence(der, position) {
  let best = -1;
  let bestLength = Infinity;

  for (let start = position - 1; start >= 0; start -= 1) {
    if (der[start] !== 0x30) continue;
    const parsed = readLength(der, start + 1);
    if (parsed === null) continue;

    const end = parsed.valueStart + parsed.length;
    if (parsed.valueStart > position || end <= position || end > der.length) continue;

    if (parsed.length < bestLength) {
      best = start;
      bestLength = parsed.length;
    }
  }

  return best;
}

/** DER の長さ表現を読む。 */
function readLength(bytes, offset) {
  const first = bytes[offset];
  if (first === undefined) return null;

  if (first < 0x80) {
    return { length: first, valueStart: offset + 1 };
  }

  const count = first & 0x7f;
  if (count === 0 || count > 4) return null;

  let length = 0;
  for (let i = 0; i < count; i += 1) {
    const b = bytes[offset + 1 + i];
    if (b === undefined) return null;
    length = length * 256 + b;
  }
  return { length, valueStart: offset + 1 + count };
}

// ---------------------------------------------------------------------------
// テストのための公開。
// Cloudflare が使うのは上の `export default` だけなので、
// ここに足しても動作には影響しません。
// 署名検証は自分で書いた部分なので、CIで毎回検証しています。
// ---------------------------------------------------------------------------
export { verifyFirebaseToken, extractSpkiFromCertificate, pemToArrayBuffer };
