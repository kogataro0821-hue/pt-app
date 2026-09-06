/**
 * ポイントの読み書き（追加仕様: ログインポイント）。
 *
 * ★ 書き込みは2種類しかありません。
 *
 *   1. 契約者が「今日ぶんを受け取る」（claimDailyPoints）
 *   2. 管理者が「付ける・減らす」（grantPoints）
 *
 *   1 は Rules が形をきっちり見ています。ここで組み立てる中身が
 *   1文字でもずれると弾かれます。だから core の claimDaily が返した
 *   ものを**そのまま**書きます。自分で足し算をしないでください。
 */

import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  addNotice,
  afterRedeem,
  applyGrant,
  sortLedger,
  toLedgerEntry,
  claimDaily,
  pointDayKey,
  readPoints,
  type LedgerEntry,
  type LedgerKind,
  type Notice,
  type PointsState,
} from '@pt/core';
import { getDb } from '@/lib/firebase';
import type { Client } from '@/features/clients/clientTypes';

/**
 * 帳簿に1行足す（追加仕様: かけらの帳簿）。
 *
 * ★ 残高を動かす書き込みと**同じ batch に入れて**ください。
 *
 *   別々に書くと、残高だけ動いて帳簿が空、という行が生まれます。
 *   batch は全部通るか全部通らないかのどちらかなので、ずれません。
 */
function addLedger(
  batch: ReturnType<typeof writeBatch>,
  clientId: string,
  entry: { delta: number; balance: number; text: string; kind: LedgerKind },
): void {
  const ref = doc(collection(getDb(), 'clients', clientId, 'shardLog'));
  batch.set(ref, {
    delta: entry.delta,
    balance: entry.balance,
    text: entry.text.slice(0, 60),
    kind: entry.kind,
    // ★ サーバー時刻。端末の時計で書くと Rules に弾かれます
    at: serverTimestamp(),
  });
}

/** 契約者ドキュメントから、いまのポイントの状態を読む。 */
export function pointsOf(client: Client): PointsState {
  return readPoints(client as unknown as Record<string, unknown>);
}

/**
 * 今日ぶんを受け取る。すでに受け取っていれば null。
 *
 * ★ 書く中身は core が決めます。ここでは足し算をしません。
 *   Rules と core が同じ計算をしていないと、静かに弾かれ続けます。
 */
