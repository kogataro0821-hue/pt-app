import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { APP_NAME } from '@/config/firebase';
import { useAuth } from '@/features/auth/AuthProvider';

/**
 * 全画面共通の外枠（設計書 §11.1）。
 *
 * ★ 「いま誰のデータを見ているか」を常に画面上部に出します。
 *   管理者は複数の契約者を行き来するため、これが無いと
 *   別人の記録を書き換える事故が起きます。
 */
export function AppShell({
  children,
  viewing,
  onChangePassword,
}: {
  children: ReactNode;
  /** 管理者が誰かのデータを見ているときだけ渡す */
  viewing?: { clientId: string; displayName: string } | undefined;
  onChangePassword: () => void;
}) {
  const { state, signOutNow } = useAuth();
  const isAdmin = state.status === 'signedIn' && state.user.role === 'admin';

  return (
    <div className="app">
      <header className="appbar">
        <h1>
          <Link to="/" className="appbar-home">
            {APP_NAME}
          </Link>
        </h1>
        <div className="appbar-actions">
          <button className="appbar-action" type="button" onClick={onChangePassword}>
            パスワード
          </button>
          <button className="appbar-action" type="button" onClick={() => void signOutNow()}>
            ログアウト
          </button>
        </div>
      </header>

      {/* 管理者だけの行き先。契約者には出しません（本当の制限は Rules 側）*/}
      {isAdmin && (
        <nav className="admin-nav">
          <AdminLink to="/clients" label="契約者" />
          <AdminLink to="/foods" label="食品マスタ" />
          <AdminLink to="/foods/requests" label="登録依頼" />
        </nav>
      )}

      {isAdmin && viewing !== undefined && (
        <div className="viewing-bar">
          <span className="viewing-label">閲覧中</span>
          <span className="viewing-name">
            {viewing.displayName.length > 0 ? viewing.displayName : viewing.clientId}
          </span>
          <Link className="viewing-exit" to="/clients">
            契約者一覧へ
          </Link>
        </div>
      )}

      <main className="main">{children}</main>
    </div>
  );
}

/** 現在地に印を付けるリンク。/foods と /foods/requests を取り違えないように。 */
function AdminLink({ to, label }: { to: string; label: string }) {
  const { pathname } = useLocation();
  const current = to === '/foods' ? pathname === '/foods' : pathname.startsWith(to);

  return (
    <Link className={current ? 'admin-link current' : 'admin-link'} to={to}>
      {label}
    </Link>
  );
}
