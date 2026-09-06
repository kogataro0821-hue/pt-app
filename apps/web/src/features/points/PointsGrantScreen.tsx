import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  formatDelta,
  isValidGrant,
  MAX_GRANT,
  SHARD_NAME,
  SHARD_UNIT,
} from '@pt/core';
import { listClients } from '@/features/clients/clientsRepo';
import type { Client } from '@/features/clients/clientTypes';
import { pointsNotice } from '@/features/notices/noticesRepo';
import { grantPoints, pointsOf, type GrantResult } from './pointsRepo';
import { Shards, ShardDelta } from './ShardIcon';

/**
 * ポイントを配る（追加仕様: ログインポイント）。管理者だけが開けます。
 *
 * ★ 画面の順番は、決める順番と同じにしてあります。
 *
 *     誰に → ポイントを動かすか（動かすなら何ポイント）→ 何を伝えるか → 送る
 *
 *   逆にすると、文面を書いたあとに相手を選び直すことになります。
 *
 * ★ 「減らす」がここにあるのは、交換がリアルで起きるからです。
 *
 *   貯めたポイントは、トレーナーと直接やり取りして何かと交換します。
 *   交換したぶんを引くのは管理者の仕事なので、配るのと同じ場所に置きました。
 *   別画面に分けると、渡した直後に引く操作で画面を行き来することになります。
 */

/** 誰に配るか。 */
type Audience = 'one' | 'all' | 'some';

