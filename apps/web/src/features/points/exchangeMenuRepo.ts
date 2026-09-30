/**
 * 交換メニューの読み書き（追加仕様: 交換メニュー）。
 *
 * ★ 置き場所は config です。専用のコレクションを作っていません。
 *
 *   専用の場所を作ると、Firestore のルールを足すことになります。
 *   ルールを足すと、そのたびに Firebase の画面を開いて貼り直す
 *   必要が出ます。**開かずに済むなら、開かないほうがいい。**
 *
 *   config はすでに「管理者が書けて、契約者全員が読める」形に
 *   なっています（食品マスタの更新日時がここにあります）。
 *   同じ形のものが欲しいだけなので、ここに間借りします。
 *
 * ★ ここに置いてよいのは、誰のものでもない情報だけです。
 *
 *   全契約者が同じものを読みます。特定の契約者に関わることを置くと、
 *   契約者Aが契約者Bを知る手がかりになります。
 *   品書き（何かけらで何がもらえるか）は、店頭の貼り紙と同じで
 *   誰が見ても同じであるべきものなので、ここで構いません。
 *
 * ★ 1枚の書類に、全部まとめて入れています。
 *
 *   読み取りは1回で済みます。件数は多くても数十なので、
 *   1枚に収まります。
 *
 *   代わりに、足す・消すは「読んで、直して、書き戻す」形になります。
 *   **2人の管理者が同時に触ると、あとから書いたほうで上書きされます。**
 *   管理者は1人なので、ここは割り切っています。
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  readExchangeMenu,
  writeExchangeMenu,
  type ExchangeItem,
} from '@pt/core';
import { getDb } from '@/lib/firebase';

const PATH = ['config', 'exchangeMenu'] as const;

function menuRef() {
  return doc(getDb(), PATH[0], PATH[1]);
}

/** メニューを読む。安い順に並んで返ります。 */
export async function listExchangeMenu(): Promise<ExchangeItem[]> {
  const snap = await getDoc(menuRef());
  return readExchangeMenu(snap.data());
}

/** 新しい1件のID。書類の中で見分けるためだけに使います。 */
function newMenuId(): string {
  return `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * 1件足す。
 *
 * ★ 足す前に読み直します。
 *   画面が開きっぱなしのあいだに別の端末で増えていることがあります。
 *   画面が覚えている一覧に足して書き戻すと、その増えたぶんが消えます。
 */
export async function saveExchangeMenuItem(item: {
  id?: string;
  text: string;
  amount: number;
}): Promise<ExchangeItem> {
  const now = Date.now();
  const text = item.text.trim();
  const id = item.id ?? newMenuId();

  const current = await listExchangeMenu();
  const next: ExchangeItem[] = [
    ...current.filter((i) => i.id !== id),
    { id, text, amount: item.amount, createdAt: now, updatedAt: now },
  ];

  await setDoc(menuRef(), { ...writeExchangeMenu(next), updatedAt: now }, { merge: true });

  return { id, text, amount: item.amount, createdAt: now, updatedAt: now };
}

/** 1件消す。 */
export async function deleteExchangeMenuItem(id: string): Promise<void> {
  const current = await listExchangeMenu();
  const next = current.filter((i) => i.id !== id);

  await setDoc(
    menuRef(),
    { ...writeExchangeMenu(next), updatedAt: Date.now() },
    { merge: true },
  );
}
