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
 * 最初から用意してある単位（追加仕様: 単位を増やす）。
 *
 * ★ 以前は「杯」を外していました。考えを変えています。
 *
 *   外していた理由は、「1杯」が誰の茶碗か決めようがないからでした。
 *   目分量の数字が正確な顔で残るのが怖かったためです。
 *
 *   ですが、**外しても目分量は無くなりませんでした。** 使う人は
 *   「150g」と当て推量で打つだけで、しかもそちらは目分量だと分かりません。
 *   選べないことが、かえって見えない当て推量を増やしていました。
 *
 *   いまは「1杯」と選べます。そのかわり **その食材の1杯が何gかを
 *   登録していなければ、栄養値を入れません**（下の toGrams が null を返し、
 *   画面は「値なし」として扱います）。
 *   分からないものを分からないまま残すほうが、嘘の数字より安全です。
 *
 * ★ 管理者がここに無い単位を足せます。
 *   足したものは config に入り、全員の入力欄に出ます。
 *   この配列は「最初から入っているもの」であって、全部ではありません。
 */
export const COUNTABLE_UNITS = ['個', '枚', '本', '袋', 'パック', '杯'] as const;

/**
 * 数えられる単位。
 *
 * ★ 決まった何種類か、ではなくなりました。
 *   管理者が足せるので、形としては「短い文字列」です。
 *   受け付けてよい形かどうかは isCountableUnit が見ます。
 */
export type CountableUnit = string;

/** 単位の名前に使ってよい長さ。 */
export const MAX_UNIT_LABEL = 6;

/**
 * 管理者が足せる単位の数。
 *
 * ★ 上限を置くのは、入力欄が選びきれなくなるのを防ぐためです。
 *   30個も並ぶ選択欄から「個」を探すのは、g で打つより面倒です。
 */
export const MAX_CUSTOM_UNITS = 12;

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

/**
 * 単位の名前として受け付けてよいか。
 *
 * ★ 一覧に入っているかどうかでは見ません（管理者が足せるため）。
 *   **形**だけを見ます。長い文章や空白を単位にされると、
 *   入力欄も一覧も崩れます。
 *
 * ★ 'g' は単位の一覧に入れません。
 *   g は常に選べるもので、換算を持たない特別な存在です。
 *   一覧に入れると「1g = ○g」という意味のない換算が作れてしまいます。
 */
export function isCountableUnit(value: unknown): value is CountableUnit {
  if (typeof value !== 'string') return false;
  const t = value.trim();
  if (t.length === 0 || t.length > MAX_UNIT_LABEL) return false;
  if (t === 'g') return false;
  // 空白・改行を含むものは単位ではありません
  return !/[\s\u3000]/.test(t);
}

/**
 * 使える単位の一覧（最初からあるもの＋管理者が足したもの）。
 *
 * ★ 並びは「最初からあるもの」が先です。
 *   よく使うものが上にあるほうが、選ぶ回数が減ります。
 */
export function unitChoices(extra: readonly string[] | undefined): CountableUnit[] {
  const out: CountableUnit[] = [...COUNTABLE_UNITS];
  for (const raw of extra ?? []) {
    if (!isCountableUnit(raw)) continue;
    const t = raw.trim();
    if (!out.includes(t)) out.push(t);
  }
  return out;
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
  return out.sort((a, b) => unitOrder(a.unit) - unitOrder(b.unit));
}

/**
 * 並べるときの順番。
 *
 * ★ 最初からある単位が先、管理者が足した単位は後ろです。
 *   一覧に無い単位（足したもの）を -1 のまま使うと、
 *   **足した単位が先頭に来ます**。並びが食品ごとに変わって読みにくくなります。
 */
function unitOrder(unit: CountableUnit): number {
  const i = (COUNTABLE_UNITS as readonly string[]).indexOf(unit);
  return i < 0 ? COUNTABLE_UNITS.length : i;
}

/** その単位の換算を探す。無ければ undefined。 */
export function conversionFor(
  list: readonly UnitConversion[] | undefined,
  unit: CountableUnit,
): UnitConversion | undefined {
  return (list ?? []).find((c) => c.unit === unit);
}

/**
 * その食品で選べる単位。g は必ず入ります。
 *
 * ★ 以前は「登録済みの換算があるものだけ」でした（追加仕様: 単位を増やす）。
 *
 *   そのせいで、ほとんどの食材で g しか出ず、**壊れているように
 *   見えていました**。使う人は理由が分からないまま、
 *   当て推量のグラム数を打つことになります。
 *
 *   いまは全部出します。換算が無い単位を選んだときは、
 *   グラムに直せないので**栄養値を入れません**（toGrams が null）。
 *   分からないものは、分からないまま残します。
 *
 * ★ 登録済みの単位が先に来ます。
 *   その食材で実際に使える（＝数字が出る）ものを上に置きます。
 */
export function entryUnitsFor(
  list: readonly UnitConversion[] | undefined,
  /** 管理者が足した単位。渡さなければ最初からあるものだけ */
  extra: readonly string[] | undefined = undefined,
): EntryUnit[] {
  const known = normalizeConversions(list).map((c) => c.unit);
  const rest = unitChoices(extra).filter((u) => !known.includes(u));
  return ['g', ...known, ...rest];
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
