import { allNames, foodKey, isSameFoodName, type NameableFood } from './matching';
import { checkPlausibility, type Per100g, type Plausibility } from './plausible';

/**
 * AI が作った登録の下書きを、採用できる形にふるう（追加仕様: 登録依頼のAI）。
 *
 * ★ AI の出力をそのまま画面に流しません。
 *
 *   ここはマスタです。1件の間違いが、全契約者の集計に効きます。
 *   ほかの画面より一段きつく見ます。
 *
 * ★ ふるうのは3つです。
 *
 *   1. 数値   … 辻褄が合わないものに印を付ける（plausible.ts）
 *   2. 同じ食材 … 渡した一覧に無い名前が返ってきたら、捨てる
 *   3. 別名   … すでにある名前・他の食材とぶつかるものを、捨てる
 *
 *   2 と 3 は、AI が実在しないものを返したときに効きます。
 *   「無い食材にまとめる」「他人の食材の名前を別名にする」は、
 *   どちらもマスタを壊します。人の目では気づけません。
 *
 * ★ ここは AI に依存しません。入ってくるのはただの値です。
 *   AI が別のものに変わっても、この関門はそのまま使えます。
 */

/** AI が返してきた下書き（AI に依存しない形で受け取る） */
export interface FoodDraftInput {
  per100g: Per100g | null;
  confidence: number;
  /** どういう食品として答えたか */
  assumed: string;
  aliases: readonly string[];
  /** すでにマスタにある同じ食材の名前。無ければ null */
  sameAs: string | null;
  sameAsReason: string;
}

export interface DroppedAlias {
  name: string;
  reason: string;
}

export interface FoodDraft {
  /** 採用してよい数値。ありえない値なら null */
  per100g: Per100g | null;
  /** 数値の辻褄。per100g が null なら null */
  plausibility: Plausibility | null;
  confidence: number;
  assumed: string;
  /** 使える別名だけ */
  aliases: string[];
  /** 捨てた別名と、その理由。黙って捨てると気づけません */
  droppedAliases: DroppedAlias[];
  /** 一覧の中に実在した食材だけ。無ければ null */
  sameAs: string | null;
  sameAsReason: string;
  /** sameAs を捨てたときの理由。捨てていなければ null */
  sameAsDropped: string | null;
}

/**
 * 別名の上限。
 *
 * ★ 別名は「その言葉でこの食材に当たる」という取り決めです。
 *   多いほど便利に見えますが、1つ間違えると別の食材に当たります。
 *   確かめられる数に絞ります。
 */
export const MAX_SUGGESTED_ALIASES = 5;

export function refineFoodDraft(
  input: FoodDraftInput,
  /** いまマスタにある食材（名前と別名を見ます） */
  master: readonly NameableFood[],
  /** いま登録しようとしている食材の名前 */
  requestedName: string,
): FoodDraft {
  return {
    ...refineNumbers(input),
    ...refineAliases(input, master, requestedName),
    ...refineSameAs(input, master),
    confidence: input.confidence,
    assumed: input.assumed,
    sameAsReason: input.sameAsReason,
  };
}

function refineNumbers(input: FoodDraftInput): Pick<FoodDraft, 'per100g' | 'plausibility'> {
  if (input.per100g === null) return { per100g: null, plausibility: null };

  const plausibility = checkPlausibility(input.per100g);

  // ★ ありえない値は、画面にも出しません。
  //   出すと「まあ近いかも」と採用されます。理由だけを伝えます。
  return {
    per100g: plausibility.level === 'impossible' ? null : input.per100g,
    plausibility,
  };
}

function refineAliases(
  input: FoodDraftInput,
  master: readonly NameableFood[],
  requestedName: string,
): Pick<FoodDraft, 'aliases' | 'droppedAliases'> {
  const aliases: string[] = [];
  const dropped: DroppedAlias[] = [];
  const seen = new Set<string>([foodKey(requestedName)]);

  for (const raw of input.aliases) {
    const name = raw.trim();

    if (name.length === 0) continue;

    if (aliases.length >= MAX_SUGGESTED_ALIASES) {
      dropped.push({ name, reason: `別名は${MAX_SUGGESTED_ALIASES}個までにしています。` });
      continue;
    }

    const key = foodKey(name);
    if (key.length === 0) {
      dropped.push({ name, reason: '別名として使えない文字です。' });
      continue;
    }

    if (seen.has(key)) {
      dropped.push({ name, reason: 'いま登録する名前と同じか、すでに出ています。' });
      continue;
    }

    // ★ 他の食材の名前・別名とぶつかるものは入れられません。
    //   入れると、その言葉がどちらの食材に当たるか決まらなくなります。
    const clash = master.find((f) => allNames(f).some((n) => isSameFoodName(n, name)));
    if (clash !== undefined) {
      dropped.push({ name, reason: `すでに「${clash.name}」が使っています。` });
      continue;
    }

    seen.add(key);
    aliases.push(name);
  }

  return { aliases, droppedAliases: dropped };
}

function refineSameAs(
  input: FoodDraftInput,
  master: readonly NameableFood[],
): Pick<FoodDraft, 'sameAs' | 'sameAsDropped'> {
  if (input.sameAs === null || input.sameAs.trim().length === 0) {
    return { sameAs: null, sameAsDropped: null };
  }

  // ★ 渡した一覧の中に本当にあるかを、こちらで確かめます。
  //   AI が一覧に無い名前を返すことがあります。
  //   そのまままとめると、存在しない食材へ寄せることになります。
  const found = master.find((f) => allNames(f).some((n) => isSameFoodName(n, input.sameAs ?? '')));

  if (found === undefined) {
    return {
      sameAs: null,
      sameAsDropped: `「${input.sameAs}」はマスタにありません。AIの作り話なので、捨てました。`,
    };
  }

  return { sameAs: found.name, sameAsDropped: null };
}
