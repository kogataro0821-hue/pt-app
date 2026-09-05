import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { APP_NAME } from '@/config/firebase';
import { versionLine } from '@/config/version';
import { refreshToLatest } from '@/lib/refresh';
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
  settings,
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
  /**
   * メニューに入れる「設定」の行き先（追加仕様: メニュー）。
   *
   * ★ 行き先は画面ごとに違うので、ここでは決めません。
   *   契約者本人は自分の設定（AIの同意・パスワード）、
   *   管理者は「いま見ている契約者」の設定です。
   *   どちらの設定なのかを取り違えると、他人の設定を開くことになります。
   *
   * ★ 行き先が無い画面（契約者一覧・食品マスタなど）では渡しません。
   *   押しても行くところが無い項目を並べるくらいなら、出さないほうが親切です。
   */
  settings?: { to: string; label: string } | undefined;
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
          <AppMenu
            settings={settings}
            onChangePassword={onChangePassword}
            onSignOut={() => void signOutNow()}
          />
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

/**
 * 右上のメニュー（追加仕様: メニュー）。
 *
 * ★ 「設定」「パスワードの変更」「ログアウト」をここにまとめます。
 *
 *   以前は「パスワード」と「ログアウト」を上部に並べていました。
 *   置き場所としては最悪です。**画面のいちばん押しやすい所に、
 *   いちばん押してほしくない操作（ログアウト）が常時出ている**からです。
 *   スマホで戻るつもりが指がかすって落ちる、が起こります。
 *
 *   一段しまうと、うっかりは起きません。
 *   探す手間は1回だけ増えますが、それは覚えれば終わる手間です。
 *
 * ★ 管理者・契約者のどちらにも同じ形で出します。
 *   中身（設定の行き先）だけが変わります。
 */
function AppMenu({
  settings,
  onChangePassword,
  onSignOut,
}: {
  settings: { to: string; label: string } | undefined;
  onChangePassword: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // ★ 外側を触ったら閉じます。
    //   開いたまま別の場所を押して「押したのに何も起きない」を防ぎます。
    const onPointerDown = (event: Event) => {
      const box = boxRef.current;
      if (box !== null && !box.contains(event.target as Node)) setOpen(false);
    };

    // ★ Esc でも閉じ、押し元へ戻します。
    //   キーボードだけで使う人が、閉じたあと行き場を失わないようにです。
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="appmenu" ref={boxRef}>
      <button
        ref={buttonRef}
        className="appmenu-button"
        type="button"
        aria-label="メニュー"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MenuIcon />
      </button>

      {open && (
        <div className="appmenu-panel" role="menu">
          {settings !== undefined && (
            <Link
              className="appmenu-item"
              role="menuitem"
              to={settings.to}
              onClick={() => setOpen(false)}
            >
              {settings.label}
            </Link>
          )}

          <button
            className="appmenu-item"
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              onChangePassword();
            }}
          >
            パスワードの変更
          </button>

          {/* ★ ログアウトだけ線で区切り、色も変えます。
                 他の項目は「戻れる」操作、これだけは「出る」操作です。
                 同じ見た目で並べると、流れで押してしまいます。 */}
          <span className="appmenu-sep" aria-hidden="true" />

          <button
            className="appmenu-item appmenu-signout"
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            ログアウト
          </button>

          {/* ★ 版と、最新に入れ替えるボタン（追加仕様: 版の表示）。
                 いちばん下に、目立たない大きさで置きます。
                 毎日見るものではなく、困ったときにだけ要るものです。 */}
          <span className="appmenu-sep" aria-hidden="true" />

          <span className="appmenu-version">{versionLine()}</span>

          <button
            className="appmenu-item appmenu-refresh"
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              void refreshToLatest();
            }}
          >
            最新に更新する
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * メニューの絵（三本線）。
 *
 * ★ ベルと同じ理由で、絵文字ではなく図形で描いています。
 *   絵文字は端末ごとに形も色も変わります。
 */
function MenuIcon() {
  return (
    <svg className="appmenu-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M4 7h16M4 12h16M4 17h16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
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
