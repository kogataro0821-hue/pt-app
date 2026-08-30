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
 *  このWorkerがすること（4つだけ）
 *  ---------------------------------------------------------------------
 *
 *  1. 本当にこのアプリのログイン利用者からの依頼かを確かめる
 *  2. その人が今日すでに何回使ったかを数え、使いすぎを止める
 *  3. APIキーを付ける
 *  4. Gemini に転送して、返事をそのまま返す
 *
 *  1が要です。これが無いと、このURLを知った人は誰でも
 *  あなたのAI枠を使えてしまいます。Firebase が発行した
 *  ログイン証明（IDトークン）の署名を、Google の公開鍵で検証します。
 *
 *  2は、身内の事故を防ぐためのものです。不具合で呼び出しが
 *  繰り返されたり、面白がって連打されたりすると、無料枠が尽きて
 *  翌日まで全員のAIが止まります。1人あたりの回数で受け止めます。
 *
 *  ---------------------------------------------------------------------
 *  設定する値（Cloudflare の管理画面で登録します）
 *  ---------------------------------------------------------------------
 *
 *    GEMINI_API_KEY   … Google AI Studio で取得したキー（Secret として登録）
 *    FIREBASE_PROJECT … pt-app-54f32
 *    ALLOWED_ORIGIN   … https://kogataro0821-hue.github.io
 *    GEMINI_MODEL     … 使うモデル名（省略可。既定 gemini-2.5-flash）
 *    DAILY_LIMIT      … 1人が1日に使える回数（省略可。既定 50）
 *
 *  ---------------------------------------------------------------------
 *  結び付けるもの（KV 名前空間のバインド）
 *  ---------------------------------------------------------------------
 *
 *    RATE_LIMIT       … 使った回数を数えておく場所（Workers KV）
 *
 *  ★ これが結び付けられていないと、回数を数えません（利用は止めません）。
 *    結び付いているかどうかは、下の動作確認の画面で確かめられます。
 *
 *  ---------------------------------------------------------------------
 *  動作確認
 *  ---------------------------------------------------------------------
 *
 *  ブラウザでこの Worker の URL をそのまま開くと、
 *  設定の状態と「いま使えるモデルの一覧」が表示されます。
 *
 * ===========================================================================
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * 使うモデル。
 *
 * ★ 設定値（GEMINI_MODEL）で差し替えられるようにしてあります。
 *   モデルは提供側の都合で入れ替わるため、そのたびにコードを貼り直すのは現実的ではありません。
 *   Cloudflare の管理画面で値を変えるだけで切り替えられます。
 *
 *   いま使えるモデルの一覧は、この Worker に GET でアクセスすると見られます。
 */
const DEFAULT_MODEL = 'gemini-2.5-flash';

/** 受け取る本文の上限。写真を送る Phase 8B でも収まる大きさにしてあります。 */
const MAX_BODY_BYTES = 2_000_000;

/**
 * 1人が1日に使える回数の既定値（設計書 §7.6）。
 *
 * ★ 設定値（DAILY_LIMIT）で変えられます。
 *   足りなくなったときに、コードを貼り直さずに済むようにするためです。
 */
const DEFAULT_DAILY_LIMIT = 50;

/**
 * 数え札を残しておく時間（秒）。
 *
 * 札は日付ごとに別の名前なので、日が変われば自然に使われなくなります。
 * 2日残せば十分で、あとは Cloudflare が勝手に片付けてくれます。
 */
const COUNTER_TTL_SECONDS = 60 * 60 * 48;

