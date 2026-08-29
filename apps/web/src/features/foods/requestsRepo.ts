import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  setDoc,
} from 'firebase/firestore';
import {
  foodKey,
  orderedVariants,
  preferredVariant,
  type DateKey,
  type DecimalNutrients,
} from '@pt/core';
import { getDb } from '@/lib/firebase';

/**
 * 食品の登録依頼（設計書 §21 / Phase 9）。
 *
 * 契約者が使った食材が共通マスタに無いとき、ここに積まれます。
 * 管理者が正しい栄養値を入れて公開すると、以後は全員がその値を使います。
 *
 * ★ ドキュメントIDに照合キーを使っています。
 *
 *   「サラダチキン」「サラダ チキン」「ｻﾗﾀﾞﾁｷﾝ」は同じIDになるので、
 *   **同じ食材の依頼が自動的に1件にまとまります**。
 *   別々に積まれると、管理者の画面が同じ食材で埋まってしまいます。
 *
 * ★ 「誰が使ったか」は下位コレクション from/{clientId} に分けてあります。
 *
 *   ここが今回いちばん考えたところです。
 *   1つのドキュメントに clientIds の配列を持たせると、配列に足すために
 *   **契約者がそのドキュメントを読める必要が出ます**。
 *   読めるということは、他の契約者が何を食べたかを推測できるということです。
 *   契約者Aが契約者Bの情報を見られない、という前提が崩れます。
 *
 *   そこで、契約者は「自分のぶんの1件」だけを書き、他人のぶんは読めない形にしました。
 *   増分は increment / arrayUnion を使うので、書く前に読む必要もありません。
 *   集計するのは管理者だけです。
 *
 * ★ 使った日付も記録します。
 *   あとで「登録できたので過去の記録も置き換えますか」を出すとき、
 *   全員の全日分を調べ直さずに済むようにするためです（無料枠を守る）。
 */

/** 依頼1件（管理者の画面で使う、集計済みの形） */
export interface FoodRequest {
  /** 照合キー。ドキュメントIDと同じ */
  id: string;
  /** 代表の表記。管理者が登録するときの初期値になる */
  name: string;
  /** 実際に使われた表記のゆれ。別名の候補になる */
  variants: string[];
  /** 使った契約者と、その人が使った日 */
  from: RequestEntry[];
  /** 使われた回数の合計 */
  count: number;
  updatedAt: number;
}

export interface RequestEntry {
  clientId: string;
  variant: string;
  count: number;
  dates: DateKey[];
  /** 成分表示から読み取った候補（追加仕様: 成分表示の読み取り）。撮っていなければ null */
  candidate: LabelCandidate | null;
}

/**
 * 成分表示から読み取った100gあたりの候補（設計書 §47 / 追加仕様: 成分表示の読み取り）。
 *
 * ★ これは「候補」であって、確定値ではありません。
 *   契約者が撮って、契約者が画面で確認した値です。
 *   マスタに入れるかどうかを決めるのは管理者のままです。
 *   ここを自動採用にすると、栄養値を管理者だけが決めるという
 *   Phase 9 の前提が崩れます。
 */
export interface LabelCandidate {
  per100g: DecimalNutrients;
  /** 何を基準にどう換算したか。管理者が判断するための手がかり */
  note: string;
  /**
   * 撮った成分表示そのもの（data URL）。無ければ空文字。
   *
   * ★ 数字だけでは、受け取った管理者が確かめられません。
   *   カップ麺のように「1食263kcal」と「参考値めん243kcal」が
   *   並んでいる表示では、どちらを読んだかで2割ずれます。
   *   それを見抜けるのは表示そのものを見たときだけです。
   *
   * ★ 依頼を片付けると、この写真も一緒に消えます。
   *   確かめ終わったら役目が終わるので、溜め込みません（設計書 §8.2）。
   */
  photo: string;
}

function requestsCol() {
  return collection(getDb(), 'foodRequests');
}

/**
 * 依頼のID。
 *
 * ★ 食品マスタのIDと同じ作り方です。
 *   ここを別々にすると、依頼のIDと照合キーが食い違い、
 *   あとから過去の記録を置き換えるときに取りこぼします。
 */
export function requestId(name: string): string {
  return foodKey(name);
}

// -----------------------------------------------------------------------------
// 契約者側（書くだけ。読まない）
// -----------------------------------------------------------------------------

/**
 * 依頼を積む。
 *
 * ★ 失敗しても食事の記録は止めません。
 *   依頼は「管理者に伝える」ための仕組みであって、記録の本体ではないためです。
 *   ここで例外を投げると、食材を1つ追加できないだけで記録全体が止まります。
 *
 * ★ ただし、成功したかどうかは返します。
 *
 *   ここを完全に黙らせていたせいで、
 *   Rules の条件が合わずに依頼がひとつも積まれない状態が続き、
 *   「依頼を出したのに管理者側に出てこない」原因が分かりませんでした。
 *   記録は止めない。でも、伝わっていないことは伝える。
 */
