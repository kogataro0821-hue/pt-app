import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { foodKey } from '@pt/core';
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
    } catch {
      setError('食品マスタを読み込めませんでした。通信状態を確認してください。');
      setFoods([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
    } catch {
      setError('削除できませんでした。');
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
        <section className="card client-row-wrap" key={food.id}>
          <div className="client-row">
            <div className="client-main">
              <span className="client-name">{food.name}</span>
              <span className="client-meta">
                {food.per100g.kcal}kcal · P{food.per100g.p} F{food.per100g.f} C{food.per100g.c}
                {' / 100g'}
              </span>
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
