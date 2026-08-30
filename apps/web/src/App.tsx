import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { currentMonthKey, isValidDateKey, isValidMonthKey } from '@pt/core';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { LoginScreen } from '@/features/auth/LoginScreen';
import { PasswordChangeScreen } from '@/features/auth/PasswordChangeScreen';
import { ClientListScreen } from '@/features/clients/ClientListScreen';
import { ClientCreateScreen } from '@/features/clients/ClientCreateScreen';
import { ClientEditScreen } from '@/features/clients/ClientEditScreen';
import { ClientGate } from '@/features/clients/ClientGate';
import { FoodsScreen } from '@/features/foods/FoodsScreen';
import { RequestsScreen } from '@/features/foods/RequestsScreen';
import type { Client } from '@/features/clients/clientTypes';
import { CalendarScreen } from '@/features/calendar/CalendarScreen';
import { MemberCard } from '@/features/rank/MemberCard';
import { DayScreen } from '@/features/days/DayScreen';
import { WeightScreen } from '@/features/weight/WeightScreen';
import { AiConsentCard } from '@/features/ai/AiConsentCard';
import { AppShell } from '@/features/shell/AppShell';
import { NoticesScreen } from '@/features/notices/NoticesScreen';
import { unreadNoticeCount } from '@/features/notices/noticesRepo';

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

/**
 * ログイン状態による振り分け（設計書 §6.4）。
 *
 * ★ ここでの出し分けは「見せ方」でしかありません。
 *   本当の権限判定は Firestore Security Rules が行います（設計書 §7.1）。
 *   この画面の判定を書き換えても、他人のデータは1バイトも取れません。
 */
function Gate() {
  const { state, signOutNow } = useAuth();
  const [changingPassword, setChangingPassword] = useState(false);
  /**
   * このセッションでパスワード変更を済ませたユーザーのUID。
   *
   * 本来の判定は clients/{clientId}.passwordChangedAt です。
   * ただし、その記録の書き込みだけが失敗した場合に画面から出られなくなるため、
   * 二重の安全網としてセッション内でも覚えておきます。
   * UIDを持つのは、ログアウトして別の人がログインしたときに引きずらないためです。
   */
  const [changedUid, setChangedUid] = useState<string | null>(null);

  /**
   * 「ログアウト状態を通ったか」の目印。
   *
   * ★ この目印を Gate が持っているのには理由があります。
   *   ログイン画面が出ている間、この下の AppRoutes は存在しません。
   *   下に置くと、ログアウト状態を一度も見られないまま消えてしまい、
   *   「ログインした直後かどうか」を判断できません。
   *   ログイン前後で消えないここに置きます。
   */
  const sawSignedOut = useRef(false);

  useEffect(() => {
    if (state.status === 'signedOut') sawSignedOut.current = true;
  }, [state.status]);

  if (state.status === 'loading') return <Splash />;
  if (state.status === 'signedOut') return <LoginScreen />;

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
  const mustChange =
    state.user.role === 'client' &&
    state.user.passwordChangedAt === null &&
    changedUid !== state.user.uid;

  if (mustChange || changingPassword) {
    const uid = state.user.uid;
    return (
      <PasswordChangeScreen
        required={mustChange}
        onDone={() => {
          setChangedUid(uid);
          setChangingPassword(false);
        }}
        onCancel={() => setChangingPassword(false)}
      />
    );
  }

  return (
    <AppRoutes onChangePassword={() => setChangingPassword(true)} sawSignedOut={sawSignedOut} />
  );
}

/**
 * 画面とURLの対応（設計書 §11.1）。
 *
 * URLと画面を結び付けておくと、次の3つが自然に手に入ります。
 *   ・ブラウザの戻るボタンが効く
 *   ・「この日を見て」とURLを共有できる
 *   ・ホーム画面に追加したときに、開きたい画面を指定できる
 */
