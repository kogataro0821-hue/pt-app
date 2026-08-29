import { collection, getCountFromServer } from 'firebase/firestore';
import { getDb } from '@/lib/firebase';

/**
 * 未処理の登録依頼の件数（設計書 §21）。
 *
 * ★ なぜ要るのか。
 *
 *   依頼は、契約者が「マスタに無い食材」を使うたびに静かに積まれます。
 *   トレーナーが「登録依頼」を開かないかぎり、溜まっていることに気づけません。
 *   気づかないあいだ、その食材の栄養値は0のまま集計されます。
 *   **数字を根拠にした指導ができない日が、黙って増えていきます。**
 *
 * ★ なぜ一覧とは別に数えるのか。
 *
 *   一覧（listRequests）は、依頼1件につき下位コレクションを1回ずつ読みます。
 *   バッジのために毎回それをやると、画面を移るだけで無料枠が減ります。
 *   ここでは数だけを問い合わせます（getCountFromServer）。**読み取り1回**で済みます。
 *
 * ★ なぜ覚えておくのか。
 *
 *   バッジは全画面の上に出ます。画面を移るたびに数え直すと、
 *   移動しただけで読み取りが増えます。一度数えたら覚えておき、
 *   数が変わる操作のときだけ合わせます。
 *
 *     ・一覧を読んだ    → 正しい数が分かっているので、そのまま合わせる（追加の読み取り無し）
 *     ・依頼を処理した  → 分からなくなるので、印を消して数え直させる
 *
 * ★ 数えられなかったときは、バッジを出しません。
 *   バッジのために画面を壊さない、という判断です。
 */

/** いまの件数。まだ数えていない・数えられなかったときは null */
let count: number | null = null;

/** 一度でも数えにいったか。失敗したときに、毎回やり直さないための印 */
let tried = false;

/** 数えている最中の処理。同時に何本も飛ばさないため */
let inFlight: Promise<void> | null = null;

const listeners = new Set<() => void>();

/** 件数が変わったら知らせる。React の useSyncExternalStore から使います。 */
export function subscribeRequestCount(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** いまの件数。分からなければ null */
export function requestCountSnapshot(): number | null {
  return count;
}

function publish(next: number | null): void {
  if (count === next) return;
  count = next;
  for (const listener of listeners) listener();
}

/**
 * 分かっている件数を教える。
 *
 * 一覧を読んだ直後に呼びます。**追加の読み取りは起きません。**
 */
export function setRequestCount(next: number): void {
  tried = true;
  publish(next);
}

/**
 * 件数が変わったので、次に必要になったら数え直す。
 *
 * ★ ここで数え直さないのは、消した直後に数えても
 *   一覧の読み直しと重なって、読み取りが二重になるためです。
 */
export function invalidateRequestCount(): void {
  tried = false;
  publish(null);
}

/** ログアウトなどで、覚えていることを捨てる。 */
export function clearRequestCount(): void {
  tried = false;
  inFlight = null;
  publish(null);
}

/**
 * まだ数えていなければ、数える。
 *
 * ★ 管理者だけが呼びます。契約者は `foodRequests` を読めません（Rules）。
 */
export async function ensureRequestCount(): Promise<void> {
  if (count !== null) return;
  if (tried) return;
  if (inFlight !== null) return inFlight;

  inFlight = (async () => {
    try {
      const snap = await getCountFromServer(collection(getDb(), 'foodRequests'));
      publish(snap.data().count);
    } catch {
      // ★ 数えられなくても、画面は今までどおり動きます。バッジが出ないだけです。
      //   通信が切れている・権限が無い、どちらでも同じ扱いにします。
    } finally {
      tried = true;
      inFlight = null;
    }
  })();

  return inFlight;
}
