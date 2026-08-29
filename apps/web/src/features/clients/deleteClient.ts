import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDocs,
  type CollectionReference,
  type DocumentReference,
} from 'firebase/firestore';
import { getDb } from '@/lib/firebase';
import type { Client } from './clientTypes';

/**
 * 契約者を、記録ごと完全に削除する（設計書 §6.6 / §46）。
 *
 * ===========================================================================
 *  ★ このファイルは、このアプリでいちばん危ない処理です。
 * ===========================================================================
 *
 * 「ユーザーのデータを消す処理は慎重にする」という方針の、まさにその場所です。
 * 気をつけていることを、先に全部書きます。
 *
 * ★ 1. 取り消せません。
 *
 *   Firestore にごみ箱はありません。消したら戻りません。
 *   だから画面側では、契約者IDを**手で打たせて**から実行します
 *   （押し間違いでは進めない形にします）。
 *
 * ★ 2. 「フォルダごと削除」はできません。
 *
 *   Firestore は、親を消しても下位コレクションが残ります。
 *   `clients/{id}` を消しただけでは、食事も写真も履歴も全部生き残り、
 *   画面から見えなくなるだけです。**いちばんたちの悪い残り方**です。
 *   だから1件ずつ、下から順に消します。
 *
 * ★ 3. 途中で止まっても、やり直せます。
 *
 *   数千件を消す途中で通信が切れることはあります。
 *   この処理は「いま在るものを数えて消す」だけなので、
 *   もう一度実行すれば、残りから続きます（同じものを二度消しても害はありません）。
 *
 * ★ 4. ログインアカウントだけは、ここでは消せません。
 *
 *   他人の Firebase Auth アカウントを消すには管理者用の鍵（Admin SDK）が要ります。
 *   サーバーを持たない構成なので、その鍵を置く場所がありません。
 *   **Firebase の管理画面で、人が手で消す**ことになります。
 *   消すまで `{契約者ID}@pt-app.local` は使われたままなので、
 *   **同じ契約者IDで作り直せません。** 画面でそう伝えます。
 *
 * ★ 5. 順番を「下から」にしています。
 *
 *   親を先に消すと、途中で失敗したときに
 *   「どの契約者のものか分からない孤児」が大量に残ります。
 *   下から消せば、途中で止まっても契約者の枠は残っているので、
 *   同じ画面からやり直せます。
 */

/** その日にぶら下がるもの。日ごとに、この順で消します。 */
const DAY_SUBCOLLECTIONS = ['meals', 'exercises', 'photos', 'notes', 'review'] as const;

/** 契約者の直下にあるもの（日付に紐づかないもの） */
const CLIENT_SUBCOLLECTIONS = [
  'measurements',
  'favorites',
  'recipes',
  // 移行前の、契約者ごとの食品マスタ。いまは使っていませんが、古いデータには残っています
  'foods',
  'audits',
] as const;

/** 消す前に見せる、おおまかな量 */
export interface DeletionEstimate {
  /** 記録のある日数 */
  days: number;
  /** 変更履歴の件数 */
  audits: number;
  /** ログインアカウントが残るか（残るなら、あとで人が消す必要がある） */
  authUid: string | null;
}

/** 進み具合。画面に出して、止まっていないことを伝えます。 */
export interface DeleteProgress {
  /** いま何をしているか（画面にそのまま出す言葉） */
  phase: string;
  /** 済んだ数 */
  done: number;
  /** 全体の数。分からないときは0 */
  total: number;
  /** 消した件数の累計 */
  deleted: number;
}

/**
 * 消す前に、どれくらいあるかを数える。
 *
 * ★ 1件ずつ読むと、1年ぶんで数千回の読み取りになります。
 *   ここでは日数と履歴の件数だけを数えます（各1回の読み取り）。
 *   人が知りたいのは「何日ぶん消えるのか」であって、
 *   ドキュメントの正確な個数ではありません。
 */
export async function estimateDeletion(client: Client): Promise<DeletionEstimate> {
  const db = getDb();
  const base = ['clients', client.clientId] as const;

  const [days, audits] = await Promise.all([
    getCountFromServer(collection(db, ...base, 'days')),
    getCountFromServer(collection(db, ...base, 'audits')),
  ]);

  return {
    days: days.data().count,
    audits: audits.data().count,
    authUid: client.authUid,
  };
}

/**
 * 契約者を、記録ごと完全に削除する。
 *
 * @returns 消した件数と、あとで人が消す必要のあるログインアカウント
 */
