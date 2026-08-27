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
  computeItemNutrients,
  toInternal,
  formatNutrients,
  type MealItem,
  type Per100gInput,
} from '@pt/core';
import { loadFoods, searchFoods, type Food } from '@/features/meals/foodsRepo';
import { newItemId } from '@/features/meals/mealsRepo';
import { PhotoResizeError, formatBytes, photoErrorMessage, resizePhoto } from '@/features/photos/resize';
import { AiError, aiErrorMessage, analyzeMealPhoto, parseMealText } from './gemini';

/**
 * 文章から食材を起こす（設計書 §12 / §14 / §39）。
 *
 * 流れ:
 *   1. 利用者が文章を書く
 *   2. AI が「何を・どれだけ」に分解する（栄養値は答えない）
 *   3. ★ 根拠が原文に無い項目を機械的に捨てる
 *   4. 量が不明なものは、利用者に聞く
 *   5. 栄養値は食品マスタから引く。無ければ手で入れてもらう
 *   6. 利用者が確認して確定 → 決定論的に計算して保存
 *
 * ★ 3〜5があるので、この画面は「AIの答えをそのまま登録する画面」ではありません。
 *   AIは下書きを作るだけで、確定するのは必ず人です（設計書 §47）。
 */

interface Draft {
  key: string;
  name: string;
  grams: string;
  /** 「150〜210g」。写真からの推定のときだけ入る */
  range: string | null;
  /** 写真からの推定か。true なら画面で「推定」と明示する */
  estimated: boolean;
  per100g: Record<keyof Per100gInput, string>;
  /** AIが根拠にした原文の一部 */
  evidence: string;
  /** 量が分からないのでユーザーに聞きたい */
  needsAmount: boolean;
  question: string | null;
  confidence: number;
  /** 食品マスタから栄養値が入ったか */
  fromMaster: boolean;
  foodId: string | null;
}

