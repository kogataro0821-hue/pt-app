import { useState } from 'react';
import { Link } from 'react-router-dom';
import { isUnread, type Notice, type NoticeKind } from '@pt/core';
import type { Client } from '@/features/clients/clientTypes';
import { markNoticesRead, noticeReadAt, visibleNotices } from './noticesRepo';

/**
 * お知らせの一覧（追加仕様: お知らせ欄）。
 *
 * ★ お知らせは、すでに手元にあります。
 *
 *   個人あてのものは契約者ドキュメントの中に入っていて、
 *   それはこの画面に来る前（カレンダーを開いた時点）で読み終わっています。
 *   全員向けのものはアプリに同梱です。
 *   **この画面を開いても、通信は1回も起きません。**
 *
 * ★ 「閉じる」でまとめて既読にします。
 *
 *   1件ずつ閉じられるほうが親切に見えますが、そうすると
 *   既読の印をお知らせと同じ数だけ持つことになります。
 *   契約者が書ける場所は Rules で絞ってあり、小さく保ちたいところです。
 *   「ここまで読んだ」という時刻を1つ持てば足ります。
 */
export function NoticesScreen({
  client,
  isAdmin,
}: {
  client: Client;
  /** 管理者が他人の画面を見ているときは、既読を付けません */
  isAdmin: boolean;
}) {
  const [readAt, setReadAt] = useState<number | null>(noticeReadAt(client));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notices = visibleNotices(client);
  const unread = notices.filter((n) => isUnread(n, readAt));

  async function closeAll() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setReadAt(await markNoticesRead(client));
    } catch {
      setError('既読にできませんでした。通信の状態を確認して、もう一度お試しください。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="section-head">
        <Link className="button-quiet back" to={`/c/${client.clientId}`}>
          ‹ カレンダー
        </Link>
      </div>

      <h2 className="title">お知らせ</h2>

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {notices.length === 0 ? (
        <section className="card">
          <p className="note">まだお知らせはありません。</p>
        </section>
      ) : (
        <>
          {unread.length > 0 && !isAdmin && (
            <div className="notice-actions">
              <span className="notice-unread-count">新しいお知らせが {unread.length} 件</span>
              <button
                className="button-secondary compact"
                type="button"
                onClick={() => void closeAll()}
                disabled={busy}
              >
                {busy ? '閉じています…' : 'すべて閉じる'}
              </button>
            </div>
          )}

          {isAdmin && (
            <p className="note">
              契約者本人に届いているお知らせです。ここでは既読になりません。
            </p>
          )}

          <ul className="notice-list">
            {notices.map((n) => (
              <NoticeRow
                key={n.id}
                notice={n}
                clientId={client.clientId}
                unread={isUnread(n, readAt)}
              />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function NoticeRow({
  notice,
  clientId,
  unread,
}: {
  notice: Notice;
  clientId: string;
  unread: boolean;
}) {
  return (
    <li className={`notice-item${unread ? ' unread' : ''}`}>
      <div className="notice-head">
        <span className={`badge notice-kind ${notice.kind}`}>{kindLabel(notice.kind)}</span>
        {unread && <span className="notice-dot" aria-label="新しいお知らせ" />}
        <time className="notice-at">{shortDate(notice.at)}</time>
      </div>
      <p className="notice-title">{notice.title}</p>
      {notice.body.length > 0 && <p className="notice-body">{notice.body}</p>}
      {notice.date !== null && (
        <Link className="button-quiet compact" to={`/c/${clientId}/d/${notice.date}`}>
          その日の記録を見る
        </Link>
      )}
    </li>
  );
}

export function kindLabel(kind: NoticeKind): string {
  switch (kind) {
    case 'welcome':
      return '登録';
    case 'rankUp':
      return '昇格';
    case 'comment':
      return 'コメント';
    case 'app':
      return 'アプリ';
  }
}

/** 日本時間の 'M月D日' */
function shortDate(at: number): string {
  const d = new Date(at + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}
