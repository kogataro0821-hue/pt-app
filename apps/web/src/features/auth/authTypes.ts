/**
 * ログイン状態の型（設計書 §6.4）。
 *
 * 権限は users/{uid} ドキュメントから読みます。
 * ★ ここで読んだ role はあくまで「画面の出し分け」のためのものです。
 *   本当の権限判定は Firestore Security Rules が行います。
 *   画面側の判定は、いくらでも改ざんできる前提で書いてください。
 */

export type Role = 'admin' | 'client';

export interface AppUser {
  uid: string;
  role: Role;
  /** role が 'client' のときのみ設定される */
  clientId: string | null;
  active: boolean;
  displayName: string | null;
  /** パスワードを一度も変更していない場合は null（初回変更を促す） */
  passwordChangedAt: number | null;
}

export type AuthState =
  /** 起動直後。ログイン状態を確認中 */
  | { status: 'loading' }
  /** 未ログイン */
  | { status: 'signedOut' }
  /**
   * Firebase Auth にはログインできたが、users ドキュメントが無い。
   * 管理者が登録していないアカウント（＝勝手に登録した人）はここに来ます。
   */
  | { status: 'unregistered'; uid: string }
  /** 無効化された契約者（設計書 §6.6） */
  | { status: 'disabled'; uid: string }
  /** ログイン済み */
  | { status: 'signedIn'; user: AppUser };

/** ログイン時のエラー。利用者に見せる文言は authErrorMessage() で統一する。 */
export type LoginErrorKind = 'invalidCredential' | 'tooManyRequests' | 'network' | 'unknown';

/**
 * Firebase のエラーコードを、こちらの分類に落とす。
 *
 * ★ 「IDが存在しない」と「パスワードが違う」を区別しません（設計書 §6.2）。
 *   区別すると、契約者IDが実在するかどうかを外部から調べられてしまいます。
 */
export function classifyAuthError(code: string): LoginErrorKind {
  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found' ||
    code === 'auth/invalid-email'
  ) {
    return 'invalidCredential';
  }
  if (code === 'auth/too-many-requests') return 'tooManyRequests';
  if (code === 'auth/network-request-failed') return 'network';
  return 'unknown';
}

export function authErrorMessage(kind: LoginErrorKind): string {
  switch (kind) {
    case 'invalidCredential':
      return 'IDまたはパスワードが違います。';
    case 'tooManyRequests':
      return '試行回数が多すぎます。しばらく待ってからもう一度お試しください。';
    case 'network':
      return '通信に失敗しました。電波の状態を確認してください。';
    case 'unknown':
      return 'ログインできませんでした。時間をおいてお試しください。';
  }
}
