import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getAuthClient, getDb } from '@/lib/firebase';
import { clientIdToEmail } from '@/config/firebase';
import { classifyAuthError, type AuthState, type LoginErrorKind } from './authTypes';

interface AuthContextValue {
  state: AuthState;
  /** 契約者ID または メールアドレス でログインする */
  signIn(identifier: string, password: string, mode: 'client' | 'admin'): Promise<void>;
  signOutNow(): Promise<void>;
  /** パスワードを変更する。現在のパスワードで本人確認してから変更する */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  /** users / clients を読み直して、ログイン状態を最新にする */
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    const auth = getAuthClient();

    return onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser === null) {
        setState({ status: 'signedOut' });
        return;
      }
      void loadProfile(firebaseUser.uid).then(setState);
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,

      async signIn(identifier, password, mode) {
        const email =
          mode === 'client' ? clientIdToEmail(identifier) : identifier.trim().toLowerCase();
        try {
          await signInWithEmailAndPassword(getAuthClient(), email, password);
        } catch (error) {
          throw new LoginError(classifyAuthError(errorCode(error)));
        }
      },

      async signOutNow() {
        await signOut(getAuthClient());
      },

      async changePassword(currentPassword, newPassword) {
        const auth = getAuthClient();
        const user = auth.currentUser;
        if (user === null || user.email === null) {
          throw new LoginError('unknown');
        }
        try {
          // パスワード変更の前に、必ず本人確認をやり直す
          const credential = EmailAuthProvider.credential(user.email, currentPassword);
          await reauthenticateWithCredential(user, credential);
          await updatePassword(user, newPassword);
        } catch (error) {
          throw new LoginError(classifyAuthError(errorCode(error)));
        }

        // 「初回パスワード変更が済んだ」印を残す。
        // 契約者自身が書ける数少ないフィールドのひとつ（設計書 §7.2）。
        //
        // ★ 書き先は clients/{clientId} です。users/{uid} には書けません
        //   （契約者が自分の権限行を書ける経路を作らないため。設計書 §7.1）。
        //   そのため、この印を読むときも clients 側を見ます。
        if (state.status === 'signedIn' && state.user.clientId !== null) {
          try {
            await setDoc(
              doc(getDb(), 'clients', state.user.clientId),
              { passwordChangedAt: Date.now(), updatedAt: Date.now() },
              { merge: true },
            );
          } catch {
            // 記録に失敗してもパスワード変更自体は成功しているので、続行する。
            // 画面側はセッション内のフラグでも先へ進めるようにしてある。
          }
          setState(await loadProfile(state.user.uid));
        }
      },

      async refresh() {
        const uid = getAuthClient().currentUser?.uid;
        if (uid === undefined) return;
        setState(await loadProfile(uid));
      },
    }),
    [state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * ログイン状態を読み直す（設計書 §6.4）。
 *
 * 2か所を読みます。
 *   users/{uid}        … 権限（管理者か契約者か・有効か）。管理者しか書けない。
 *   clients/{clientId} … 初回パスワード変更の印。契約者自身が書ける。
 *
 * 権限にかかわる情報と、本人が書き換えられる情報を、別のドキュメントに
 * 分けてあるのが要点です。混ぜると「自分を管理者にする」経路ができてしまいます。
 */
async function loadProfile(uid: string): Promise<AuthState> {
  let data: Record<string, unknown>;
  try {
    const snap = await getDoc(doc(getDb(), 'users', uid));
    if (!snap.exists()) return { status: 'unregistered', uid };
    data = snap.data();
  } catch {
    // users を読めない = Rules に拒否された = 登録されていない扱い
    return { status: 'unregistered', uid };
  }

  if (data.active !== true) return { status: 'disabled', uid };

  const role = data.role === 'admin' ? 'admin' : 'client';
  const clientId = typeof data.clientId === 'string' ? data.clientId : null;

  // 初回パスワード変更の印は clients 側にある
  let passwordChangedAt: number | null = null;
  if (role === 'client' && clientId !== null) {
    try {
      const clientSnap = await getDoc(doc(getDb(), 'clients', clientId));
      const value = clientSnap.data()?.passwordChangedAt;
      passwordChangedAt = typeof value === 'number' ? value : null;
    } catch {
      // 読めなくても致命的ではない。未変更として扱う（安全側）。
      passwordChangedAt = null;
    }
  }

  return {
    status: 'signedIn',
    user: {
      uid,
      role,
      clientId,
      active: true,
      displayName: typeof data.displayName === 'string' ? data.displayName : null,
      passwordChangedAt,
    },
  };
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth は AuthProvider の中でしか使えません');
  }
  return ctx;
}

export class LoginError extends Error {
  constructor(readonly kind: LoginErrorKind) {
    super(kind);
    this.name = 'LoginError';
  }
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}