export function AiTextPanel({
  clientId,
  mode,
  onAdd,
  onClose,
}: {
  clientId: string;
  /** 'text' = 文章から / 'photo' = 写真から */
  mode: 'text' | 'photo';
  onAdd: (items: MealItem[], sources: { name: string; per100g: Per100gInput }[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<{ dataUrl: string; bytes: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [foods, setFoods] = useState<Food[]>([]);
  const [result, setResult] = useState<{
    guard: GuardResult;
    recognition: MealRecognition;
    sourceText: string;
  } | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  useEffect(() => {
    void loadFoods(clientId)
      .then(setFoods)
      .catch(() => setFoods([]));
  }, [clientId]);

  async function pick(files: FileList | null) {
    if (files === null || files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const resized = await resizePhoto(files[0]!);
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
       *   写真から … 照合できる原文が無いので、閾値を厳しくし、
       *              すべてを確認待ちに回す（wire.ts の説明を参照）
       */
      const guard = isPhoto
        ? guardRecognition(recognition, {
            minConfidence: PHOTO_MIN_CONFIDENCE,
            sourceText: null,
          })
        : guardRecognition(recognition, { minConfidence: 0.6, sourceText: text });

      setResult({ guard, recognition, sourceText: text });
      setDrafts([...guard.accepted, ...guard.flagged].map((item) => toDraft(item, foods, isPhoto)));
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

  function remove(key: string) {
    setDrafts((prev) => prev.filter((d) => d.key !== key));
  }

  const ready = drafts.filter(isComplete);

  function confirm() {
    const items: MealItem[] = [];
    const sources: { name: string; per100g: Per100gInput }[] = [];

    for (const d of ready) {
      const per100g: Per100gInput = {
        kcal: Number(d.per100g.kcal),
        p: Number(d.per100g.p),
        f: Number(d.per100g.f),
        c: Number(d.per100g.c),
      };
      const internal = toInternal(per100g);
      const grams = Number(d.grams);

      items.push({
        id: newItemId(),
        name: d.name.trim(),
        grams,
        per100g: internal,
        nutrients: computeItemNutrients(internal, grams),
        foodId: d.foodId,
      });
      sources.push({ name: d.name.trim(), per100g });
    }

    onAdd(items, sources);
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
              ? '写真に写っているものだけを読み取ります。写っていないものをAIが足すことはありません。量は必ず「150〜210g」のような幅で示され、そのまま登録されることはありません。'
              : '食べたものをそのまま書いてください。量が分かるものは書いておくと、そのまま入ります。書いていないことをAIが勝手に足すことはありません。'}
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
              <p className="note">
                {mode === 'photo'
                  ? '写真では根拠を機械的に確かめられないため、自信の低いものは自動的に外しています。必要なら手で足してください。'
                  : '書いていないことをAIが補ったため、こちらで自動的に外しました。必要なら手で足してください。'}
              </p>
            </section>
          )}

          {mode === 'photo' && drafts.length > 0 && (
            <p className="notice">
              写真から読み取った<b>推定</b>です。実際の量と見比べて、必要なら直してください。
              数字は幅で示しています。幅が広いものほど、AIの自信が低い項目です。
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
              onRemove={() => remove(d.key)}
            />
          ))}

          {result.recognition.notes.length > 0 && (
            <ul className="note-list">
              {result.recognition.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
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

          {ready.length < drafts.length && (
            <p className="note">
              量または栄養値が埋まっていない項目は追加されません。
              上で入力するか、その項目を外してください。
            </p>
          )}
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
  const complete = isComplete(draft);
  const preview = complete
    ? computeItemNutrients(
        toInternal({
          kcal: Number(draft.per100g.kcal),
          p: Number(draft.per100g.p),
          f: Number(draft.per100g.f),
          c: Number(draft.per100g.c),
        }),
        Number(draft.grams),
      )
    : null;

  const suggestions = draft.fromMaster ? [] : searchFoods(foods, draft.name, 3);

  return (
    <div className={complete ? 'ai-draft ready' : 'ai-draft'}>
      <div className="ai-draft-head">
        <input
          className="input ai-name"
          type="text"
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value, fromMaster: false, foodId: null })}
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

      {/*
        ★ 質問は、量が埋まっていても出します。
          「皮は付いていましたか？」のように、量とは別のことを聞いている場合があり、
          量が入ったからという理由で握りつぶすと、確認の機会が失われます。
      */}
      {draft.question !== null && <p className="notice">{draft.question}</p>}

      <div className="grid-2">
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

        <div className="ai-status">
          {draft.fromMaster ? (
            <span className="badge ok">マスタから</span>
          ) : (
            <span className="badge wait">栄養値を入力</span>
          )}
        </div>
      </div>

      {suggestions.length > 0 && (
        <ul className="suggestions">
          {suggestions.map((f) => (
            <li key={`${f.scope}-${f.id}`}>
              <button
                type="button"
                className="suggestion"
                onClick={() =>
                  onChange({
                    name: f.name,
                    per100g: {
                      kcal: String(f.per100g.kcal),
                      p: String(f.per100g.p),
                      f: String(f.per100g.f),
                      c: String(f.per100g.c),
                    },
                    fromMaster: true,
                    foodId: f.scope === 'personal' ? f.id : null,
                  })
                }
              >
                <span className="suggestion-name">{f.name}</span>
                <span className="suggestion-meta">
                  100gあたり {f.per100g.kcal}kcal · P{f.per100g.p} F{f.per100g.f} C{f.per100g.c}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid-4">
        {(['kcal', 'p', 'f', 'c'] as const).map((key) => (
          <label className="field" key={key}>
            <span className={key === 'kcal' ? 'field-label small' : `field-label small macro ${key}`}>
              {key === 'kcal' ? 'kcal' : key.toUpperCase()}
            </span>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              step="0.1"
              value={draft.per100g[key]}
              onChange={(e) =>
                onChange({ per100g: { ...draft.per100g, [key]: e.target.value }, fromMaster: false })
              }
            />
          </label>
        ))}
      </div>

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

function toDraft(item: RecognizedItem, foods: Food[], estimated = false): Draft {
  // ★ 栄養値は食品マスタから引きます。AIには答えさせません（設計書 §13 / §37）。
  const match = foods.find((f) => f.name === item.name);

  /**
   * ★ 写真の場合だけ、推定値を最初から入れておきます。
   *   「入れておく」ことと「確定させる」ことは違います。
   *   画面には推定であることと幅を並べて出し、人が見比べて直せるようにしています。
   *   逆に文章の場合は、書かれていない量を勝手に埋めません。
   */
  const prefill = estimated
    ? item.quantity.value > 0
      ? String(Math.round(item.quantity.value))
      : ''
    : item.needsUserInput || item.quantity.value === 0
      ? ''
      : String(item.quantity.value);

  return {
    key: `${item.name}-${item.evidence}-${Math.random().toString(36).slice(2, 8)}`,
    name: item.name,
    grams: prefill,
    range: formatRange(item),
    estimated,
    per100g:
      match === undefined
        ? { kcal: '', p: '', f: '', c: '' }
        : {
            kcal: String(match.per100g.kcal),
            p: String(match.per100g.p),
            f: String(match.per100g.f),
            c: String(match.per100g.c),
          },
    evidence: item.evidence,
    needsAmount: item.needsUserInput && prefill === '',
    question: item.question,
    confidence: item.confidence,
    fromMaster: match !== undefined,
    foodId: match !== undefined && match.scope === 'personal' ? match.id : null,
  };
}

function isComplete(d: Draft): boolean {
  const grams = Number(d.grams);
  if (d.name.trim().length === 0) return false;
  if (d.grams.trim().length === 0 || !Number.isFinite(grams) || grams <= 0) return false;
  return (['kcal', 'p', 'f', 'c'] as const).every((k) => {
    const v = Number(d.per100g[k]);
    return d.per100g[k].trim().length > 0 && Number.isFinite(v) && v >= 0;
  });
}
