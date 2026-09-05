import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import {
  foodKey,
  normalizeConversions,
  shouldAddAlias,
  toInternal,
  type NameableFood,
  type Nutrients,
  type Per100gInput,
  type UnitConversion,
} from '@pt/core';
import { getDb } from '@/lib/firebase';

/**
 * 共通食品マスタ（設計書 §13 / §21 / Phase 9）。
 *
 * ★ 栄養値を決められるのは管理者だけです。
 *
 *   以前は契約者ごとの個人マスタがあり、各自が自由に栄養値を入れられました。
 *   その結果、田中さんの「白米 156kcal」と鈴木さんの「白米 168kcal」が
 *   平気で共存してしまいます。トレーナーが数字を根拠に指導する以上、
 *   これは成り立ちません。
 *
 *   そこで個人マスタを廃止し、`foods` 一本にしました。
 *   契約者が触れるのは「量(g)」だけで、100gあたりの値は管理者の領分です。
 *
 * ★ 別名（aliases）を持たせているのは、名前のぶれで
 *   同じ食材が分裂するのを防ぐためです（matching.ts の説明を参照）。
 */

export interface Food extends NameableFood {
  id: string;
  name: string;
  aliases: string[];
  /** 100gあたり（人間の単位で保存する。コンソールから読めるように） */
  per100g: Per100gInput;
  /**
   * 「1個 = 50g」の換算（追加仕様: 単位換算）。未設定なら空の配列。
   *
   * ★ ここが空でも、契約者はグラムで記録できます。
   *   換算はあくまで「楽になる道」であって、必須ではありません。
   *
   * ★ 「6枚切り」と「8枚切り」は、同じ『枚』で重さが違います（60gと45g）。
   *   1件では表せないので、その場合はマスタを2件に分けてください。
   *   「皮なし」「ゆで」を分けているのと同じやり方です。
   */
  unitConversions: UnitConversion[];
  /** 補足。「皮なし」「ゆで」など、管理者が残すメモ */
  note: string;
  createdAt: number | null;
  updatedAt: number | null;
}

export function foodPer100gInternal(food: Food): Nutrients {
  return toInternal(food.per100g);
}

// -----------------------------------------------------------------------------
// 読み込み
// -----------------------------------------------------------------------------

/**
 * 一度読んだら覚えておきます。
 * 食材を1つ入力するたびに全件読み直していたら、無料枠がすぐ尽きます。
 */
let cache: Food[] | null = null;

/**
 * この一覧を読んだときに見えていた「マスタの最終更新」（追加仕様: マスタ更新の反映）。
 * null は「見に行けなかった」という意味です。0件のときの 0 とは区別します。
 */
let cacheStamp: number | null = null;

/**
 * マスタの「最終更新」を置く場所。中身は updatedAt ひとつだけです。
 *
 * ★ ここが要になった経緯（実際に困った話）。
 *
 *   食品マスタは、アプリを開いた最初の1回だけ読んで、あとは覚えていました。
 *   通信を減らすためです。ところがこれには**出口がありませんでした。**
 *   管理者が食材を登録しても、契約者のアプリには何も伝わりません。
 *   アプリのJavaScriptが動き直すまで、ずっと古いままです。
 *   ホーム画面から開いたアプリは、他のアプリに切り替えて戻っただけでは
 *   動き直しません。**何日も古い一覧のまま使い続けることになります。**
 *
 *   契約者から見ると「登録依頼を出したのに、いつまでも反映されない」です。
 *   単位換算を足したときに、ようやく気づきました。
 *
 * ★ かといって毎回200件を読み直すと、無料枠がすぐ尽きます。
 *   そこで**1件だけ**読んで、変わっていたときだけ全部を読み直します。
 *   ふだんの費用は「読み取り1回」です。
 */
const STAMP_PATH = ['config', 'foods'] as const;

/**
 * 最終更新を読む。読めなければ null。
 *
 * ★ 読めなくても失敗にしません。
 *   ここが読めないだけで食材を1件も出せなくなるのは、明らかにやりすぎです。
 *   その場合は、覚えている一覧をそのまま使います（今までどおりの動きです）。
 */
async function readStamp(): Promise<number | null> {
  try {
    const snap = await getDoc(doc(getDb(), STAMP_PATH[0], STAMP_PATH[1]));
    const value = (snap.data() ?? {}).updatedAt;
    // ★ 置き場所がまだ無いときは 0。「読めなかった」(null) とは別ものです。
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  } catch {
    return null;
  }
}

export async function loadFoods(force = false): Promise<Food[]> {
  if (cache !== null && !force) {
    const stamp = await readStamp();
    // 読めなかった → 覚えているものを使う。変わっていない → そのまま使う。
    if (stamp === null) return cache;
    if (cacheStamp !== null && stamp === cacheStamp) return cache;
  }

  // ★ 一覧より先に最終更新を読みます。
  //   逆にすると、読んでいる最中の更新を取りこぼして、
  //   古い一覧に新しい印を付けてしまいます。
  const stamp = await readStamp();
  const snap = await getDocs(collection(getDb(), 'foods'));
  cache = snap.docs.map((d) => toFood(d.id, d.data()));
  cacheStamp = stamp;
  return cache;
}

