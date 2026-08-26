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

      // 権限は users/{uid} から読む（設計書 §6.4）
      void (async () => {
        try {
          const snap = await getDoc(doc(getDb(), 'users', firebaseUser.uid));

          if (!snap.exists()) {
            setState({ status: 'unregistered', uid: firebaseUser.uid });
            return;
          }

          const data = snap.data();
          if (data.active !== true) {
            setState({ status: 'disabled', uid: firebaseUser.uid });
            return;
          }

          setState({
            status: 'signedIn',
            user: {
              uid: firebaseUser.uid,
              role: data.role === 'admin' ? 'admin' : 'client',
              clientId: typeof data.clientId === 'string' ? data.clientId : null,
              active: true,
              displayName: typeof data.displayName === 'string' ? data.displayName : null,
              passwordChangedAt:
                typeof data.passwordChangedAt === 'number' ? data.passwordChangedAt : null,
            },
          });
        } catch {
          // users を読めない = Rules に拒否された = 登録されていない扱い
          setState({ status: 'unregistered', uid: firebaseUser.uid });
        }
      })();
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
        if (state.status === 'signedIn' && state.user.clientId !== null) {
          try {
            await setDoc(
              doc(getDb(), 'clients', state.user.clientId),
              { passwordChangedAt: Date.now(), updatedAt: Date.now() },
              { merge: true },
            );
          } catch {
            // 記録に失敗してもパスワード変更自体は成功しているので、続行する
          }
        }
      },
    }),
    [state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
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
