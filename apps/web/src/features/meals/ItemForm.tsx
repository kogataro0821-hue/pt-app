import { useEffect, useMemo, useState } from 'react';
import {
  computeItemNutrients,
  findExactFood,
  findSimilarFoods,
  formatNutrients,
  toDecimal,
  toInternal,
  ZERO,
  type MealItem,
  type Per100gInput,
} from '@pt/core';
import { AI_RELAY_URL } from '@/config/firebase';
import { loadFoods, type Food } from '@/features/foods/foodsRepo';
import { LabelScanner } from '@/features/foods/LabelScanner';
import type { LabelCandidate } from '@/features/foods/requestsRepo';
import { newItemId } from './mealsRepo';

/**
 * 食材1件の入力（設計書 §13 / §21 / Phase 9）。
 *
 * ★ 境界は「マスタにあるかどうか」です（追加仕様: 仮の栄養値）。
 *
 *   | 食材 | 契約者ができること |
 *   |---|---|
 *   | マスタにある | 量(g)だけ。栄養値は**見るだけ** |
 *   | マスタに無い | 量(g)と、**仮の栄養値** |
 *
 *   マスタにある食材の値を触らせないことが、いちばん大事な一線です。
 *   ここを開けると「白米」が人によって156kcalだったり200kcalだったりして、
 *   トレーナーが数字を根拠に指導できなくなります。
 *   **値がぶつかりうる場所には、そもそも入力欄を出しません。**
 *
 *   マスタに無い食材は、そもそもぶつかる相手がいません。
 *   0のまま記録されるより、本人の分かる範囲で入れてもらったほうが、
 *   その日の合計が実態に近づきます。管理者が登録した時点で置き換わります。
 *
 * ★ 同じ入力欄でも、管理者と契約者では意味が違います。
 *
 *     管理者が入れた値 … 確定（そのまま使う）
 *     契約者が入れた値 … 仮（「うち仮」として分けて表示し、承認で置き換わる）
 */
