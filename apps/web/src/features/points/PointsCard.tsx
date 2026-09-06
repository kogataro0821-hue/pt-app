import { useEffect, useRef, useState } from 'react';
import { pointDayKey, canClaimToday, SHARD_NAME } from '@pt/core';
import type { Client } from '@/features/clients/clientTypes';
import { claimDailyPoints, pointsOf } from './pointsRepo';
import { Shards, ShardIcon } from './ShardIcon';

/**
 * ポイント（追加仕様: ログインポイント）。契約者の画面に出ます。
 *
 * ★ 開いたら勝手に受け取ります。ボタンは押させません。
 *
 *   「受け取る」を押させると、押し忘れた日が出ます。
 *   押し忘れは本人の落ち度ではないのに、損をした気持ちだけ残ります。
 *   毎日開けば毎日たまる、でいいはずです。
 *
 * ★ 失敗しても、何も出しません。
 *
 *   通信が切れていれば、次に開いたときに受け取れます。
 *   ここで赤いエラーを出しても、本人にできることはありません。
 *   （残高そのものはサーバーにあるので、失われることはありません）
 */
export function PointsCard({
  client,
  isAdmin,
  onChanged,
}: {
  client: Client;
  isAdmin: boolean;
  /** 受け取ったあと、親に読み直してもらう */
  onChanged?: () => void;
}) {
  const state = pointsOf(client);
  const [points, setPoints] = useState(state.points);
  const [gained, setGained] = useState<number | null>(null);

  // ★ 同じ契約者に何度も投げないための見張り。
  //   親の再描画で useEffect が走り直しても、1回で止まります。
  const tried = useRef<string>('');

  useEffect(() => {
    setPoints(pointsOf(client).points);
  }, [client]);

  useEffect(() => {
    // ★ 管理者が代理で開いているときは受け取りません。
    //   トレーナーが様子を見ただけで、その人のポイントが増えては困ります。
    //   （Rules も、書けるのは本人だけにしてあります）
    if (isAdmin) return;

    const day = pointDayKey();
    const key = `${client.clientId}:${day}`;
    if (tried.current === key) return;
    tried.current = key;

    const current = pointsOf(client);
    if (!canClaimToday(current, day)) return;

    void (async () => {
      try {
        const next = await claimDailyPoints(client);
        if (next === null) return;
        setPoints(next.points);
        setGained(next.points - current.points);
        onChanged?.();
      } catch {
        // ★ 黙って諦めます。あすまた開けば受け取れます
      }
    })();
  }, [client, isAdmin, onChanged]);

  const daily = state.dailyPoints;

  return (
    <section className="card points-card">
      <div className="points-head">
        <span className="points-label">{SHARD_NAME}</span>
        <Shards n={points} className="points-total" />
      </div>

      {gained !== null && gained > 0 && (
        <p className="points-gained" role="status">
          きょうのぶん +{gained.toLocaleString('ja-JP')}
          <ShardIcon />
        </p>
      )}

      <p className="points-note">
        {isAdmin
          ? 'トレーナーが見ているので、受け取りは動きません。'
          : `毎日ひらくと ${daily.toLocaleString('ja-JP')} つ たまります（朝4時で切り替わります）。`}
      </p>

      {state.totalDays > 0 && (
        <p className="points-days">これまで {state.totalDays.toLocaleString('ja-JP')} 日</p>
      )}
    </section>
  );
}
