import { useMemo, useState } from 'react';
import { findSimilarFoods, kcalMismatchWarning, type Per100gInput } from '@pt/core';
import { writeErrorMessage } from '@/lib/firestoreError';
import { emptyFood, newFoodId, saveFood, type Food } from './foodsRepo';

/**
 * 食品マスタ1件の編集（設計書 §21 / Phase 9）。
 *
 * ★ ここは管理者だけの画面です。
 *   100gあたりの kcal / P / F / C は、このアプリの数字すべての土台になります。
 *   契約者が各自で入れられる状態にすると、同じ「白米」が人によって
 *   違うカロリーになり、トレーナーが数字を根拠に指導できなくなります。
 *
 * ★ 保存前に「似た名前の食材」を出します。
 *   同じ食材を2件作ってしまうと、あとから統合するのは大変です。
 *   作る前に気づけるほうが安上がりです。
 */
export function FoodEditor({
  initial,
  all,
  onSaved,
  onCancel,
}: {
  /** 新規なら未指定、または名前だけ入ったもの */
  initial?: Food;
  /** 重複チェックに使う既存の一覧 */
  all: Food[];
  onSaved: (food: Food) => void;
  onCancel: () => void;
}) {
  const base = initial ?? emptyFood();
  const isNew = base.createdAt === null;

  const [name, setName] = useState(base.name);
  const [aliasText, setAliasText] = useState(base.aliases.join('、'));
  const [note, setNote] = useState(base.note);
  const [values, setValues] = useState<Record<keyof Per100gInput, string>>({
    kcal: isNew && base.per100g.kcal === 0 ? '' : String(base.per100g.kcal),
    p: isNew && base.per100g.p === 0 ? '' : String(base.per100g.p),
    f: isNew && base.per100g.f === 0 ? '' : String(base.per100g.f),
    c: isNew && base.per100g.c === 0 ? '' : String(base.per100g.c),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 新規のときだけ、似た名前を警告します。
  // 既存を編集しているときに自分自身が出ても意味がありません。
  const similar = useMemo(
    () => (isNew ? findSimilarFoods(all, name, 4) : []),
    [all, name, isNew],
  );

  const numbers: Per100gInput = {
    kcal: parse(values.kcal),
    p: parse(values.p),
    f: parse(values.f),
    c: parse(values.c),
  };

  const nameOk = name.trim().length > 0;
  const numbersOk = (['kcal', 'p', 'f', 'c'] as const).every(
    (k) => values[k].trim().length > 0 && Number.isFinite(Number(values[k])) && numbers[k] >= 0,
  );

  // ★ 桁の打ち間違いをここで拾います。
  //   この数値は全員の記録に効くので、1件の入力ミスが全員の合計を狂わせます。
  //   ただし止めはしません。野菜のように、計算値とずれるのが正常な食材もあります。
  const mismatch = numbersOk ? kcalMismatchWarning(numbers) : null;

  async function submit() {
    if (!nameOk) {
      setError('食材の名前を入力してください。');
      return;
    }
    if (!numbersOk) {
      setError('100gあたりの kcal・P・F・C をすべて入力してください（0以上の数字）。');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const saved = await saveFood({
        ...base,
        // ★ 新規のときだけIDを名前から作ります。
        //   既存のIDを変えると、過去の記録から食材をたどれなくなります。
        id: isNew ? newFoodId(name) : base.id,
        name: name.trim(),
        aliases: splitAliases(aliasText),
        per100g: numbers,
        note: note.trim(),
      });
      onSaved(saved);
    } catch (e) {
      setError(writeErrorMessage(e, 'この食材'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h3 className="card-title">{isNew ? '食材を登録する' : '食材を編集する'}</h3>

      <label className="field">
        <span className="field-label">名前</span>
        <input
          className="input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="鶏むね肉（皮なし）"
        />
      </label>

      {similar.length > 0 && (
        <>
          <p className="field-hint">
            似た食材がすでにあります。同じものなら、新しく作らずそちらに別名を足してください。
          </p>
          <ul className="suggestions">
            {similar.map((m) => (
              <li key={m.food.id}>
                <span className="suggestion">
                  <span className="suggestion-name">{m.food.name}</span>
                  <span className="suggestion-meta">
                    {m.food.per100g.kcal}kcal · P{m.food.per100g.p} F{m.food.per100g.f} C
                    {m.food.per100g.c}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <fieldset className="per100g">
        <legend className="field-label">100gあたり</legend>
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
                value={values[key]}
                onChange={(e) => setValues({ ...values, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
      </fieldset>

      {mismatch !== null && (
        <p className="notice" role="status">
          {mismatch}
        </p>
      )}

      <label className="field">
        <span className="field-label">別名（読み方や書き方のゆれ）</span>
        <input
          className="input"
          type="text"
          value={aliasText}
          onChange={(e) => setAliasText(e.target.value)}
          placeholder="鶏胸肉、とりむね、ムネ肉"
        />
        <span className="field-hint">
          「、」で区切って入れてください。ここに入れた名前で入力しても、この食材に当たります。
        </span>
      </label>

      <label className="field">
        <span className="field-label">補足（任意）</span>
        <input
          className="input"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="皮なし・生"
        />
      </label>

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="item-form-actions">
        <button
          className="button-primary compact"
          type="button"
          onClick={() => void submit()}
          disabled={busy}
        >
          {busy ? '保存しています…' : '保存する'}
        </button>
        <button className="button-quiet" type="button" onClick={onCancel} disabled={busy}>
          やめる
        </button>
      </div>
    </section>
  );
}

export function splitAliases(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[、,\n]/)) {
    const t = raw.trim();
    if (t.length > 0 && !out.includes(t)) out.push(t);
  }
  return out;
}

function parse(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
