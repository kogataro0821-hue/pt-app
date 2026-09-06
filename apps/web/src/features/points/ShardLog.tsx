import { useCallback, useEffect, useState } from 'react';
import { formatLedgerAt, summarize, type LedgerEntry } from '@pt/core';
import { listLedger } from './pointsRepo';
import { Shards, ShardDelta } from './ShardIcon';

/**
 * かけらの帳簿（追加仕様: かけらの帳簿）。
 *
 * ★ 残すのは「人が動かしたぶん」だけです。
 *
 *   毎日の受け取り（+1）は入っていません。10人×365日で
 *   年に数千件になり、開くたびに重くなるわりに、
 *   「これまで◯日」で分かる話だからです。
 *   もめるのは、いつも人が動かしたほうです。
 *
 * ★ だから、合計は残高と一致しません。
 *
 *   これは不具合ではありません。画面にもその一言を出しています。
 *   書いておかないと「計算が合っていない」と見えます。
 */
export function ShardLog({ clientId, max = 100 }: { clientId: string; max?: number }) {
  const [rows, setRows] = useState<LedgerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await listLedger(clientId, max));
    } catch {
      setError('帳簿を読み込めませんでした。通信状態を確認してください。');
      setRows([]);
    }
  }, [clientId, max]);

  useEffect(() => {
    void load();
  }, [load]);

  if (rows === null) return <p className="note">読み込んでいます…</p>;

  if (error !== null) {
    return (
      <p className="form-error" role="alert">
        {error}
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="note">
        まだ動きがありません。ここには、渡したぶん・引いたぶん・交換したぶんが並びます
        （毎日たまるぶんは入りません）。
      </p>
    );
  }

  const { gained, spent } = summarize(rows);

  return (
    <>
      <p className="note">
        渡した <Shards n={gained} /> ／ 使った <Shards n={spent} />
        <br />
        毎日たまるぶんは入っていないので、この合計は残高と一致しません。
      </p>

      <ul className="shard-log">
        {rows.map((r) => (
          <li key={r.id} className={r.kind === 'redeem' ? 'shard-log-row redeem' : 'shard-log-row'}>
            <span className="shard-log-at">{formatLedgerAt(r.at)}</span>
            <span className="shard-log-text">{r.text}</span>
            <ShardDelta delta={r.delta} />
            <span className="shard-log-left">
              残り <Shards n={r.balance} />
            </span>
            {/* ★ 誰が動かしたかを出します。
                   「自分で交換した」のか「トレーナーが引いた」のかは、
                   後から見たときに意味がまったく違います。 */}
            <span className="shard-log-kind">
              {r.kind === 'redeem' ? '本人が交換' : 'トレーナー'}
            </span>
          </li>
        ))}
      </ul>

      {rows.length >= max && (
        <p className="note">直近 {max} 件まで出しています。古いぶんも消えてはいません。</p>
      )}
    </>
  );
}
