/**
 * 「1個 = 50g」の換算（設計書 §10.5 / 追加仕様: 単位換算）。
 *
 * ★ 設計書には最初からありました。作られていなかっただけです。
 *   §16.2 の計算テストには「卵1個（個→g換算）→ unitConversions 経由」と
 *   書いてあります。実装が追いついていませんでした。
 *
 * ★ 換算を持つのは**食品マスタ**です。入力する人ではありません。
 *
 *   各自が目分量で入れると、Aさんの卵1個が50g、Bさんが60gになります。
 *   同じ「卵1個」が人によって違うカロリーになる、という状態です。
 *   個人マスタを廃止して共通マスタ一本にしたのと、まったく同じ理由で、
 *   換算も管理者が1回だけ決めます。
 *
 * ★ 卵で特に効きます。
 *   Mサイズは殻付きで約58〜64g、殻を除くと可食部は約50gです。
 *   量りに乗せて60gと入れると、2割ぶん多く計算されます。
 *   しかもこの間違いは、画面のどこにも出ません。
 */

/**
 * 数えられる単位（このアプリで扱うぶん）。
 *
 * ★ 「杯」「食」「大さじ」「小さじ」は、あえて外しています。
 *
 *   設計書 §10.5 の表には載っていますが、これらは人によって量が違います。
 *   「1杯」が誰の茶碗なのか、こちらには決めようがありません。
 *   正確そうに見えて実は目分量、というのが一番たちの悪い数字です。
 *   分からないものは、分からないまま g で入れてもらいます。
 */
export const COUNTABLE_UNITS = ['個', '枚', '本', 'パック'] as const;

export type CountableUnit = (typeof COUNTABLE_UNITS)[number];

/** 入力欄で選べる単位。g は常に選べます。 */
export type EntryUnit = 'g' | CountableUnit;

/** 食品マスタが持つ換算1件。「1個 = 50g」 */
export interface UnitConversion {
  unit: CountableUnit;
  grams: number;
}

/**
 * 入力された「2個」そのもの（追加仕様: 単位換算）。
 *
 * ★ 記録に残すのは、あくまで**グラム**です。これは表示のための控えです。
 *   管理者があとで「1個＝50g → 55g」に直しても、過去の記録は動きません。
 *   3月に食べた卵のカロリーが9月に変わるのは、確定した記録として間違いです
 *   （設計書 §47「確定 → 保存」）。
 */
export interface EnteredAmount {
  value: number;
  unit: CountableUnit;
}

/** 1個あたりの重さとして、受け付ける範囲。 */
export const MIN_CONVERSION_GRAMS = 0.1;
export const MAX_CONVERSION_GRAMS = 2000;

export function isCountableUnit(value: unknown): value is CountableUnit {
  return typeof value === 'string' && (COUNTABLE_UNITS as readonly string[]).includes(value);
}

/**
 * 換算1件の検証。問題が無ければ null。
 *
 * 範囲は広めです。目的は打ち間違いに気づいてもらうことであって、
 * 珍しい食品を拒むことではありません（1パック=1000gの米も、1枚=1gの海苔もあります）。
 */
export function validateConversion(grams: number | null): string | null {
  if (grams === null || !Number.isFinite(grams)) {
    return '1つあたりの重さ（g）を入力してください。';
  }
  if (grams < MIN_CONVERSION_GRAMS) {
    return `1つあたりの重さは${MIN_CONVERSION_GRAMS}g以上で入力してください。`;
  }
  if (grams > MAX_CONVERSION_GRAMS) {
    return `1つあたりの重さが大きすぎます（${MAX_CONVERSION_GRAMS}g以内）。`;
  }
  return null;
}

/**
 * 保存・表示のために整える。
 *
 * ★ 同じ単位が2件あったら、**先に書いてあるほうを残します**。
 *   「1個=50g」と「1個=60g」が両方あると、どちらで計算されるか分かりません。
 *   壊れたデータを読んだときに、黙って後ろ勝ちにするのは危険です。
 */
export function normalizeConversions(
  list: readonly UnitConversion[] | undefined,
): UnitConversion[] {
  if (list === undefined) return [];

  const seen = new Set<CountableUnit>();
  const out: UnitConversion[] = [];

  for (const item of list) {
    if (!isCountableUnit(item?.unit)) continue;
    if (seen.has(item.unit)) continue;
    if (validateConversion(item.grams) !== null) continue;
    seen.add(item.unit);
    out.push({ unit: item.unit, grams: item.grams });
  }

  // 画面での並びを、単位の決まった順に揃えます（食品ごとに順が違うと読みにくい）
  return out.sort(
    (a, b) => COUNTABLE_UNITS.indexOf(a.unit) - COUNTABLE_UNITS.indexOf(b.unit),
  );
}

/** その単位の換算を探す。無ければ undefined。 */
export function conversionFor(
  list: readonly UnitConversion[] | undefined,
  unit: CountableUnit,
): UnitConversion | undefined {
  return (list ?? []).find((c) => c.unit === unit);
}

/** その食品で選べる単位。g は必ず入ります。 */
export function entryUnitsFor(list: readonly UnitConversion[] | undefined): EntryUnit[] {
  return ['g', ...normalizeConversions(list).map((c) => c.unit)];
}

/**
 * 入力された量を、グラムに直す。
 *
 * 換算が無い単位を渡されたら null を返します。
 * **0 として計算してはいけません。** 記録が静かに0kcalになります。
 *
 * ★ 小数第1位で丸めます。
 *   0.1g の差は栄養値に出ませんが、丸めておかないと
 *   「2個 = 100.00000000000001g」のような値が保存に残ります。
 */
export function toGrams(
  value: number,
  unit: EntryUnit,
  list: readonly UnitConversion[] | undefined,
): number | null {
  if (!Number.isFinite(value)) return null;
  if (unit === 'g') return value;

  const found = conversionFor(normalizeConversions(list), unit);
  if (found === undefined) return null;

  return Math.round(value * found.grams * 10) / 10;
}

/** 「2個」のような表示。小数は必要なときだけ出します。 */
export function formatAmount(value: number, unit: EntryUnit): string {
  const shown = Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  return `${shown}${unit}`;
}
