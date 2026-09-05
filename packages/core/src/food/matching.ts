/**
 * 食材名の照合（設計書 §13 / §21 / Phase 9）。
 *
 * ★ なぜこれが要るのか
 *
 *   栄養値を全員で統一するために、食品マスタは管理者だけが登録する形にしました。
 *   ところが、名前がぶれると同じ食材の依頼が何件も立ちます。
 *
 *       サラダチキン / サラダ チキン / ｻﾗﾀﾞﾁｷﾝ / さらだちきん
 *       鶏むね肉 / 鶏ムネ肉 / とりむね肉 / 鶏胸肉
 *
 *   これを放置すると、統一のために作った仕組みが逆に分裂を生みます。
 *
 * ★ 目で確かめにくい処理なので、純粋な関数として切り出し、テストで固めています。
 */

/**
 * 照合専用のキーを作る。
 *
 * 表示に使う名前はそのまま保存し、これは「同じものかどうか」の判定にだけ使います。
 *
 *   NFKC で全角・半角を統一   ｻﾗﾀﾞ → サラダ、Ａ → A
 *   空白をすべて除去          サラダ チキン → サラダチキン
 *   カタカナをひらがなへ      サラダチキン → さらだちきん
 *   英字を小文字へ            Chicken → chicken
 *   中黒などの区切りを除去    鶏・むね肉 → 鶏むね肉
 *
 * ★ 長音（ー）と小書き文字（ッャュョ）は残します。
 *   「ラーメン」と「ラメン」、「ホッケ」と「ホケ」を同じ扱いにすると、
 *   別の食材まで巻き込んでしまうためです。
 *
 * ★ この値は、そのまま Firestore のドキュメントIDとしても使います。
 *
 *   食品マスタのIDにも、登録依頼のIDにも、同じキーを使っています。
 *   だから「IDに使えない文字を落とす」処理は、ここに1か所だけ置きます。
 *
 *   以前は使う側でそれぞれ落としていました。すると「1/2カット」のような名前で、
 *   照合キーは `1/2かっと`、依頼のIDは `1_2かっと` と食い違い、
 *   あとから過去の記録を置き換えるときに**黙って取りこぼします**。
 *   気づきにくい壊れ方なので、キーの作り方は1つに統一しました。
 */
