import { useState } from 'react';
import { APP_NAME } from '@/config/firebase';
import { useAuth } from '@/features/auth/AuthProvider';
import { ClientListScreen } from '@/features/clients/ClientListScreen';
import { ClientCreateScreen } from '@/features/clients/ClientCreateScreen';
import { ClientEditScreen } from '@/features/clients/ClientEditScreen';

/**
 * 管理者の画面（設計書 §11.3）。
 *
 * Phase 4 の時点では契約者管理だけです。
 * カレンダーや食事の閲覧は Phase 5 以降で足していきます。
 *
 * 画面の切り替えは、いまは状態で持っています。
 * 画面が増える Phase 5 で、URLと連動するルーティングに置き換えます。
 */
type View = { name: 'list' } | { name: 'create' } | { name: 'edit'; clientId: string };

export function AdminScreen({ onChangePassword }: { onChangePassword: () => void }) {
  const { signOutNow } = useAuth();
  const [view, setView] = useState<View>({ name: 'list' });

  return (
    <div className="app">
      <header className="appbar">
        <h1>{APP_NAME}</h1>
        <div className="appbar-actions">
          <button className="appbar-action" type="button" onClick={onChangePassword}>
            パスワード
          </button>
          <button className="appbar-action" type="button" onClick={() => void signOutNow()}>
            ログアウト
          </button>
        </div>
      </header>

      <main className="main">
        {view.name === 'list' && (
          <ClientListScreen
            onCreate={() => setView({ name: 'create' })}
            onOpen={(clientId) => setView({ name: 'edit', clientId })}
          />
        )}

        {view.name === 'create' && (
          <ClientCreateScreen
            onDone={(clientId) => setView({ name: 'edit', clientId })}
            onCancel={() => setView({ name: 'list' })}
          />
        )}

        {view.name === 'edit' && (
          <ClientEditScreen clientId={view.clientId} onBack={() => setView({ name: 'list' })} />
        )}
      </main>
    </div>
  );
}
