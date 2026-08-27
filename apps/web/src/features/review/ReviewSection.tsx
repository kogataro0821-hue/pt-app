import { useEffect, useState } from 'react';
import {
  checkReviewText,
  reviewRejectionMessage,
  type DateKey,
  type Nutrients,
  type Targets,
} from '@pt/core';
import { AiError, aiErrorMessage, requestDayReview } from '@/features/ai/gemini';
import { readErrorMessage, writeErrorMessage } from '@/lib/firestoreError';
import { deleteReview, getReview, saveReview, type DayReview } from './reviewRepo';

/**
 * AI評価（設計書 §26 / §13 / Phase 14）。
 *
 * ★ 押したときだけ作ります。
 *
 *   1日確定のたびに自動で作ると、解除して確定し直すたびにAPIを使います。
 *   無料枠は有限なので、回数は人が握れる形にしています。
 *
 * ★ トレーナーのコメントの「下」に置いています。
 *   人が書いた言葉が先に目に入る並びにするためです。
 *   AIの文章は、そのあとの参考です。
 *
 * ★ 出す前に必ず検査します（@pt/core の checkReviewText）。
 *   指示文で禁じるのは第1層で、守られることを期待しているだけです。
 *   病名や、体に負担のかかるやり方が混ざっていたら、表示しません。
 */
export function ReviewSection({
  clientId,
  date,
  totals,
  targets,
  exerciseMinutes,
  mealCount,
  pendingCount,
  reviewMode,
  aiAvailable,
  canEdit,
  uid,
}: {
  clientId: string;
  date: DateKey;
  /** その日の合計（内部表現） */
  totals: Nutrients;
  targets: Targets;
  exerciseMinutes: number;
  mealCount: number;
  pendingCount: number;
  reviewMode: string;
  aiAvailable: boolean;
  canEdit: boolean;
  uid: string;
}) {
  const [review, setReview] = useState<DayReview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReview(null);
    setLoaded(false);
    setError(null);

    void (async () => {
      try {
        const found = await getReview(clientId, date);
        if (!cancelled) setReview(found);
      } catch (e) {
        if (!cancelled) setError(readErrorMessage(e, 'AI評価'));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId, date]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const text = await requestDayReview({
        actual: human(totals),
        target: { kcal: targets.kcal, p: targets.p, f: targets.f, c: targets.c },
        exerciseMinutes,
        mealCount,
        pendingCount,
        reviewMode,
      });

      // ★ ここが第2層。指示文を信じるのではなく、出てきた文章を確かめます。
      const check = checkReviewText(text);
      if (!check.ok && check.reason !== null) {
        setError(reviewRejectionMessage(check.reason));
        return;
      }

      const next: DayReview = { text, mode: reviewMode, by: uid, createdAt: Date.now() };
      await saveReview(clientId, date, next);
      setReview(next);
    } catch (e) {
      setError(
        e instanceof AiError ? aiErrorMessage(e.kind, e.detail) : writeErrorMessage(e, 'AI評価'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('AIの評価を削除します。よろしいですか？')) return;
    setBusy(true);
    setError(null);
    try {
      await deleteReview(clientId, date);
      setReview(null);
    } catch (e) {
      setError(writeErrorMessage(e, 'AI評価'));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  // 同意していない、または中継役が未設定なら、この欄自体を出しません。
  // 押せないボタンだけが残っても、何もできないので邪魔になるだけです。
  if (!aiAvailable && review === null) return null;

  return (
    <section className="card">
      <h3 className="card-title">AIの評価</h3>

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {review !== null && (
        <>
          <p className="review-text">{review.text}</p>
          <p className="review-meta">
            {formatStamp(review.createdAt)}・AIが書いた文章です
          </p>
        </>
      )}

      {review === null && !busy && (
        <p className="note">
          その日の合計と目標の差から、AIが短い講評を書きます。
          {mealCount === 0 && <>（まだ食事が記録されていません）</>}
        </p>
      )}

      {busy && <p className="lede">書いています…</p>}

      {canEdit && aiAvailable && (
        <div className="item-form-actions">
          <button
            className="button-secondary"
            type="button"
            onClick={() => void generate()}
            disabled={busy}
          >
            {review === null ? 'AIに評価してもらう' : 'もう一度書いてもらう'}
          </button>
          {review !== null && (
            <button className="button-quiet" type="button" onClick={() => void remove()} disabled={busy}>
              削除
            </button>
          )}
        </div>
      )}

      {/* ★ 免責は必ず出します（設計書 §13 リスク12）。
          トレーナーは医師ではありません。ここを省くと、
          受け取った側が医療的な助言として読む余地が残ります。 */}
      <p className="field-hint">
        食事と運動の記録にもとづく参考意見です。<b>医療的な判断ではありません</b>。
        体調に不安があるときは、専門の方にご相談ください。
      </p>
    </section>
  );
}

/** 内部表現（1/1000単位）から、AIに渡す人間の単位へ。 */
function human(n: Nutrients): { kcal: number; p: number; f: number; c: number } {
  return { kcal: n.kcal / 1000, p: n.p / 1000, f: n.f / 1000, c: n.c / 1000 };
}

function formatStamp(ms: number): string {
  const at = new Date(ms);
  return `${at.getMonth() + 1}月${at.getDate()}日 ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
