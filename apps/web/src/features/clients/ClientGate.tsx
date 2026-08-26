import { useEffect, useState, type ReactNode } from 'react';
import { checkClientId } from '@pt/core';
import { useAuth } from '@/features/auth/AuthProvider';
import { getClient } from './clientsRepo';
import type { Client } from './clientTypes';

/**
 * URL の契約者IDを受け取り、その契約者を読み込んでから中身を描く。
 *
 * ★ ここで「契約者が他人のURLを直接開いた」場合を弾きます。
 *   ただしこれは画面を分かりやすくするためであって、防衛線ではありません。
 *   仮にこの判定を消しても、Firestore Security Rules が読み取りを拒否するので
 *   他人のデータは1バイトも出てきません（設計書 §7.1）。
 */
export function ClientGate({
  clientId,
  children,
  wrap = (node) => node,
}: {
  clientId: string;
  children: (client: Client, isAdmin: boolean) => ReactNode;
  /** 読み込み中やエラーのときも、共通の外枠の中に収めるための包み */
  wrap?: (node: ReactNode) => ReactNode;
}) {
  const { state } = useAuth();
  const [client, setClient] = useState<Client | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'notFound' | 'denied' | 'error'>(
    'loading',
  );

  const signedIn = state.status === 'signedIn' ? state.user : null;
  const isAdmin = signedIn?.role === 'admin';
  const allowed = isAdmin === true || signedIn?.clientId === clientId;
  const idOk = checkClientId(clientId).ok;

  useEffect(() => {
    let cancelled = false;

    if (!idOk) {
      setStatus('notFound');
      return;
    }
    if (!allowed) {
      setStatus('denied');
      return;
    }

    setStatus('loading');
    void (async () => {
      try {
        const loaded = await getClient(clientId);
        if (cancelled) return;
        if (loaded === null) {
          setStatus('notFound');
          return;
        }
        setClient(loaded);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId, allowed, idOk]);

  if (status === 'loading') return <>{wrap(<p className="lede">読み込んでいます…</p>)}</>;

  if (status === 'denied') {
    return (
      <>
        {wrap(
          <section className="card warn">
            <h3 className="card-title">このページは開けません</h3>
            <p className="note">ご自身の記録だけをご覧いただけます。</p>
          </section>,
        )}
      </>
    );
  }

  if (status === 'notFound') {
    return (
      <>
        {wrap(
          <section className="card warn">
            <h3 className="card-title">見つかりませんでした</h3>
            <p className="note">その契約者は存在しないか、削除されています。</p>
          </section>,
        )}
      </>
    );
  }

  if (status === 'error' || client === null) {
    return (
      <>
        {wrap(
          <section className="card warn">
            <h3 className="card-title">読み込めませんでした</h3>
            <p className="note">通信状態を確認して、もう一度お試しください。</p>
          </section>,
        )}
      </>
    );
  }

  return <>{children(client, isAdmin === true)}</>;
}
