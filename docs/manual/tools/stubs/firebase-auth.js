// 説明書の画面写真を撮るためだけの偽 Auth。製品には入りません。
// ?as=admin / ?as=client / ?as=out で、ログインしている人を切り替えます。

function who() {
  const p = new URLSearchParams(window.location.search).get('as');
  if (p === 'admin') return { uid: 'uid-admin', email: 'trainer@example.com' };
  if (p === 'out') return null;
  if (p === 'new') return { uid: 'uid-suzuki02', email: 'suzuki02@pt-app.local' };
  return { uid: 'uid-tanaka', email: 'tanaka01@pt-app.local' };
}

const AUTH = { currentUser: who() };

export function getAuth() {
  return AUTH;
}
export function setPersistence() {
  return Promise.resolve();
}
export const browserLocalPersistence = 'local';

export function onAuthStateChanged(auth, cb) {
  setTimeout(() => cb(auth.currentUser), 0);
  return () => undefined;
}

export function signInWithEmailAndPassword() {
  return Promise.reject(Object.assign(new Error('stub'), { code: 'auth/wrong-password' }));
}
export function signOut() {
  return Promise.resolve();
}
export function updatePassword() {
  return Promise.resolve();
}
export function reauthenticateWithCredential() {
  return Promise.resolve();
}
export const EmailAuthProvider = { credential: () => ({}) };

export function createUserWithEmailAndPassword() {
  return Promise.resolve({ user: { uid: 'uid-new' } });
}
