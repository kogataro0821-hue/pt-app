import { useRef, useState } from 'react';
import {
  formatNutrients,
  kcalMismatchWarning,
  labelBasisLabel,
  labelToPer100g,
  toInternal,
  type DecimalNutrients,
  type LabelBasis,
  type LabelReading,
} from '@pt/core';
import { AiError, aiErrorMessage, readNutritionLabel } from '@/features/ai/gemini';
import { PhotoResizeError, photoErrorMessage, resizePhoto } from '@/features/photos/resize';

/**
 * 栄養成分表示の読み取り（設計書 §47 / Phase 12）。
 *
 * ★ 手順を守っています。
 *
 *     AI(読み取り) → 人間の確認 → 手動修正 → 決定論的計算 → 保存
 *
 *   AIがやるのは「表示に何と書いてあるか」まで。
 *   100gあたりへの換算は @pt/core の labelToPer100g が行います。
 *   割り算をAIにやらせると、263kcal が 461kcal になった理由が
 *   説明できなくなり、間違っていても気づけません。
 *
 * ★ 読み取った値は、必ず画面に出してから使います。
 *
 *   どの欄を読んだか（evidence）も一緒に出します。
 *   カップ麺のように「1食263kcal」と「参考値めん243kcal」が
 *   並んでいる表示では、どちらを読んだかが決定的に効きます。
 *
 * ★ グラム数が読めなければ、推測せずに聞きます。
 *   「1本当たり」としか書いていない表示から100gあたりは出せません。
 *   情報が足りないので、人に入れてもらいます。
 */
