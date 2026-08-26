import { useState } from 'react';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { LoginScreen } from '@/features/auth/LoginScreen';
import { PasswordChangeScreen } from '@/features/auth/PasswordChangeScreen';
import { HomeScreen } from '@/features/home/HomeScreen';

export default function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}

/**
 * ログイン状態による画面の振り分け。
 *
 * ★ ここでの出し分けは「見せ方」でしかありません。
 *   本当の権限判定は Firestore Security Rules が行います（設計書 §7.1）。
 *   この画面の判定を書き換えても、他人のデータは1バイトも取れません。
 */
function Router() {
  const { state, signOutNow } = useAuth();
  const [changingPassword, setChangingPassword] = useState(false);

  if (state.status === 'loading') {
    return <Splash />;
  }

  if (state.status === 'signedOut') {
    return <LoginScreen />;
  }

  if (state.status === 'unregistered') {
    return (
      <Blocked
        title="このアカウントはまだ登録されていません"
        body="ログインはできましたが、アプリを使う権限が設定されていません。トレーナーにご連絡ください。"
        onSignOut={() => void signOutNow()}
      />
    );
  }

  if (state.status === 'disabled') {
    return (
      <Blocked
        title="このアカウントは現在ご利用いただけません"
        body="アカウントが無効になっています。トレーナーにご連絡ください。"
        onSignOut={() => void signOutNow()}
      />
    );
  }

  // 契約者が一度もパスワードを変えていない場合は、変更するまで先へ進めない
  const mustChange = state.user.role === 'client' && state.user.passwordChangedAt === null;

  if (mustChange || changingPassword) {
    return (
      <PasswordChangeScreen
        required={mustChange}
        onDone={() => setChangingPassword(false)}
        onCancel={() => setChangingPassword(false)}
      />
    );
  }

  return <HomeScreen user={state.user} onChangePassword={() => setChangingPassword(true)} />;
}

function Splash() {
  return (
    <div className="auth-screen">
      <main className="auth-card">
        <p className="auth-lede" aria-live="polite">
          読み込んでいます…
        </p>
      </main>
    </div>
  );
}

function Blocked({
  title,
  body,
  onSignOut,
}: {
  title: string;
  body: string;
  onSignOut: () => void;
}) {
  return (
    <div className="auth-screen">
      <main className="auth-card">
        <h1 className="auth-title">{title}</h1>
        <p className="auth-lede">{body}</p>
        <button className="button-secondary" type="button" onClick={onSignOut}>
          ログアウト
        </button>
      </main>
    </div>
  );
}
