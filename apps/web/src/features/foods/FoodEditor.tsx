import { useMemo, useState } from 'react';
import {
  COUNTABLE_UNITS,
  conversionFor,
  findSimilarFoods,
  foodKey,
  kcalMismatchWarning,
  validateConversion,
  type CountableUnit,
  type Per100gInput,
  type UnitConversion,
} from '@pt/core';
import { AI_RELAY_URL } from '@/config/firebase';
import { writeErrorMessage } from '@/lib/firestoreError';
import { LabelScanner } from './LabelScanner';
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
  nameOptions,
  onSaved,
  onCancel,
}: {
  /** 新規なら未指定、または名前だけ入ったもの */
  initial?: Food;
  /** 重複チェックに使う既存の一覧 */
  all: Food[];
  /**
   * 名前の候補（依頼から登録するときに、実際に使われた表記を渡す）。
   *
   * ★ 代表は自動で選びますが、選び方が常に正しいとは限りません。
   *   管理者が1タップで選び直せるようにしておきます。
   */
  nameOptions?: string[];
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
  /**
   * 「1個 = ○g」の入力（追加仕様: 単位換算）。
   *
   * ★ 4つの単位ぶんの欄を、最初から全部出しておきます。
   *   「行を足す」形にすると、押さないと存在に気づけません。
   *   空欄のままなら、その単位は登録されません。
   */
  const [conversions, setConversions] = useState<Record<CountableUnit, string>>(() => {
    const out = {} as Record<CountableUnit, string>;
    for (const unit of COUNTABLE_UNITS) {
      const found = conversionFor(base.unitConversions, unit);
      out[unit] = found === undefined ? '' : String(found.grams);
    }
    return out;
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

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

  /** 入力されている換算（空欄の単位は入りません）。 */
  const filledConversions: UnitConversion[] = useMemo(
    () =>
      COUNTABLE_UNITS.flatMap((unit) => {
        const text = conversions[unit].trim();
        if (text.length === 0) return [];
        const grams = Number(text);
        if (!Number.isFinite(grams)) return [];
        return [{ unit, grams }];
      }),
    [conversions],
  );

  /** 換算のうち、範囲から外れているもの。最初の1件だけ知らせます。 */
  const conversionError = useMemo(() => {
    for (const unit of COUNTABLE_UNITS) {
      const text = conversions[unit].trim();
      if (text.length === 0) continue;
      const message = validateConversion(Number(text));
      if (message !== null) return `「1${unit}」の重さ: ${message}`;
    }
    return null;
  }, [conversions]);

  async function submit() {
    if (!nameOk) {
      setError('食材の名前を入力してください。');
      return;
    }
    if (!numbersOk) {
      setError('100gあたりの kcal・P・F・C をすべて入力してください（0以上の数字）。');
      return;
    }
    if (conversionError !== null) {
      setError(conversionError);
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
        aliases: usefulAliases(name, aliasText),
        per100g: numbers,
        unitConversions: filledConversions,
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

      {(nameOptions ?? []).length > 1 && (
        <>
          <p className="field-hint">実際に使われた表記です。どれで登録するか選べます。</p>
          <div className="add-actions">
            {(nameOptions ?? []).map((option) => (
              <button
                key={option}
                type="button"
                className={option === name ? 'button-secondary current' : 'button-secondary'}
                onClick={() => setName(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </>
      )}

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

      {/* ★ 成分表示から読み取る（設計書 §47 / 追加仕様: 成分表示の読み取り）。
          読み取った値は、下の欄に入るだけです。そのまま保存はされません。
          最後に数字を決めるのは管理者のままです。 */}
      {AI_RELAY_URL !== null && !scanning && (
        <button
          className="button-secondary"
          type="button"
          onClick={() => setScanning(true)}
          disabled={busy}
        >
          成分表示を撮って入れる
        </button>
      )}

      {scanning && (
        <LabelScanner
          onCancel={() => setScanning(false)}
          onDone={(r) => {
            setValues({
              kcal: String(r.per100g.kcal),
              p: String(r.per100g.p),
              f: String(r.per100g.f),
              c: String(r.per100g.c),
            });
            if (name.trim().length === 0 && r.productName.length > 0) setName(r.productName);
            if (note.trim().length === 0) setNote(r.note);
            setScanning(false);
          }}
        />
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

      {/* ★ かぞえ方（追加仕様: 単位換算）。
             栄養値ではなく、物差しです。100gあたりの値はここでは変わりません。 */}
      <fieldset className="conv">
        <legend className="field-label">かぞえ方（任意）</legend>

        <p className="field-hint">
          ここを入れておくと、契約者が<b>「2個」と入れるだけ</b>で記録できます。
          <br />
          卵はMサイズ1個が<b>殻を除いて約50g</b>です。殻ごと量った重さ（約60g）を
          入れると2割ぶん多く計算されるので、<b>食べる部分の重さ</b>を入れてください。
        </p>

        {COUNTABLE_UNITS.map((unit) => (
          <div className="conv-row" key={unit}>
            <span className="conv-label">1{unit}</span>
            <span className="conv-eq">=</span>
            <input
              className="input conv-input"
              type="number"
              inputMode="decimal"
              step="0.1"
              value={conversions[unit]}
              onChange={(e) => setConversions({ ...conversions, [unit]: e.target.value })}
              aria-label={`1${unit}あたりの重さ（g）`}
            />
            <span className="conv-unit">g</span>
            {/* ★ その場で1個ぶんのカロリーを出します。
                   桁を間違えて 500 と打てば 710kcal と出るので、保存前に気づけます。 */}
            <span className="conv-preview">{previewFor(unit, conversions[unit], numbers)}</span>
          </div>
        ))}

        <span className="field-hint">
          空欄の単位は登録されません。食パンの「6枚切り」と「8枚切り」のように
          同じ単位で重さが違うものは、<b>食材を2件に分けて</b>ください。
        </span>
      </fieldset>

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

/**
 * 「1個 ≒ 71kcal」を、入力中に出す（追加仕様: 単位換算）。
 *
 * ★ 保存する値ではありません。**桁の打ち間違いに気づくための鏡**です。
 *   卵の「1個 = 50g」を 500 と打つと 710kcal と出ます。
 *   数字だけ見ていても気づけませんが、kcal になると分かります。
 */
export function previewFor(
  unit: string,
  text: string,
  per100g: Per100gInput,
): string {
  const grams = Number(text.trim());
  if (text.trim().length === 0 || !Number.isFinite(grams)) return '';
  if (validateConversion(grams) !== null) return '';
  if (per100g.kcal <= 0) return '';

  return `1${unit} ≒ ${Math.round((per100g.kcal * grams) / 100)}kcal`;
}

/**
 * 別名として意味のあるものだけを残す。
 *
 * ★ 照合キーが名前と同じ別名は、登録しても何も増えません。
 *   「サラダチキン」と「サラダ（全角スペース）チキン」は
 *   すでに同じキーになるので、別名が無くても当たります。
 *   意味のない別名が並ぶと、管理者が一覧を読むときの邪魔になるだけです。
 *
 *   逆に「鶏むね肉」と「鶏胸肉」はキーが違うので、別名が要ります。
 *   ここで消えるのは前者だけです。
 */
export function usefulAliases(name: string, aliasText: string): string[] {
  const nameKey = foodKey(name);
  const seen = new Set<string>([nameKey]);
  const out: string[] = [];

  for (const alias of splitAliases(aliasText)) {
    const key = foodKey(alias);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
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
