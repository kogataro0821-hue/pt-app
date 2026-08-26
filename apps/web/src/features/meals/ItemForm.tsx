import { useEffect, useMemo, useState } from 'react';
import {
  computeItemNutrients,
  formatNutrients,
  kcalMismatchWarning,
  toInternal,
  validateItemInput,
  type MealItem,
  type Per100gInput,
} from '@pt/core';
import { loadFoods, searchFoods, type Food } from './foodsRepo';
import { newItemId } from './mealsRepo';

/**
 * 食材1件の入力（設計書 §14 / Q13）。
 *
 * 流れ:
 *   名前を打つ → マスタに候補があれば選ぶ（栄養値が自動で入る）
 *              → 無ければ 100gあたりの値を手で入れる
 *   量(g)を入れる → その場で「実際に食べたぶん」の数字が出る
 *
 * ★ 計算しているのは @pt/core の決定論的な関数です。
 *   AI も推測も入りません（設計書 §37）。
 */
export function ItemForm({
  clientId,
  initial,
  onSubmit,
  onCancel,
}: {
  clientId: string;
  /** 編集のときだけ渡す */
  initial?: MealItem;
  onSubmit: (item: MealItem, source: { name: string; per100g: Per100gInput }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [grams, setGrams] = useState(initial === undefined ? '' : String(initial.grams));
  const [per100g, setPer100g] = useState<Record<keyof Per100gInput, string>>(() =>
    initial === undefined
      ? { kcal: '', p: '', f: '', c: '' }
      : {
          kcal: String(round1(initial.per100g.kcal / 1000)),
          p: String(round1(initial.per100g.p / 1000)),
          f: String(round1(initial.per100g.f / 1000)),
          c: String(round1(initial.per100g.c / 1000)),
        },
  );
  const [foodId, setFoodId] = useState<string | null>(initial?.foodId ?? null);
  const [foods, setFoods] = useState<Food[]>([]);
  const [picked, setPicked] = useState(initial !== undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadFoods(clientId)
      .then(setFoods)
      .catch(() => setFoods([]));
  }, [clientId]);

  const suggestions = useMemo(
    () => (picked ? [] : searchFoods(foods, name)),
    [foods, name, picked],
  );

  const numbers: Partial<Per100gInput> = {
    ...maybe('kcal', per100g.kcal),
    ...maybe('p', per100g.p),
    ...maybe('f', per100g.f),
    ...maybe('c', per100g.c),
  };
  const gramsNum = parse(grams);
  const issues = validateItemInput({ name, grams: gramsNum, per100g: numbers });
  const complete = issues.length === 0;

  const preview =
    complete && gramsNum !== null
      ? computeItemNutrients(toInternal(numbers as Per100gInput), gramsNum)
      : null;

  const warning = complete ? kcalMismatchWarning(numbers as Per100gInput) : null;

  function choose(food: Food) {
    setName(food.name);
    setPer100g({
      kcal: String(food.per100g.kcal),
      p: String(food.per100g.p),
      f: String(food.per100g.f),
      c: String(food.per100g.c),
    });
    setFoodId(food.scope === 'personal' ? food.id : null);
    setPicked(true);
  }

  function submit() {
    if (!complete || gramsNum === null) {
      setError(issues[0]?.message ?? '入力を確認してください。');
      return;
    }
    const source = { name: name.trim(), per100g: numbers as Per100gInput };
    const internal = toInternal(source.per100g);
    onSubmit(
      {
        id: initial?.id ?? newItemId(),
        name: source.name,
        grams: gramsNum,
        per100g: internal,
        nutrients: computeItemNutrients(internal, gramsNum),
        foodId,
      },
      source,
    );
  }

  return (
    <div className="item-form">
      <label className="field">
        <span className="field-label">食材の名前</span>
        <input
          className="input"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setPicked(false);
            setFoodId(null);
          }}
          placeholder="鶏むね肉"
          autoFocus
        />
      </label>

      {suggestions.length > 0 && (
        <ul className="suggestions">
          {suggestions.map((f) => (
            <li key={`${f.scope}-${f.id}`}>
              <button type="button" className="suggestion" onClick={() => choose(f)}>
                <span className="suggestion-name">{f.name}</span>
                <span className="suggestion-meta">
                  100gあたり {f.per100g.kcal}kcal · P{f.per100g.p} F{f.per100g.f} C{f.per100g.c}
                </span>
                {f.scope === 'common' && <span className="badge">共通</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="field">
        <span className="field-label">食べた量（g）</span>
        <input
          className="input"
          type="number"
          inputMode="decimal"
          step="0.1"
          value={grams}
          onChange={(e) => setGrams(e.target.value)}
          placeholder="150"
        />
      </label>

      <fieldset className="per100g">
        <legend className="field-label">100gあたりの栄養値</legend>
        <div className="grid-4">
          <Small label="kcal" value={per100g.kcal} onChange={(v) => setPer100g({ ...per100g, kcal: v })} />
          <Small label="P" accent="p" value={per100g.p} onChange={(v) => setPer100g({ ...per100g, p: v })} />
          <Small label="F" accent="f" value={per100g.f} onChange={(v) => setPer100g({ ...per100g, f: v })} />
          <Small label="C" accent="c" value={per100g.c} onChange={(v) => setPer100g({ ...per100g, c: v })} />
        </div>
        <span className="field-hint">
          食品パッケージの栄養成分表示や、文部科学省の食品成分データベースの値を入れてください。
          一度入れれば、次回から名前を打つだけで候補に出ます。
        </span>
      </fieldset>

      {warning !== null && <p className="notice">{warning}</p>}

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

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="item-form-actions">
        <button className="button-primary compact" type="button" onClick={submit} disabled={!complete}>
          {initial === undefined ? '追加する' : '変更する'}
        </button>
        <button className="button-quiet" type="button" onClick={onCancel}>
          やめる
        </button>
      </div>
    </div>
  );
}

function Small({
  label,
  value,
  onChange,
  accent,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  accent?: 'p' | 'f' | 'c';
}) {
  return (
    <label className="field">
      <span className={accent === undefined ? 'field-label small' : `field-label small macro ${accent}`}>
        {label}
      </span>
      <input
        className="input"
        type="number"
        inputMode="decimal"
        step="0.1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** 未入力なら、そのキー自体を作らない（validateItemInput が「未入力」として扱えるように） */
function maybe(key: keyof Per100gInput, raw: string): Partial<Per100gInput> {
  const n = parse(raw);
  return n === null ? {} : ({ [key]: n } as Partial<Per100gInput>);
}

function parse(value: string): number | null {
  if (value.trim().length === 0) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