export function LabelScanner({
  onDone,
  onCancel,
}: {
  /**
   * 読み取って人が確認した100gあたりの値。
   *
   * ★ 写真も一緒に返します。
   *   数字だけ渡すと、受け取った管理者に確かめる手段がありません。
   *   「参考値のほうを拾っていないか」は、表示を見ないと判断できませんし、
   *   そのころ契約者はパッケージを捨てています。
   */
  onDone: (result: {
    per100g: DecimalNutrients;
    productName: string;
    note: string;
    photo: string;
    /** 表示に書いてあった1回分のグラム数。書いていなければ null */
    servingGrams: number | null;
  }) => void;
  onCancel: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<LabelReading | null>(null);
  const [productName, setProductName] = useState('');
  const [evidence, setEvidence] = useState('');
  const [aiNotes, setAiNotes] = useState<string[]>([]);
  const [gramsInput, setGramsInput] = useState('');
  /** 撮った写真そのもの。管理者が確かめられるように持ち回る */
  const [photo, setPhoto] = useState<string>('');

  async function onPick(files: FileList | null) {
    if (files === null || files.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      const resized = await resizePhoto(files[0]!);
      const result = await readNutritionLabel(resized.dataUrl);

      setPhoto(resized.dataUrl);
      setProductName(result.productName);
      setEvidence(result.evidence);
      setAiNotes(result.notes);
      setGramsInput(result.servingGrams === null ? '' : String(result.servingGrams));
      setReading({
        // 'unknown' は「読めなかった」という意味なので、
        // 100gあたりだと決めつけずに、人に選んでもらいます。
        basis: result.basis === 'unknown' ? 'perServing' : (result.basis as LabelBasis),
        servingGrams: result.servingGrams,
        kcal: result.kcal ?? 0,
        p: result.p ?? 0,
        f: result.f ?? 0,
        c: result.c,
        sugar: result.sugar,
        fiber: result.fiber,
        salt: result.salt,
        sodiumMg: result.sodiumMg,
      });
    } catch (e) {
      setError(
        e instanceof PhotoResizeError
          ? photoErrorMessage(e.kind)
          : e instanceof AiError
            ? aiErrorMessage(e.kind, e.detail)
            : '成分表示を読み取れませんでした。手で入力してください。',
      );
    } finally {
      setBusy(false);
      if (fileInput.current !== null) fileInput.current.value = '';
    }
  }

  // 人が直したグラム数を反映してから換算します。
  const effective: LabelReading | null =
    reading === null
      ? null
      : { ...reading, servingGrams: parseGrams(gramsInput) ?? reading.servingGrams };

  const converted = effective === null ? null : labelToPer100g(effective);
  const mismatch =
    converted !== null && converted.ok ? kcalMismatchWarning(converted.per100g) : null;

  return (
    <section className="card">
      <h3 className="card-title">成分表示から読み取る</h3>

      {reading === null && (
        <>
          <p className="note">
            商品の「栄養成分表示」が写るように撮ってください。
            <br />
            読み取った数値は<b>そのまま登録されません</b>。画面で確認してから使います。
          </p>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept="image/*"
            onChange={(e) => void onPick(e.target.files)}
          />
          <button
            className="button-secondary"
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
          >
            {busy ? '読み取っています…' : '成分表示を撮る'}
          </button>
        </>
      )}

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {reading !== null && effective !== null && (
        <>
          {/* ★ 何をどこから読んだかを、必ず見せます */}
          <div className="kv">
            <span className="kv-key">商品名</span>
            <span className="kv-value">{productName.length > 0 ? productName : '(読めず)'}</span>
          </div>
          {evidence.length > 0 && (
            <div className="kv">
              <span className="kv-key">読んだ欄</span>
              <span className="kv-value">{evidence}</span>
            </div>
          )}
          <div className="kv">
            <span className="kv-key">基準量</span>
            <span className="kv-value">{labelBasisLabel(effective)}</span>
          </div>

          <p className="field-hint">表示に書いてあった値（換算前）</p>
          <div className="macros">
            <span className="kcal">{reading.kcal}kcal</span>
            <span className="macro p">P {reading.p}</span>
            <span className="macro f">F {reading.f}</span>
            <span className="macro c">
              C {reading.c ?? `${reading.sugar ?? '?'}(糖質)`}
            </span>
          </div>

          <label className="field">
            <span className="field-label">基準量</span>
            <select
              className="input"
              value={reading.basis}
              onChange={(e) => setReading({ ...reading, basis: e.target.value as LabelBasis })}
            >
              <option value="per100g">100g当たり</option>
              <option value="per100ml">100ml当たり</option>
              <option value="perServing">1回分あたり</option>
            </select>
          </label>

          {reading.basis === 'perServing' && (
            <label className="field">
              <span className="field-label">1回分は何g？</span>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                step="0.1"
                value={gramsInput}
                onChange={(e) => setGramsInput(e.target.value)}
                placeholder="57"
              />
              <span className="field-hint">
                表示に書いてあれば自動で入ります。入っていなければ、パッケージを見て入力してください。
              </span>
            </label>
          )}

          {aiNotes.length > 0 && (
            <ul className="note-list">
              {aiNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}

          {converted !== null && !converted.ok && (
            <p className="notice" role="status">
              {converted.message}
            </p>
          )}

          {converted !== null && converted.ok && (
            <>
              <p className="field-hint">100gあたり（この値を使います）</p>
              <div className="macros">
                <span className="kcal">
                  {formatNutrients(toInternal(converted.per100g)).kcal}kcal
                </span>
                <span className="macro p">
                  P {formatNutrients(toInternal(converted.per100g)).p}
                </span>
                <span className="macro f">
                  F {formatNutrients(toInternal(converted.per100g)).f}
                </span>
                <span className="macro c">
                  C {formatNutrients(toInternal(converted.per100g)).c}
                </span>
              </div>

              {converted.notes.map((n) => (
                <p className="field-hint" key={n}>
                  {n}
                </p>
              ))}

              {mismatch !== null && (
                <p className="notice" role="status">
                  {mismatch}
                  <br />
                  写真がぼやけていると、桁を読み違えることがあります。
                </p>
              )}
            </>
          )}

          <div className="item-form-actions">
            <button
              className="button-primary compact"
              type="button"
              disabled={converted === null || !converted.ok}
              onClick={() => {
                if (converted === null || !converted.ok) return;
                onDone({
                  per100g: converted.per100g,
                  photo,
                  productName,
                  servingGrams:
                    effective.basis === 'perServing' ? effective.servingGrams : null,
                  note: [labelBasisLabel(effective), evidence, ...converted.notes]
                    .filter((s) => s.length > 0)
                    .join(' / ')
                    .slice(0, 200),
                });
              }}
            >
              この値を使う
            </button>
            <button className="button-quiet" type="button" onClick={onCancel}>
              やめる
            </button>
          </div>
        </>
      )}

      {reading === null && (
        <button className="button-quiet" type="button" onClick={onCancel} disabled={busy}>
          やめる
        </button>
      )}
    </section>
  );
}

function parseGrams(value: string): number | null {
  if (value.trim().length === 0) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