export async function deleteClientCompletely(
  client: Client,
  onProgress: (progress: DeleteProgress) => void,
): Promise<{ deleted: number; authUid: string | null }> {
  const db = getDb();
  const cid = client.clientId;
  let deleted = 0;

  const report = (phase: string, done: number, total: number): void => {
    onProgress({ phase, done, total, deleted });
  };

  // --- 1. 毎日の記録（いちばん量が多い）--------------------------------------
  //
  // ★ 日付で絞らずに全部読みます。
  //   `where('date', ...)` で絞ると、date を持たない日（確定だけした日など）が
  //   すり抜けます。すり抜けたぶんは、消したあとも永久に残ります。
  const daysCol = collection(db, 'clients', cid, 'days');
  const daySnap = await getDocs(daysCol);

  let dayIndex = 0;
  for (const day of daySnap.docs) {
    for (const name of DAY_SUBCOLLECTIONS) {
      deleted += await deleteAllIn(collection(day.ref, name));
    }
    await deleteDoc(day.ref);
    deleted += 1;

    dayIndex += 1;
    report('毎日の記録', dayIndex, daySnap.size);
  }

  // --- 2. 日付に紐づかないもの ----------------------------------------------
  let subIndex = 0;
  for (const name of CLIENT_SUBCOLLECTIONS) {
    deleted += await deleteAllIn(collection(db, 'clients', cid, name));
    subIndex += 1;
    report('体のサイズ・お気に入り・レシピ・変更履歴', subIndex, CLIENT_SUBCOLLECTIONS.length);
  }

  // --- 3. AIとのやりとり ----------------------------------------------------
  //
  // ★ 会話の本文（何を食べたかがそのまま入っている）は下位コレクションです。
  //   親だけ消すと、いちばん中身のあるものが残ります。
  const sessions = await getDocs(collection(db, 'clients', cid, 'aiSessions'));
  let sessionIndex = 0;
  for (const session of sessions.docs) {
    deleted += await deleteAllIn(collection(session.ref, 'messages'));
    await deleteDoc(session.ref);
    deleted += 1;

    sessionIndex += 1;
    report('AIとのやりとり', sessionIndex, sessions.size);
  }

  // --- 4. 登録依頼に残っている「この人の分」---------------------------------
  //
  // ★ ここを忘れると、消したはずの人が使った食材の名前と日付が、
  //   管理者の「登録依頼」の画面に残り続けます。
  //
  // ★ 依頼をまたいだ検索（collectionGroup）は Rules で塞いであるので、
  //   依頼を1件ずつ見ていきます。依頼は数十件の想定です。
  const requests = await getDocs(collection(db, 'foodRequests'));
  let requestIndex = 0;
  for (const request of requests.docs) {
    const mine = doc(request.ref, 'from', cid);
    await deleteDoc(mine);

    // その依頼を出した人がもう誰も残っていなければ、依頼そのものも消します。
    // 残すと、中身の無い依頼が一覧に並び続けます。
    const rest = await getDocs(collection(request.ref, 'from'));
    if (rest.empty) {
      await deleteDoc(request.ref);
      deleted += 1;
    }

    requestIndex += 1;
    report('登録依頼', requestIndex, requests.size);
  }

  // --- 5. 権限と、契約者そのもの --------------------------------------------
  //
  // ★ ここでようやく親を消します。
  //   ここまでのどこかで失敗しても、契約者の枠は残っているので、
  //   同じ画面からやり直せます。
  report('権限と契約者', 0, 2);
  if (client.authUid !== null) {
    await deleteDoc(doc(db, 'users', client.authUid));
    deleted += 1;
  }
  await deleteDoc(doc(db, 'clients', cid));
  deleted += 1;
  report('権限と契約者', 2, 2);

  return { deleted, authUid: client.authUid };
}

/**
 * コレクションの中身をすべて消して、消した件数を返す。
 *
 * ★ わざと1件ずつ、順番に消しています。
 *   まとめて並列に投げると速いのですが、途中で失敗したときに
 *   「どこまで進んだか」が分からなくなります。
 *   消す処理では、速さより「途中経過が分かること」を選びます。
 */
async function deleteAllIn(
  col: CollectionReference,
): Promise<number> {
  const snap = await getDocs(col);
  let count = 0;
  for (const found of snap.docs) {
    await deleteDoc(found.ref as DocumentReference);
    count += 1;
  }
  return count;
}
