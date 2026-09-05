import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { findNameConflicts, foodKey } from '@pt/core';
import { readErrorMessage, writeErrorMessage } from '@/lib/firestoreError';
import { clearFoodCache, deleteFood, emptyFood, loadFoods, type Food } from './foodsRepo';
import { FoodEditor } from './FoodEditor';

/**
 * 共通食品マスタの管理（設計書 §21 / Phase 9）。
 *
 * 管理者だけが開けます。Rules 側でも `foods` への書き込みは管理者に限定しています。
 *
 * ★ この一覧が、アプリ全体の数字の出どころです。
 *   契約者の画面には栄養値の入力欄がありません。
 *   全員がここの値を使うので、同じ食材の数字が人によって違うことが起きません。
 */
export function FoodsScreen() {
  const [foods, setFoods] = useState<Food[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [editing, setEditing] = useState<Food | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setFoods(await loadFoods(true));
    } catch (e) {
      setError(readErrorMessage(e, '食品マスタ'));
      setFoods([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 名前がぶつかっている食材（追加仕様: 名前の重複に印）。
   *
   * ★ 検索で絞ったあとではなく、**全件**から出します。
   *   相手が検索の外にいたら、ぶつかっていないように見えてしまいます。
   */
  const conflicts = useMemo(() => findNameConflicts(foods ?? []), [foods]);

  // 検索も照合キーで行います。「とりムネ」と打っても「鶏むね肉」に当たります。
  const shown = useMemo(() => {
    const all = foods ?? [];
    const k = foodKey(keyword);
    const filtered =
      k.length === 0
        ? all
        : all.filter(
            (f) =>
              foodKey(f.name).includes(k) || f.aliases.some((a) => foodKey(a).includes(k)),
          );
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }, [foods, keyword]);

  async function remove(food: Food) {
    try {
      await deleteFood(food.id);
      setConfirmDelete(null);
      await load();
    } catch (e) {
      setError(writeErrorMessage(e, '削除'));
    }
  }

  return (
    <>
      <div className="section-head">
        <h2 className="title">食品マスタ</h2>
        <button
          className="button-primary compact"
          type="button"
          onClick={() => setEditing(emptyFood())}
        >
          + 追加
        </button>
      </div>

      <p className="lede">
        契約者は量(g)だけを入力します。100gあたりの数値はここで決めた値が全員に使われます。
      </p>

      <p className="calendar-links">
        <Link to="/foods/requests">登録依頼を見る</Link>
      </p>

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {/* ★ 一覧の上にも件数を出します（追加仕様: 名前の重複に印）。
             印だけだと、下までたどらないと気づけません。 */}
      {conflicts.size > 0 && (
        <section className="card warn" role="status">
          <h3 className="card-title">名前がぶつかっている食材が{conflicts.size}件あります</h3>
          <p className="note">
            同じ呼び名の食材が複数あると、契約者が入力したときに
            <b>どちらの栄養値が使われるか決まりません</b>。
            画面には何も出ないので、気づかないまま古い数字で記録され続けます。
            <br />
            片方を消すか、名前や別名を直してください。
          </p>
        </section>
      )}

      {editing !== null && (
        <FoodEditor
          initial={editing}
          all={foods ?? []}
          onSaved={() => {
            setEditing(null);
            clearFoodCache();
            void load();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      <label className="field">
        <span className="field-label">さがす</span>
        <input
          className="input"
          type="search"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="鶏むね"
        />
      </label>

      {foods === null && <p className="lede">読み込んでいます…</p>}

      {foods !== null && foods.length === 0 && error === null && (
        <section className="card">
          <p className="lede">まだ食材が登録されていません。</p>
          <p className="field-hint">
            契約者が記録した未登録の食材は「登録依頼」に積まれます。そこから登録するのが近道です。
          </p>
        </section>
      )}

      {foods !== null && foods.length > 0 && shown.length === 0 && (
        <p className="lede">「{keyword}」に当てはまる食材はありません。</p>
      )}

      {shown.map((food) => (
        <section
          className={
            conflicts.get(food.id) === undefined
              ? 'card client-row-wrap'
              : 'card client-row-wrap conflicted'
          }
          key={food.id}
        >
          <div className="client-row">
            <div className="client-main">
              <span className="client-name">{food.name}</span>
              <span className="client-meta">
                {food.per100g.kcal}kcal · P{food.per100g.p} F{food.per100g.f} C{food.per100g.c}
                {' / 100g'}
              </span>
              {/* ★ ぶつかっている相手を、その場に名指しします（追加仕様: 名前の重複に印）。
                     「ぶつかっています」だけでは、どこを直せばいいか分かりません。 */}
              {conflicts.get(food.id) !== undefined && (
                <span className="food-conflict">
                  「{(conflicts.get(food.id)?.names ?? []).join('」「')}」が
                  {(conflicts.get(food.id)?.others ?? []).map((o) => o.name).join('・')}
                  とぶつかっています
                </span>
              )}
              {/* ★ かぞえ方は一覧にも出します（追加仕様: 単位換算）。
                     どの食材に入れ終わったかが、開かずに分かるようにです。 */}
              {food.unitConversions.length > 0 && (
                <span className="client-meta">
                  かぞえ方: {food.unitConversions.map((c) => `1${c.unit}=${c.grams}g`).join('、')}
                </span>
              )}
              {food.aliases.length > 0 && (
                <span className="client-meta">別名: {food.aliases.join('、')}</span>
              )}
              {food.note.length > 0 && <span className="client-meta">{food.note}</span>}
            </div>
            <div className="item-actions">
              <button className="button-quiet" type="button" onClick={() => setEditing(food)}>
                編集
              </button>
              <button
                className="button-quiet"
                type="button"
                onClick={() => setConfirmDelete(food.id)}
              >
                削除
              </button>
            </div>
          </div>

          {confirmDelete === food.id && (
            <div className="notice">
              <p>
                「{food.name}」を削除します。
                <br />
                <b>過去の記録の数字は変わりません。</b>
                これから入力するときに候補に出なくなるだけです。
              </p>
              <div className="item-form-actions">
                <button
                  className="button-secondary compact"
                  type="button"
                  onClick={() => void remove(food)}
                >
                  削除する
                </button>
                <button
                  className="button-quiet"
                  type="button"
                  onClick={() => setConfirmDelete(null)}
                >
                  やめる
                </button>
              </div>
            </div>
          )}
        </section>
      ))}
    </>
  );
}