export function PointsGrantScreen({ onBack }: { onBack: () => void }) {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [audience, setAudience] = useState<Audience>('one');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const [movePoints, setMovePoints] = useState(true);
  /** 入力は文字列で持ちます。「-」だけ打った途中の状態を消さないためです */
  const [amountText, setAmountText] = useState('1');

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<GrantResult[] | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await listClients();
      // ★ 作りかけの人には配りません。ポイントの置き場所がまだありません
      setClients(list.filter((c) => c.provisionStatus === 'ready' && c.active));
    } catch {
      setLoadError('契約者の一覧を読み込めませんでした。通信状態を確認してください。');
      setClients([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const all = clients ?? [];

  /** いま送る相手。 */
  const targets = useMemo(() => {
    if (audience === 'all') return all;
    return all.filter((c) => picked.has(c.clientId));
  }, [audience, all, picked]);

  const amount = Number(amountText);
  const amountOk = !movePoints || isValidGrant(amount);
  const hasMessage = title.trim().length > 0 || body.trim().length > 0;
  const canSend =
    !sending && targets.length > 0 && amountOk && (movePoints || hasMessage);

  function toggle(clientId: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  }

  /** 「個人」に切り替えたら、選択は1人だけに絞ります。 */
  function chooseAudience(next: Audience) {
    setAudience(next);
    if (next === 'one' && picked.size > 1) setPicked(new Set());
  }

  function pickOne(clientId: string) {
    setPicked(new Set([clientId]));
  }

  async function send() {
    if (!canSend) return;
    setSending(true);
    setSendError(null);

    const delta = movePoints ? amount : 0;
    const at = Date.now();

    // ★ 文面が空でも、ポイントが動いたなら必ず1件届けます。
    //   残高だけ変わって何も知らされないのが、いちばん不安にさせます。
    const finalTitle =
      title.trim().length > 0
        ? title.trim()
        : delta > 0
          ? `${SHARD_UNIT}が届きました`
          : delta < 0
            ? `${SHARD_UNIT}を引きました`
            : 'トレーナーからのお知らせ';

    const lines: string[] = [];
    if (body.trim().length > 0) lines.push(body.trim());
    if (delta !== 0) lines.push(`${formatDelta(delta)}`);
    const finalBody = lines.join('\n\n');

    try {
      const results = await grantPoints(
        targets,
        delta,
        pointsNotice(finalTitle, finalBody, at),
      );
      setDone(results);
      await load();
    } catch {
      setSendError('送信できませんでした。通信状態を確認して、もう一度お試しください。');
    } finally {
      setSending(false);
    }
  }

  function reset() {
    setDone(null);
    setTitle('');
    setBody('');
    setPicked(new Set());
  }

  // ---- 送ったあと -----------------------------------------------------------

  if (done !== null) {
    const moved = done.filter((r) => r.applied !== 0);
    const short = done.filter((r) => movePoints && amount < 0 && r.applied > amount);

    return (
      <>
        <div className="section-head">
          <h2 className="title">送りました</h2>
        </div>

        <section className="card">
          <p className="lede">{done.length} 人に送りました。</p>

          {short.length > 0 && (
            <p className="note" role="status">
              ★ 残高が足りなかった人は、残っていたぶんだけ引きました。
            </p>
          )}

          <ul className="points-result">
            {done.map((r) => (
              <li key={r.clientId}>
                <span className="points-result-name">{r.displayName}</span>
                {r.applied !== 0 && <ShardDelta delta={r.applied} />}
                <Shards n={r.points} className="points-result-total" />
              </li>
            ))}
          </ul>
          {moved.length === 0 && <p className="note">{SHARD_UNIT}は動かしていません。</p>}
        </section>

        <div className="form-actions">
          <button className="button-primary" type="button" onClick={reset}>
            続けて送る
          </button>
          <button className="button-secondary" type="button" onClick={onBack}>
            戻る
          </button>
        </div>
      </>
    );
  }

  // ---- 入力 -----------------------------------------------------------------

  return (
    <>
      <div className="section-head">
        <h2 className="title">{SHARD_NAME}を配る</h2>
        <button className="button-secondary compact" type="button" onClick={onBack}>
          戻る
        </button>
      </div>

      {loadError !== null && (
        <p className="form-error" role="alert">
          {loadError}
        </p>
      )}

      {clients === null && <p className="lede">読み込んでいます…</p>}

      {clients !== null && (
        <>
          {/* ---- 1. 誰に ---------------------------------------------------- */}
          <section className="card">
            <h3 className="card-title">1. 誰に</h3>

            <div className="choice-row" role="radiogroup" aria-label="送る相手">
              {(
                [
                  ['one', '個人'],
                  ['some', '選ぶ'],
                  ['all', '全員'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={audience === value}
                  className={audience === value ? 'choice on' : 'choice'}
                  onClick={() => chooseAudience(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            {audience === 'all' && (
              <p className="note">
                いま有効な契約者 {all.length} 人ぜんぶに送ります。
              </p>
            )}

            {audience !== 'all' && (
              <ul className="points-pick">
                {all.map((c) => {
                  const on = picked.has(c.clientId);
                  return (
                    <li key={c.clientId}>
                      <button
                        type="button"
                        className={on ? 'points-pick-row on' : 'points-pick-row'}
                        aria-pressed={on}
                        onClick={() =>
                          audience === 'one' ? pickOne(c.clientId) : toggle(c.clientId)
                        }
                      >
                        <span className="points-pick-mark" aria-hidden="true">
                          {on ? '✓' : ''}
                        </span>
                        <span className="points-pick-name">{c.displayName}</span>
                        <Shards n={pointsOf(c).points} className="points-pick-points" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {all.length === 0 && <p className="note">送れる契約者がいません。</p>}
          </section>

          {/* ---- 2. ポイント ------------------------------------------------ */}
          <section className="card">
            <h3 className="card-title">2. {SHARD_UNIT}</h3>

            <label className="check-row">
              <input
                type="checkbox"
                checked={movePoints}
                onChange={(e) => setMovePoints(e.target.checked)}
              />
              <span>{SHARD_UNIT}を動かす</span>
            </label>

            {movePoints && (
              <>
                <label className="field">
                  <span className="field-label">{SHARD_UNIT}の数</span>
                  <input
                    className="input"
                    type="number"
                    inputMode="numeric"
                    step={1}
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    aria-invalid={!amountOk}
                  />
                </label>

                <div className="choice-row compact">
                  {[1, 3, 5, 10].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="choice"
                      onClick={() => setAmountText(String(n))}
                    >
                      +{n}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="choice"
                    onClick={() => setAmountText(String(-Math.abs(Number(amountText) || 0)))}
                  >
                    符号を反転
                  </button>
                </div>

                <p className="note">
                  マイナスを打つと減らせます（交換したとき）。残高より多くは引かれません。
                  1人だけなら、その人の設定画面からのほうが速く動かせます。
                </p>

                {!amountOk && (
                  <p className="form-error" role="alert">
                    {amount === 0
                      ? '0 は送れません。'
                      : `±${MAX_GRANT.toLocaleString('ja-JP')} までの整数で入れてください。`}
                  </p>
                )}
              </>
            )}
          </section>

          {/* ---- 3. お知らせ ------------------------------------------------ */}
          <section className="card">
            <h3 className="card-title">3. お知らせ</h3>

            <label className="field">
              <span className="field-label">見出し</span>
              <input
                className="input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={movePoints ? `${SHARD_UNIT}が届きました` : 'お知らせ'}
                maxLength={40}
              />
            </label>

            <label className="field">
              <span className="field-label">本文</span>
              <textarea
                className="input"
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="今月もよく続きました。"
                maxLength={400}
              />
            </label>

            <p className="note">
              空でも届きます。{SHARD_UNIT}が動いたことは自動で書き足されます。
            </p>
          </section>

          {/* ---- 4. 送る ---------------------------------------------------- */}
          <section className="card">
            <h3 className="card-title">4. 確認</h3>
            <p className="lede">
              {targets.length === 0 ? (
                '送る相手を選んでください。'
              ) : (
                <>
                  <strong>{targets.length} 人</strong>に
                  {movePoints && amountOk ? (
                    <>
                      {' '}
                      <ShardDelta delta={amount} />
                    </>
                  ) : (
                    'お知らせだけ'
                  )}
                  送ります。
                </>
              )}
            </p>

            {sendError !== null && (
              <p className="form-error" role="alert">
                {sendError}
              </p>
            )}
          </section>

          <div className="form-actions">
            <button
              className="button-primary"
              type="button"
              disabled={!canSend}
              onClick={() => void send()}
            >
              {sending ? '送っています…' : '送信'}
            </button>
            <button className="button-secondary" type="button" onClick={onBack}>
              やめる
            </button>
          </div>
        </>
      )}
    </>
  );
}
