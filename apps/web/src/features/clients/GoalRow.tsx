import { useState } from 'react';
import { goalLabel, rankLabel, type Rank, type RankGoal } from '@pt/core';

/**
 * DIAMOND から先の昇格条件を1つ決める（追加仕様: 会員ランク）。
 *
 * ★ 選ぶのは3つだけです。
 *
 *     何を   … 食事記録 ／ 運動記録
 *     どう   … 累計 ／ 連続
 *     何日   … 数字
 *
 *   組み合わせると「運動記録を、連続で、30日」のように読めます。
 *   欄を増やせばもっと細かく決められますが、決めるのが面倒になれば
 *   結局決めないままになります。**決めやすさを優先しました。**
 *
 * ★ 決めていないランクへは、記録がいくらあっても上がりません。
 *   目標を渡していないのに上がるのは、おかしいためです。
 */
export function GoalRow({
  rank,
  goal,
  busy,
  onSave,
}: {
  rank: Rank;
  goal: RankGoal | null;
  busy: boolean;
  onSave: (goal: RankGoal | null) => void;
}) {
  const [target, setTarget] = useState<RankGoal['target']>(goal?.target ?? 'meal');
  const [mode, setMode] = useState<RankGoal['mode']>(goal?.mode ?? 'total');
  const [days, setDays] = useState(goal === null ? '' : String(goal.days));

  const n = Number(days);
  const valid = days.trim().length > 0 && Number.isInteger(n) && n >= 1 && n <= 3650;
  const changed =
    goal === null
      ? valid
      : target !== goal.target || mode !== goal.mode || (valid && n !== goal.days);

  return (
    <div className="goal-row">
      <div className="goal-head">
        <b>{rankLabel(rank)}</b>
        {goal === null ? (
          <span className="badge wait">未設定</span>
        ) : (
          <span className="goal-current">
            {goalLabel(goal)} {goal.days}日
          </span>
        )}
      </div>

      <div className="goal-fields">
        <label className="field">
          <span className="field-label small">何を</span>
          <select
            className="input"
            value={target}
            onChange={(e) => setTarget(e.target.value as RankGoal['target'])}
            disabled={busy}
          >
            <option value="meal">食事記録</option>
            <option value="exercise">運動記録</option>
          </select>
        </label>

        <label className="field">
          <span className="field-label small">どう</span>
          <select
            className="input"
            value={mode}
            onChange={(e) => setMode(e.target.value as RankGoal['mode'])}
            disabled={busy}
          >
            <option value="total">累計</option>
            <option value="streak">連続</option>
          </select>
        </label>

        <label className="field">
          <span className="field-label small">何日</span>
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={1}
            max={3650}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            placeholder="120"
          />
        </label>
      </div>

      <div className="item-form-actions">
        <button
          className="button-secondary compact"
          type="button"
          disabled={busy || !valid || !changed}
          onClick={() => onSave({ target, mode, days: n })}
        >
          この条件にする
        </button>
        {goal !== null && (
          <button
            className="button-quiet compact"
            type="button"
            disabled={busy}
            onClick={() => {
              setDays('');
              onSave(null);
            }}
          >
            条件を消す
          </button>
        )}
      </div>
    </div>
  );
}
