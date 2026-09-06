import { useState } from 'react';
import { canAfford, parseRedeem, SHARD_NAME, SHARD_UNIT, type RedeemRequest } from '@pt/core';
import type { Client } from '@/features/clients/clientTypes';
import { pointsOf, spendShards } from './pointsRepo';
import { Shards, ShardIcon } from './ShardIcon';

/**
 * QRを読んで、かけらを使う（追加仕様: かけらの交換QR）。
 *
 * ★ 押すまでは、何も起きません。
 *
 *   カメラで読んだだけで引かれると、間違えて読んでしまった人が
 *   取り返せません。必ず「何といくつか」を見せてから確かめます。
 *
 * ★ 押したあとは、取り消せません。
 *
 *   取り消しを付けると、交換したあとに押し戻せてしまいます。
 *   間違えたときは、トレーナーに戻してもらう形にします
 *   （管理者はいつでも増やせます）。それを画面にも書いてあります。
 */
export function RedeemScreen({
  client,
  isAdmin,
  params,
  onDone,
}: {
  client: Client;
  isAdmin: boolean;
  params: URLSearchParams;
  onDone: () => void;
}) {
  const req = parseRedeem(params);
  const state = pointsOf(client);

  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ---- QRが読めなかった -----------------------------------------------------

  if (req === null) {
    return (
      <section className="card">
        <h2 className="title">交換できません</h2>
        <p className="lede">このQRの中身が読み取れませんでした。</p>
        <p className="note">
          別のQRを読んでしまったか、印刷が かすれているのかもしれません。
          トレーナーに見せてください。
        </p>
        <button className="button-primary" type="button" onClick={onDone}>
          もどる
        </button>
      </section>
    );
  }

  // ---- 済んだあと -----------------------------------------------------------

  if (left !== null) {
    return (
      <section className="card redeem-done">
        <p className="redeem-done-mark" aria-hidden="true">
          <ShardIcon size="56px" />
        </p>
        <h2 className="title">交換しました</h2>
        <p className="lede">{req.text}</p>
        <p className="redeem-amount">
          <Shards n={req.amount} /> つかいました
        </p>
        <p className="lede">
          残り <Shards n={left} />
        </p>
        {/* ★ 相手（トレーナー）にこの画面を見せて終わり、にはしません。
               本当に引かれたかはトレーナー側の画面に出ます。 */}
        <p className="note">
          トレーナーの画面にも届いています。この画面を見せる必要はありません。
        </p>
        <button className="button-primary" type="button" onClick={onDone}>
          とじる
        </button>
      </section>
    );
  }

  // ---- 確認 -----------------------------------------------------------------

  const enough = canAfford(state.points, req.amount);

  async function confirm() {
    if (busy || req === null || !enough) return;
    setBusy(true);
    setError(null);
    try {
      const next = await spendShards(client, req.amount, req.text);
      if (next === null) {
        setError(`${SHARD_UNIT}が足りませんでした。`);
        return;
      }
      setLeft(next);
    } catch {
      setError('交換できませんでした。通信状態を確認して、もう一度お試しください。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card redeem">
      <p className="field-hint">{SHARD_NAME}をつかいます</p>
      <h2 className="title">{req.text}</h2>

      <p className="redeem-amount">
        <Shards n={req.amount} />
      </p>

      <dl className="redeem-lines">
        <div>
          <dt>いま</dt>
          <dd>
            <Shards n={state.points} />
          </dd>
        </div>
        <div>
          <dt>交換したあと</dt>
          <dd>{enough ? <Shards n={state.points - req.amount} /> : '—'}</dd>
        </div>
      </dl>

      {/* ★ 管理者が代理で開いているときは押させません。
             トレーナーが確認のつもりで開いて、その人のかけらが減っては困ります。 */}
      {isAdmin ? (
        <p className="note">
          トレーナーとして開いています。この画面からは交換できません。
        </p>
      ) : !enough ? (
        <p className="form-error" role="alert">
          {SHARD_UNIT}が {req.amount - state.points} つ足りません。
        </p>
      ) : (
        <p className="note">
          押すと、その場で引かれます。<strong>あとから取り消せません。</strong>
          間違えたときは、トレーナーに戻してもらってください。
        </p>
      )}

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="form-actions">
        <button
          className="button-primary"
          type="button"
          disabled={busy || !enough || isAdmin}
          onClick={() => void confirm()}
        >
          {busy ? '交換しています…' : `${req.amount} つ払って交換する`}
        </button>
        <button className="button-secondary" type="button" onClick={onDone} disabled={busy}>
          やめる
        </button>
      </div>
    </section>
  );
}

export type { RedeemRequest };