function AppRoutes({
  onChangePassword,
  sawSignedOut,
}: {
  onChangePassword: () => void;
  sawSignedOut: React.MutableRefObject<boolean>;
}) {
  const { state } = useAuth();
  const user = state.status === 'signedIn' ? state.user : null;
  const isAdmin = user?.role === 'admin';

  return (
    <>
      <LandOnHomeAfterLogin sawSignedOut={sawSignedOut} />
      <Routes>
      <Route
        path="/"
        element={
          isAdmin ? (
            <Navigate to="/clients" replace />
          ) : user?.clientId !== null && user?.clientId !== undefined ? (
            <Navigate to={`/c/${user.clientId}`} replace />
          ) : (
            <Shell onChangePassword={onChangePassword}>
              <p className="lede">表示できる記録がありません。</p>
            </Shell>
          )
        }
      />

      {/* ---- 管理者だけの画面 ------------------------------------------- */}
      <Route
        path="/clients"
        element={
          <AdminOnly isAdmin={isAdmin === true} onChangePassword={onChangePassword}>
            <ClientListRoute />
          </AdminOnly>
        }
      />
      <Route
        path="/clients/new"
        element={
          <AdminOnly isAdmin={isAdmin === true} onChangePassword={onChangePassword}>
            <ClientCreateRoute />
          </AdminOnly>
        }
      />
      <Route
        path="/clients/:clientId/settings"
        element={
          <AdminOnly isAdmin={isAdmin === true} onChangePassword={onChangePassword}>
            <ClientEditRoute />
          </AdminOnly>
        }
      />

      {/* 共通食品マスタと登録依頼。数字の出どころなので管理者だけが触れます（設計書 §21） */}
      <Route
        path="/foods"
        element={
          <AdminOnly isAdmin={isAdmin === true} onChangePassword={onChangePassword}>
            <FoodsScreen />
          </AdminOnly>
        }
      />
      <Route
        path="/foods/requests"
        element={
          <AdminOnly isAdmin={isAdmin === true} onChangePassword={onChangePassword}>
            <RequestsScreen />
          </AdminOnly>
        }
      />

      {/* ---- カレンダーと日別（管理者は全員分、契約者は自分の分だけ）---- */}
      <Route path="/c/:clientId" element={<MonthRedirect />} />
      <Route
        path="/c/:clientId/m/:month"
        element={<CalendarRoute onChangePassword={onChangePassword} />}
      />
      <Route path="/c/:clientId/d/:date" element={<DayRoute onChangePassword={onChangePassword} />} />
      <Route
        path="/c/:clientId/weight"
        element={<WeightRoute onChangePassword={onChangePassword} />}
      />
      <Route
        path="/c/:clientId/settings"
        element={<ClientSettingsRoute onChangePassword={onChangePassword} />}
      />
      <Route
        path="/c/:clientId/notices"
        element={<NoticesRoute onChangePassword={onChangePassword} />}
      />

      <Route path="*" element={<NotFoundRoute onChangePassword={onChangePassword} />} />
      </Routes>
    </>
  );
}

/**
 * ログインした直後は、その人の「持ち場」から始める（設計書 §11.1）。
 *
 *   契約者 … 自分のカレンダー
 *   管理者 … 契約者一覧
 *
 * ★ 判定に使うのは「ログアウト状態を経由したか」です。
 *
 *   ログイン画面から入ったときだけ移動し、
 *   ページを開き直しただけのとき（ログイン状態が残っている）は移動しません。
 *   常に飛ばしてしまうと、「この日を見て」と渡したURLを開いても
 *   カレンダーに戻されてしまい、URLを共有できる利点が消えます。
 *
 *   行き先を '/' にしているのは、役割ごとの振り分けが
 *   すでにそこに1か所だけ書いてあるためです。二重に持ちません。
 */
function LandOnHomeAfterLogin({
  sawSignedOut,
}: {
  sawSignedOut: React.MutableRefObject<boolean>;
}) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!sawSignedOut.current) return;
    sawSignedOut.current = false;
    navigate('/', { replace: true });
  }, [navigate, sawSignedOut]);

  return null;
}

// -----------------------------------------------------------------------------
// 各ルートの中身
// -----------------------------------------------------------------------------

function Shell({
  children,
  onChangePassword,
  viewing,
  bell,
  settings,
}: {
  children: React.ReactNode;
  onChangePassword: () => void;
  viewing?: { clientId: string; displayName: string };
  bell?: { to: string; unread: number };
  settings?: { to: string; label: string };
}) {
  return (
    <AppShell
      onChangePassword={onChangePassword}
      viewing={viewing}
      bell={bell}
      settings={settings}
    >
      {children}
    </AppShell>
  );
}

/**
 * メニューの「設定」の行き先（追加仕様: メニュー）。
 *
 * ★ 同じ「設定」でも、開く先が違います。
 *
 *   契約者本人 … /c/{id}/settings（AIの同意・自分のパスワード）
 *   管理者     … /clients/{id}/settings（目標値・権限・ランクなど）
 *
 *   管理者に前者を出すと、代われない同意の画面へ連れて行くことになります。
 *   文言も変えて、「誰の設定を開くのか」が押す前に分かるようにします。
 */
