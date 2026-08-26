import Constants from 'expo-constants';

/**
 * 環境変数の読み取り口（設計書 §31）。
 *
 * ★ 秘密情報はここに置かない。
 *   Expo の EXPO_PUBLIC_* はアプリのバンドルに埋め込まれ、誰でも取り出せる。
 *   AI の APIキーは Cloudflare Worker 側の Secret に置く（設計書 §9.2）。
 *
 * ここに書いてよいのは「公開されても困らない設定」だけ:
 *   ・Firebase のクライアント設定（Rules が守るので秘密ではない・§7.6）
 *   ・Worker のURL
 *   ・ログイン用ドメイン
 */

function readEnv(key: string): string | undefined {
  const value = process.env[key];
  return value !== undefined && value !== '' ? value : undefined;
}

function requireEnv(key: string): string {
  const value = readEnv(key);
  if (value === undefined) {
    throw new Error(
      `環境変数 ${key} が設定されていません。.env.example をコピーして .env を作成してください。`,
    );
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

/**
 * Firebase の設定を読む。Phase 2 で実際に使い始める。
 * 未設定でもアプリが落ちないよう、明示的に呼んだときだけ検証する。
 */
export function getFirebaseConfig(): FirebaseClientConfig {
  return {
    apiKey: requireEnv('EXPO_PUBLIC_FIREBASE_API_KEY'),
    authDomain: requireEnv('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN'),
    projectId: requireEnv('EXPO_PUBLIC_FIREBASE_PROJECT_ID'),
    storageBucket: requireEnv('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: requireEnv('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'),
    appId: requireEnv('EXPO_PUBLIC_FIREBASE_APP_ID'),
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
 *   'tanaka01' → 'tanaka01@pt-app-dev.local'
 *
 * サーバーへ問い合わせずに機械的に変換するため、契約者ID の一覧が外部に漏れない。
 */
export const CLIENT_LOGIN_DOMAIN = readEnv('EXPO_PUBLIC_CLIENT_LOGIN_DOMAIN') ?? 'pt-app.local';

export function clientIdToEmail(clientId: string): string {
  return `${clientId.trim().toLowerCase()}@${CLIENT_LOGIN_DOMAIN}`;
}

/** AI中継サーバー（Cloudflare Worker）。Phase 8 まで空。 */
export const AI_WORKER_URL = readEnv('EXPO_PUBLIC_AI_WORKER_URL') ?? null;

/** 開発時に Firebase Emulator へ接続するか。 */
export const USE_EMULATOR = readEnv('EXPO_PUBLIC_USE_EMULATOR') === 'true';

/** app.config.ts で定義したアプリ名。画面ではこれを使う（設計書 §5）。 */
export const APP_NAME =
  (Constants.expoConfig?.extra as { appName?: string } | undefined)?.appName ?? 'PT Manager';
