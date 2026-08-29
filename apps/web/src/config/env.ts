/**
 * 環境変数の読み取り口（設計書 §31）。
 *
 * ★ 秘密情報はここに置かない。
 *   Vite の VITE_* は最終的なファイルに埋め込まれ、誰でも取り出せる。
 *   AI の APIキーは Cloudflare Worker 側の Secret に置く（設計書 §9.2）。
 *
 * ここに書いてよいのは「公開されても困らない設定」だけ:
 *   ・Firebase のクライアント設定（Rules が守るので秘密ではない・§7.6）
 *   ・AI中継サーバーのURL
 *   ・ログイン用ドメイン
 */

function read(key: string): string | undefined {
  const value = (import.meta.env as Record<string, string | undefined>)[key];
  return value !== undefined && value !== '' ? value : undefined;
}

function required(key: string): string {
  const value = read(key);
  if (value === undefined) {
    throw new Error(`環境変数 ${key} が設定されていません。`);
  }
  return value;
}

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

/** Firebase の設定を読む。Phase 2 で実際に使い始める。 */
export function getFirebaseConfig(): FirebaseClientConfig {
  return {
    apiKey: required('VITE_FIREBASE_API_KEY'),
    authDomain: required('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: required('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: required('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: required('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: required('VITE_FIREBASE_APP_ID'),
  };
}

/** Firebase の設定が揃っているか（起動画面で状態を出すために使う）。 */
export function isFirebaseConfigured(): boolean {
  try {
    getFirebaseConfig();
    return true;
  } catch {
    return false;
  }
}

/**
 * 契約者ID → ログイン用の合成メールアドレス（設計書 §6.2）。
 *
 *   'tanaka01' → 'tanaka01@pt-app.local'
 *
 * サーバーへ問い合わせずに機械的に変換するため、契約者ID の一覧が外部に漏れない。
 */
export const CLIENT_LOGIN_DOMAIN = read('VITE_CLIENT_LOGIN_DOMAIN') ?? 'pt-app.local';

export function clientIdToEmail(clientId: string): string {
  return `${clientId.trim().toLowerCase()}@${CLIENT_LOGIN_DOMAIN}`;
}

/** AI中継サーバー（Cloudflare Worker）。Phase 8 まで空。 */
export const AI_WORKER_URL = read('VITE_AI_WORKER_URL') ?? null;

/** アプリ名。本物は config/firebase.ts です（このファイルは、いまどこからも使われていません）。 */
export const APP_NAME = 'たろZAP';
