/**
 * 交換メニューの読み書き（追加仕様: 交換メニュー）。
 *
 * ★ 「保存した交換QR」とは別の場所に置いています。
 *
 *   形はよく似ています（何かけらで、何がもらえるか）。
 *   それでも一緒にしなかったのは、**見る人が違う**からです。
 *
 *     保存した交換QR … 管理者の道具。よく使うQRを出すための控え
 *     交換メニュー   … 契約者に見せる品書き
 *
 *   一緒にすると、管理者が控えとして保存したものが
 *   **そのまま全員に見えます。** 見せるつもりのないものまで
 *   並ぶ形は、あとから直しようがありません。
 *   同じものを2回登録する手間より、こちらのほうが安全です。
 *
 * ★ 読めるのは全契約者、書けるのは管理者だけです（Rules 側で締めています）。
 *   品書きは全員に共通です。誰が見ても同じものが並びます。
 */

import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { sortExchangeItems, toExchangeItem, type ExchangeItem } from '@pt/core';
import { getDb } from '@/lib/firebase';

const COLLECTION = 'exchangeMenu';

/**
 * メニューを読む。安い順に並べて返します。
 *
 * ★ 並べ替えはこちら側でやります。
 *   Firestore の並べ替えを使うと索引が要ります。件数は多くても数十なので、
 *   読んでから並べるほうが、設定を1つ減らせます。
 */
export async function listExchangeMenu(): Promise<ExchangeItem[]> {
  const snap = await getDocs(collection(getDb(), COLLECTION));
  return sortExchangeItems(
    snap.docs.map((d) => toExchangeItem(d.id, d.data() as Record<string, unknown>)),
  );
}

/** 登録する。id を渡せば上書き、渡さなければ新しく作ります。 */
export async function saveExchangeMenuItem(item: {
  id?: string;
  text: string;
  amount: number;
}): Promise<ExchangeItem> {
  const now = Date.now();
  const ref =
    item.id === undefined
      ? doc(collection(getDb(), COLLECTION))
      : doc(getDb(), COLLECTION, item.id);

  const text = item.text.trim();
  await setDoc(
    ref,
    { text, amount: item.amount, createdAt: now, updatedAt: now },
    { merge: true },
  );

  return { id: ref.id, text, amount: item.amount, createdAt: now, updatedAt: now };
}

export async function deleteExchangeMenuItem(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), COLLECTION, id));
}
