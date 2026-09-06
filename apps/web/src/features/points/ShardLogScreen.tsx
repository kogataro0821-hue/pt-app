import { Link } from 'react-router-dom';
import { SHARD_NAME } from '@pt/core';
import type { Client } from '@/features/clients/clientTypes';
import { pointsOf } from './pointsRepo';
import { ShardLog } from './ShardLog';
import { Shards } from './ShardIcon';

/**
 * かけらの記録（追加仕様: かけらの帳簿）。契約者が自分で開けます。
 *
 * ★ 使っているのは本人です。
 *
 *   何にいくつ使ったかを、本人が見られないのはおかしな話です。
 *   実物と交換する数字なので、
 *   「先週プロテインと交換したはず」を確かめられる必要があります。
 *
 * ★ 契約者は、この記録を書き換えられません。
 *   Rules で、書き足すことだけ許してあります。
 *   消せる記録は、記録として意味がありません。
 */
export function ShardLogScreen({ client }: { client: Client }) {
  const state = pointsOf(client);

  return (
    <>
      <div className="section-head">
        <h2 className="title">{SHARD_NAME}の記録</h2>
        <Link className="button-secondary compact" to={`/c/${client.clientId}`}>
          戻る
        </Link>
      </div>

      <section className="card">
        <div className="points-head">
          <span className="points-label">いまの残高</span>
          <Shards n={state.points} className="points-total" />
        </div>
        {state.totalDays > 0 && (
          <p className="points-days">
            これまで {state.totalDays.toLocaleString('ja-JP')} 日ぶん受け取っています
          </p>
        )}
      </section>

      <section className="card">
        <h3 className="card-title">出入りの記録</h3>
        <ShardLog clientId={client.clientId} />
      </section>
    </>
  );
}
