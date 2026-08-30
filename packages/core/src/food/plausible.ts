/**
 * 栄養値が「ありえる値か」を、計算だけで確かめる（追加仕様: 登録依頼のAI）。
 *
 * ★ AI が返した数値を、人が見る前に機械で一度ふるいます。
 *
 *   ここはマスタです。1件の間違いが、全契約者の集計に効きます。
 *   人の目だけに頼ると、忙しい日に素通りします。
 *   **計算で分かることは、計算で止めます。**
 *
 * ★ ここが見るのは「ありえるか」だけで、「正しいか」ではありません。
 *
 *   白米の kcal が 156 か 168 かは、ここでは分かりません。
 *   分かるのは「100g の中に 120g のたんぱく質は入らない」のような、
 *   数字の辻褄です。正しさの判断は人がします。
 */

/** 1g あたりの熱量（Atwater 係数）。たんぱく質4・脂質9・炭水化物4 kcal */
export const KCAL_PER_G = { p: 4, f: 9, c: 4 } as const;

export interface Per100g {
  kcal: number;
  p: number;
  f: number;
  c: number;
}

/** PFC から計算した kcal（100gあたり） */
export function kcalFromPfc(n: Pick<Per100g, 'p' | 'f' | 'c'>): number {
  return n.p * KCAL_PER_G.p + n.f * KCAL_PER_G.f + n.c * KCAL_PER_G.c;
}

export type PlausibilityLevel =
  /** 辻褄が合っている */
  | 'ok'
  /** 合わないが、ありえなくはない（食物繊維・水分・アルコールなどで説明が付く範囲） */
  | 'warn'
  /** ありえない。採用してはいけない */
  | 'impossible';

export interface Plausibility {
  level: PlausibilityLevel;
  /** PFC から計算した kcal */
  computed: number;
  /** 申告された kcal との差（kcal） */
  gap: number;
  /** 人に見せる説明。level が 'ok' なら空文字 */
  reason: string;
}

/**
 * 「ありえない」と判断する境目。
 *
 * ★ P+F+C が 100g を超えたら、それだけでありえません。
 *   100g の中に 100g より多くは入りません（水分も灰分も0になってしまいます）。
 *   小数の誤差で弾かないよう、少しだけ余裕を持たせています。
 */
const MAX_GRAMS = 100.5;

/**
 * kcal の食い違いを「注意」とみなす幅。
 *
 * ★ ぴったり一致はしません。
 *
 *   食物繊維は炭水化物に数えられますが、熱量はほとんどありません。
 *   糖アルコールやアルコールもずれます。日本の成分表そのものが
 *   Atwater 係数をそのまま使っていない食品もあります。
 *   ですから「合わない＝間違い」ではありません。
 *
 *   厳しくしすぎると、正しい値まで警告だらけになって、
 *   警告そのものが読まれなくなります。20% と 30kcal のどちらも
 *   超えたときだけ言うことにしました。
 */
const WARN_RATIO = 0.2;
const WARN_ABSOLUTE = 30;

export function checkPlausibility(n: Per100g): Plausibility {
  const computed = kcalFromPfc(n);
  const gap = n.kcal - computed;

  const negative = n.kcal < 0 || n.p < 0 || n.f < 0 || n.c < 0;
  if (negative) {
    return { level: 'impossible', computed, gap, reason: 'マイナスの値が入っています。' };
  }

  const grams = n.p + n.f + n.c;
  if (grams > MAX_GRAMS) {
    return {
      level: 'impossible',
      computed,
      gap,
      reason: `P+F+C が ${round1(grams)}g で、100g を超えています。100g の中には収まりません。`,
    };
  }

  // ★ 脂質だけの食品（油）でも 900kcal/100g です。それを超える食品はありません。
  if (n.kcal > 900) {
    return {
      level: 'impossible',
      computed,
      gap,
      reason: `${round1(n.kcal)}kcal は、100gあたりの上限（油の900kcal）を超えています。`,
    };
  }

  // ★ 中身がまったく無いのに熱量だけある、は辻褄が合いません
  if (grams === 0 && n.kcal > WARN_ABSOLUTE) {
    return {
      level: 'impossible',
      computed,
      gap,
      reason: 'P・F・C がすべて0なのに、熱量だけ入っています。',
    };
  }

  const off = Math.abs(gap);
  if (off > WARN_ABSOLUTE && off > computed * WARN_RATIO) {
    return {
      level: 'warn',
      computed,
      gap,
      reason:
        `PFC から計算すると ${round1(computed)}kcal ですが、${round1(n.kcal)}kcal になっています` +
        `（差 ${round1(gap)}kcal）。食物繊維などで説明が付くこともありますが、確かめてください。`,
    };
  }

  return { level: 'ok', computed, gap, reason: '' };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
