import { useEffect, useState } from 'react';
import type { DateKey } from '@pt/core';
import {
  deleteExercise,
  emptyExercise,
  listExercises,
  saveExercise,
  validateExercise,
  type Exercise,
} from './exercisesRepo';
import { syncDayExerciseFlag } from '@/features/days/daysRepo';

/**
 * その日の運動（設計書 §22）。
 *
 * 種目名・時間・内容の3つだけの、素直な記録です。
 * 消費カロリーは扱いません（exercisesRepo の説明を参照）。
 */
export function ExercisesSection({
  clientId,
  date,
  canEdit,
  onExercisesChanged,
}: {
  clientId: string;
  date: DateKey;
  canEdit: boolean;
  /**
   * その日の運動の状況を親へ伝える。
   * AI評価に「何分動いたか」を渡すために、分数も一緒に出します。
   */
  onExercisesChanged?: (hasExercise: boolean, totalMinutes: number) => void;
}) {
  const [list, setList] = useState<Exercise[] | null>(null);
  const [draft, setDraft] = useState<Exercise | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setList(null);
    setDraft(null);
    setError(null);

    void (async () => {
      try {
        const loaded = await listExercises(clientId, date);
        if (!cancelled) {
          setList(loaded);
          // 読み込んだ時点でも伝えます。これが無いと、
          // その日を開いただけでは運動時間が親に届きません。
          onExercisesChanged?.(loaded.length > 0, loaded.reduce((s, e) => s + (e.minutes ?? 0), 0));
        }
      } catch {
        if (!cancelled) {
          setError('運動の記録を読み込めませんでした。');
          setList([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId, date]);

  /** 分が入っていないものは 0 として数えます（未入力と 0分 を区別しません）。 */
  function totalMinutes(items: Exercise[]): number {
    return items.reduce((sum, e) => sum + (e.minutes ?? 0), 0);
  }

  async function persist(next: Exercise[], changed: Exercise | null, removedId?: string) {
    const previous = list;
    setList(next);
    setError(null);
    setBusy(true);
    try {
      if (removedId !== undefined) await deleteExercise(clientId, date, removedId);
      if (changed !== null) await saveExercise(clientId, date, changed);

      const has = next.length > 0;
      onExercisesChanged?.(has, totalMinutes(next));
      try {
        await syncDayExerciseFlag(clientId, date, has);
      } catch {
        // 印の更新に失敗しても記録は残る
      }
    } catch {
      setList(previous);
      setError(
        canEdit
          ? '保存に失敗しました。通信状態を確認してください。'
          : 'この日は編集できないため保存されませんでした。',
      );
    } finally {
      setBusy(false);
    }
  }

  function submitDraft() {
    if (draft === null) return;
    const problem = validateExercise(draft);
    if (problem !== null) {
      setError(problem);
      return;
    }
    const current = list ?? [];
    const exists = current.some((e) => e.id === draft.id);
    const next = exists
      ? current.map((e) => (e.id === draft.id ? draft : e))
      : [...current, draft];
    void persist(next, draft);
    setDraft(null);
  }

  function remove(exercise: Exercise) {
    if (!window.confirm(`${exercise.name || 'この運動'} を削除します。よろしいですか？`)) return;
    void persist(
      (list ?? []).filter((e) => e.id !== exercise.id),
      null,
      exercise.id,
    );
  }

  if (list === null) {
    return (
      <section className="card">
        <h3 className="card-title">運動</h3>
        <p className="lede">読み込んでいます…</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h3 className="card-title">運動</h3>

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {list.length === 0 && draft === null && (
        <p className="note">この日の運動は記録されていません。</p>
      )}

      {list.map((exercise) =>
        draft?.id === exercise.id ? (
          <ExerciseForm
            key={exercise.id}
            draft={draft}
            onChange={setDraft}
            onSubmit={submitDraft}
            onCancel={() => setDraft(null)}
          />
        ) : (
          <div className="row exercise-row" key={exercise.id}>
            <div className="row-label">
              <span className="item-name">{exercise.name}</span>
              {/* ★ 入れたものだけ並べます（追加仕様: 運動記録の項目）。
                     未入力の欄に 0 や「-」を出すと、**0で記録した**ように
                     読めます。入れなかったことは、出さないことで伝えます。 */}
              {summarize(exercise).length > 0 && (
                <span className="exercise-detail">{summarize(exercise)}</span>
              )}
              {exercise.detail.length > 0 && (
                <span className="exercise-detail">{exercise.detail}</span>
              )}
            </div>
            {exercise.minutes !== null && <span className="exercise-minutes">{exercise.minutes}分</span>}
            {canEdit && (
              <div className="item-actions">
                <button className="button-quiet compact" type="button" onClick={() => setDraft(exercise)}>
                  編集
                </button>
                <button
                  className="button-quiet danger compact"
                  type="button"
                  onClick={() => remove(exercise)}
                >
                  削除
                </button>
              </div>
            )}
          </div>
        ),
      )}

      {draft !== null && !list.some((e) => e.id === draft.id) && (
        <ExerciseForm
          draft={draft}
          onChange={setDraft}
          onSubmit={submitDraft}
          onCancel={() => setDraft(null)}
        />
      )}

      {canEdit && draft === null && (
        <button
          className="button-secondary"
          type="button"
          onClick={() => setDraft(emptyExercise(list.length))}
          disabled={busy}
        >
          + 運動を追加
        </button>
      )}
    </section>
  );
}

function ExerciseForm({
  draft,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: Exercise;
  onChange: (e: Exercise) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="item-form">
      <label className="field">
        <span className="field-label">種目</span>
        <input
          className="input"
          type="text"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="ベンチプレス / ランニング"
          autoFocus
        />
      </label>

      {/* ★ ここから下は、すべて未入力で構いません（追加仕様: 運動記録の項目）。

             運動によって埋まる欄が違います。
               ベンチプレス … 重量・カウント・セット
               ランニング   … 時間だけ
               懸垂         … カウントとセットだけ（自重なので重量が無い）

             全部を必須にすると、埋めるために**嘘の数字**を入れることに
             なります。0 と書かせるのも同じです。
             「0kgで挙げた」という記録が残ってしまいます。 */}
      <p className="field-hint">
        下の欄は<b>入れたものだけで構いません</b>。使わない欄は空のままにしてください。
      </p>

      <div className="exercise-grid">
        <NumberField
          label="重量"
          unit="kg"
          value={draft.weight}
          onChange={(weight) => onChange({ ...draft, weight })}
        />
        <NumberField
          label="カウント数"
          unit="回"
          value={draft.reps}
          onChange={(reps) => onChange({ ...draft, reps })}
        />
        <NumberField
          label="セット数"
          unit="セット"
          value={draft.sets}
          onChange={(sets) => onChange({ ...draft, sets })}
        />
        <NumberField
          label="時間"
          unit="分"
          value={draft.minutes}
          onChange={(minutes) => onChange({ ...draft, minutes })}
        />
      </div>

      <label className="field">
        <span className="field-label">メモ</span>
        <input
          className="input"
          type="text"
          value={draft.detail}
          onChange={(e) => onChange({ ...draft, detail: e.target.value })}
          placeholder="フォームを意識／最後の1回がきつい"
        />
      </label>

      <div className="item-form-actions">
        <button className="button-primary compact" type="button" onClick={onSubmit}>
          保存する
        </button>
        <button className="button-quiet" type="button" onClick={onCancel}>
          やめる
        </button>
      </div>
    </div>
  );
}

/**
 * 数を入れる欄1つ（追加仕様: 運動記録の項目）。
 *
 * ★ 空欄と 0 を、はっきり分けます。
 *
 *   空欄は null（入れていない）、0 は 0（0と入れた）です。
 *   ここを混ぜると、入れなかった欄が「0」として残ります。
 *
 * ★ 単位は欄の中に出します。
 *   見出しに「重量（kg）」と書く形もありますが、
 *   数字のすぐ隣にあるほうが、入れている最中に目に入ります。
 */
function NumberField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="field exercise-field">
      <span className="field-label small">{label}</span>
      <span className="exercise-input-row">
        <input
          className="input"
          type="number"
          inputMode="decimal"
          step="0.1"
          value={value ?? ''}
          onChange={(e) => {
            const raw = e.target.value.trim();
            onChange(raw === '' ? null : Number(raw));
          }}
          placeholder="—"
          aria-label={label}
        />
        <span className="exercise-unit">{unit}</span>
      </span>
    </label>
  );
}

/**
 * 一覧に出す1行ぶんの言い方（追加仕様: 運動記録の項目）。
 *
 *   60kg × 10回 × 3セット
 *   10回 × 3セット          （自重のとき）
 *   60kg                     （重量だけ入れたとき）
 *
 * ★ 入れていない欄は、書きません。
 *   「-」や「0」で埋めると、入れたのか入れていないのかが
 *   読み取れなくなります。
 *
 * ★ 時間はここに入れません。行の右端に別で出しているためです。
 */
export function summarize(exercise: {
  weight: number | null;
  reps: number | null;
  sets: number | null;
}): string {
  const parts: string[] = [];
  if (exercise.weight !== null) parts.push(`${String(exercise.weight)}kg`);
  if (exercise.reps !== null) parts.push(`${String(exercise.reps)}回`);
  if (exercise.sets !== null) parts.push(`${String(exercise.sets)}セット`);
  return parts.join(' × ');
}
