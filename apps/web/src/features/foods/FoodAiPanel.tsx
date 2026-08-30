import { useState } from 'react';
import { refineFoodDraft, type FoodDraft, type Per100g } from '@pt/core';
import { AiError, aiErrorMessage, suggestFoodDraft } from '@/features/ai/gemini';
import type { Food } from './foodsRepo';

/**
 * 登録依頼に、AI の下書きを添える（追加仕様: 登録依頼のAI）。
 *
 * ★ ここが作るのは**下書きだけ**です。マスタには1バイトも書きません。
 *
 *   書くのは、あなたが「この値を使う」を押して、
 *   登録の画面で確かめて保存したときだけです。
 *   マスタの1件は全契約者の集計に効くので、
 *   AI が直接触れる経路を作りません（設計書 §47）。
 *
 * ★ ボタンを押したときだけ聞きます。
 *   開いただけで聞くと、自分で分かる食材にも回数を使います。
 *   AI の利用は1人1日50回までです。
 *
 * ★ 送るのは食材名と、マスタにある名前だけです（設計書 §35）。
 *   誰が依頼したか、いつ食べたか、契約者が入れた仮の値は送りません。
 */
export function FoodAiPanel({
  name,
  foods,
  busy,
  onUsePer100g,
  onUseAliases,
  onAbsorbInto,
}: {
  /** これから登録しようとしている食材の名前 */
  name: string;
  /** いまマスタにある食材 */
  foods: Food[];
  busy: boolean;
  /** 「この値を使う」。登録の画面に持っていくだけで、保存はしません */
  onUsePer100g: (per100g: Per100g, note: string) => void;
  /** 「この別名も入れる」 */
  onUseAliases: (aliases: string[]) => void;
  /** 「こちらにまとめる」 */
  onAbsorbInto: (food: Food) => void;
}) {
  const [draft, setDraft] = useState<FoodDraft | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    if (asking) return;
    setAsking(true);
    setError(null);
    try {
      const raw = await suggestFoodDraft(
        name,
        foods.map((f) => f.name),
      );
      // ★ AI の返事は、必ずここを通してから画面に出します。
      //   マスタに無い食材へまとめようとしたり、
      //   他の食材の名前を別名に挙げたりするのを、ここで落とします。
      setDraft(refineFoodDraft(raw, foods, name));
    } catch (e) {
      setError(e instanceof AiError ? aiErrorMessage(e.kind, e.detail) : 'AIに聞けませんでした。');
    } finally {
      setAsking(false);
    }
  }

  if (draft === null) {
    return (
      <div className="ai-draft">
        <button
          className="button-secondary compact"
          type="button"
          disabled={busy || asking}
          onClick={() => void ask()}
        >
          {asking ? 'AIに聞いています…' : 'AIに下書きを作らせる'}
        </button>
        <p className="field-hint">
          食材名だけを送ります（誰の記録かは送りません）。
          <b>出てくるのは下書きです。</b>あなたが確かめて決めます。
        </p>
        {error !== null && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  const sameFood =
    draft.sameAs === null ? null : (foods.find((f) => f.name === draft.sameAs) ?? null);

  return (
    <div className="ai-draft filled">
      <div className="ai-draft-head">
        <span className="badge ai-draft-badge">AIの下書き</span>
        <span className="ai-draft-conf">確からしさ {Math.round(draft.confidence * 100)}%</span>
      </div>

      {draft.assumed.length > 0 && (
        <p className="field-hint">
          <b>{draft.assumed}</b> として答えています。違う食品なら、この下書きは使わないでください。
        </p>
      )}

      {/* ---- まとめ先の提案 ------------------------------------------- */}
      {sameFood !== null && (
        <div className="ai-draft-block">
          <p className="ai-draft-label">すでにある食材かもしれません</p>
          <button
            type="button"
            className="suggestion"
            disabled={busy}
            onClick={() => onAbsorbInto(sameFood)}
          >
            <span className="suggestion-name">{sameFood.name} にまとめる</span>
            <span className="suggestion-meta">
              {sameFood.per100g.kcal}kcal · P{sameFood.per100g.p} F{sameFood.per100g.f} C
              {sameFood.per100g.c}
            </span>
          </button>
          {draft.sameAsReason.length > 0 && <p className="field-hint">{draft.sameAsReason}</p>}
        </div>
      )}

      {/* ★ AI が実在しない食材へまとめようとしたときは、黙って消さずに伝えます。
             黙って消すと、AIが何を言ったのか分からなくなります。 */}
      {draft.sameAsDropped !== null && (
        <p className="field-hint">
          <b>まとめ先の提案は捨てました。</b>
          {draft.sameAsDropped}
        </p>
      )}

      {/* ---- 栄養値 ---------------------------------------------------- */}
      <div className="ai-draft-block">
        <p className="ai-draft-label">100gあたりの値</p>

        {draft.per100g === null ? (
          <p className="field-hint">
            <b>AIも分かりませんでした。</b>
            {draft.plausibility === null
              ? '手で入れてください。それらしい数字を作らせるより、分からないと言わせるほうが安全です。'
              : `ありえない値だったので捨てました（${draft.plausibility.reason}）`}
          </p>
        ) : (
          <>
            <p className="ai-draft-values">
              {draft.per100g.kcal}kcal · P{draft.per100g.p} F{draft.per100g.f} C{draft.per100g.c}
            </p>

            {draft.plausibility?.level === 'warn' && (
              <p className="field-hint warn-text">
                <b>⚠ 計算が合いません。</b>
                {draft.plausibility.reason}
              </p>
            )}

            <button
              className="button-secondary compact"
              type="button"
              disabled={busy}
              onClick={() =>
                draft.per100g !== null &&
                onUsePer100g(draft.per100g, `AIの推定（${draft.assumed}）。要確認。`)
              }
            >
              この値を入力欄に入れる
            </button>
            <p className="field-hint">
              入れるだけで、保存はされません。登録の画面で直せます。
            </p>
          </>
        )}
      </div>

      {/* ---- 別名 ------------------------------------------------------ */}
      {draft.aliases.length > 0 && (
        <div className="ai-draft-block">
          <p className="ai-draft-label">表記ゆれ（別名）の案</p>
          <p className="ai-draft-values">{draft.aliases.join(' / ')}</p>
          <button
            className="button-secondary compact"
            type="button"
            disabled={busy}
            onClick={() => onUseAliases(draft.aliases)}
          >
            この別名も入れる
          </button>
        </div>
      )}

      {draft.droppedAliases.length > 0 && (
        <p className="field-hint">
          <b>使えない別名を外しました。</b>
          {draft.droppedAliases.map((d) => `「${d.name}」${d.reason}`).join(' ')}
        </p>
      )}

      <button className="button-quiet compact" type="button" onClick={() => setDraft(null)}>
        下書きを閉じる
      </button>
    </div>
  );
}