export function foodKey(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[\s\u3000]/g, '')
    .replace(/[・･･,、,.．]/g, '')
    // Firestore のドキュメントIDに使えない文字（設計書 §5.2）
    .replace(/[/\\#$[\]?*]/g, '')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    // IDの長さを抑える。ここで切っても照合の精度はまず変わらない
    .slice(0, 100);
}

/** 2つの名前が「同じもの」とみなせるか。 */
export function isSameFoodName(a: string, b: string): boolean {
  const ka = foodKey(a);
  return ka.length > 0 && ka === foodKey(b);
}

// -----------------------------------------------------------------------------
// 似ている名前を探す
// -----------------------------------------------------------------------------

/**
 * 2文字ずつの並び（バイグラム）を取り出す。
 *
 * 「サラダチキン」→ さら / らだ / だち / ちき / きん
 *
 * 日本語は単語の区切りが無いので、単語単位の比較が使えません。
 * 文字の並びの重なりで測るこの方法は、その点で相性が良く、
 * 「サラダチキ」のような打ち間違いも拾えます。
 */
export function bigrams(key: string): string[] {
  if (key.length <= 1) return key.length === 1 ? [key] : [];
  const out: string[] = [];
  for (let i = 0; i < key.length - 1; i += 1) {
    out.push(key.slice(i, i + 2));
  }
  return out;
}

/**
 * 名前の近さ。0（無関係）〜1（同一）。
 *
 * 共通するバイグラムの割合で測ります（Dice係数）。
 */
export function similarity(a: string, b: string): number {
  const ka = foodKey(a);
  const kb = foodKey(b);
  if (ka.length === 0 || kb.length === 0) return 0;
  if (ka === kb) return 1;

  const ga = bigrams(ka);
  const gb = bigrams(kb);
  if (ga.length === 0 || gb.length === 0) return 0;

  // 同じ2文字が複数回出る場合も正しく数える
  const counts = new Map<string, number>();
  for (const g of ga) counts.set(g, (counts.get(g) ?? 0) + 1);

  let shared = 0;
  for (const g of gb) {
    const left = counts.get(g) ?? 0;
    if (left > 0) {
      shared += 1;
      counts.set(g, left - 1);
    }
  }

  return (2 * shared) / (ga.length + gb.length);
}

/**
 * 「似ている」とみなす下限。
 *
 * 0.5 だと別の食材まで拾い、0.8 だと打ち間違いを拾えませんでした。
 * 実際の食材名で試して 0.6 に落ち着いています。
 */
export const SIMILAR_THRESHOLD = 0.6;

/** 照合できる食材が最低限持っている情報。 */
export interface NameableFood {
  id: string;
  name: string;
  /** 別名。管理者が依頼を吸収させるたびに増える */
  aliases: string[];
}

/** その食材が名乗りうる名前をすべて（本名＋別名）。 */
export function allNames(food: NameableFood): string[] {
  return [food.name, ...food.aliases];
}

/**
 * 名前がぴったり一致する食材を探す（別名も見る）。
 *
 * ★ AIが「鶏ムネ肉」と返しても、ここで既存の「鶏むね肉」に当たります。
 *   大半のぶれは、契約者の目に触れる前にここで消えます。
 */
export function findExactFood<T extends NameableFood>(
  foods: readonly T[],
  name: string,
): T | null {
  const key = foodKey(name);
  if (key.length === 0) return null;
  return foods.find((f) => allNames(f).some((n) => foodKey(n) === key)) ?? null;
}

export interface FoodMatch<T> {
  food: T;
  /** 0〜1 */
  score: number;
  /** どの名前に当たったか（別名で当たった場合に見せる） */
  matchedName: string;
}

/**
 * 似ている食材を近い順に返す。
 *
 * 並べ方には理由があります。
 *   1. 完全一致（別名を含む）
 *   2. 前方一致 … 「とり」で「鶏むね肉」より先に「焼きとり」が出ると探しにくい
 *   3. 部分一致
 *   4. 綴りの近さ … 打ち間違いを拾う
 */
export function findSimilarFoods<T extends NameableFood>(
  foods: readonly T[],
  name: string,
  limit = 5,
): FoodMatch<T>[] {
  const key = foodKey(name);
  if (key.length === 0) return [];

  const matches: FoodMatch<T>[] = [];

  for (const food of foods) {
    let best: FoodMatch<T> | null = null;

    for (const candidate of allNames(food)) {
      const ck = foodKey(candidate);
      if (ck.length === 0) continue;

      let score: number;
      if (ck === key) score = 1;
      else if (ck.startsWith(key) || key.startsWith(ck)) score = 0.95;
      else if (ck.includes(key) || key.includes(ck)) score = 0.85;
      else score = similarity(key, ck);

      if (best === null || score > best.score) {
        best = { food, score, matchedName: candidate };
      }
    }

    if (best !== null && best.score >= SIMILAR_THRESHOLD) {
      matches.push(best);
    }
  }

  return matches
    .sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name))
    .slice(0, limit);
}

/**
 * 別名として足してよいか。
 *
 * すでに同じ意味の名前を持っているなら足しません。
 * 別名が同義語だらけになると、かえって照合が鈍ります。
 */
export function shouldAddAlias(food: NameableFood, name: string): boolean {
  const key = foodKey(name);
  if (key.length === 0) return false;
  return !allNames(food).some((n) => foodKey(n) === key);
}

/** 表記のゆれ1件と、それが使われた回数 */
export interface VariantCount {
  text: string;
  count: number;
}

/**
 * 表記のゆれの中から、代表として使う1つを選ぶ（Phase 9）。
 *
 * ★ なぜ「最後に書かれたもの」ではいけないのか
 *
 *   最初この判断を持っていませんでした。依頼を積むたびに代表名を
 *   上書きしていたので、「サラダチキン」→「サラダ（全角スペース）チキン」の順に
 *   使われると、**後から来た全角スペース入りのほうが代表**になります。
 *   管理者はそれをそのまま登録してしまい、
 *   全員のマスタに変な表記が残ります（実際に起きました）。
 *
 *   誰が最後に打ったかは、正しさと何の関係もありません。
 *
 * ★ 選び方
 *
 *   1. いちばん多く使われた表記        …… 多数の人が書く形が自然な形
 *   2. 同数なら短いほう                …… 余分な空白や記号が入っていない
 *   3. それでも同じなら文字順          …… 同じ入力なら毎回同じ結果になるように
 *
 *   3を入れているのは、選び方が実行のたびに変わらないようにするためです。
 *   代表名がちらつくと、管理者は何を信じてよいか分からなくなります。
 */
