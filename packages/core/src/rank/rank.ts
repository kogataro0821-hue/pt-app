import { addDays, type DateKey } from '../date/day';

/**
 * 会員ランク（追加仕様: 会員ランク）。
 *
 * ★ 何のためにあるか。
 *
 *   食事の記録は、いちばん続かないものです。効果が出るのは数週間先で、
 *   その間ずっと「面倒なだけの作業」に見えます。
 *   ランクは、その数週間に**目に見える手応え**を置くための仕掛けです。
 *
 * ★ だから降格は自動でしません。
 *
 *   一度上がったものが下がる仕組みにすると、「下がらないために記録する」に変わります。
 *   それは続ける理由として弱く、休んだ日の罪悪感だけが残ります。
 *   （トレーナーの裁量で下げることはできます。運用上の判断のためです）
 *
 * ★ 昇格の判定はここでやりますが、**確定はしません**。
 *
 *   ここが返すのは「条件を満たしているか」だけです。
 *   実際にランクを上げるのはトレーナーです（設計書 §7 の権限方針）。
 *
 *   理由は2つあります。
 *     1. 契約者が自分でランクを書けるようにすると、アプリを迂回して
 *        いきなり CROWN にできます。「自分の権限を上げられない」という
 *        このアプリの一番の約束が崩れます。
 *     2. 昇格は声をかける機会です。勝手に上がるより、
 *        「おめでとうございます」と一緒に上がるほうが効きます。
 */

export type Rank =
  | 'PLATINUM'
  | 'RUBY'
  | 'SAPPHIRE'
  | 'EMERALD'
  | 'DIAMOND'
  | 'CROWN'
  | 'CROWN_AMBASSADOR';

/** 下から順に。配列の位置がそのまま順位です。 */
export const RANKS: readonly Rank[] = [
  'PLATINUM',
  'RUBY',
  'SAPPHIRE',
  'EMERALD',
  'DIAMOND',
  'CROWN',
  'CROWN_AMBASSADOR',
] as const;

/** 登録した人が最初に持つランク */
export const INITIAL_RANK: Rank = 'PLATINUM';

/**
 * 記録だけで上がれる上限。
 *
 * これより上（DIAMOND / CROWN / CROWN AMBASSADOR）は、
 * 記録の量では決まりません。トレーナーが一人ひとり決めます。
 */
export const AUTO_MAX_RANK: Rank = 'EMERALD';

/** 画面に出す表記。CROWN_AMBASSADOR だけ内部の名前と違います。 */
export function rankLabel(rank: Rank): string {
  return rank === 'CROWN_AMBASSADOR' ? 'CROWN AMBASSADOR' : rank;
}

export function rankOrder(rank: Rank): number {
  const index = RANKS.indexOf(rank);
  // 知らない値は最下位として扱います（古いデータや、手で書き換えられた場合）
  return index < 0 ? 0 : index;
}

/** 保存されている値を Rank に直す。おかしな値は初期ランクにします。 */
export function toRank(value: unknown): Rank {
  return typeof value === 'string' && (RANKS as readonly string[]).includes(value)
    ? (value as Rank)
    : INITIAL_RANK;
}

// -----------------------------------------------------------------------------
// 昇格の条件
// -----------------------------------------------------------------------------

/** 昇格の条件で使う、記録の集計。 */
export interface RecordStats {
  /** 食事を記録した日の総数 */
  mealDays: number;
  /** 運動を記録した日の総数 */
  exerciseDays: number;
  /** 食事を記録した日が、いちばん長く続いた日数 */
  longestMealStreak: number;
}

/** ひとつの条件。画面の進み具合にもそのまま使います。 */
export interface RankStep {
  label: string;
  done: number;
  need: number;
}

/** そのランクへ上がるための条件。PLATINUM（最初）には条件がありません。 */
export function requirementsFor(rank: Rank, stats: RecordStats): RankStep[] {
  switch (rank) {
    case 'RUBY':
      // ★ 「最初の21日間」ではなく「連続21日」にしました。
      //   最初の21日に限ると、入会2日目に落とした人が以後ずっと上がれません。
      //   やり直せる形のほうが、続ける仕掛けとして機能します。
      return [{ label: '食事を続けて記録した日数', done: stats.longestMealStreak, need: 21 }];
    case 'SAPPHIRE':
      return [{ label: '運動を記録した日数', done: stats.exerciseDays, need: 16 }];
    case 'EMERALD':
      // 両方そろって初めて上がります
      return [
        { label: '食事を記録した日数', done: stats.mealDays, need: 90 },
        { label: '運動を記録した日数', done: stats.exerciseDays, need: 24 },
      ];
    default:
      return [];
  }
}

