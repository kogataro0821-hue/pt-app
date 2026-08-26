import { useEffect, useState } from 'react';
import {
  dayTotals,
  diffFromTarget,
  formatNutrients,
  mealTotals,
  nextMealLabel,
  renumber,
  targetsToNutrients,
  type DateKey,
  type Meal,
  type MealItem,
  type Nutrients,
  type Per100gInput,
  type Targets,
} from '@pt/core';
import { AI_RELAY_URL } from '@/config/firebase';
import { AiTextPanel } from '@/features/ai/AiTextPanel';
import { hasValidAiConsent, type AiConsent } from '@/features/clients/clientTypes';
import { rememberFood } from './foodsRepo';
import { ItemForm } from './ItemForm';
import { deleteMeal, listMeals, newMealId, saveMeal, syncDayMealFlag } from './mealsRepo';

/**
 * その日の食事（設計書 §14 / §15 / Q12）。
 *
 * ★ 表示している数字はすべて「食材の積み上げ」です。
 *   合計だけを別に計算している箇所はありません。
 *   食材合計 == 食事合計 == 日合計 が常に成り立ちます。
 */
export function MealsSection({
  clientId,
  date,
  targets,
  canEdit,
  allowFoodCreate,
  aiConsent,
  onMealsChanged,
}: {
  clientId: string;
  date: DateKey;
  targets: Targets;
  canEdit: boolean;
  allowFoodCreate: boolean;
  /** AI利用への同意。同意が無ければAIのボタンを出さない（設計書 §35） */
  aiConsent: AiConsent;
  /** カレンダーの印を更新するために、食事の有無を親へ伝える */
  onMealsChanged?: (hasMeals: boolean) => void;
}) {
  const [meals, setMeals] = useState<Meal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [aiFor, setAiFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ mealId: string; item: MealItem } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMeals(null);
    setError(null);
    setAddingTo(null);
    setAiFor(null);
    setEditing(null);

    void (async () => {
      try {
        const loaded = await listMeals(clientId, date);
        if (!cancelled) setMeals(loaded);
      } catch {
        if (!cancelled) {
          setError('食事の記録を読み込めませんでした。');
          setMeals([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId, date]);

  /**
   * 保存の順番には理由があります。
   *   1. 画面をすぐ更新する（待たせない）
   *   2. 食事ドキュメントを保存する
   *   3. カレンダーの印を更新する
   * 2が失敗したら画面を元に戻します。3が失敗しても記録は残るので、印だけ諦めます。
   */
  async function persist(next: Meal[], changed: Meal | null, removedId?: string) {
    const previous = meals;
    setMeals(next);
    setError(null);
    setBusy(true);
    try {
      if (removedId !== undefined) await deleteMeal(clientId, date, removedId);
      if (changed !== null) await saveMeal(clientId, date, changed);

      const hasMeals = next.some((m) => m.items.length > 0);
      onMealsChanged?.(hasMeals);
      try {
        await syncDayMealFlag(clientId, date, hasMeals);
      } catch {
        // 印の更新に失敗しても、記録そのものは保存できている
      }
    } catch {
      setMeals(previous);
      setError(
        canEdit
          ? '保存に失敗しました。通信状態を確認してください。'
          : 'この日は編集できないため保存されませんでした。',
      );
    } finally {
      setBusy(false);
    }
  }

  function addMeal() {
    const list = meals ?? [];
    const meal: Meal = {
      id: newMealId(),
      order: list.length,
      label: nextMealLabel(list),
      items: [],
      memo: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    void persist([...list, meal], meal);
    setAddingTo(meal.id);
  }

  function removeMeal(meal: Meal) {
    if (!window.confirm(`${meal.label} を削除します。よろしいですか？`)) return;
    const next = renumber((meals ?? []).filter((m) => m.id !== meal.id));
    void persist(next, null, meal.id);
  }

  function renameMeal(meal: Meal, label: string) {
    const updated = { ...meal, label };
    setMeals((prev) => (prev ?? []).map((m) => (m.id === meal.id ? updated : m)));
  }

  function commitRename(meal: Meal) {
    const list = meals ?? [];
    const found = list.find((m) => m.id === meal.id);
    if (found === undefined) return;
    void persist(list, found);
  }

  function addItem(mealId: string, item: MealItem, source: { name: string; per100g: Per100gInput }) {
    const list = meals ?? [];
    const target = list.find((m) => m.id === mealId);
    if (target === undefined) return;

    const updated = { ...target, items: [...target.items, item] };
    void persist(
      list.map((m) => (m.id === mealId ? updated : m)),
      updated,
    );
    void rememberFood(clientId, source, allowFoodCreate);
    setAddingTo(null);
  }

  function updateItem(mealId: string, item: MealItem, source: { name: string; per100g: Per100gInput }) {
    const list = meals ?? [];
    const target = list.find((m) => m.id === mealId);
    if (target === undefined) return;

    const updated = { ...target, items: target.items.map((i) => (i.id === item.id ? item : i)) };
    void persist(
      list.map((m) => (m.id === mealId ? updated : m)),
      updated,
    );
    void rememberFood(clientId, source, allowFoodCreate);
    setEditing(null);
  }

  /** AIが起こした下書きを、人が確認したうえでまとめて追加する（設計書 §47）。 */
  function addItems(
    mealId: string,
    newItems: MealItem[],
    sources: { name: string; per100g: Per100gInput }[],
  ) {
    const list = meals ?? [];
    const target = list.find((m) => m.id === mealId);
    if (target === undefined || newItems.length === 0) return;

    const updated = { ...target, items: [...target.items, ...newItems] };
    void persist(
      list.map((m) => (m.id === mealId ? updated : m)),
      updated,
    );
    for (const source of sources) void rememberFood(clientId, source, allowFoodCreate);
    setAiFor(null);
  }

  function removeItem(mealId: string, itemId: string) {
    const list = meals ?? [];
    const target = list.find((m) => m.id === mealId);
    if (target === undefined) return;

    const updated = { ...target, items: target.items.filter((i) => i.id !== itemId) };
    void persist(
      list.map((m) => (m.id === mealId ? updated : m)),
      updated,
    );
  }

  if (meals === null) {
    return (
      <section className="card">
        <h3 className="card-title">食事</h3>
        <p className="lede">読み込んでいます…</p>
      </section>
    );
  }

  const totals = dayTotals(meals);
  const hasAnyItem = meals.some((m) => m.items.length > 0);
  // 中継役が未設定なら、そもそもAIは動かないのでボタンも出さない
  const aiAvailable = AI_RELAY_URL !== null && hasValidAiConsent(aiConsent);

  return (
    <>
      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {meals.map((meal) => (
        <section className="card meal" key={meal.id}>
          <div className="meal-head">
            {canEdit ? (
              <input
                className="meal-label"
                type="text"
                value={meal.label}
                onChange={(e) => renameMeal(meal, e.target.value)}
                onBlur={() => commitRename(meal)}
                aria-label="食事の名前"
              />
            ) : (
              <h3 className="card-title">{meal.label}</h3>
            )}
            {canEdit && (
              <button
                className="button-quiet danger compact"
                type="button"
                onClick={() => removeMeal(meal)}
                disabled={busy}
              >
                削除
              </button>
            )}
          </div>

          {meal.items.length === 0 && <p className="note">まだ食材がありません。</p>}

          {meal.items.map((item) =>
            editing?.mealId === meal.id && editing.item.id === item.id ? (
              <ItemForm
                key={item.id}
                clientId={clientId}
                initial={item}
                onSubmit={(next, source) => updateItem(meal.id, next, source)}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <ItemRow
                key={item.id}
                item={item}
                canEdit={canEdit}
                onEdit={() => setEditing({ mealId: meal.id, item })}
                onRemove={() => removeItem(meal.id, item.id)}
              />
            ),
          )}

          {meal.items.length > 0 && (
            <>
              <div className="divider" />
              <NutrientRow label="この食事の合計" value={mealTotals(meal)} total />
            </>
          )}

          {canEdit && aiFor === meal.id && (
            <AiTextPanel
              clientId={clientId}
              onAdd={(items, sources) => addItems(meal.id, items, sources)}
              onClose={() => setAiFor(null)}
            />
          )}

          {canEdit &&
            addingTo !== meal.id &&
            aiFor !== meal.id &&
            (aiAvailable ? (
              <div className="add-actions">
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => setAddingTo(meal.id)}
                  disabled={busy}
                >
                  + 食材を追加
                </button>
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => setAiFor(meal.id)}
                  disabled={busy}
                >
                  文章から入力
                </button>
              </div>
            ) : (
              <button
                className="button-secondary"
                type="button"
                onClick={() => setAddingTo(meal.id)}
                disabled={busy}
              >
                + 食材を追加
              </button>
            ))}

          {canEdit && addingTo === meal.id && (
            <ItemForm
              clientId={clientId}
              onSubmit={(item, source) => addItem(meal.id, item, source)}
              onCancel={() => setAddingTo(null)}
            />
          )}
        </section>
      ))}

      {canEdit && (
        <button className="button-secondary" type="button" onClick={addMeal} disabled={busy}>
          + 食事を追加
        </button>
      )}

      {!canEdit && meals.length === 0 && (
        <section className="card">
          <h3 className="card-title">食事</h3>
          <p className="note">この日の食事は記録されていません。</p>
        </section>
      )}

      <TotalsCard totals={totals} targets={targets} hasAnyItem={hasAnyItem} />
    </>
  );
}

// -----------------------------------------------------------------------------

function ItemRow({
  item,
  canEdit,
  onEdit,
  onRemove,
}: {
  item: MealItem;
  canEdit: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const f = formatNutrients(item.nutrients);
  return (
    <div className="row item-row">
      <div className="row-label">
        <span className="item-name">{item.name}</span>
        <span className="item-grams">{item.grams}g</span>
      </div>
      <div className="macros">
        <span className="kcal">{f.kcal}kcal</span>
        <span className="macro p">P {f.p}</span>
        <span className="macro f">F {f.f}</span>
        <span className="macro c">C {f.c}</span>
      </div>
      {canEdit && (
        <div className="item-actions">
          <button className="button-quiet compact" type="button" onClick={onEdit}>
            編集
          </button>
          <button className="button-quiet danger compact" type="button" onClick={onRemove}>
            削除
          </button>
        </div>
      )}
    </div>
  );
}

function NutrientRow({
  label,
  value,
  total,
}: {
  label: string;
  value: Nutrients;
  total?: boolean;
}) {
  const f = formatNutrients(value);
  return (
    <div className={total ? 'row total' : 'row'}>
      <div className="row-label">{label}</div>
      <div className="macros">
        <span className="kcal">{f.kcal}kcal</span>
        <span className="macro p">P {f.p}</span>
        <span className="macro f">F {f.f}</span>
        <span className="macro c">C {f.c}</span>
      </div>
    </div>
  );
}

/**
 * その日の合計と、目標との差（設計書 §26）。
 *
 * 差は「超過ならプラス、不足ならマイナス」で表します。
 * 色は付けますが、良し悪しの判断はしません。判断は評価（Phase 10）の役目です。
 */
function TotalsCard({
  totals,
  targets,
  hasAnyItem,
}: {
  totals: Nutrients;
  targets: Targets;
  hasAnyItem: boolean;
}) {
  const target = targetsToNutrients(targets);
  const diff = diffFromTarget(totals, target);
  const f = formatNutrients(totals);
  const t = formatNutrients(target);
  const d = formatNutrients(diff);

  return (
    <section className="card totals">
      <h3 className="card-title">この日の合計</h3>

      <div className="row total">
        <div className="row-label">合計</div>
        <div className="macros">
          <span className="kcal">{f.kcal}kcal</span>
          <span className="macro p">P {f.p}</span>
          <span className="macro f">F {f.f}</span>
          <span className="macro c">C {f.c}</span>
        </div>
      </div>

      <div className="row">
        <div className="row-label">目標</div>
        <div className="macros">
          <span className="kcal">{t.kcal}kcal</span>
          <span className="macro p">P {t.p}</span>
          <span className="macro f">F {t.f}</span>
          <span className="macro c">C {t.c}</span>
        </div>
      </div>

      <div className="row diff">
        <div className="row-label">差</div>
        <div className="macros">
          <span className={signClass(diff.kcal)}>{signed(d.kcal)}kcal</span>
          <span className={signClass(diff.p)}>P {signed(d.p)}</span>
          <span className={signClass(diff.f)}>F {signed(d.f)}</span>
          <span className={signClass(diff.c)}>C {signed(d.c)}</span>
        </div>
      </div>

      {!hasAnyItem && <p className="note">まだ食事が記録されていないため、合計は0です。</p>}

      <p className="note">
        合計は各食材の値を積み上げて出しています（設計書 §15）。
        内訳の表示は小数第1位に丸めているため、目で足すと1桁ずれて見えることがあります。
        正しいのは合計のほうです。
      </p>
    </section>
  );
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function signClass(raw: number): string {
  if (raw > 0) return 'diff-over';
  if (raw < 0) return 'diff-under';
  return 'diff-even';
}
