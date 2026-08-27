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

      <label className="field">
        <span className="field-label">時間（分）</span>
        <input
          className="input"
          type="number"
          inputMode="numeric"
          value={draft.minutes ?? ''}
          onChange={(e) =>
            onChange({
              ...draft,
              minutes: e.target.value.trim() === '' ? null : Number(e.target.value),
            })
          }
          placeholder="未入力でも構いません"
        />
      </label>

      <label className="field">
        <span className="field-label">内容</span>
        <input
          className="input"
          type="text"
          value={draft.detail}
          onChange={(e) => onChange({ ...draft, detail: e.target.value })}
          placeholder="60kg 10回 3セット"
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
