/**
 * Firebase の接続設定。
 *
 * ★ ここに値を直接書いているのは意図的です。
 *
 *   この6つの値は「秘密情報ではありません」。
 *   ビルドすると最終的な JavaScript に埋め込まれ、
 *   アプリを開いた人なら誰でもブラウザの開発者ツールで見られます。
 *   隠す方法は存在しませんし、隠す必要もありません。
 *
 *   データを守っているのは Firestore Security Rules です（設計書 §7）。
 *   Rules が正しければ、この値を知っていても他人のデータには一切触れません。
 *
 *   逆に「絶対にここに書いてはいけないもの」は AI の APIキーです。
 *   そちらは Cloudflare Worker 側の Secret に置きます（設計書 §9.2 / Phase 8）。
 *
 * 環境変数（VITE_FIREBASE_*）が設定されていれば、そちらが優先されます。
 * 将来 dev / prod を分けたくなったときのための逃げ道です。
 */

function env(key: string): string | undefined {
  const value = (import.meta.env as Record<string, string | undefined>)[key];
  return value !== undefined && value !== '' ? value : undefined;
}

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

/** Firebase コンソールの「マイアプリ（ウェブ）」に表示される値。 */
const DEFAULT_CONFIG: FirebaseClientConfig = {
  apiKey: 'AIzaSyDB-E4DQmft0bIHHmy5BRZsTvYEg3Lul9E',
  authDomain: 'pt-app-54f32.firebaseapp.com',
  projectId: 'pt-app-54f32',
  storageBucket: 'pt-app-54f32.firebasestorage.app',
  messagingSenderId: '474782094087',
  appId: '1:474782094087:web:675e061eb3de7fa6b42ba2',
};

export function getFirebaseConfig(): FirebaseClientConfig {
  return {
    apiKey: env('VITE_FIREBASE_API_KEY') ?? DEFAULT_CONFIG.apiKey,
    authDomain: env('VITE_FIREBASE_AUTH_DOMAIN') ?? DEFAULT_CONFIG.authDomain,
    projectId: env('VITE_FIREBASE_PROJECT_ID') ?? DEFAULT_CONFIG.projectId,
    storageBucket: env('VITE_FIREBASE_STORAGE_BUCKET') ?? DEFAULT_CONFIG.storageBucket,
    messagingSenderId: env('VITE_FIREBASE_MESSAGING_SENDER_ID') ?? DEFAULT_CONFIG.messagingSenderId,
    appId: env('VITE_FIREBASE_APP_ID') ?? DEFAULT_CONFIG.appId,
  };
}

/** 設定が埋まっているか（起動画面で状態を出すために使う）。 */
export function isFirebaseConfigured(): boolean {
  const config = getFirebaseConfig();
  return Object.values(config).every((value) => value.length > 0);
}

/**
 * 契約者ID → ログイン用の合成メールアドレス（設計書 §6.2）。
 *
 *   'tanaka01' → 'tanaka01@pt-app.local'
 *
 * サーバーへ問い合わせずに機械的に変換するため、契約者ID の一覧が外部に漏れない。
 * ここのドメインは実在しなくて構いません（メールを送らないため）。
 */
export const CLIENT_LOGIN_DOMAIN = env('VITE_CLIENT_LOGIN_DOMAIN') ?? 'pt-app.local';

export function clientIdToEmail(clientId: string): string {
  return `${clientId.trim().toLowerCase()}@${CLIENT_LOGIN_DOMAIN}`;
}

/** AI中継サーバー（Cloudflare Worker）。Phase 8 まで空。 */
export const AI_WORKER_URL = env('VITE_AI_WORKER_URL') ?? null;

/** アプリ名。ここと vite.config.ts の manifest の2箇所だけ（設計書 §5）。 */
export const APP_NAME = 'PT Manager';
