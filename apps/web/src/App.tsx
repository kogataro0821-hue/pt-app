import { useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { currentMonthKey, isValidDateKey, isValidMonthKey } from '@pt/core';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { LoginScreen } from '@/features/auth/LoginScreen';
import { PasswordChangeScreen } from '@/features/auth/PasswordChangeScreen';
import { ClientListScreen } from '@/features/clients/ClientListScreen';
import { ClientCreateScreen } from '@/features/clients/ClientCreateScreen';
import { ClientEditScreen } from '@/features/clients/ClientEditScreen';
import { ClientGate } from '@/features/clients/ClientGate';
import { CalendarScreen } from '@/features/calendar/CalendarScreen';
import { DayScreen } from '@/features/days/DayScreen';
import { WeightScreen } from '@/features/weight/WeightScreen';
import { AppShell } from '@/features/shell/AppShell';

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

  return <AppRoutes onChangePassword={() => setChangingPassword(true)} />;
}

/**
 * 画面とURLの対応（設計書 §11.1）。
 *
 * URLと画面を結び付けておくと、次の3つが自然に手に入ります。
 *   ・ブラウザの戻るボタンが効く
 *   ・「この日を見て」とURLを共有できる
 *   ・ホーム画面に追加したときに、開きたい画面を指定できる
 */
function AppRoutes({ onChangePassword }: { onChangePassword: () => void }) {
  const { state } = useAuth();
  const user = state.status === 'signedIn' ? state.user : null;
  const isAdmin = user?.role === 'admin';

  return (
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

      <Route path="*" element={<NotFoundRoute onChangePassword={onChangePassword} />} />
    </Routes>
  );
}

// -----------------------------------------------------------------------------
// 各ルートの中身
// -----------------------------------------------------------------------------

function Shell({
  children,
  onChangePassword,
  viewing,
}: {
  children: React.ReactNode;
  onChangePassword: () => void;
  viewing?: { clientId: string; displayName: string };
}) {
  return (
    <AppShell onChangePassword={onChangePassword} viewing={viewing}>
      {children}
    </AppShell>
  );
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
        >
          <div className="section-head">
            <h2 className="title">
              {client.displayName.length > 0 ? client.displayName : client.clientId}
            </h2>
            {isAdmin && (
              <Link className="button-quiet compact" to={`/clients/${client.clientId}/settings`}>
                設定
              </Link>
            )}
          </div>
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
        >
          <WeightScreen client={client} />
        </Shell>
      )}
    </ClientGate>
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