function settingsFor(client: Client, isAdmin: boolean) {
  return isAdmin
    ? { to: `/clients/${client.clientId}/settings`, label: '契約者の設定' }
    : { to: `/c/${client.clientId}/settings`, label: '設定' };
}

/**
 * ベルに出すもの（追加仕様: お知らせ欄）。
 *
 * ★ 契約者本人のときだけ出します。
 *
 *   管理者が誰かの画面を見ているときにベルを出すと、
 *   「自分あてのお知らせ」と見分けが付きません。
 *   管理者に届くお知らせは、そもそもありません（自分で書いたものだけになります）。
 *
 * ★ 数えるための通信はありません。
 *   client はこの画面に来る前にすでに読んであります。
 */
function bellFor(client: Client, isAdmin: boolean) {
  if (isAdmin) return undefined;
  return { to: `/c/${client.clientId}/notices`, unread: unreadNoticeCount(client) };
}

function AdminOnly({
  isAdmin,
  onChangePassword,
  children,
}: {
  isAdmin: boolean;
  onChangePassword: () => void;
  children: React.ReactNode;
}) {
  if (!isAdmin) return <Navigate to="/" replace />;
  return <Shell onChangePassword={onChangePassword}>{children}</Shell>;
}

function ClientListRoute() {
  const navigate = useNavigate();
  return (
    <ClientListScreen
      onCreate={() => navigate('/clients/new')}
      onOpen={(clientId) => navigate(`/c/${clientId}`)}
      onSettings={(clientId) => navigate(`/clients/${clientId}/settings`)}
    />
  );
}

function ClientCreateRoute() {
  const navigate = useNavigate();
  return (
    <ClientCreateScreen
      onDone={(clientId) => navigate(`/clients/${clientId}/settings`, { replace: true })}
      onCancel={() => navigate('/clients')}
    />
  );
}

function ClientEditRoute() {
  const navigate = useNavigate();
  const { clientId } = useParams();
  if (clientId === undefined) return <Navigate to="/clients" replace />;
  return <ClientEditScreen clientId={clientId} onBack={() => navigate('/clients')} />;
}

/** /c/xxx を今月のカレンダーへ送る */
function MonthRedirect() {
  const { clientId } = useParams();
  if (clientId === undefined) return <Navigate to="/" replace />;
  return <Navigate to={`/c/${clientId}/m/${currentMonthKey()}`} replace />;
}

function CalendarRoute({ onChangePassword }: { onChangePassword: () => void }) {
  const { clientId, month } = useParams();
  if (clientId === undefined) return <Navigate to="/" replace />;
  if (month === undefined || !isValidMonthKey(month)) {
    return <Navigate to={`/c/${clientId}/m/${currentMonthKey()}`} replace />;
  }

  return (
    <ClientGate
      clientId={clientId}
      wrap={(node) => <Shell onChangePassword={onChangePassword}>{node}</Shell>}
    >
      {(client, isAdmin) => (
        <Shell
          onChangePassword={onChangePassword}
          viewing={
            isAdmin ? { clientId: client.clientId, displayName: client.displayName } : undefined
          }
          bell={bellFor(client, isAdmin)}
          settings={settingsFor(client, isAdmin)}
        >
          {/* ★ 会員証はカレンダーの上に置きます（追加仕様: 会員ランク）。
                 画面を開いた瞬間に目に入る場所です。
                 名前は会員証に入っているので、見出しは出しません。

                 ここにあった管理者向けの「設定」は、右上のメニューへ移しました。
                 同じ行き先が2か所にあると、片方を直し忘れます。 */}
          <MemberCard client={client} isAdmin={isAdmin} />
          <CalendarScreen clientId={client.clientId} month={month} />
        </Shell>
      )}
    </ClientGate>
  );
}

