/**
 * 保存した交換の読み書き（追加仕様: かけらの交換QR）。
 *
 * ★ 管理者だけが読み書きします。
 *   交換の内容と数はQRに入って渡るので、契約者が一覧を読む場面がありません。
 */

import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { sortExchangeItems, toExchangeItem, type ExchangeItem } from '@pt/core';
import { getDb } from '@/lib/firebase';

const COLLECTION = 'exchangeItems';

export async function listExchangeItems(): Promise<ExchangeItem[]> {
  const snap = await getDocs(collection(getDb(), COLLECTION));
  return sortExchangeItems(
    snap.docs.map((d) => toExchangeItem(d.id, d.data() as Record<string, unknown>)),
  );
}

/**
 * 保存する。id を渡せば上書き、渡さなければ新しく作ります。
 *
 * ★ QRの絵そのものは保存しません。内容と数だけです。
 *   絵を保存すると、置き場所（URL）が変わったときに
 *   古いQRが黙って使えなくなります。
 */
export async function saveExchangeItem(item: {
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

export async function deleteExchangeItem(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), COLLECTION, id));
}
