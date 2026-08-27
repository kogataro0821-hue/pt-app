/**
 * Firestore の失敗を、原因の分かる日本語にする。
 *
 * ★ ここを作った理由。
 *
 *   以前は失敗をまとめて「通信状態を確認してください」と出していました。
 *   ところが実際に起きたのは通信の問題ではなく、
 *   **Security Rules をコンソールに貼り直していなかった**ことでした。
 *
 *   画面が「通信を確認しろ」と言うので、通信を疑って時間を使ってしまいます。
 *   原因と表示が食い違うと、直せるはずのものが直せません。
 *
 *   権限で断られたのか、通信が届かないのかは、
 *   Firestore がエラーの code で教えてくれます。分けて出します。
 */

/** Firestore が返すエラーの code（あれば） */
function codeOf(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

export function isPermissionDenied(error: unknown): boolean {
  return codeOf(error) === 'permission-denied';
}

/**
 * 画面に出す文言を作る。
 *
 * @param what 「登録依頼」「食品マスタ」など、何を読もうとしたか
 */
export function readErrorMessage(error: unknown, what: string): string {
  if (isPermissionDenied(error)) {
    return `${what}を読む権限がありません。Firebase コンソールの「Firestore Database → ルール」に firebase/firestore.rules を貼り直して「公開」してください。`;
  }
  if (codeOf(error) === 'unavailable') {
    return `${what}を読み込めませんでした。通信状態を確認してください。`;
  }
  return `${what}を読み込めませんでした。時間をおいてもう一度お試しください。`;
}

export function writeErrorMessage(error: unknown, what: string): string {
  if (isPermissionDenied(error)) {
    return `${what}を保存する権限がありません。Firebase コンソールの「Firestore Database → ルール」に firebase/firestore.rules を貼り直して「公開」してください。`;
  }
  if (codeOf(error) === 'unavailable') {
    return `${what}を保存できませんでした。通信状態を確認してください。`;
  }
  return `${what}を保存できませんでした。時間をおいてもう一度お試しください。`;
}