function DayRoute({ onChangePassword }: { onChangePassword: () => void }) {
  const { clientId, date } = useParams();
  if (clientId === undefined) return <Navigate to="/" replace />;
  if (date === undefined || !isValidDateKey(date)) {
    return <Navigate to={`/c/${clientId}`} replace />;
  }

  return (
    <ClientGate
      clientId={clientId}
      wrap={(node) => <Shell onChangePassword={onChangePassword}>{node}</Shell>}
    >
      {(client, isAdmin) => (
        <Shell
          onChangePassword={onChangePassword}
          viewing={
            isAdmin ? { clientId: client.clientId, displayName: client.displayName } : undefined
          }
          bell={bellFor(client, isAdmin)}
          settings={settingsFor(client, isAdmin)}
        >
          <DayScreen client={client} date={date} isAdmin={isAdmin} />
        </Shell>
      )}
    </ClientGate>
  );
}

function WeightRoute({ onChangePassword }: { onChangePassword: () => void }) {
  const { clientId } = useParams();
  if (clientId === undefined) return <Navigate to="/" replace />;

  return (
    <ClientGate
      clientId={clientId}
      wrap={(node) => <Shell onChangePassword={onChangePassword}>{node}</Shell>}
    >
      {(client, isAdmin) => (
        <Shell
          onChangePassword={onChangePassword}
          viewing={
            isAdmin ? { clientId: client.clientId, displayName: client.displayName } : undefined
          }
          bell={bellFor(client, isAdmin)}
          settings={settingsFor(client, isAdmin)}
        >
          <WeightScreen client={client} />
        </Shell>
      )}
    </ClientGate>
  );
}

/** お知らせの一覧（追加仕様: お知らせ欄）。 */
function NoticesRoute({ onChangePassword }: { onChangePassword: () => void }) {
  const { clientId } = useParams();
  if (clientId === undefined) return <Navigate to="/" replace />;

  return (
    <ClientGate
      clientId={clientId}
      wrap={(node) => <Shell onChangePassword={onChangePassword}>{node}</Shell>}
    >
      {(client, isAdmin) => (
        <Shell
          onChangePassword={onChangePassword}
          viewing={
            isAdmin ? { clientId: client.clientId, displayName: client.displayName } : undefined
          }
          bell={bellFor(client, isAdmin)}
          settings={settingsFor(client, isAdmin)}
        >
          <NoticesScreen client={client} isAdmin={isAdmin} />
        </Shell>
      )}
    </ClientGate>
  );
}

/** 契約者本人の設定（AI同意など）。管理者から見ると閲覧のみになる。 */
function ClientSettingsRoute({ onChangePassword }: { onChangePassword: () => void }) {
  const { clientId } = useParams();
  if (clientId === undefined) return <Navigate to="/" replace />;

  return (
    <ClientGate
      clientId={clientId}
      wrap={(node) => <Shell onChangePassword={onChangePassword}>{node}</Shell>}
    >
      {(client, isAdmin) => (
        <Shell
          onChangePassword={onChangePassword}
          viewing={
            isAdmin ? { clientId: client.clientId, displayName: client.displayName } : undefined
          }
          bell={bellFor(client, isAdmin)}
          settings={settingsFor(client, isAdmin)}
        >
          <ClientSettings client={client} isAdmin={isAdmin} onChangePassword={onChangePassword} />
        </Shell>
      )}
    </ClientGate>
  );
}

function ClientSettings({
  client,
  isAdmin,
  onChangePassword,
}: {
  client: Client;
  isAdmin: boolean;
  onChangePassword: () => void;
}) {
  const [current, setCurrent] = useState(client);

  return (
    <>
      <div className="section-head">
        <Link className="button-quiet back" to={`/c/${client.clientId}`}>
          ‹ カレンダー
        </Link>
      </div>

      <h2 className="title">設定</h2>

      <AiConsentCard
        client={current}
        isSelf={!isAdmin}
        onChanged={(aiConsent) => setCurrent({ ...current, aiConsent })}
      />

      {!isAdmin && (
        <section className="card">
          <h3 className="card-title">パスワード</h3>
          <p className="note">ご自身だけが知っているパスワードに変更できます。</p>
          <button className="button-secondary" type="button" onClick={onChangePassword}>
            パスワードを変更する
          </button>
        </section>
      )}
    </>
  );
}

function NotFoundRoute({ onChangePassword }: { onChangePassword: () => void }) {
  return (
    <Shell onChangePassword={onChangePassword}>
      <section className="card warn">
        <h3 className="card-title">ページが見つかりません</h3>
        <p className="note">アドレスが間違っているかもしれません。</p>
        <Link className="button-secondary" to="/">
          最初の画面へ
        </Link>
      </section>
    </Shell>
  );
}

// -----------------------------------------------------------------------------

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
