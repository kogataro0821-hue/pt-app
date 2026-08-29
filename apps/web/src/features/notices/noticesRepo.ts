import { doc, setDoc } from 'firebase/firestore';
import {
  addNotice,
  commentNoticeId,
  mergeNotices,
  rankUpNoticeId,
  unreadCount,
  WELCOME_NOTICE_ID,
  type Notice,
  type Rank,
} from '@pt/core';
import { rankLabel } from '@pt/core';
import { getDb } from '@/lib/firebase';
import type { Client } from '@/features/clients/clientTypes';
import { APP_NOTICES } from './appNotices';

/**
 * お知らせの読み書き（追加仕様: お知らせ欄）。
 *
 * ★ お知らせを作るのは、いつも**管理者側の操作**です。
 *
 *     契約者を作った        → 登録が完了しました
 *     昇格させた            → ランクが上がりました
 *     コメントを保存した    → コメントが届きました
 *
 *   契約者が自分で作ることはありません。
 *   Rules 側でも、契約者は `notices` を書けません
 *   （clients の update で契約者に許した項目に入っていないため）。
 *
 * ★ 既読だけは契約者本人が付けます。
 *   置き場所は `extra.noticeReadAt` です。`extra` は契約者が書ける唯一の自由欄なので、
 *   ここも Rules を書き足さずに済みます。
 */

/** その契約者に見えるお知らせ全部（個人あて＋アプリ同梱） */
export function visibleNotices(client: Client): Notice[] {
  return mergeNotices(client.notices, APP_NOTICES);
}

/** 「いつまで読んだか」（ミリ秒）。一度も読んでいなければ null */
export function noticeReadAt(client: Client): number | null {
  const raw = client.extra.noticeReadAt;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/** ベルに出す未読件数 */
export function unreadNoticeCount(client: Client): number {
  return unreadCount(visibleNotices(client), noticeReadAt(client));
}

/**
 * お知らせを1件足す（管理者の操作から呼ばれます）。
 *
 * ★ 足したあとの一覧を返します。呼んだ側は画面をそれで描き直せます。
 *
 * ★ 配列ごと書き直します（arrayUnion は使いません）。
 *   同じ出来事のお知らせは「増やす」のではなく「置き換える」ためです。
 *   arrayUnion では、1文字違うだけの似たお知らせが2件並んでしまいます。
 */
export async function pushNotice(client: Client, notice: Notice): Promise<Notice[]> {
  const next = addNotice(client.notices, notice);
  await setDoc(
    doc(getDb(), 'clients', client.clientId),
    { notices: next, updatedAt: Date.now() },
    { merge: true },
  );
  return next;
}

/**
 * 「閉じる」= そのときまでのお知らせを読んだことにする。
 *
 * ★ 1件ずつではなく、時刻1つで持ちます。
 *   既読の印がお知らせと同じ数だけ増えるのを避けるためです。
 *   以後に届くお知らせは、また未読になります。
 */
export async function markNoticesRead(client: Client, at: number = Date.now()): Promise<number> {
  await setDoc(
    doc(getDb(), 'clients', client.clientId),
    { extra: { ...client.extra, noticeReadAt: at }, updatedAt: Date.now() },
    { merge: true },
  );
  return at;
}

// -----------------------------------------------------------------------------
// お知らせの文面
// -----------------------------------------------------------------------------

export function welcomeNotice(at: number = Date.now()): Notice {
  return {
    id: WELCOME_NOTICE_ID,
    kind: 'welcome',
    at,
    title: '登録が完了しました',
    body:
      'ようこそ。カレンダーの日付を選ぶと、その日の食事・運動・体重を記録できます。' +
      '続けて記録すると、会員証のランクが上がります。',
    date: null,
  };
}

export function rankUpNotice(rank: Rank, at: number = Date.now()): Notice {
  return {
    id: rankUpNoticeId(rank),
    kind: 'rankUp',
    at,
    title: `${rankLabel(rank)} になりました`,
    body: 'おめでとうございます。会員証のランクが上がりました。',
    date: null,
  };
}

/**
 * トレーナーからコメントが届いた。
 *
 * ★ 目印を日付から作っているので、**同じ日のコメントを何度直しても1件**です。
 *   直すたびに増えると、ベルの数字ばかり大きくなって中身が読まれません。
 */
export function commentNotice(date: string, at: number = Date.now()): Notice {
  return {
    id: commentNoticeId(date),
    kind: 'comment',
    at,
    title: 'トレーナーからコメントが届きました',
    body: `${date} の記録にコメントがあります。`,
    date,
  };
}
