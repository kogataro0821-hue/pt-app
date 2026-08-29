import { describe, expect, it } from 'vitest';
import {
  AUTO_MAX_RANK,
  earnedRank,
  longestStreak,
  rankLabel,
  rankOrder,
  goalLabel,
  rankProgress,
  readyRank,
  requirementsFor,
  summarizeRecords,
  toRank,
  toRankGoal,
  toRankGoals,
  type RankGoals,
  type RecordStats,
} from './rank';

/**
 * 会員ランク（追加仕様: 会員ランク）。
 *
 * ★ ここで守りたいのは2つです。
 *
 *   1. 順番を飛ばさないこと。運動だけ頑張っても、RUBY より先へは行けません。
 *   2. トレーナーが決めたランク（DIAMOND 以上）を、集計で勝手に動かさないこと。
 */

function stats(over: Partial<RecordStats> = {}): RecordStats {
  return { mealDays: 0, exerciseDays: 0, longestMealStreak: 0, longestExerciseStreak: 0, ...over };
}

describe('連続した日数', () => {
  it('1日も無ければ0', () => {
    expect(longestStreak([])).toBe(0);
  });

  it('続いていれば、その長さ', () => {
    expect(longestStreak(['2026-03-01', '2026-03-02', '2026-03-03'])).toBe(3);
  });

  it('途切れたら数え直す。いちばん長いところを返す', () => {
    expect(
      longestStreak([
        '2026-03-01',
        '2026-03-02',
        // 3日が抜けている
        '2026-03-04',
        '2026-03-05',
        '2026-03-06',
        '2026-03-07',
      ]),
    ).toBe(4);
  });

  it('月をまたいでも続きとして数える', () => {
    // ★ 自前で日付を足すと、ここを間違えます
    expect(longestStreak(['2026-03-30', '2026-03-31', '2026-04-01'])).toBe(3);
  });

  it('うるう年の2月末もまたげる', () => {
    expect(longestStreak(['2028-02-28', '2028-02-29', '2028-03-01'])).toBe(3);
  });

  it('同じ日が2回あっても、日数は増えない', () => {
    // summarizeRecords 側で重複を落とすので、ここは素通しでよい
    expect(summarizeRecords(['2026-03-01', '2026-03-01', '2026-03-02'], []).mealDays).toBe(2);
  });
});

describe('記録から集計を作る', () => {
  it('同じ日に何件入れても1日と数える', () => {
    // ★ 件数で数えると、細かく分けて入れる人ほど早く上がります
    const s = summarizeRecords(
      ['2026-03-01', '2026-03-01', '2026-03-01'],
      ['2026-03-01', '2026-03-01'],
    );
    expect(s.mealDays).toBe(1);
    expect(s.exerciseDays).toBe(1);
  });

  it('並び順がばらばらでも、連続を見つけられる', () => {
    const s = summarizeRecords(['2026-03-03', '2026-03-01', '2026-03-02'], []);
    expect(s.longestMealStreak).toBe(3);
  });
});

describe('昇格の条件', () => {
  it('RUBY は、食事を続けて21日', () => {
    expect(earnedRank('PLATINUM', stats({ longestMealStreak: 20 }))).toBe('PLATINUM');
    expect(earnedRank('PLATINUM', stats({ longestMealStreak: 21 }))).toBe('RUBY');
  });

  it('SAPPHIRE は、運動16日', () => {
    const base = { longestMealStreak: 21 };
    expect(earnedRank('PLATINUM', stats({ ...base, exerciseDays: 15 }))).toBe('RUBY');
    expect(earnedRank('PLATINUM', stats({ ...base, exerciseDays: 16 }))).toBe('SAPPHIRE');
  });

  it('EMERALD は、食事90日と運動24日の両方', () => {
    const base = { longestMealStreak: 21, exerciseDays: 24 };
    // 食事が足りない
    expect(earnedRank('SAPPHIRE', stats({ ...base, mealDays: 89 }))).toBe('SAPPHIRE');
    // 運動が足りない
    expect(earnedRank('SAPPHIRE', stats({ ...base, mealDays: 90, exerciseDays: 23 }))).toBe(
      'SAPPHIRE',
    );
    // 両方そろった
    expect(earnedRank('SAPPHIRE', stats({ ...base, mealDays: 90 }))).toBe('EMERALD');
  });
});

describe('★ 順番を飛ばさない', () => {
  it('運動だけ達成しても、RUBY より先へは行かない', () => {
    // ★ ここが「優先順位はルビーへの昇格」の意味です
    expect(earnedRank('PLATINUM', stats({ exerciseDays: 100, longestMealStreak: 5 }))).toBe(
      'PLATINUM',
    );
  });

  it('全部そろっていれば、一度に何段でも上がる', () => {
    expect(
      earnedRank('PLATINUM', stats({ longestMealStreak: 21, exerciseDays: 24, mealDays: 90 })),
    ).toBe('EMERALD');
  });

  it('条件が決まっていないかぎり、EMERALD より先へは行かない', () => {
    // ★ DIAMOND から先は、トレーナーが条件を決めていなければ上がりません
    const perfect = stats({ longestMealStreak: 365, exerciseDays: 365, mealDays: 365 });
    expect(earnedRank('PLATINUM', perfect)).toBe(AUTO_MAX_RANK);
    expect(earnedRank('EMERALD', perfect)).toBe('EMERALD');
  });
});