function meets(rank: Rank, stats: RecordStats): boolean {
  const steps = requirementsFor(rank, stats);
  if (steps.length === 0) return false;
  return steps.every((s) => s.done >= s.need);
}

/**
 * いまの記録で到達できるランク。
 *
 * ★ 順番に上がります。飛び級はしません。
 *
 *   運動16日を先に達成しても、RUBY の条件（連続21日）が未達なら
 *   SAPPHIRE にはなりません。RUBY が先です。
 *
 *   ただし、両方そろっていれば**一度に2段上がります**。
 *   1段ずつ待たせる理由がないためです。
 *
 * ★ すでに DIAMOND 以上の人は、ここでは動かしません。
 *   トレーナーが決めたランクを、記録の集計で上書きしてはいけません。
 */
export function earnedRank(current: Rank, stats: RecordStats): Rank {
  let rank = current;

  while (rankOrder(rank) < rankOrder(AUTO_MAX_RANK)) {
    const next = RANKS[rankOrder(rank) + 1];
    if (next === undefined) break;
    if (!meets(next, stats)) break;
    rank = next;
  }

  return rank;
}

/** 画面に出すための、まとめ。 */
export interface RankProgress {
  current: Rank;
  /** 条件を満たして上がれるランク。上がれないなら null */
  earned: Rank | null;
  /** 次に目指すランク。トレーナーの裁量の範囲に入っていれば null */
  next: Rank | null;
  /** 次のランクの条件の進み具合 */
  steps: RankStep[];
  stats: RecordStats;
}

export function rankProgress(current: Rank, stats: RecordStats): RankProgress {
  const earned = earnedRank(current, stats);
  const base = rankOrder(earned) > rankOrder(current) ? earned : current;
  const next = rankOrder(base) < rankOrder(AUTO_MAX_RANK) ? RANKS[rankOrder(base) + 1] : undefined;

  return {
    current,
    earned: rankOrder(earned) > rankOrder(current) ? earned : null,
    next: next ?? null,
    steps: next === undefined ? [] : requirementsFor(next, stats),
    stats,
  };
}

// -----------------------------------------------------------------------------
// 記録から集計を作る
// -----------------------------------------------------------------------------

/**
 * 記録のある日付から、昇格の判定に使う数を作る。
 *
 * ★ 日付の重複は取り除きます。
 *   同じ日に食事を3件入れても1日です。「日数」で数えると決めました。
 *   件数で数えると、細かく分けて入れる人ほど早く上がってしまいます。
 */
export function summarizeRecords(
  mealDates: readonly DateKey[],
  exerciseDates: readonly DateKey[],
): RecordStats {
  const meals = unique(mealDates);
  return {
    mealDays: meals.length,
    exerciseDays: unique(exerciseDates).length,
    longestMealStreak: longestStreak(meals),
  };
}

function unique(dates: readonly DateKey[]): DateKey[] {
  return [...new Set(dates)].sort();
}

/**
 * 連続した日数のうち、いちばん長いもの。
 *
 * ★ 日付の足し算を自前でやらず、addDays を使います。
 *   月末・うるう年・月またぎを自分で書くと、必ずどこかで間違えます。
 */
export function longestStreak(sortedDates: readonly DateKey[]): number {
  if (sortedDates.length === 0) return 0;

  let longest = 1;
  let run = 1;

  for (let i = 1; i < sortedDates.length; i += 1) {
    const prev = sortedDates[i - 1];
    const here = sortedDates[i];
    if (prev === undefined || here === undefined) continue;

    if (addDays(prev, 1) === here) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }

  return longest;
}

/**
 * 「昇格の条件を満たしている」という目印（追加仕様: 会員ランク）。
 *
 * ★ なぜ目印を保存するのか。
 *
 *   条件を満たしたかどうかは、その人の記録を全部数えないと分かりません。
 *   契約者一覧でそれを10人ぶんやると、開くだけで数千回の読み取りになります。
 *
 *   そこで、契約者の画面で数えたときに結果を1文字だけ書き残します。
 *   一覧は契約者の情報をもう読んでいるので、**追加の読み取りが0回**で
 *   「昇格できる人がいる」と出せます。
 *
 * ★ 契約者がこの目印を勝手に書けても、危なくありません。
 *   目印は印が出るだけで、ランクは上がりません。
 *   上げるのはトレーナーで、そのとき本物の数字が画面に出ています。
 */
export function readyRank(extra: Record<string, unknown>, current: Rank): Rank | null {
  const marked = extra.rankReady;
  if (typeof marked !== 'string') return null;
  if (!(RANKS as readonly string[]).includes(marked)) return null;

  const rank = marked as Rank;
  // すでにそのランク以上なら、目印は古いものです
  return rankOrder(rank) > rankOrder(current) ? rank : null;
}
