import { useEffect, useState } from 'react';
import {
  countNoValue,
  countProvisional,
  provisionalTotals,
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
  type Targets,
} from '@pt/core';
import { AI_RELAY_URL } from '@/config/firebase';
import { AiTextPanel } from '@/features/ai/AiTextPanel';
import { hasValidAiConsent, type AiConsent } from '@/features/clients/clientTypes';
import { requestFood, type LabelCandidate } from '@/features/foods/requestsRepo';
import { ItemForm } from './ItemForm';
import { LabelItemPanel } from './LabelItemPanel';
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
  isAdmin,
  aiConsent,
  onMealsChanged,
  onPhotoSaved,
  onSummary,
}: {
  clientId: string;
  date: DateKey;
  targets: Targets;
  canEdit: boolean;
  /** 管理者なら、その場で栄養値を決められる（設計書 §21） */
  isAdmin: boolean;
  /** AI利用への同意。同意が無ければAIのボタンを出さない（設計書 §35） */
  aiConsent: AiConsent;
  /** カレンダーの印を更新するために、食事の有無を親へ伝える */
  onMealsChanged?: (hasMeals: boolean) => void;
  /** AIに送った写真を保存したときに、写真欄を更新させる */
  onPhotoSaved?: () => void;
  /**
   * その日の集計を親へ伝える。
   * AI評価に渡す数字は、画面に出ているものと同じでなければなりません。
   * 別々に計算すると、見えている数字と評価の前提がずれます。
   */
  onSummary?: (summary: {
    totals: Nutrients;
    mealCount: number;
    /** 栄養値がまったく無く、合計に入っていない食材の数 */
    noValueCount: number;
    /** 契約者が仮の値を入れた食材の数。この分は合計に**入っています** */
    provisionalCount: number;
  }) => void;
}) {
  const [meals, setMeals] = useState<Meal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [aiFor, setAiFor] = useState<{ mealId: string; mode: 'text' | 'photo' } | null>(null);
  /** 成分表示から入力している食事 */
  const [labelFor, setLabelFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ mealId: string; item: MealItem } | null>(null);
  const [busy, setBusy] = useState(false);
  /** 登録依頼が届かなかったとき。記録は成立しているので、止めずに知らせるだけ */
  const [requestFailed, setRequestFailed] = useState(false);

  // ★ 集計は描画のたびに変わるので、useEffect で伝えます。
  //   描画の途中で親を更新すると、React が警告を出します。
  useEffect(() => {
    if (meals === null) return;
    onSummary?.({
      totals: dayTotals(meals),
      mealCount: meals.length,
      noValueCount: countNoValue(meals),
      provisionalCount: countProvisional(meals),
    });
    // ★ 依存は meals だけです。
    //   onSummary を入れると、親が毎回関数を作り直すたびに再実行され、
    //   親の更新 → 再実行 → 親の更新 … と往復します。
  }, [meals]);

  useEffect(() => {
    let cancelled = false;
    setMeals(null);
    setError(null);
    setAddingTo(null);
    setAiFor(null);
    setLabelFor(null);
    setEditing(null);
    setRequestFailed(false);

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

    // ★ ここで手入力の欄を開いてはいけません。
    //
    //   以前は食事を足した瞬間に「＋食材」の入力欄を開いていました。
    //   すると「文章から」「写真から」を選ぶ機会が飛ばされ、
    //   手で打つしかないように見えます。
    //   （画面を更新すると選べるようになる、という分かりにくい挙動でした）
    //
    //   どうやって入れるかは本人が選ぶところなので、選ばせます。
    setAddingTo(null);
    setAiFor(null);
    setLabelFor(null);
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

  /**
   * 管理者へ登録依頼を送る。
   * 届かなくても記録は成立しているので止めませんが、届かなかったことは知らせます。
   */
  async function sendRequest(requestName: string, candidate: LabelCandidate | null) {
    const ok = await requestFood(requestName, clientId, date, candidate);
    if (!ok) setRequestFailed(true);
  }

  function addItem(
    mealId: string,
    item: MealItem,
    requestName: string | null,
    candidate: LabelCandidate | null = null,
  ) {
    const list = meals ?? [];
    const target = list.find((m) => m.id === mealId);
    if (target === undefined) return;

    const updated = { ...target, items: [...target.items, item] };
    void persist(
      list.map((m) => (m.id === mealId ? updated : m)),
      updated,
    );
    if (requestName !== null) void sendRequest(requestName, candidate);
    setAddingTo(null);
  }

  function updateItem(
    mealId: string,
    item: MealItem,
    requestName: string | null,
    candidate: LabelCandidate | null = null,
  ) {
    const list = meals ?? [];
    const target = list.find((m) => m.id === mealId);
    if (target === undefined) return;

    const updated = { ...target, items: target.items.map((i) => (i.id === item.id ? item : i)) };
    void persist(
      list.map((m) => (m.id === mealId ? updated : m)),
      updated,
    );
    if (requestName !== null) void sendRequest(requestName, candidate);
    setEditing(null);
  }

  /** AIが起こした下書きを、人が確認したうえでまとめて追加する（設計書 §47）。 */
  function addItems(mealId: string, newItems: MealItem[], requestNames: string[]) {
    const list = meals ?? [];
    const target = list.find((m) => m.id === mealId);
    if (target === undefined || newItems.length === 0) return;

    const updated = { ...target, items: [...target.items, ...newItems] };
    void persist(
      list.map((m) => (m.id === mealId ? updated : m)),
      updated,
    );
    for (const requestName of requestNames) void sendRequest(requestName, null);
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
  const noValueCount = countNoValue(meals);
  const provisionalCount = countProvisional(meals);
  const provisional = provisionalTotals(meals);
  // 中継役が未設定なら、そもそもAIは動かないのでボタンも出さない
  const aiAvailable = AI_RELAY_URL !== null && hasValidAiConsent(aiConsent);

  return (
    <>
      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {requestFailed && (
        <p className="notice" role="alert">
          <b>トレーナーへの登録依頼を送れませんでした。</b>
          <br />
          食事の記録そのものは保存されています。お手数ですが、この食材を入れ直すか、
          トレーナーに直接お伝えください。
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
                initial={item}
                canEditNutrition={isAdmin}
                aiAvailable={aiAvailable}
              onSubmit={(next, requestName, candidate) =>
                updateItem(meal.id, next, requestName, candidate)
              }
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

          {canEdit && labelFor === meal.id && (
            <LabelItemPanel
              onClose={() => setLabelFor(null)}
              onAdd={(item, requestName, candidate) => {
                addItem(meal.id, item, requestName, candidate);
                setLabelFor(null);
              }}
            />
          )}

          {canEdit && aiFor?.mealId === meal.id && (
            <AiTextPanel
              mode={aiFor.mode}
              clientId={clientId}
              date={date}
              mealId={meal.id}
              onAdd={(items, requestNames) => addItems(meal.id, items, requestNames)}
              onPhotoSaved={onPhotoSaved}
              onClose={() => setAiFor(null)}
            />
          )}

          {canEdit &&
            addingTo !== meal.id &&
            aiFor?.mealId !== meal.id &&
            labelFor !== meal.id &&
            (aiAvailable ? (
              <div className="add-actions">
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => setAddingTo(meal.id)}
                  disabled={busy}
                >
                  + 食材
                </button>
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => setAiFor({ mealId: meal.id, mode: 'text' })}
                  disabled={busy}
                >
                  文章から
                </button>
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => setAiFor({ mealId: meal.id, mode: 'photo' })}
                  disabled={busy}
                >
                  写真から
                </button>
                {/* ★ 既製品を食べたとき、手にしているのはパッケージです。
                    名前を打たせてから撮らせるのは順番が逆なので、入口を分けました。 */}
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => setLabelFor(meal.id)}
                  disabled={busy}
                >
                  成分表示から
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
              canEditNutrition={isAdmin}
              aiAvailable={aiAvailable}
              onSubmit={(item, requestName, candidate) =>
                addItem(meal.id, item, requestName, candidate)
              }
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

      <TotalsCard
        totals={totals}
        targets={targets}
        hasAnyItem={hasAnyItem}
        noValueCount={noValueCount}
        provisionalCount={provisionalCount}
        provisional={provisional}
      />
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
    <div className={item.pending ? 'row item-row pending' : 'row item-row'}>
      <div className="row-label">
        <span className="item-name">{item.name}</span>
        <span className="item-grams">{item.grams}g</span>
      </div>
      {/* ★ 仮の値のときは、数字と「仮」の印を両方出します。
             数字だけだと確定と見分けが付かず、印だけだと合計との関係が分かりません。 */}
      {item.provisional ? (
        <div className="macros">
          <span className="badge wait">仮</span>
          <span className="kcal">{f.kcal}kcal</span>
          <span className="macro p">P {f.p}</span>
          <span className="macro f">F {f.f}</span>
          <span className="macro c">C {f.c}</span>
        </div>
      ) : item.pending ? (
        <div className="macros">
          <span className="badge wait">栄養値は登録待ち</span>
        </div>
      ) : (
        <div className="macros">
          <span className="kcal">{f.kcal}kcal</span>
          <span className="macro p">P {f.p}</span>
          <span className="macro f">F {f.f}</span>
          <span className="macro c">C {f.c}</span>
        </div>
      )}
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
  noValueCount,
  provisionalCount,
  provisional,
}: {
  totals: Nutrients;
  targets: Targets;
  hasAnyItem: boolean;
  /** 栄養値がまったく無く、合計に入っていない食材の数 */
  noValueCount: number;
  /** 契約者が仮の値を入れた食材の数 */
  provisionalCount: number;
  /** その仮の値だけを足した合計 */
  provisional: Nutrients;
}) {
  const target = targetsToNutrients(targets);
  const diff = diffFromTarget(totals, target);
  const f = formatNutrients(totals);
  const t = formatNutrients(target);
  const d = formatNutrients(diff);
  const pv = formatNutrients(provisional);

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

      {/*
        ★ 仮の値が混ざっていることは、必ず分けて出します（追加仕様: 仮の栄養値）。

          合計に入れるからには、「どこまでが確かな数字か」が
          ひと目で分かる必要があります。混ぜたまま出すと、
          仮の数字を根拠に判断してしまいます。
      */}
      {provisionalCount > 0 && (
        <div className="row provisional">
          <div className="row-label">うち仮</div>
          <div className="macros">
            <span className="kcal">{pv.kcal}kcal</span>
            <span className="macro p">P {pv.p}</span>
            <span className="macro f">F {pv.f}</span>
            <span className="macro c">C {pv.c}</span>
          </div>
        </div>
      )}

      {provisionalCount > 0 && (
        <p className="notice">
          仮の値で記録した食材が{provisionalCount}件あります。
          <b>その分も上の合計に入っています。</b>
          トレーナーが登録すると、正しい値に置き換わります。
        </p>
      )}

      {/*
        ★ 未確定があることは必ず伝えます。
          伝えないと「合計が実際より少ない」ことに気づけず、
          その数字を根拠に判断してしまいます。
      */}
      {noValueCount > 0 && (
        <p className="notice">
          栄養値が未確定の食材が{noValueCount}件あります。
          <b>その分は合計に含まれていません。</b>
          トレーナーが登録すると反映されます。
        </p>
      )}

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