describe('★ トレーナーが決めたランクを、集計で動かさない', () => {
  it('DIAMOND の人は、記録が少なくても下がらない', () => {
    // 自動での降格はしません
    expect(earnedRank('DIAMOND', stats())).toBe('DIAMOND');
  });

  it('条件が決まっていなければ、記録が満点でも上がらない', () => {
    const perfect = stats({ longestMealStreak: 365, exerciseDays: 365, mealDays: 365 });
    expect(earnedRank('CROWN', perfect)).toBe('CROWN');
  });

  it('記録が減っても、いまのランクは下がらない', () => {
    expect(earnedRank('EMERALD', stats())).toBe('EMERALD');
    expect(earnedRank('RUBY', stats())).toBe('RUBY');
  });
});

describe('画面に出すまとめ', () => {
  it('上がれるときは、上がれるランクを示す', () => {
    const p = rankProgress('PLATINUM', stats({ longestMealStreak: 21 }));
    expect(p.earned).toBe('RUBY');
    // 上がったあとの次の目標も出す
    expect(p.next).toBe('SAPPHIRE');
  });

  it('上がれないときは earned が null で、いまの次の目標を出す', () => {
    const p = rankProgress('PLATINUM', stats({ longestMealStreak: 10 }));
    expect(p.earned).toBeNull();
    expect(p.next).toBe('RUBY');
    expect(p.steps).toEqual([{ label: '食事を続けて記録した日数', done: 10, need: 21 }]);
  });

  it('条件が決まっていなければ、次の目標は出さない', () => {
    const p = rankProgress('EMERALD', stats({ mealDays: 200 }));
    expect(p.next).toBeNull();
    expect(p.steps).toEqual([]);
  });

  it('CROWN でも、条件が決まっていなければ出さない', () => {
    expect(rankProgress('CROWN', stats()).next).toBeNull();
  });

  it('EMERALD の条件は2つとも出す', () => {
    const p = rankProgress('SAPPHIRE', stats({ mealDays: 50, exerciseDays: 10 }));
    expect(p.next).toBe('EMERALD');
    expect(p.steps).toHaveLength(2);
    expect(p.steps[0]?.done).toBe(50);
    expect(p.steps[1]?.done).toBe(10);
  });
});

describe('表記と、壊れた値の扱い', () => {
  it('CROWN AMBASSADOR は、画面では空白で区切る', () => {
    expect(rankLabel('CROWN_AMBASSADOR')).toBe('CROWN AMBASSADOR');
    expect(rankLabel('RUBY')).toBe('RUBY');
  });

  it('知らない値は、いちばん下のランクとして扱う', () => {
    // ★ ここが落ちると、手で書き換えられた値がそのまま画面に出ます
    expect(toRank('SUPER_CROWN')).toBe('PLATINUM');
    expect(toRank(undefined)).toBe('PLATINUM');
    expect(toRank(7)).toBe('PLATINUM');
    expect(rankOrder('SUPER_CROWN' as never)).toBe(0);
  });

  it('順位は下から上へ並んでいる', () => {
    expect(rankOrder('PLATINUM')).toBeLessThan(rankOrder('RUBY'));
    expect(rankOrder('RUBY')).toBeLessThan(rankOrder('SAPPHIRE'));
    expect(rankOrder('SAPPHIRE')).toBeLessThan(rankOrder('EMERALD'));
    expect(rankOrder('EMERALD')).toBeLessThan(rankOrder('DIAMOND'));
    expect(rankOrder('DIAMOND')).toBeLessThan(rankOrder('CROWN'));
    expect(rankOrder('CROWN')).toBeLessThan(rankOrder('CROWN_AMBASSADOR'));
  });

  it('PLATINUM には条件が無い（最初のランクなので）', () => {
    expect(requirementsFor('PLATINUM', stats())).toEqual([]);
    expect(requirementsFor('CROWN', stats())).toEqual([]);
  });
});