export async function requestFood(
  name: string,
  clientId: string,
  date: DateKey,
  candidate: LabelCandidate | null = null,
): Promise<boolean> {
  const key = requestId(name);
  if (key.length === 0) return false;

  const trimmed = name.trim().slice(0, 60);
  const now = Date.now();

  try {
    const parent = doc(requestsCol(), key);
    // 読まずに書きます。読めてしまうと、他人が何を食べたかが漏れます。
    //
    // ★ ここに名前を書きません。
    //
    //   以前は代表名を親に持たせていました。読まずに書くので毎回上書きになり、
    //   「サラダチキン」のあとに「サラダ（全角スペース）チキン」が来ると、
    //   **後から書いた全角スペース入りのほうが代表**になります。
    //   管理者はそれをそのまま登録し、全員のマスタに変な表記が残りました。
    //
    //   誰が最後に打ったかは正しさと関係がないので、
    //   表記は下の from/{契約者ID} に各自のぶんだけ残し、
    //   代表は読むときに選びます（preferredVariant）。
    await setDoc(parent, { key, updatedAt: now }, { merge: true });
    await setDoc(
      doc(parent, 'from', clientId),
      {
        variant: trimmed,
        count: increment(1),
        dates: arrayUnion(date),
        updatedAt: now,
        // ★ 候補は上書きします。あとから撮り直したほうが新しいためです。
        //   撮っていない回では触りません（merge なので前の候補が残ります）。
        ...(candidate === null
          ? {}
          : {
              candidatePer100g: candidate.per100g,
              candidateNote: candidate.note.slice(0, 200),
              candidatePhoto: candidate.photo,
            }),
      },
      { merge: true },
    );
    return true;
  } catch (e) {
    // ★ 依頼を積めなくても、食事の記録そのものは成立しているので止めません。
    //
    //   ただし黙って消すのはやりすぎでした。
    //   Rules を貼り直し忘れていたとき、依頼が1件も積まれないのに
    //   画面には何も出ず、「依頼は出したのに管理者側に出てこない」という
    //   原因の分からない状態になります。
    //   記録は止めず、原因だけは残します。
    console.warn('[foodRequests] 登録依頼を積めませんでした', e);
    return false;
  }
}

// -----------------------------------------------------------------------------
// 管理者側（読む・消す）
// -----------------------------------------------------------------------------

/**
 * 依頼を一覧する（管理者のみ）。
 *
 * 依頼1件につき下位コレクションを1回読みます。
 * 依頼は数十件を想定しているので、この読み方で足ります。
 */
export async function listRequests(): Promise<FoodRequest[]> {
  const snap = await getDocs(requestsCol());

  const out = await Promise.all(
    snap.docs.map(async (d) => {
      const data = d.data();
      const fromSnap = await getDocs(collection(d.ref, 'from'));
      const from = fromSnap.docs.map((f) => toEntry(f.id, f.data()));

      // 実際に使われた表記から代表を選びます。
      // 移行前のデータには親に name が残っていることがあるので、
      // 表記が1つも取れなかったときだけ、そちらを使います。
      const counts = from.map((e) => ({ text: e.variant, count: e.count }));
      const preferred = preferredVariant(counts);
      const fallback = typeof data.name === 'string' ? data.name : d.id;

      return {
        id: d.id,
        name: preferred.length > 0 ? preferred : fallback,
        variants: preferred.length > 0 ? orderedVariants(counts) : [fallback],
        from,
        count: from.reduce((n, e) => n + e.count, 0),
        updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
      } satisfies FoodRequest;
    }),
  );

  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 処理済みの依頼を消す（管理者のみ）。 */
export async function resolveRequest(request: FoodRequest): Promise<void> {
  // ★ 下位を先に、しかも読み直してから消します。
  //
  //   画面に出したあとで別の契約者が同じ食材を使うと、from が1件増えています。
  //   画面の情報だけを頼りに消すと、その1件が取り残されます。
  //   親を消したあとの取り残しは一覧に出てこないため、
  //   次に同じ食材の依頼が来たときに古い日付が混ざって復活します。
  const parent = doc(requestsCol(), request.id);
  const fromSnap = await getDocs(collection(parent, 'from'));
  for (const entry of fromSnap.docs) {
    await deleteDoc(entry.ref);
  }
  await deleteDoc(parent);
}

// -----------------------------------------------------------------------------

function toEntry(clientId: string, data: Record<string, unknown>): RequestEntry {
  return {
    clientId,
    variant: typeof data.variant === 'string' ? data.variant : '',
    count: typeof data.count === 'number' && Number.isFinite(data.count) ? data.count : 0,
    dates: Array.isArray(data.dates)
      ? data.dates.filter((v): v is DateKey => typeof v === 'string')
      : [],
    candidate: toCandidate(data.candidatePer100g, data.candidateNote, data.candidatePhoto),
  };
}

function toCandidate(raw: unknown, note: unknown, photo: unknown): LabelCandidate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Record<string, unknown>;
  const pick = (k: string): number =>
    typeof d[k] === 'number' && Number.isFinite(d[k]) ? (d[k] as number) : 0;

  // kcalが0の候補は、読み取りに失敗したものとみなして無視します。
  const kcal = pick('kcal');
  if (kcal <= 0) return null;

  return {
    per100g: { kcal, p: pick('p'), f: pick('f'), c: pick('c'), fiber: pick('fiber'), salt: pick('salt') },
    note: typeof note === 'string' ? note : '',
    photo: typeof photo === 'string' ? photo : '',
  };
}

/** 依頼に付いている候補のうち、最初に見つかったもの。 */
export function firstCandidate(request: FoodRequest): LabelCandidate | null {
  for (const entry of request.from) {
    if (entry.candidate !== null) return entry.candidate;
  }
  return null;
}
