import { useEffect, useRef, useState } from 'react';
import {
  PHOTO_MIN_CONFIDENCE,
  formatRange,
  guardRecognition,
  type GuardResult,
  type MealRecognition,
  type RecognizedItem,
} from '@pt/ai-contract';
import {
  ZERO,
  computeItemNutrients,
  findExactFood,
  findSimilarFoods,
  formatNutrients,
  toInternal,
  type DateKey,
  type MealItem,
} from '@pt/core';
import { loadFoods, type Food } from '@/features/foods/foodsRepo';
import { newItemId } from '@/features/meals/mealsRepo';
import {
  PhotoResizeError,
  formatBytes,
  photoErrorMessage,
  resizePhoto,
  type ResizedPhoto,
} from '@/features/photos/resize';
import { addPhoto, deletePhoto } from '@/features/photos/photosRepo';
import { AiError, aiErrorMessage, analyzeMealPhoto, parseMealText } from './gemini';

/**
 * AIに下書きを起こしてもらう（設計書 §12 / §14 / §39 / §47）。
 *
 * 流れ:
 *   1. 文章を書く / 写真を選ぶ
 *   2. AI が「何を・どれだけ」に分解する（栄養値は答えない）
 *   3. ★ 根拠が原文に無い項目を機械的に捨てる（文章のとき）
 *   4. 名前を共通マスタに当てる。当たれば栄養値が入る
 *   5. 当たらなければ「登録待ち」として記録し、管理者へ依頼を出す
 *   6. 人が確認して確定 → 決定論的に計算して保存
 *
 * ★ 栄養値は共通マスタからしか来ません。AIも契約者も決められません。
 *
 * ★ AIに送った写真は、写真欄に残します（追加仕様: 成分表示の読み取り）。
 *
 *   残さないと、あとからトレーナーが見たときに
 *   「AIは何を見てこの数字を出したのか」を確かめる手段がありません。
 *   量の推定が妥当だったかは、写真が無いと判断できません。
 *
 *   保存するのは「送った時点」です。追加をやめた場合も残ります。
 *   ただし撮り直したときは、前の1枚を消してから保存します。
 *   何度も撮り直すと、その回数だけ写真が積み上がってしまうためです。
 *
 * ★ 契約者IDや日付はAIに送りません（設計書 §35）。
 *   下で受け取っているのは、写真を保存する先を決めるためだけです。
 */

interface Draft {
  key: string;
  name: string;
  grams: string;
  /** 「150〜210g」。写真からの推定のときだけ入る */
  range: string | null;
  /** 写真からの推定か */
  estimated: boolean;
  /** 共通マスタに当たった食材。当たらなければ null（＝登録待ち） */
  food: Food | null;
  evidence: string;
  question: string | null;
}

