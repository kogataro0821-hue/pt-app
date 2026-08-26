/**
 * 契約者IDの検証（設計書 §4 / §6.2）。
 *
 * 契約者IDは、ログイン時に機械的にメールアドレスへ変換されます。
 *
 *     tanaka01  →  tanaka01@pt-app.local
 *
 * そのため、メールアドレスの左側として成立する文字だけを許可します。
 * また、一度決めたIDは後から変えられません（データのパスに使うため）。
 * 作成時に厳しくしておくのは、そのためです。
 */

/** 使える文字: 英小文字・数字・ドット・アンダースコア・ハイフン */
const PATTERN = /^[a-z0-9][a-z0-9._-]{2,29}$/;

/** 予約語。システム側のパスや、紛らわしいものと衝突させない。 */
const RESERVED = new Set([
  'admin',
  'administrator',
  'root',
  'system',
  'config',
  'users',
  'clients',
  'foods',
  'recipes',
  'null',
  'undefined',
  'test',
]);

export type ClientIdError =
  'empty' | 'tooShort' | 'tooLong' | 'invalidChars' | 'startsWithSymbol' | 'reserved';

export type ClientIdCheck = { ok: true; id: string } | { ok: false; reason: ClientIdError };

/**
 * 入力を正規化する。
 * 前後の空白を落とし、大文字を小文字に統一します。
 * （メールアドレスの左側は大小を区別しない運用が一般的なため）
 */
export function normalizeClientId(input: string): string {
  return input.trim().toLowerCase();
}

export function checkClientId(input: string): ClientIdCheck {
  const id = normalizeClientId(input);

  if (id.length === 0) return { ok: false, reason: 'empty' };
  if (id.length < 3) return { ok: false, reason: 'tooShort' };
  if (id.length > 30) return { ok: false, reason: 'tooLong' };
  if (RESERVED.has(id)) return { ok: false, reason: 'reserved' };
  if (/^[._-]/.test(id)) return { ok: false, reason: 'startsWithSymbol' };
  if (!PATTERN.test(id)) return { ok: false, reason: 'invalidChars' };

  return { ok: true, id };
}

export function clientIdErrorMessage(reason: ClientIdError): string {
  switch (reason) {
    case 'empty':
      return '契約者IDを入力してください。';
    case 'tooShort':
      return '契約者IDは3文字以上にしてください。';
    case 'tooLong':
      return '契約者IDは30文字以内にしてください。';
    case 'invalidChars':
      return '契約者IDに使えるのは、英小文字・数字・ドット・アンダースコア・ハイフンだけです。';
    case 'startsWithSymbol':
      return '契約者IDは英小文字または数字で始めてください。';
    case 'reserved':
      return 'そのIDは予約されているため使えません。';
  }
}
