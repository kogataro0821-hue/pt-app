import { useEffect, useState } from 'react';
import { rankLabel, rankProgress, readyRank, type Rank, type RecordStats } from '@pt/core';
import type { Client } from '@/features/clients/clientTypes';
import { setClientRank, updateClient } from '@/features/clients/clientsRepo';
import { loadRankStats } from './rankRepo';
import logoUrl from './taro-zap.png';

/**
 * 会員証（追加仕様: 会員ランク）。
 *
 * ★ 置き場所はカレンダーの下です。
 *   記録画面に入る前に必ず目に入ります。
 *   「今日も記録しよう」と思う理由が、そこにあるようにします。
 *
 * ★ 形はクレジットカードと同じ比率（85.60 × 53.98mm）にしてあります。
 *
 *   会員証として持っている感じを出したいので、カードそのものは
 *   「ロゴ・整理番号・ランク・会員ID・入会年月」だけに絞りました。
 *
 *   進み具合や累計は**カードの外**に出します。
 *   カードの中に詰め込むと、比率が崩れるか、字が読めない大きさになります。
 *
 * ★ 進み具合は、カードのすぐ下にいちばん大きく出しています。
 *   いまのランクは「済んだこと」で、明日の行動を変えるのは「あと何日か」のほうです。
 *
 * ★ 昇格はここでは確定しません。
 *   条件を満たすと、契約者には「トレーナーの確認をお待ちください」、
 *   管理者には「昇格させる」ボタンが出ます。
 *   契約者が自分でランクを書ける形にはしません（設計書 §7）。
 */
export function MemberCard({ client, isAdmin }: { client: Client; isAdmin: boolean }) {
  const [stats, setStats] = useState<RecordStats | null>(null);
  // ★ 昇格させた直後に、その場で表示を切り替えるために持ちます。
  //   親を読み直させると、カレンダーごと再描画されて画面が飛びます。
  const [rank, setRank] = useState<Rank>(client.rank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    setRank(client.rank);
    void loadRankStats(client.clientId)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        // ★ 数えられなくても、会員証そのものは出します。
        //   ランクと番号は保存された値なので、集計が無くても表示できます。
        if (!cancelled) setStats({ mealDays: 0, exerciseDays: 0, longestMealStreak: 0, longestExerciseStreak: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [client.clientId, client.rank]);

  const progress = stats === null ? null : rankProgress(rank, stats, client.rankGoals);

  // ★ 契約者の画面で数えたときに、目印を書き残します（追加仕様: 会員ランク）。
  //
  //   これが無いと、条件を満たしたことをトレーナーが知る手段がありません。
  //   契約者一人ひとりのカレンダーを開いて回ることになります。
  //
  //   書けるのは extra だけです（Rules で契約者に許された唯一の自由欄）。
  //   目印が出るだけで、ランクは上がりません。上げるのはトレーナーです。
  const earned = progress?.earned ?? null;
  useEffect(() => {
    if (isAdmin || progress === null) return;
    const marked = readyRank(client.extra, rank);
    if (marked === earned) return;

    void updateClient(client.clientId, {
      extra: { ...client.extra, rankReady: earned },
    }).catch(() => {
      // 目印が書けなくても、会員証そのものは成立しています
    });
    // ★ stats を依存に入れています。
    //   earned は「数える前」も「条件を満たさないとき」も同じ null なので、
    //   earned だけを見ていると、数え終わったことに気づけません。
    //   （目印を消す経路が一度も走らない、という取りこぼしが実際に出ました）
  }, [stats, earned, rank, isAdmin, client.clientId]);

  async function promote(to: Rank) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setClientRank(client, to);
      // 昇格させたので、目印は役目を終えます
      await updateClient(client.clientId, { extra: { ...client.extra, rankReady: null } });
      setRank(to);
    } catch {
      setError('ランクを変更できませんでした。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="member-block">
      {/* ★ ここはクレジットカードと同じ比率です。中身は絞ってあります */}
      <section className={`member-card rank-${rank.toLowerCase()}`}>
        {/* 紙の質感。飾りではなく、のっぺりしたグラデーションから抜けるためのもの */}
        <span className="member-grain" aria-hidden="true" />
        {/* 光の帯と、きらめき。動かすのは DIAMOND から上だけです（CSS側で制御） */}
        <span className="member-shine" aria-hidden="true" />
        <span className="member-sparks" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        <img className="member-logo" src={logoUrl} alt="たろZAP" />
        <span className="member-no">
          No. {client.memberNo === null ? '----' : pad4(client.memberNo)}
        </span>

        <div className="member-rank">
          <span className="member-rank-label">RANK</span>
          <span className="member-rank-name">{rankLabel(rank)}</span>
        </div>

        <div className="member-card-foot">
          <span className="member-id">
            {client.displayName.length > 0 ? client.displayName : client.clientId}
          </span>
          <span className="member-since">
            MEMBER SINCE {client.startDate === null ? '----.--' : memberSince(client.startDate)}
          </span>
        </div>
      </section>

      {progress !== null && (
        <div className="member-extra">
          {progress.steps.length > 0 && progress.next !== null && (
            <div className="member-progress">
              <span className="member-progress-title">
                次は <b>{rankLabel(progress.next)}</b>
              </span>
              {progress.steps.map((step) => (
                <div className="member-step" key={step.label}>
                  <div className="member-step-row">
                    <span className="member-step-label">{step.label}</span>
                    <span className="member-step-count">
                      {Math.min(step.done, step.need)} / {step.need}
                    </span>
                  </div>
                  <div className="member-bar">
                    <div
                      className="member-bar-fill"
                      style={{ width: `${Math.min(100, (step.done / step.need) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ★ EMERALD より上は、記録の量では決まりません。
                 進み具合を出すと「あと何日で上がる」と誤解させます。 */}
          {progress.next === null && progress.earned === null && (
            <p className="member-note">ここから先のランクは、トレーナーが決めます。</p>
          )}

          {progress.earned !== null &&
            (isAdmin ? (
              <div className="member-promote">
                <p className="member-note">
                  <b>{rankLabel(progress.earned)} の条件を満たしています。</b>
                </p>
                <button
                  className="button-primary compact"
                  type="button"
                  onClick={() => void promote(progress.earned as Rank)}
                  disabled={busy}
                >
                  {rankLabel(progress.earned)} に昇格させる
                </button>
              </div>
            ) : (
              <p className="member-note" role="status">
                <b>{rankLabel(progress.earned)} の条件を満たしました。</b>
                <br />
                トレーナーの確認をお待ちください。
              </p>
            ))}

          <p className="member-totals">
            食事 {progress.stats.mealDays}日 ／ 運動 {progress.stats.exerciseDays}日
          </p>
        </div>
      )}

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** 0001 の形に揃える */
function pad4(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(4, '0');
}

/** '2026-08-29' → '2026.08' */
function memberSince(date: string): string {
  return date.slice(0, 7).replace('-', '.');
}
