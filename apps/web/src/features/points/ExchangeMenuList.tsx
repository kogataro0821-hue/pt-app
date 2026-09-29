import { useEffect, useState } from 'react';
import { SHARD_NAME, SHARD_UNIT, type ExchangeItem } from '@pt/core';
import { readErrorMessage } from '@/lib/firestoreError';
import { Shards } from './ShardIcon';
import { listExchangeMenu } from './exchangeMenuRepo';

/**
 * 交換メニューを見る（追加仕様: 交換メニュー）。契約者も管理者も同じものを見ます。
 *
 * ★ 見るだけの画面です。ここからは交換できません。
 *
 *   交換はトレーナーと対面で、QRを読んで行います。
 *   ここから押せてしまうと、**相手がいないところで引ける**ことになります。
 *   品書きと、引く操作は分けておきます。
 *
 * ★ いま届かないものも、同じ見た目で並べます。
 *
 *   薄くしたり隠したりしていません。**先に何があるのかが見えること**が
 *   この画面の値打ちなので、届かないものこそ見せます。
 *   持っている数は上に出ているので、引き算は見た人がします。
 *
 * ★ 安い順です。
 *   いま手が届くものが上に来ます。下へ行くほど遠いものになります。
 */
export function ExchangeMenuList({
  /** いま持っている数。分からないときは null（管理者が見るときなど） */
  points,
}: {
  points: number | null;
}) {
  const [items, setItems] = useState<ExchangeItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void listExchangeMenu()
      .then((list) => {
        if (alive) setItems(list);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(readErrorMessage(e, '交換メニュー'));
        setItems([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <h2 className="title">交換メニュー</h2>

      {points !== null && (
        <p className="lede">
          いま <Shards n={points} /> 持っています。
        </p>
      )}

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {items === null && error === null && <p className="lede">読み込んでいます…</p>}

      {items !== null && items.length === 0 && error === null && (
        <section className="card">
          <p className="lede">まだ何も登録されていません。</p>
          <p className="field-hint">トレーナーが用意すると、ここに並びます。</p>
        </section>
      )}

      {items !== null && items.length > 0 && (
        <section className="card">
          <ul className="exchange-menu">
            {items.map((item) => (
              <li key={item.id}>
                <span className="exchange-menu-name">{item.text}</span>
                <Shards n={item.amount} className="exchange-menu-cost" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ★ どうやって交換するのかを書きます。
             品書きだけ置くと「ここから押すのでは」と探させます。 */}
      {items !== null && items.length > 0 && (
        <p className="note">
          交換はトレーナーと会ったときに行います。トレーナーが出すQRを
          「QRを読む」で読み取ると、その場で{SHARD_UNIT}が引かれます。
          <br />
          {SHARD_NAME}が足りないものも、そのまま並べています。
        </p>
      )}
    </>
  );
}
