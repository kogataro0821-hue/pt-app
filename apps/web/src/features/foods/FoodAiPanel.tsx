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
  hasLabelPhoto = false,
  onUsePer100g,
  onUseAliases,
  onAbsorbInto,
}: {
  /** これから登録しようとしている食材の名前 */
  name: string;
  /** いまマスタにある食材 */
  foods: Food[];
  busy: boolean;
  /**
   * 契約者が撮った成分表示の写真があるか。
   *
   * ★ 写真には**実物の裏付け**があります。AI の推定にはありません。
   *   同じ顔で並べると、押した人は上書きだと気づけません。
   *   写真があるときは、そちらが上だと画面に書きます。
   */
  hasLabelPhoto?: boolean;
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
  /**
   * すでに取り込んだもの。
   *
   * ★ 押しても画面が変わらないと、効いたのかどうか分かりません。
   *   値と別名は**両方とも**取り込めるので、片方ずつ印を付けます。
   */
  const [taken, setTaken] = useState<{ value: boolean; aliases: boolean }>({
    value: false,
    aliases: false,
  });

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
        {hasLabelPhoto && (
          <p className="field-hint">
            <b>この依頼には成分表示の写真があります。そちらのほうが確かです。</b>
            <br />
            AI の下書きは、写真が読めなかったときや、別名・まとめ先を見たいときにお使いください。
          </p>
        )}
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

            {/* ★ 写真があるときは、押すと「読み取った値」が推定で上書きされます。
                   押す前に言わないと、押したあとには分かりません。 */}
            {hasLabelPhoto && (
              <p className="field-hint warn-text">
                <b>⚠ 押すと、成分表示から読み取った値が、この推定で置き換わります。</b>
              </p>
            )}
            <button
              className="button-secondary compact"
              type="button"
              disabled={busy}
              onClick={() => {
                if (draft.per100g === null) return;
                onUsePer100g(draft.per100g, `AIの推定（${draft.assumed}）。要確認。`);
                setTaken((prev) => ({ ...prev, value: true }));
              }}
            >
              {taken.value
                ? '取り込みました'
                : hasLabelPhoto
                  ? '読み取った値を、この推定で置き換える'
                  : 'この値を入力欄に入れる'}
            </button>
            <p className="field-hint">
              入れるだけで、保存はされません。<b>別名も取り込めます。</b>
              終わったら下の「新しく登録する」を押してください。
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
            onClick={() => {
              onUseAliases(draft.aliases);
              setTaken((prev) => ({ ...prev, aliases: true }));
            }}
          >
            {taken.aliases ? '取り込みました' : 'この別名も入れる'}
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