/** Google の公開鍵。取得のたびに通信すると遅いので、しばらく覚えておきます。 */
let keyCache = { keys: null, expiresAt: 0 };

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN ?? '*';

    // ブラウザが本番の通信の前に投げてくる確認（CORS preflight）
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }


    /**
     * 動作確認用。ブラウザでこのWorkerのURLを開くと、
     * 「キーが設定されているか」「どのモデルが使えるか」が分かります。
     *
     * ★ 返すのはモデル名の一覧だけです。APIキーも利用者のデータも含みません。
     *   設定を間違えたときに、原因が分からず何往復もするのを避けるための窓口です。
     */
    if (request.method === 'GET') {
      if (!env.GEMINI_API_KEY) {
        return json({ ok: false, reason: 'GEMINI_API_KEY が設定されていません' }, 500, origin);
      }

      try {
        const res = await fetch(`${GEMINI_BASE}/models?key=${env.GEMINI_API_KEY}`);
        const data = await res.json();
        if (!res.ok) {
          return json({ ok: false, status: res.status, reason: data }, 200, origin);
        }
        return json(
          {
            ok: true,
            configuredModel: env.GEMINI_MODEL ?? DEFAULT_MODEL,
            firebaseProject: env.FIREBASE_PROJECT ?? '(未設定)',
            // ★ KV を結び付け忘れても、アプリは普通に動いてしまいます。
            //   気づける場所がここしかないので、はっきり書きます。
            dailyLimit: hasCounter(env)
              ? `有効（1人あたり1日 ${dailyLimit(env)} 回まで）`
              : '⚠ 数えていません（KV名前空間 RATE_LIMIT が結び付けられていません）',
            usableModels: (data.models ?? [])
              .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
              .map((m) => m.name),
          },
          200,
          origin,
        );
      } catch (e) {
        return json({ ok: false, reason: String(e && e.message) }, 502, origin);
      }
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
    // ★ 文字数ではなくバイト数で見ます。
    //   `body.length` は文字の数なので、日本語（1文字3バイト）だと
    //   上限2,000,000は実際には約6MBまで通ってしまいます。
    if (byteLength(body) > MAX_BODY_BYTES) {
      return json({ error: 'payload_too_large' }, 413, origin);
    }

    // --- 3. 使いすぎを止める（設計書 §7.6） -------------------------------
    if (!env.GEMINI_API_KEY) {
      return json({ error: 'server_not_configured' }, 500, origin);
    }

    // ★ 鍵の確認を先にしています。
    //   設定が済んでいないせいで失敗する回数を、上限に数えたくないためです。
    const quota = await countUse(env, uid);
    if (!quota.allowed) {
      // ★ 上限に達したことは、必ず記録に残します。
      //   契約者から「AIが動かない」と言われたとき、
      //   ここを見れば「壊れた」のか「使い切った」のかがすぐ分かります。
      console.log(
        JSON.stringify({ uid, result: 'daily_limit', used: quota.used, limit: quota.limit }),
      );

      // ★ Gemini 側の混み合い（同じ429）と区別できるようにします。
      //   区別が付かないと、上限に達した人が一日じゅう押し続けます。
      return json(
        { error: 'daily_limit_reached', limit: quota.limit, used: quota.used },
        429,
        origin,
      );
    }

    // --- 4. Gemini へ転送 -------------------------------------------------
    const model = env.GEMINI_MODEL ?? DEFAULT_MODEL;

    let upstream;
    try {
      upstream = await fetch(
        `${GEMINI_BASE}/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        },
      );
    } catch {
      return json({ error: 'upstream_unreachable' }, 502, origin);
    }

    const text = await upstream.text();

    // ★ 失敗したときも、こちらのキーが含まれる情報は返しません。
    if (!upstream.ok) {
      const kind =
        upstream.status === 429 ? 'rate_limited' : upstream.status >= 500 ? 'unavailable' : 'rejected';

      // ★ 失敗の理由は Cloudflare のログに残します。
      //   これが無いと「AIに接続できませんでした」としか分からず、
      //   原因の切り分けに何往復もかかります。
      //
      // ★ ただし、書く前に必ずAPIキーを伏せます。
      //
      //   ここは一度間違えていました。
      //   「APIキーは URL のクエリにあるので、応答本文には含まれない」
      //   と思い込んでいましたが、Gemini はキーが不正なときに
      //       {"error":{"message":"API key not valid: AIza..."}}
      //   のように、**エラー文にキーを入れて返します**。
      //   そのままログに書くと、キーが平文で残ります。
      //
      //   しかも、それが起きるのは「キーがおかしいとき」＝
      //   まさにログを見て人に相談する場面です。
      //   画面を撮って送った先に、キーごと渡ることになります。
      console.log(
        JSON.stringify({
          uid,
          result: 'error',
          status: upstream.status,
          detail: redact(text, env.GEMINI_API_KEY).slice(0, 500),
        }),
      );

      // ★ 理由を、伏せ字にしたうえで返します。
      //
      //   以前は返していませんでした。キーが漏れるのを避けるためです。
      //   ただ、それだと画面には「中継役の応答: 400」としか出ず、
      //   **原因が分からないまま何往復もする**ことになりました。実際になりました。
      //
      //   いまは redact が「形で」消すので、こちらが知らないキーも消えます。
      //   長さも切ります。返すのはログイン済みの相手だけです。
      return json(
        { error: kind, status: upstream.status, model, detail: redact(text, env.GEMINI_API_KEY).slice(0, 300) },
        upstream.status,
        origin,
      );
    }

    // 誰が使ったかを Cloudflare のログに残す（本文は残しません）
    console.log(
      JSON.stringify({ uid, result: 'ok', bytes: byteLength(body), used: quota.used }),
    );

    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  },
};

// ---------------------------------------------------------------------------
// 使いすぎを止める（設計書 §7.6）
//
// ★ これは「攻撃を防ぐ壁」ではありません。門番はトークンの検証のほうです。
//   ここが受け止めるのは、通ってよい人が使いすぎることです。
//
//     ・アプリの不具合で、AIを呼ぶ処理が繰り返される
//     ・面白がって連打される
//     ・端末を盗られて、トークンが1時間だけ使われる
//
//   どれも結果は同じで、Gemini の無料枠が尽きて、翌日まで全員のAIが止まります。
//
// ★ 数え方は厳密ではありません。
//   Workers KV は「少し前の値が返ることがある」作りなので、
//   同時に何本も飛んでくると、数え落として上限を数回超えることがあります。
//   繰り返しを止める用途では、それで十分です。
//   1回たりとも超えさせない仕組みが要るなら、KV では足りません。
// ---------------------------------------------------------------------------

/** 回数を数える場所が結び付けられているか */
function hasCounter(env) {
  return typeof env.RATE_LIMIT?.get === 'function';
}

/** 1人が1日に使える回数。設定が無い・おかしいときは既定値。 */
function dailyLimit(env) {
  const n = Number(env.DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_LIMIT;
}

/**
 * 日本時間での「今日」（YYYY-MM-DD）。
 *
 * ★ 世界標準時のままだと、日本の朝9時に回数が戻ります。
 *   利用者から見れば「昼前に急に使えるようになる」ので、
 *   日付の変わり目は日本時間に合わせます。
 */
function todayInJst(now = Date.now()) {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 使った回数を1つ増やし、まだ使ってよいかを返す。
 *
 * ★ 数えられないときは、通します（止めません）。
 *
 *   KV を結び付け忘れていたり、KV が一時的に応答しなかったりしたときに
 *   AIが全員使えなくなるのは、行き過ぎです。ここで守っているのは
 *   「無料枠が尽きること」であって、利用者のデータではありません。
 *   結び付け忘れに気づけるよう、動作確認の画面に状態を出しています。
 */
async function countUse(env, uid) {
  const limit = dailyLimit(env);
  if (!hasCounter(env)) return { allowed: true, counted: false, used: 0, limit };

  const key = `use:${uid}:${todayInJst()}`;

  let used;
  try {
    used = Number(await env.RATE_LIMIT.get(key));
  } catch {
    return { allowed: true, counted: false, used: 0, limit };
  }
  if (!Number.isFinite(used) || used < 0) used = 0;

  if (used >= limit) return { allowed: false, counted: true, used, limit };

  try {
    await env.RATE_LIMIT.put(key, String(used + 1), { expirationTtl: COUNTER_TTL_SECONDS });
  } catch {
    // 数え札を置けなくても、利用は止めません（理由は上のとおり）
    return { allowed: true, counted: false, used: used + 1, limit };
  }

  return { allowed: true, counted: true, used: used + 1, limit };
}

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

/**
 * ログに残す前に、APIキーを伏せる。
 *
 * ★ 短く切ってから伏せるのでは間に合いません。
 *   切れ目でキーが半分になると、伏せ字に引っかからず、
 *   前半だけがログに残ります。伏せてから切ります。
 */
function redact(text, apiKey) {
  let out = String(text);

  // 1. 設定されているキーそのもの
  if (apiKey) out = out.split(apiKey).join(MASK);

  // ★ 2. Google のAPIキーの形をしたもの全部。
  //
  //   設定されているキーと一字一句同じとは限りません。
  //   URL に載って戻ってきたり、別のキーが混ざったりします。
  //   「知っているキーだけ消す」では、知らないキーが素通りします。
  //   形で消せば、こちらが知らなくても消えます。
  out = out.replace(/AIza[0-9A-Za-z_-]{10,}/g, MASK);

  // ★ 3. key= のクエリに続く値。
  //   キーの形が変わっても、置き場所は変わりません。
  out = out.replace(/([?&]key=)[^&"'\s]+/g, `$1${MASK}`);

  return out;
}

const MASK = '[伏せました]';

/** 文字列を送ったときの、実際のバイト数。 */
function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

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
export {
  verifyFirebaseToken,
  extractSpkiFromCertificate,
  pemToArrayBuffer,
  countUse,
  todayInJst,
  dailyLimit,
  byteLength,
};