describe('昇格の目印', () => {
  it('目印が無ければ null', () => {
    expect(readyRank({}, 'PLATINUM')).toBeNull();
  });

  it('いまより上のランクの目印なら、その値を返す', () => {
    expect(readyRank({ rankReady: 'RUBY' }, 'PLATINUM')).toBe('RUBY');
  });

  it('★ すでに追いついていれば、古い目印として無視する', () => {
    // 昇格させたあとに目印を消し損ねても、印が出っぱなしにならない
    expect(readyRank({ rankReady: 'RUBY' }, 'RUBY')).toBeNull();
    expect(readyRank({ rankReady: 'RUBY' }, 'EMERALD')).toBeNull();
  });

  it('知らない値は無視する（手で書き換えられても壊れない）', () => {
    expect(readyRank({ rankReady: 'SUPER_CROWN' }, 'PLATINUM')).toBeNull();
    expect(readyRank({ rankReady: 42 }, 'PLATINUM')).toBeNull();
    expect(readyRank({ rankReady: null }, 'PLATINUM')).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// DIAMOND から先の条件（トレーナーが一人ひとりに決める）
// -----------------------------------------------------------------------------

describe('DIAMOND から先の条件', () => {
  const goals: RankGoals = {
    DIAMOND: { target: 'meal', mode: 'total', days: 120 },
    CROWN: { target: 'exercise', mode: 'streak', days: 30 },
  };

  it('条件を決めていなければ、満点でも上がらない', () => {
    // ★ 決めていない＝まだ目標を渡していない、ということなので、そこで止めます
    const perfect = stats({ mealDays: 999, exerciseDays: 999, longestExerciseStreak: 999 });
    expect(earnedRank('EMERALD', perfect, {})).toBe('EMERALD');
  });

  it('決めた条件を満たせば上がる（累計）', () => {
    expect(earnedRank('EMERALD', stats({ mealDays: 119 }), goals)).toBe('EMERALD');
    expect(earnedRank('EMERALD', stats({ mealDays: 120 }), goals)).toBe('DIAMOND');
  });

  it('決めた条件を満たせば上がる（連続）', () => {
    const s = stats({ mealDays: 120, longestExerciseStreak: 30 });
    expect(earnedRank('EMERALD', s, goals)).toBe('CROWN');
  });

  it('★ 先の条件だけ満たしても、手前を飛ばさない', () => {
    // CROWN の条件は満たしているが、DIAMOND の条件（食事120日）が未達
    const s = stats({ mealDays: 10, longestExerciseStreak: 30 });
    expect(earnedRank('EMERALD', s, goals)).toBe('EMERALD');
  });

  it('途中のランクの条件が抜けていたら、そこで止まる', () => {
    // ★ CROWN AMBASSADOR の条件だけ決めても、CROWN の条件が無ければ進めません
    const onlyLast: RankGoals = { CROWN_AMBASSADOR: { target: 'meal', mode: 'total', days: 1 } };
    expect(earnedRank('EMERALD', stats({ mealDays: 999 }), onlyLast)).toBe('EMERALD');
  });

  it('条件の書き方が、そのまま画面の見出しになる', () => {
    expect(goalLabel({ target: 'meal', mode: 'total', days: 120 })).toBe('食事を記録した日数');
    expect(goalLabel({ target: 'meal', mode: 'streak', days: 30 })).toBe(
      '食事を続けて記録した日数',
    );
    expect(goalLabel({ target: 'exercise', mode: 'total', days: 50 })).toBe('運動を記録した日数');
    expect(goalLabel({ target: 'exercise', mode: 'streak', days: 10 })).toBe(
      '運動を続けて記録した日数',
    );
  });

  it('進み具合も、決めた条件で出す', () => {
    const p = rankProgress('EMERALD', stats({ mealDays: 60 }), goals);
    expect(p.next).toBe('DIAMOND');
    expect(p.steps).toEqual([{ label: '食事を記録した日数', done: 60, need: 120 }]);
  });
});

describe('条件の読み込み（壊れた値に強いか）', () => {
  it('正しい形はそのまま読む', () => {
    expect(toRankGoal({ target: 'meal', mode: 'total', days: 120 })).toEqual({
      target: 'meal',
      mode: 'total',
      days: 120,
    });
  });

  it('知らない値や、日数が0以下なら無視する', () => {
    expect(toRankGoal({ target: 'sleep', mode: 'total', days: 10 })).toBeNull();
    expect(toRankGoal({ target: 'meal', mode: 'sometimes', days: 10 })).toBeNull();
    expect(toRankGoal({ target: 'meal', mode: 'total', days: 0 })).toBeNull();
    expect(toRankGoal({ target: 'meal', mode: 'total', days: -5 })).toBeNull();
    expect(toRankGoal(null)).toBeNull();
    expect(toRankGoal('たくさん')).toBeNull();
  });

  it('ランクごとにまとめて読める。壊れているものだけ落ちる', () => {
    const goals = toRankGoals({
      DIAMOND: { target: 'meal', mode: 'total', days: 120 },
      CROWN: { target: 'meal', mode: 'total', days: 0 },
      NOT_A_RANK: { target: 'meal', mode: 'total', days: 5 },
    });
    expect(Object.keys(goals)).toEqual(['DIAMOND']);
  });
});
