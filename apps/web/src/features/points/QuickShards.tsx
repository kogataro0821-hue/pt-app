import { useState } from 'react';
import { formatDelta, formatPoints, isValidGrant, MAX_GRANT, SHARD_UNIT } from '@pt/core';
import type { Client } from '@/features/clients/clientTypes';
import { pointsNotice } from '@/features/notices/noticesRepo';
import { grantPoints, pointsOf } from './pointsRepo';

/**
 * その場で増やす・減らす（追加仕様: ログインポイント）。
 *
 * ★ 「配る」画面とは、別のものとして置いています。
 *
 *   配る画面は、相手を選んで文面を書いて送る、一斉送信のための場所です。
 *   一方この欄は、**目の前に本人がいるとき**のためのものです。
 *   交換したその場で1回押して終わり、が要るので、
 *   4段階の画面を通らせるわけにいきません。
 *
 * ★ 押した瞬間に反映されます。保存ボタンは要りません。
 *
 *   この画面の「保存する」は、目標や権限をまとめて書き換えるものです。
 *   かけらの増減をそこに混ぜると、目標を直しかけて画面を離れたときに
 *   増減まで消えます。逆に、増減のつもりで押した保存で
 *   書きかけの目標が入ってしまいます。別々に書きます。
 *
 * ★ 押すと、本人にもお知らせが届きます。
 *   数字だけ黙って減っているのが、いちばん不安にさせます。
 */
export function QuickShards({
  client,
  onChanged,
}: {
  client: Client;
  /** 反映後の残高。呼び出し側で持っている client を更新してもらう */
  onChanged: (points: number) => void;
}) {
  const state = pointsOf(client);

  const [amountText, setAmountText] = useState('1');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ applied: number; points: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const amount = Number(amountText);
  const ok = isValidGrant(Math.abs(amount) || 0);

  async function move(sign: 1 | -1) {
    const delta = sign * Math.abs(amount);
    if (busy || !isValidGrant(delta)) return;

    setBusy(true);
    setError(null);
    setDone(null);

    const at = Date.now();
    const title = delta > 0 ? `${SHARD_UNIT}が届きました` : `${SHARD_UNIT}を引きました`;
    const lines = [reason.trim(), formatDelta(delta)].filter((s) => s.length > 0);

    try {
      const [result] = await grantPoints([client], delta, pointsNotice(title, lines.join('\n\n'), at));
      if (result === undefined) return;
      setDone({ applied: result.applied, points: result.points });
      setReason('');
      onChanged(result.points);
    } catch {
      setError('反映できませんでした。通信状態を確認して、もう一度お試しください。');
    } finally {
      setBusy(false);
    }
  }

  // ★ 引ききれなかった＝残高が足りなかった、ということです。
  //   交換の場で「引いた」と思ったまま帰されると、後から合いません。
  const short = done !== null && done.applied < 0 && Math.abs(done.applied) < Math.abs(amount);

  return (
    <div className="quick-shards">
      <p className="lede">
        いまの残高 <strong>{formatPoints(state.points)}</strong>
      </p>

      <div className="quick-shards-row">
        <input
          className="input quick-shards-amount"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_GRANT}
          step={1}
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          aria-label={`動かす${SHARD_UNIT}の数`}
          disabled={busy}
        />
        <button
          className="button-secondary compact"
          type="button"
          disabled={busy || !ok}
          onClick={() => void move(-1)}
        >
          減らす
        </button>
        <button
          className="button-primary compact"
          type="button"
          disabled={busy || !ok}
          onClick={() => void move(1)}
        >
          増やす
        </button>
      </div>

      <div className="quick-shards-presets">
        {[1, 3, 5, 10].map((n) => (
          <button
            key={n}
            type="button"
            className={amountText === String(n) ? 'choice on' : 'choice'}
            onClick={() => setAmountText(String(n))}
            disabled={busy}
          >
            {n}
          </button>
        ))}
      </div>

      <label className="field">
        <span className="field-label">ひとこと（お知らせに載ります）</span>
        <input
          className="input"
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="プロテインと交換しました"
          maxLength={60}
          disabled={busy}
        />
      </label>

      {!ok && (
        <p className="form-error" role="alert">
          1 〜 {MAX_GRANT.toLocaleString('ja-JP')} の整数で入れてください。
        </p>
      )}

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {done !== null && (
        <p className="form-ok" role="status">
          {formatDelta(done.applied)} 反映しました（残り {formatPoints(done.points)}）
          {short && <> ／ 残高が足りなかったので、残っていたぶんだけ引きました</>}
        </p>
      )}

      <p className="note">
        押した瞬間に反映されます（「保存する」は不要です）。本人にもお知らせが届きます。
      </p>
    </div>
  );
}
