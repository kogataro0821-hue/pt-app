import { useState, type FormEvent } from 'react';
import { APP_NAME } from '@/config/firebase';
import { LoginError, useAuth } from './AuthProvider';
import { authErrorMessage } from './authTypes';

/**
 * ログイン画面（設計書 §3 / §6.2）。
 *
 * 契約者は「契約者ID + パスワード」。
 * 契約者ID は端末側で機械的にメール形式へ変換するため、
 * サーバーに問い合わせません（＝契約者ID の一覧が外部に漏れません）。
 */
export function LoginScreen() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<'client' | 'admin'>('client');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    setError(null);
    setBusy(true);
    try {
      await signIn(identifier, password, mode);
      // 成功すると onAuthStateChanged が発火して画面が切り替わる
    } catch (e) {
      setError(authErrorMessage(e instanceof LoginError ? e.kind : 'unknown'));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <main className="auth-card">
        <h1 className="auth-title">{APP_NAME}</h1>
        <p className="auth-lede">
          {mode === 'client'
            ? '契約者IDとパスワードでログインしてください。'
            : '管理者のメールアドレスとパスワードでログインしてください。'}
        </p>

        <div className="segmented" role="tablist" aria-label="ログイン種別">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'client'}
            className={mode === 'client' ? 'seg on' : 'seg'}
            onClick={() => {
              setMode('client');
              setError(null);
            }}
          >
            契約者
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'admin'}
            className={mode === 'admin' ? 'seg on' : 'seg'}
            onClick={() => {
              setMode('admin');
              setError(null);
            }}
          >
            管理者
          </button>
        </div>

        <form onSubmit={onSubmit} className="form">
          <label className="field">
            <span className="field-label">{mode === 'client' ? '契約者ID' : 'メールアドレス'}</span>
            <input
              className="input"
              type={mode === 'client' ? 'text' : 'email'}
              inputMode={mode === 'client' ? 'text' : 'email'}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={mode === 'client' ? 'tanaka01' : 'you@example.com'}
              required
            />
          </label>

          <label className="field">
            <span className="field-label">パスワード</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error !== null && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button className="button-primary" type="submit" disabled={busy}>
            {busy ? 'ログイン中…' : 'ログイン'}
          </button>
        </form>

        <p className="auth-note">
          パスワードが分からないときは、トレーナーにお問い合わせください。
        </p>
      </main>
    </div>
  );
}
