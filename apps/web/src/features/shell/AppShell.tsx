import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { APP_NAME } from '@/config/firebase';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  clearRequestCount,
  ensureRequestCount,
  requestCountSnapshot,
  subscribeRequestCount,
} from '@/features/foods/requestCount';

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
  bell,
  onChangePassword,
}: {
  children: ReactNode;
  /** 管理者が誰かのデータを見ているときだけ渡す */
  viewing?: { clientId: string; displayName: string } | undefined;
  /**
   * お知らせのベル（追加仕様: お知らせ欄）。契約者の画面でだけ渡します。
   *
   * ★ 件数はここで数えません。渡してもらいます。
   *   数えるには契約者ドキュメントが要りますが、それを持っているのは
   *   ClientGate を通った画面だけです。この外枠に読ませると、
   *   同じものをもう一度読むことになります（読み取りが2倍）。
   */
  bell?: { to: string; unread: number } | undefined;
  onChangePassword: () => void;
}) {
  const { state, signOutNow } = useAuth();
  const isAdmin = state.status === 'signedIn' && state.user.role === 'admin';

  // 未処理の登録依頼の件数。契約者は読めないので、管理者のときだけ数えます。
  const pendingRequests = useSyncExternalStore(subscribeRequestCount, requestCountSnapshot);
  useEffect(() => {
    if (isAdmin) {
      void ensureRequestCount();
      return;
    }
    // ★ 管理者でなくなったら（ログアウト・契約者に切り替わった）、覚えていた数を捨てます。
    //   画面には出ませんが、前の人のものを持ち続ける理由がありません。
    clearRequestCount();
  }, [isAdmin]);

  return (
    <div className="app">
      <header className="appbar">
        <h1>
          <Link to="/" className="appbar-home">
            {APP_NAME}
          </Link>
        </h1>
        <div className="appbar-actions">
          {bell !== undefined && (
            <Link className="appbar-bell" to={bell.to} aria-label={bellLabel(bell.unread)}>
              <BellIcon />
              {bell.unread > 0 && (
                <span className="appbar-bell-badge">{bell.unread > 99 ? '99+' : bell.unread}</span>
              )}
            </Link>
          )}
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
          <AdminLink to="/foods/requests" label="登録依頼" badge={pendingRequests} />
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

function bellLabel(unread: number): string {
  return unread > 0 ? `お知らせ（新しいものが${unread}件）` : 'お知らせ';
}

/**
 * ベルの絵。
 *
 * ★ 絵文字ではなく図形で描いています。
 *   絵文字は端末ごとに形も色も変わり、iPhone では原色の黄色になります。
 *   画面の色を決めているのに、そこだけ別の絵になります。
 */
function BellIcon() {
  return (
    <svg className="bell-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 3a5.5 5.5 0 0 0-5.5 5.5v3.2L5 15.2h14l-1.5-3.5V8.5A5.5 5.5 0 0 0 12 3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M10 17.5a2 2 0 0 0 4 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 現在地に印を付けるリンク。/foods と /foods/requests を取り違えないように。 */
function AdminLink({
  to,
  label,
  badge,
}: {
  to: string;
  label: string;
  /** 数が分かっていて、かつ1件以上のときだけ出す。0件のときは何も出しません */
  badge?: number | null;
}) {
  const { pathname } = useLocation();
  const current = to === '/foods' ? pathname === '/foods' : pathname.startsWith(to);

  return (
    <Link className={current ? 'admin-link current' : 'admin-link'} to={to}>
      {label}
      {badge !== undefined && badge !== null && badge > 0 && (
        // ★ 3桁になると横並びが崩れるので、そこで打ち切ります。
        //   ここまで溜まっていれば、正確な数より「溜まっている」ことが大事です。
        <span className="admin-badge" aria-label={`未処理の依頼が${badge}件`}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}