export function AiTextPanel({
  mode,
  clientId,
  date,
  mealId,
  onAdd,
  onPhotoSaved,
  onClose,
}: {
  /** 'text' = 文章から / 'photo' = 写真から */
  mode: 'text' | 'photo';
  /** 写真の保存先。AIには送りません（設計書 §35） */
  clientId: string;
  date: DateKey;
  /** どの食事に紐づく写真か */
  mealId: string;
  onAdd: (items: MealItem[], requestNames: string[]) => void;
  /** 写真欄をその場で更新させるための合図 */
  onPhotoSaved?: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<{ dataUrl: string; bytes: number } | null>(null);
  /** 送るために縮小した写真。保存にも使う */
  const resizedRef = useRef<ResizedPhoto | null>(null);
  /** 写真欄に保存した1枚。撮り直したときに消すため覚えておく */
  const [savedPhotoId, setSavedPhotoId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [foods, setFoods] = useState<Food[]>([]);
  const [result, setResult] = useState<{ guard: GuardResult; recognition: MealRecognition } | null>(
    null,
  );
  const [drafts, setDrafts] = useState<Draft[]>([]);

  useEffect(() => {
    void loadFoods()
      .then(setFoods)
      .catch(() => setFoods([]));
  }, []);

  async function pick(files: FileList | null) {
    if (files === null || files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const resized = await resizePhoto(files[0]!);

      // ★ 撮り直したら、前に保存した1枚を消します。
      //   消さないと、撮り直した回数だけ写真欄に積み上がります。
      if (savedPhotoId !== null) {
        const stale = savedPhotoId;
        setSavedPhotoId(null);
        void deletePhoto(clientId, date, stale)
          .then(() => onPhotoSaved?.())
          .catch(() => undefined);
      }

      resizedRef.current = resized;
      setPhoto({ dataUrl: resized.dataUrl, bytes: resized.bytes });
    } catch (e) {
      setError(
        e instanceof PhotoResizeError ? photoErrorMessage(e.kind) : '写真を読み込めませんでした。',
      );
    } finally {
      setBusy(false);
      if (fileInput.current !== null) fileInput.current.value = '';
    }
  }

  async function run() {
    if (busy) return;
    if (mode === 'text' && text.trim().length === 0) return;
    if (mode === 'photo' && photo === null) return;

    setBusy(true);
    setError(null);

    try {
      const isPhoto = mode === 'photo';
      const recognition = isPhoto
        ? await analyzeMealPhoto(photo!.dataUrl, text)
        : await parseMealText(text);

      /**
       * ★ 受け止め方が2通りあります。
       *
       *   文章から … 根拠が原文にあるかを照合し、無ければ捨てる（設計書 §12 の第3層）
       *   写真から … 照合できる原文が無いので、閾値を厳しくし、すべてを確認待ちに回す
       */
      const guard = isPhoto
        ? guardRecognition(recognition, { minConfidence: PHOTO_MIN_CONFIDENCE, sourceText: null })
        : guardRecognition(recognition, { minConfidence: 0.6, sourceText: text });

      setResult({ guard, recognition });
      setDrafts([...guard.accepted, ...guard.flagged].map((item) => toDraft(item, foods, isPhoto)));

      // ★ AIに送った写真を、写真欄に残します。
      //   失敗しても下書きは使えるので、握りつぶします。
      //   ここで例外を投げると、読み取れているのに先へ進めなくなります。
      if (isPhoto && resizedRef.current !== null && savedPhotoId === null) {
        try {
          const saved = await addPhoto(clientId, date, resizedRef.current, {
            mealId,
            caption: 'AIで読み取った写真',
          });
          setSavedPhotoId(saved.id);
          onPhotoSaved?.();
        } catch {
          // 写真が残せなくても、下書きそのものは成立している
        }
      }
    } catch (e) {
      setError(
        e instanceof AiError ? aiErrorMessage(e.kind, e.detail) : 'AIの呼び出しに失敗しました。',
      );
    } finally {
      setBusy(false);
    }
  }

  function patch(key: string, changes: Partial<Draft>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...changes } : d)));
  }

  const ready = drafts.filter(isComplete);
  const pendingCount = ready.filter((d) => d.food === null).length;

  function confirm() {
    const items: MealItem[] = [];
    const requestNames: string[] = [];

    for (const d of ready) {
      const grams = Number(d.grams);

      if (d.food === null) {
        // 登録待ち。名前と量だけ残し、栄養値は管理者が入れる
        items.push({
          id: newItemId(),
          name: d.name.trim(),
          grams,
          per100g: ZERO,
          nutrients: ZERO,
          foodId: null,
          pending: true,
          // ★ ここでは仮の値を入れません（追加仕様: 仮の栄養値）。
          //   この確認画面に kcal/P/F/C の4欄を並べると、5品なら20欄になり、
          //   スマホでは押し間違えます。
          //   追加したあとに食材をタップすれば、いつもの入力画面で入れられます。
          provisional: false,
        });
        requestNames.push(d.name.trim());
        continue;
      }

      const internal = toInternal(d.food.per100g);
      items.push({
        id: newItemId(),
        name: d.food.name,
        grams,
        per100g: internal,
        nutrients: computeItemNutrients(internal, grams),
        foodId: d.food.id,
        pending: false,
        provisional: false,
      });
    }

    onAdd(items, requestNames);
  }

  return (
    <div className="ai-panel">
      <div className="ai-head">
        <h4 className="ai-title">{mode === 'photo' ? '写真から入力' : '文章から入力'}</h4>
        <button className="button-quiet" type="button" onClick={onClose}>
          閉じる
        </button>
      </div>

      {result === null && (
        <>
          {mode === 'photo' && (
            <>
              {photo !== null && (
                <div className="ai-photo-preview">
                  <img src={photo.dataUrl} alt="" />
                  <span className="note">{formatBytes(photo.bytes)}に縮小して送ります</span>
                </div>
              )}

              <input
                ref={fileInput}
                className="visually-hidden"
                type="file"
                accept="image/*"
                onChange={(e) => void pick(e.target.files)}
              />
              <button
                className="button-secondary"
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={busy}
              >
                {photo === null ? '写真を選ぶ / 撮る' : '別の写真にする'}
              </button>
            </>
          )}

          <textarea
            className="input"
            rows={mode === 'photo' ? 2 : 3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              mode === 'photo'
                ? '補足があれば（例: ごはんは少なめ）。空欄でも構いません'
                : '白米180gと鶏むね肉150g、ブロッコリー少し'
            }
            autoFocus={mode === 'text'}
          />
          <p className="field-hint">
            {mode === 'photo'
              ? '写真に写っているものだけを読み取ります。量は「150〜210g」のような幅で示され、そのまま登録されることはありません。'
              : '食べたものをそのまま書いてください。書いていないことをAIが勝手に足すことはありません。'}
          </p>

          {error !== null && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button
            className="button-primary compact"
            type="button"
            onClick={() => void run()}
            disabled={busy || (mode === 'photo' ? photo === null : text.trim().length === 0)}
          >
            {busy
              ? 'AIに聞いています…'
              : mode === 'photo'
                ? 'この写真を読み取ってもらう'
                : 'AIに分解してもらう'}
          </button>
        </>
      )}

      {result !== null && (
        <>
          {result.guard.rejected.length > 0 && (
            <section className="card warn ai-rejected">
              <h4 className="card-title">
                {mode === 'photo'
                  ? '自信が低いため取り除いた項目'
                  : 'AIが足そうとした情報を取り除きました'}
              </h4>
              <ul className="note-list">
                {result.guard.rejected.map((r, i) => (
                  <li key={i}>
                    <b>{r.item.name}</b> — {r.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {mode === 'photo' && drafts.length > 0 && (
            <p className="notice">
              写真から読み取った<b>推定</b>です。実際の量と見比べて、必要なら直してください。
            </p>
          )}

          {result.recognition.unidentified.length > 0 && (
            <p className="notice">
              判別できなかった部分:{' '}
              {result.recognition.unidentified.map((u) => u.description).join(' / ')}
            </p>
          )}

          {drafts.length === 0 && (
            <p className="note">
              使える候補がありませんでした。表現を変えてお試しいただくか、手で入力してください。
            </p>
          )}

          {drafts.map((d) => (
            <DraftRow
              key={d.key}
              draft={d}
              foods={foods}
              onChange={(changes) => patch(d.key, changes)}
              onRemove={() => setDrafts((prev) => prev.filter((x) => x.key !== d.key))}
            />
          ))}

          {result.recognition.notes.length > 0 && (
            <ul className="note-list">
              {result.recognition.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}

          {pendingCount > 0 && (
            <p className="notice">
              未登録の食材が{pendingCount}件あります。記録はされますが、
              <b>トレーナーが登録するまで合計に含まれません。</b>
            </p>
          )}

          <div className="item-form-actions">
            <button
              className="button-primary compact"
              type="button"
              onClick={confirm}
              disabled={ready.length === 0}
            >
              {ready.length === 0 ? '追加できる項目がありません' : `${ready.length}件を追加する`}
            </button>
            <button
              className="button-quiet"
              type="button"
              onClick={() => {
                setResult(null);
                setDrafts([]);
              }}
            >
              やり直す
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------

function DraftRow({
  draft,
  foods,
  onChange,
  onRemove,
}: {
  draft: Draft;
  foods: Food[];
  onChange: (changes: Partial<Draft>) => void;
  onRemove: () => void;
}) {
  const grams = Number(draft.grams);
  const complete = isComplete(draft);

  const preview =
    complete && draft.food !== null
      ? computeItemNutrients(toInternal(draft.food.per100g), grams)
      : null;

  const similar = draft.food === null ? findSimilarFoods(foods, draft.name, 3) : [];

  return (
    <div className={complete ? 'ai-draft ready' : 'ai-draft'}>
      <div className="ai-draft-head">
        <input
          className="input ai-name"
          type="text"
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value, food: findExactFood(foods, e.target.value) })}
          aria-label="食材の名前"
        />
        <button className="button-quiet danger compact" type="button" onClick={onRemove}>
          外す
        </button>
      </div>

      <p className="ai-evidence">
        根拠: <span>{draft.evidence}</span>
      </p>

      {draft.estimated && (
        <p className="ai-estimate">
          <span className="badge wait">推定</span>
          {draft.range !== null && <> AIの見立て: {draft.range}</>}
        </p>
      )}

      {draft.question !== null && <p className="notice">{draft.question}</p>}

      <label className="field">
        <span className="field-label small">量（g）</span>
        <input
          className="input"
          type="number"
          inputMode="decimal"
          step="0.1"
          value={draft.grams}
          onChange={(e) => onChange({ grams: e.target.value })}
          placeholder="未入力"
        />
      </label>

      {draft.food !== null ? (
        <div className="nutrition-fixed">
          <span className="field-label small">100gあたり（共通マスタ）</span>
          <div className="macros">
            <span className="kcal">{draft.food.per100g.kcal}kcal</span>
            <span className="macro p">P {draft.food.per100g.p}</span>
            <span className="macro f">F {draft.food.per100g.f}</span>
            <span className="macro c">C {draft.food.per100g.c}</span>
          </div>
        </div>
      ) : (
        <>
          <p className="notice">
            未登録の食材です。<b>量だけ記録し、トレーナーに登録を依頼します。</b>
          </p>
          {similar.length > 0 && (
            <>
              <p className="field-hint">似た食材があります。同じものならこちらを選んでください。</p>
              <ul className="suggestions">
                {similar.map((m) => (
                  <li key={m.food.id}>
                    <button
                      type="button"
                      className="suggestion"
                      onClick={() => onChange({ name: m.food.name, food: m.food })}
                    >
                      <span className="suggestion-name">{m.food.name}</span>
                      <span className="suggestion-meta">
                        {m.food.per100g.kcal}kcal · P{m.food.per100g.p} F{m.food.per100g.f} C
                        {m.food.per100g.c}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {preview !== null && (
        <div className="preview">
          <span className="preview-label">この食材ぶん</span>
          <span className="macros">
            <span className="kcal">{formatNutrients(preview).kcal}kcal</span>
            <span className="macro p">P {formatNutrients(preview).p}</span>
            <span className="macro f">F {formatNutrients(preview).f}</span>
            <span className="macro c">C {formatNutrients(preview).c}</span>
          </span>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------

function toDraft(item: RecognizedItem, foods: Food[], estimated: boolean): Draft {
  /**
   * ★ AIが返した名前を、まず共通マスタに当てにいきます（別名も見ます）。
   *   AIが「鶏ムネ肉」と返しても既存の「鶏むね肉」に当たるので、
   *   ぶれの大半は契約者の目に触れる前に消えます。
   */
  const food = findExactFood(foods, item.name);

  const prefill = estimated
    ? item.quantity.value > 0
      ? String(Math.round(item.quantity.value))
      : ''
    : item.needsUserInput || item.quantity.value === 0
      ? ''
      : String(item.quantity.value);

  return {
    key: `${item.name}-${item.evidence}-${Math.random().toString(36).slice(2, 8)}`,
    name: food?.name ?? item.name,
    grams: prefill,
    range: formatRange(item),
    estimated,
    food,
    evidence: item.evidence,
    question: item.question,
  };
}

function isComplete(d: Draft): boolean {
  const grams = Number(d.grams);
  if (d.name.trim().length === 0) return false;
  return d.grams.trim().length > 0 && Number.isFinite(grams) && grams > 0;
}
