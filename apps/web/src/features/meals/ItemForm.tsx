import { useEffect, useMemo, useState } from 'react';
import {
  computeItemNutrients,
  findExactFood,
  findSimilarFoods,
  formatNutrients,
  toInternal,
  ZERO,
  type MealItem,
  type Per100gInput,
} from '@pt/core';
import { loadFoods, type Food } from '@/features/foods/foodsRepo';
import { newItemId } from './mealsRepo';

/**
 * 食材1件の入力（設計書 §13 / §21 / Phase 9）。
 *
 * ★ 契約者が決められるのは「量(g)」だけです。
 *
 *   100gあたりの kcal / P / F / C は共通マスタの値をそのまま使い、
 *   契約者は編集できません。ここを開けてしまうと、
 *   同じ食材の数値が人によって違う状態が生まれ、
 *   トレーナーが数字を根拠に指導できなくなります。
 *
 *   量は本人しか知らない情報なので、本人が入れます。
 *   栄養値は調べる人が決める情報なので、管理者が決めます。
 *   それぞれ、知っている側が担当する形です。
 *
 * ★ マスタに無い食材も記録できます。
 *   その場合は「栄養値は未確定」として記録し、管理者へ登録依頼を出します。
 *   記録を止めると続かなくなるので、止めません。
 */
export function ItemForm({
  initial,
  canEditNutrition,
  onSubmit,
  onCancel,
}: {
  /** 編集のときだけ渡す */
  initial?: MealItem;
  /** 管理者なら true。その場で栄養値を決められる */
  canEditNutrition: boolean;
  onSubmit: (item: MealItem, requestName: string | null) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [grams, setGrams] = useState(initial === undefined ? '' : String(initial.grams));
  const [foods, setFoods] = useState<Food[]>([]);
  const [picked, setPicked] = useState<Food | null>(null);
  /** 管理者がその場で入れた栄養値 */
  const [manual, setManual] = useState<Record<keyof Per100gInput, string>>({
    kcal: '',
    p: '',
    f: '',
    c: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadFoods()
      .then(setFoods)
      .catch(() => setFoods([]));
  }, []);

  // ★ 打った名前を、まず既存マスタに当てにいきます（別名も見ます）。
  //   「鶏ムネ肉」と打っても既存の「鶏むね肉」に当たるので、
  //   ぶれの大半はここで消えます。
  const exact = useMemo(() => (picked !== null ? picked : findExactFood(foods, name)), [foods, name, picked]);
  const similar = useMemo(
    () => (exact !== null ? [] : findSimilarFoods(foods, name, 4)),
    [foods, name, exact],
  );

  const gramsNum = parse(grams);
  const manualNumbers: Per100gInput = {
    kcal: parse(manual.kcal) ?? 0,
    p: parse(manual.p) ?? 0,
    f: parse(manual.f) ?? 0,
    c: parse(manual.c) ?? 0,
  };
  const manualFilled =
    canEditNutrition && (['kcal', 'p', 'f', 'c'] as const).every((k) => manual[k].trim().length > 0);

  const per100g: Per100gInput | null =
    exact !== null ? exact.per100g : manualFilled ? manualNumbers : null;

  const nameOk = name.trim().length > 0;
  const gramsOk = gramsNum !== null && gramsNum > 0 && gramsNum <= 5000;
  const canSubmit = nameOk && gramsOk;

  const preview =
    per100g !== null && gramsNum !== null && gramsOk
      ? computeItemNutrients(toInternal(per100g), gramsNum)
      : null;

  function submit() {
    if (!nameOk) {
      setError('食材の名前を入力してください。');
      return;
    }
    if (!gramsOk || gramsNum === null) {
      setError('量は0より大きく、5000g以内で入力してください。');
      return;
    }

    const trimmed = name.trim();
    const pending = per100g === null;
    const internal = per100g === null ? ZERO : toInternal(per100g);

    onSubmit(
      {
        id: initial?.id ?? newItemId(),
        name: exact !== null ? exact.name : trimmed,
        grams: gramsNum,
        per100g: internal,
        nutrients: pending ? ZERO : computeItemNutrients(internal, gramsNum),
        foodId: exact?.id ?? null,
        pending,
      },
      // 未確定なら、管理者へ登録依頼を出す
      pending ? trimmed : null,
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
            setPicked(null);
          }}
          placeholder="鶏むね肉"
          autoFocus
        />
      </label>

      {similar.length > 0 && (
        <>
          <p className="field-hint">似た食材があります。同じものならこちらを選んでください。</p>
          <ul className="suggestions">
            {similar.map((m) => (
              <li key={m.food.id}>
                <button
                  type="button"
                  className="suggestion"
                  onClick={() => {
                    setPicked(m.food);
                    setName(m.food.name);
                  }}
                >
                  <span className="suggestion-name">{m.food.name}</span>
                  <span className="suggestion-meta">
                    {m.matchedName !== m.food.name && <>「{m.matchedName}」· </>}
                    {m.food.per100g.kcal}kcal · P{m.food.per100g.p} F{m.food.per100g.f} C
                    {m.food.per100g.c}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
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

      <NutritionBlock
        food={exact}
        name={name}
        canEditNutrition={canEditNutrition}
        manual={manual}
        onManualChange={setManual}
      />

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
        <button className="button-primary compact" type="button" onClick={submit} disabled={!canSubmit}>
          {initial === undefined ? '追加する' : '変更する'}
        </button>
        <button className="button-quiet" type="button" onClick={onCancel}>
          やめる
        </button>
      </div>
    </div>
  );
}

/**
 * 栄養値の欄。
 *
 * マスタにあれば表示だけ（編集不可）。
 * 無ければ、管理者はその場で入れられ、契約者は「未確定」として記録します。
 */
function NutritionBlock({
  food,
  name,
  canEditNutrition,
  manual,
  onManualChange,
}: {
  food: Food | null;
  name: string;
  canEditNutrition: boolean;
  manual: Record<keyof Per100gInput, string>;
  onManualChange: (v: Record<keyof Per100gInput, string>) => void;
}) {
  if (food !== null) {
    return (
      <div className="nutrition-fixed">
        <span className="field-label small">100gあたり（共通マスタ）</span>
        <div className="macros">
          <span className="kcal">{food.per100g.kcal}kcal</span>
          <span className="macro p">P {food.per100g.p}</span>
          <span className="macro f">F {food.per100g.f}</span>
          <span className="macro c">C {food.per100g.c}</span>
        </div>
        {food.note.length > 0 && <span className="field-hint">{food.note}</span>}
      </div>
    );
  }

  if (name.trim().length === 0) return null;

  if (!canEditNutrition) {
    return (
      <p className="notice">
        この食材はまだ登録されていません。<b>量だけ記録し、トレーナーに登録を依頼します。</b>
        <br />
        登録されるまで、この食材は合計に含まれません。
      </p>
    );
  }

  return (
    <fieldset className="per100g">
      <legend className="field-label">100gあたりの栄養値（新しく登録します）</legend>
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
              value={manual[key]}
              onChange={(e) => onManualChange({ ...manual, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <span className="field-hint">
        空欄のままでも記録できます。その場合は「未確定」として残り、あとから登録できます。
      </span>
    </fieldset>
  );
}

function parse(value: string): number | null {
  if (value.trim().length === 0) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