export function clearFoodCache(): void {
  cache = null;
  cacheStamp = null;
}

/**
 * 「マスタが変わった」と印を付ける（管理者だけが書けます）。
 *
 * ★ ここが失敗しても、保存は失敗にしません。
 *   食材そのものはもう入っています。ここで失敗を返すと、管理者は
 *   「保存できなかった」と思ってもう一度押します。実際には入っているので、
 *   そちらのほうが混乱します。印が付かなくても、次にアプリを開き直せば
 *   一覧は新しくなります（今までどおりの動きに戻るだけです）。
 */
async function touchStamp(): Promise<void> {
  const now = Date.now();
  try {
    await setDoc(doc(getDb(), STAMP_PATH[0], STAMP_PATH[1]), { updatedAt: now });
    // 自分が付けた印です。自分の一覧まで読み直す必要はありません。
    if (cacheStamp !== null) cacheStamp = now;
  } catch {
    // わざと握りつぶします（上の説明のとおり）
  }
}

/** キャッシュを読み直さずに1件だけ差し替える。 */
function upsertCache(food: Food): void {
  if (cache === null) return;
  cache = [...cache.filter((f) => f.id !== food.id), food];
}

// -----------------------------------------------------------------------------
// 書き込み（管理者のみ。Rules 側でも管理者に限定しています）
// -----------------------------------------------------------------------------

export function newFoodId(name: string): string {
  // ★ 照合キーをそのままIDに使います。
  //   こうすると、同じ食材を二重に作れなくなります（IDが衝突するため）。
  //   IDに使えない文字を落とすのは foodKey の中でやっています。
  const key = foodKey(name);
  return key.length > 0 ? key : `f${Date.now().toString(36)}`;
}

export async function saveFood(food: Food): Promise<Food> {
  const saved: Food = {
    ...food,
    name: food.name.trim(),
    aliases: food.aliases.map((a) => a.trim()).filter((a) => a.length > 0),
    // 順を揃え、壊れた行と重複した単位を落としてから保存します
    unitConversions: normalizeConversions(food.unitConversions),
    updatedAt: Date.now(),
    createdAt: food.createdAt ?? Date.now(),
  };

  await setDoc(doc(getDb(), 'foods', saved.id), {
    name: saved.name,
    aliases: saved.aliases,
    // ★ 照合キーも保存します。将来サーバー側で検索する必要が出たときのためです。
    key: foodKey(saved.name),
    per100g: saved.per100g,
    unitConversions: saved.unitConversions,
    note: saved.note,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
  });

  upsertCache(saved);
  await touchStamp();
  return saved;
}

/** 既存の食材に別名を足す。依頼を「これは◯◯と同じ」で吸収するときに使う。 */
export async function addAlias(food: Food, alias: string): Promise<Food> {
  if (!shouldAddAlias(food, alias)) return food;
  return await saveFood({ ...food, aliases: [...food.aliases, alias.trim()] });
}

export async function deleteFood(foodId: string): Promise<void> {
  await deleteDoc(doc(getDb(), 'foods', foodId));
  if (cache !== null) cache = cache.filter((f) => f.id !== foodId);
  await touchStamp();
}

// -----------------------------------------------------------------------------

export function emptyFood(name = ''): Food {
  return {
    id: newFoodId(name),
    name,
    aliases: [],
    per100g: { kcal: 0, p: 0, f: 0, c: 0 },
    unitConversions: [],
    note: '',
    createdAt: null,
    updatedAt: null,
  };
}

function toFood(id: string, data: Record<string, unknown>): Food {
  const p = (data.per100g ?? {}) as Partial<Per100gInput>;
  return {
    id,
    name: typeof data.name === 'string' ? data.name : '(名称なし)',
    aliases: Array.isArray(data.aliases)
      ? data.aliases.filter((a): a is string => typeof a === 'string')
      : [],
    per100g: { kcal: num(p.kcal), p: num(p.p), f: num(p.f), c: num(p.c) },
    // ★ 換算はあとから足した項目です。無い記録も、壊れた記録も、空として読みます。
    //   1件の変な行のせいで食品マスタ全体が開けなくなるほうが、実害が大きいためです。
    unitConversions: normalizeConversions(
      Array.isArray(data.unitConversions) ? (data.unitConversions as UnitConversion[]) : [],
    ),
    note: typeof data.note === 'string' ? data.note : '',
    createdAt: numOrNull(data.createdAt),
    updatedAt: numOrNull(data.updatedAt),
  };
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 100gあたりの値が入っているか。0 のままの食材は「未設定」とみなす。 */
export function hasNutrition(food: Food): boolean {
  return food.per100g.kcal > 0 || food.per100g.p > 0 || food.per100g.f > 0 || food.per100g.c > 0;
}
