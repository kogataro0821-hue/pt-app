import { useState, type FormEvent } from 'react';
import { LoginError, useAuth } from './AuthProvider';
import { authErrorMessage } from './authTypes';

/** パスワードの最低文字数。Firebase 側の下限は6文字だが、もう少し厳しくする。 */
const MIN_LENGTH = 8;

/**
 * パスワード変更画面（設計書 §6.5）。
 *
 * `required` が true のときは初回ログイン直後で、変更するまで先へ進めません。
 * 管理者が口頭で伝えた初期パスワードのまま使い続けるのを防ぎます。
 */
export function PasswordChangeScreen({
  required,
  onDone,
  onCancel,
}: {
  required: boolean;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { changePassword, signOutNow } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function validate(): string | null {
    if (next.length < MIN_LENGTH) return `新しいパスワードは${MIN_LENGTH}文字以上にしてください。`;
    if (next !== confirm) return '確認用のパスワードが一致しません。';
    if (next === current) return '現在のパスワードとは違うものにしてください。';
    return null;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    const problem = validate();
    if (problem !== null) {
      setError(problem);
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await changePassword(current, next);
      onDone();
    } catch (e) {
      setError(authErrorMessage(e instanceof LoginError ? e.kind : 'unknown'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <main className="auth-card">
        <h1 className="auth-title">パスワードの変更</h1>
        <p className="auth-lede">
          {required
            ? '初回ログインです。ご自身だけが知っているパスワードに変更してください。'
            : '新しいパスワードを設定します。'}
        </p>

        <form onSubmit={onSubmit} className="form">
          <label className="field">
            <span className="field-label">現在のパスワード</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </label>

          <label className="field">
            <span className="field-label">新しいパスワード（{MIN_LENGTH}文字以上）</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
          </label>

          <label className="field">
            <span className="field-label">新しいパスワード（確認）</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </label>

          {error !== null && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button className="button-primary" type="submit" disabled={busy}>
            {busy ? '変更中…' : 'パスワードを変更する'}
          </button>

          {required ? (
            <button className="button-quiet" type="button" onClick={() => void signOutNow()}>
              ログアウト
            </button>
          ) : (
            onCancel !== undefined && (
              <button className="button-quiet" type="button" onClick={onCancel}>
                やめる
              </button>
            )
          )}
        </form>
      </main>
    </div>
  );
}