export function preferredVariant(variants: readonly VariantCount[]): string {
  const usable = variants
    .map((v) => ({ text: v.text.trim(), count: v.count }))
    .filter((v) => v.text.length > 0);

  if (usable.length === 0) return '';

  return usable.reduce((best, v) => {
    if (v.count !== best.count) return v.count > best.count ? v : best;
    if (v.text.length !== best.text.length) return v.text.length < best.text.length ? v : best;
    return v.text.localeCompare(best.text) < 0 ? v : best;
  }).text;
}

/**
 * 表記のゆれを、代表を先頭にして重複なく並べる。
 * 管理者の画面で「どれを代表にしたか」が一目で分かるようにするため。
 */
export function orderedVariants(variants: readonly VariantCount[]): string[] {
  const preferred = preferredVariant(variants);
  const out: string[] = preferred.length > 0 ? [preferred] : [];

  for (const v of variants) {
    const t = v.text.trim();
    if (t.length > 0 && !out.includes(t)) out.push(t);
  }
  return out;
}

// -----------------------------------------------------------------------------
// 名前のぶつかり（追加仕様: 名前の重複に印）
// -----------------------------------------------------------------------------

/**
 * 同じ呼び名を持つ食材どうしの、ぶつかり。
 *
 * ★ これは実際に起きて、原因を突き止めるのに何往復もかかりました。
 *
 *   「卵」が2件ありました。片方は F 10.2、もう片方は古い F 1.2 です。
 *   管理者の画面では新しいほうを直していたのに、
 *   契約者の画面には**古いほうの数字が出ていました。**
 *
 *   findExactFood は、当たった中の**先頭を黙って返します。**
 *   どちらが選ばれるかは並び順しだいで、画面には何も出ません。
 *   トレーナーが数字を根拠に指導するアプリで、
 *   「どの数字が使われるか分からない」は、あってはならない状態です。
 *
 * ★ 名前だけでなく、別名も見ます。
 *   「卵」に別名「たまご」を足したあとで、
 *   別の食材が「たまご」という名前で登録されていれば、それもぶつかります。
 *   むしろ本名どうしより気づきにくい形です。
 */
export interface NameConflict<T> {
  /** ぶつかっている相手（自分は入りません） */
  others: T[];
  /** ぶつかっている呼び名。管理者に見せるので、キーではなく実際の表記です */
  names: string[];
}

/**
 * ぶつかっている食材を洗い出す。
 *
 * 返すのは「ぶつかっているものだけ」です。ぶつかっていない食材は入りません。
 * キーは食材のIDなので、画面側は id で引けます。
 *
 * ★ 総当たりにはしません。
 *   呼び名ごとにまとめてから、2件以上ある山だけを拾います。
 *   食材が増えても、かかる時間は件数に比例したままです。
 */
export function findNameConflicts<T extends NameableFood>(
  foods: readonly T[],
): Map<string, NameConflict<T>> {
  /** 照合キー → その呼び名を持つ食材たち（同じ食材は1回だけ） */
  const byKey = new Map<string, { name: string; foods: T[] }>();

  for (const food of foods) {
    // ★ 1つの食材が「卵」と別名「たまご」を持ち、両方が同じキーになることがあります。
    //   自分自身とぶつかった扱いにしないよう、食材ごとに一度だけ数えます。
    const seen = new Set<string>();

    for (const name of allNames(food)) {
      const key = foodKey(name);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);

      const bucket = byKey.get(key);
      if (bucket === undefined) {
        byKey.set(key, { name, foods: [food] });
      } else {
        bucket.foods.push(food);
      }
    }
  }

  const out = new Map<string, NameConflict<T>>();

  for (const { name, foods: sharing } of byKey.values()) {
    if (sharing.length < 2) continue;

    for (const food of sharing) {
      const found = out.get(food.id) ?? { others: [], names: [] };
      for (const other of sharing) {
        if (other.id !== food.id && !found.others.some((o) => o.id === other.id)) {
          found.others.push(other);
        }
      }
      if (!found.names.includes(name)) found.names.push(name);
      out.set(food.id, found);
    }
  }

  return out;
}
