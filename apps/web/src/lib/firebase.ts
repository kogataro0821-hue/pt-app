import { initializeApp, type FirebaseApp } from 'firebase/app';
import { browserLocalPersistence, getAuth, setPersistence, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getFirebaseConfig } from '@/config/firebase';

/**
 * Firebase の初期化。
 *
 * アプリ全体でここだけが Firebase を組み立てます。
 * 画面から直接 initializeApp を呼ばないでください。
 */

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

function getApp(): FirebaseApp {
  app ??= initializeApp(getFirebaseConfig());
  return app;
}

export function getAuthClient(): Auth {
  if (authInstance === null) {
    authInstance = getAuth(getApp());
    // ホーム画面に追加したアプリを閉じても、ログイン状態を保つ。
    // 失敗しても致命的ではないので握りつぶす（プライベートブラウズ等）。
    void setPersistence(authInstance, browserLocalPersistence).catch(() => undefined);
  }
  return authInstance;
}

export function getDb(): Firestore {
  dbInstance ??= getFirestore(getApp());
  return dbInstance;
}
