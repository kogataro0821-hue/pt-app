import { useCallback, useEffect, useState } from 'react';
import { listClients } from './clientsRepo';
import { reviewModeLabel, type Client } from './clientTypes';

/**
 * 契約者の一覧（設計書 §11.3 A-1）。
 *
 * 管理者だけが開けます。Rules 側でも `clients` の一覧取得は管理者に限定しています。
 */
export function ClientListScreen({
  onCreate,
  onOpen,
}: {
  onCreate: () => void;
  onOpen: (clientId: string) => void;
}) {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setClients(await listClients());
    } catch {
      setError('契約者の一覧を読み込めませんでした。通信状態を確認してください。');
      setClients([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const provisioning = (clients ?? []).filter((c) => c.provisionStatus !== 'ready');
  const ready = (clients ?? []).filter((c) => c.provisionStatus === 'ready');

  return (
    <>
      <div className="section-head">
        <h2 className="title">契約者</h2>
        <button className="button-primary compact" type="button" onClick={onCreate}>
          + 追加
        </button>
      </div>

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {clients === null && <p className="lede">読み込んでいます…</p>}

      {clients !== null && clients.length === 0 && error === null && (
        <section className="card">
          <p className="lede">まだ契約者が登録されていません。</p>
          <p className="note">
            「+ 追加」から登録できます。契約者IDと初期パスワードを決めて、
            本人に口頭でお伝えください。初回ログイン時にパスワードの変更を求められます。
          </p>
        </section>
      )}

      {provisioning.length > 0 && (
        <section className="card warn">
          <h3 className="card-title">未完了の契約者</h3>
          <p className="note">
            作成の途中で止まっています。開いて「作成をやり直す」か、削除してください。
          </p>
          {provisioning.map((client) => (
            <ClientRow key={client.clientId} client={client} onOpen={onOpen} />
          ))}
        </section>
      )}

      {ready.length > 0 && (
        <section className="card">
          {ready.map((client) => (
            <ClientRow key={client.clientId} client={client} onOpen={onOpen} />
          ))}
        </section>
      )}
    </>
  );
}

function ClientRow({ client, onOpen }: { client: Client; onOpen: (id: string) => void }) {
  return (
    <button className="client-row" type="button" onClick={() => onOpen(client.clientId)}>
      <span className="client-main">
        <span className="client-name">
          {client.displayName.length > 0 ? client.displayName : client.clientId}
        </span>
        <span className="client-meta">
          {client.clientId} · {client.targets.kcal}kcal · {reviewModeLabel(client.reviewMode)}
        </span>
      </span>
      {!client.active && <span className="badge wait">無効</span>}
      {client.active && client.passwordChangedAt === null && (
        <span className="badge wait">初期パスワード</span>
      )}
      <span className="chevron" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