export function ItemForm({
  initial,
  canEditNutrition,
  aiAvailable = false,
  onSubmit,
  onCancel,
}: {
  /** 編集のときだけ渡す */
  initial?: MealItem;
  /** 管理者なら true。その場で栄養値を決められる */
  canEditNutrition: boolean;
  /** AIが使えるか（同意済み＆中継役が設定済み） */
  aiAvailable?: boolean;
  onSubmit: (
    item: MealItem,
    requestName: string | null,
    candidate: LabelCandidate | null,
  ) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [grams, setGrams] = useState(initial === undefined ? '' : String(initial.grams));
  const [foods, setFoods] = useState<Food[]>([]);
  const [picked, setPicked] = useState<Food | null>(null);
  /**
   * その場で入れた100gあたりの栄養値。
   * 管理者なら確定値、契約者なら仮の値になります（下の submit を参照）。
   */
  const [manual, setManual] = useState<Record<keyof Per100gInput, string>>(
    initial !== undefined && initial.provisional
      ? {
          // 編集のときは、前に入れた仮の値を出しておきます。
          // 空欄から入れ直させると、直したいだけの人が全部打ち直すことになります。
          kcal: String(toDecimal(initial.per100g).kcal),
          p: String(toDecimal(initial.per100g).p),
          f: String(toDecimal(initial.per100g).f),
          c: String(toDecimal(initial.per100g).c),
        }
      : { kcal: '', p: '', f: '', c: '' },
  );
  const [error, setError] = useState<string | null>(null);
  /**
   * 成分表示を読み取ったときの、写真とメモ（追加仕様: 成分表示の読み取り）。
   *
   * ★ 読み取った**数字は manual に入れます**。候補として別に持ちません。
   *   そうしないと、読み取りが間違っていたときに直す手段がありません。
   *   AIのOCRは間違えます。直せる形にしておきます。
   */
  const [scan, setScan] = useState<{ note: string; photo: string; read: Per100gInput } | null>(null);
  const [scanning, setScanning] = useState(false);

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
  const manualFilled = (['kcal', 'p', 'f', 'c'] as const).every(
    (k) => manual[k].trim().length > 0,
  );

  const per100g: Per100gInput | null =
    exact !== null ? exact.per100g : manualFilled ? manualNumbers : null;

  /**
   * この記録の栄養値の立ち位置。
   *
   *   マスタにある                  → 確定（マスタの値）
   *   無い ＋ 管理者が入れた        → 確定（その場で決めた値。登録依頼は出さない）
   *   無い ＋ 契約者が入れた        → **仮**（合計に入るが「うち仮」として分ける）
   *   無い ＋ 誰も入れていない      → 値なし（合計に入らない）
   */
  //
  // ★ 管理者が「仮」の食材を開いたときは、仮のままにします。
  //
  //   開いた時点で欄に値が入っている（契約者が入れた値）ので、
  //   そのまま保存すると、押しただけで確定値に化けます。
  //   契約者の当て推量を、管理者が確かめずに承認した形になります。
  //   値を確定させる道は「登録依頼」の画面だけ、と決めておきます。
  const wasProvisional = initial?.provisional === true;
  const decidedByAdmin = exact === null && canEditNutrition && manualFilled && !wasProvisional;
  const provisional = exact === null && manualFilled && !decidedByAdmin;
  const pending = exact === null && !decidedByAdmin;

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
    const internal = per100g === null ? ZERO : toInternal(per100g);
    // 値が無いときだけ0。仮の値が入っていれば、ちゃんと計算します
    const noValue = pending && !provisional;

    onSubmit(
      {
        id: initial?.id ?? newItemId(),
        name: exact !== null ? exact.name : trimmed,
        grams: gramsNum,
        per100g: internal,
        nutrients: noValue ? ZERO : computeItemNutrients(internal, gramsNum),
        foodId: exact?.id ?? null,
        pending,
        provisional,
      },
      // 未確定なら、管理者へ登録依頼を出す
      pending ? trimmed : null,
      pending ? buildCandidate() : null,
    );
  }

  /**
   * 管理者へ送る「値の候補」を組み立てる。
   *
   * ★ 写真があるのに数字が写真と違う、という状態を隠しません。
   *   管理者は写真を見て「この数字で合っている」と判断します。
   *   契約者が直していたことを知らないまま採用すると、
   *   写真を添えた意味がなくなります。
   */
  function buildCandidate(): LabelCandidate | null {
    if (!manualFilled) return null;

    if (scan === null) {
      return { source: 'manual', per100g: manualNumbers, note: '', photo: '' };
    }

    const edited = (['kcal', 'p', 'f', 'c'] as const).some(
      (k) => manualNumbers[k] !== scan.read[k],
    );

    return {
      source: 'label',
      per100g: manualNumbers,
      note: edited
        ? `${scan.note}${scan.note.length > 0 ? ' / ' : ''}※ 読み取り値（${scan.read.kcal}kcal・P${scan.read.p}・F${scan.read.f}・C${scan.read.c}）を契約者が直しています`
        : scan.note,
      photo: scan.photo,
    };
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

      {/* ★ マスタに無い食材のときだけ出します（設計書 §47 / 追加仕様: 成分表示の読み取り）。
          読み取った数字は、上の入力欄にそのまま入れます。
          読み取りは間違えるので、**直せる形にしておきます**。 */}
      {exact === null && nameOk && aiAvailable && AI_RELAY_URL !== null && !canEditNutrition && (
        <>
          {scan === null && !scanning && (
            <button
              className="button-secondary"
              type="button"
              onClick={() => setScanning(true)}
            >
              成分表示を撮って入れる
            </button>
          )}

          {scanning && (
            <LabelScanner
              onCancel={() => setScanning(false)}
              onDone={(r) => {
                setScan({ note: r.note, photo: r.photo, read: r.per100g });
                setManual({
                  kcal: String(r.per100g.kcal),
                  p: String(r.per100g.p),
                  f: String(r.per100g.f),
                  c: String(r.per100g.c),
                });
                if (grams.trim().length === 0 && r.servingGrams !== null) {
                  setGrams(String(r.servingGrams));
                }
                if (name.trim().length === 0 && r.productName.length > 0) setName(r.productName);
                setScanning(false);
              }}
            />
          )}

          {scan !== null && (
            <p className="notice" role="status">
              <b>成分表示を読み取って、上の欄に入れました。</b>
              <br />
              袋の表示と見比べて、違っていたら直してください。
              写真もトレーナーに届くので、あとで確認してもらえます。
            </p>
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
 * マスタにあれば表示だけ（編集不可）。ここが一線です。
 * 無ければ入力できますが、**管理者と契約者では意味が違います**。
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
  // ★ マスタにある食材は、表示だけ。入力欄を出しません。
  //   出さないことが、そのまま「値がぶつからない」保証になります。
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

  return (
    <fieldset className="per100g">
      <legend className="field-label">
        {canEditNutrition ? '100gあたりの栄養値（新しく登録します）' : '100gあたりの栄養値（仮）'}
      </legend>

      {!canEditNutrition && (
        <p className="field-hint">
          この食材はまだ登録されていません。分かる範囲で入れておくと、
          <b>その分もこの日の合計に入ります</b>（「うち仮」として分けて表示します）。
          <br />
          トレーナーが登録すると、正しい値に置き換わります。
          <b>分からなければ空欄のままで大丈夫です。</b>
        </p>
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
              value={manual[key]}
              onChange={(e) => onManualChange({ ...manual, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>

      <span className="field-hint">
        {canEditNutrition
          ? '空欄のままでも記録できます。その場合は「未確定」として残り、あとから登録できます。'
          : '4つすべて入れたときだけ、仮の値として使います。1つでも空欄なら、これまでどおり合計には入りません。'}
      </span>
    </fieldset>
  );
}

function parse(value: string): number | null {
  if (value.trim().length === 0) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