export async function claimDailyPoints(
  client: Client,
  nowMs: number = Date.now(),
): Promise<PointsState | null> {
  const claim = claimDaily(pointsOf(client), pointDayKey(nowMs));
  if (claim === null) return null;

  await setDoc(
    doc(getDb(), 'clients', client.clientId),
    {
      points: claim.next.points,
      pointsLastDate: claim.next.lastDate,
      pointsTotalDays: claim.next.totalDays,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
  return claim.next;
}

/** 1人ぶんの付与の結果。 */
export interface GrantResult {
  clientId: string;
  displayName: string;
  /** 実際に動いた額。残高が足りなければ、引けたぶんだけ */
  applied: number;
  /** 動いたあとの残高 */
  points: number;
}

/**
 * 管理者がポイントを付ける・減らす。お知らせも一緒に届けます。
 *
 * ★ 1人ずつ書かずに、まとめて書きます（writeBatch）。
 *
 *   全員に配るとき、途中で失敗すると「配られた人と配られていない人」が
 *   混ざります。交換に使う数字でそれが起きると、後から追えません。
 *   まとめて書けば、全部通るか全部通らないかのどちらかになります。
 *
 * ★ 500件までという上限があるので、それを超えるときは分けて書きます。
 *   契約者は1〜10人の想定ですが、上限に当たったときに黙って
 *   切り捨てられるほうが困ります。
 *
 * @param delta   付ける額。マイナスなら減らす。0 なら額は動かさず、お知らせだけ
 * @param notice  届けるお知らせ。null なら何も届けない
 */
export async function grantPoints(
  clients: readonly Client[],
  delta: number,
  notice: Notice | null,
  /** 帳簿に残す理由。空なら「手渡し」「交換」が入ります */
  reason = '',
): Promise<GrantResult[]> {
  const results: GrantResult[] = [];
  const db = getDb();
  const now = Date.now();

  // ★ 1件の書き込みで2つのことをするので、上限は 500 ではなく余裕を見ます
  const CHUNK = 400;

  for (let i = 0; i < clients.length; i += CHUNK) {
    const batch = writeBatch(db);

    for (const client of clients.slice(i, i + CHUNK)) {
      const state = pointsOf(client);
      const { points, applied } = applyGrant(state.points, delta);

      const patch: Record<string, unknown> = { updatedAt: now };
      if (applied !== 0) patch.points = points;
      if (notice !== null) patch.notices = addNotice(client.notices, notice);

      batch.set(doc(db, 'clients', client.clientId), patch, { merge: true });

      // ★ 動いたときだけ帳簿に残します。
      //   0 のとき（お知らせだけ送ったとき）に行を作ると、
      //   帳簿に「0」がずらりと並んで読めなくなります。
      if (applied !== 0) {
        addLedger(batch, client.clientId, {
          delta: applied,
          balance: points,
          text: reason.trim().length > 0 ? reason.trim() : applied > 0 ? '手渡し' : '交換',
          kind: 'grant',
        });
      }

      results.push({
        clientId: client.clientId,
        displayName: client.displayName,
        applied,
        points,
      });
    }

    await batch.commit();
  }

  return results;
}

/** 管理者が「1日のポイント」を変える。 */
export async function setDailyPoints(clientId: string, amount: number): Promise<void> {
  await setDoc(
    doc(getDb(), 'clients', clientId),
    { pointsDailyAmount: amount, updatedAt: Date.now() },
    { merge: true },
  );
}

/**
 * かけらを交換で使う（追加仕様: かけらの交換QR）。
 *
 * ★ 契約者本人が書きます。管理者ではありません。
 *
 *   Rules は「減った数」と「控えに書いた数」が一致することを見ています。
 *   だから、この2つを1回の書き込みでまとめて入れます。
 *   別々に書くと、片方だけ通って残りが弾かれます。
 *
 * ★ 時刻は serverTimestamp() を使います。
 *   端末の時計で書くと Rules に弾かれます（そういう条件にしてあります）。
 *
 * @returns 交換したあとの残高。足りなければ null（何も書きません）
 */
export async function spendShards(
  client: Client,
  amount: number,
  text: string,
): Promise<number | null> {
  const state = pointsOf(client);
  const next = afterRedeem(state.points, amount);
  if (next === null) return null;

  // ★ 残高と帳簿を、1回の batch でまとめて書きます。
  //   別々に書くと、残高だけ減って帳簿に残らない交換が生まれます。
  const batch = writeBatch(getDb());
  batch.set(
    doc(getDb(), 'clients', client.clientId),
    {
      points: next,
      lastRedemption: { at: serverTimestamp(), amount, text },
      updatedAt: Date.now(),
    },
    { merge: true },
  );
  addLedger(batch, client.clientId, {
    delta: -amount,
    balance: next,
    text,
    kind: 'redeem',
  });
  await batch.commit();

  return next;
}

/**
 * 帳簿を読む（追加仕様: かけらの帳簿）。
 *
 * ★ 上限を付けています。何年も使うと行が増え続けるためです。
 *   古いぶんは消しません。読む数を絞るだけです。
 */
export async function listLedger(clientId: string, max = 100): Promise<LedgerEntry[]> {
  const snap = await getDocs(
    query(collection(getDb(), 'clients', clientId, 'shardLog'), orderBy('at', 'desc'), limit(max)),
  );
  return sortLedger(snap.docs.map((d) => toLedgerEntry(d.id, d.data() as Record<string, unknown>)));
}

/**
 * 帳簿を見張る（管理者のQR画面用）。
 *
 * ★ 交換が起きたら、その場で気づける必要があります。
 *   交換の場に立っているので、読み直しを待たせるわけにいきません。
 */
export function watchLedger(
  clientId: string,
  onRows: (rows: LedgerEntry[]) => void,
  max = 20,
): () => void {
  return onSnapshot(
    query(collection(getDb(), 'clients', clientId, 'shardLog'), orderBy('at', 'desc'), limit(max)),
    (snap) => {
      onRows(sortLedger(snap.docs.map((d) => toLedgerEntry(d.id, d.data() as Record<string, unknown>))));
    },
  );
}
