/**
 * 保存した交換（追加仕様: かけらの交換QR）。
 *
 * ★ 同じQRを何度も作り直さないためのものです。
 *
 *   「プロテイン1杯 3かけら」のように、毎回まったく同じ内容を
 *   打ち直すのは無駄です。保存しておけば、開いて選ぶだけで
 *   同じQRが出ます。印刷して貼ったQRとも中身が一致します。
 *
 * ★ QRの絵そのものは保存しません。
 *
 *   保存するのは「内容」と「数」だけです。
 *   QRはそこから毎回その場で描きます。
 *   絵を保存すると、置き場所（URL）が変わったときに
 *   古いQRが黙って使えなくなります。
 */

import { isValidRedeem, MAX_REDEEM, MAX_REDEEM_TEXT, type RedeemRequest } from './redeem';

/** 保存した交換1件。 */
export interface ExchangeItem {
  id: string;
  /** 交換するもの */
  text: string;
  /** 必要なかけらの数 */
  amount: number;
  createdAt: number | null;
  updatedAt: number | null;
}

/** 保存できる件数の上限。 */
export const MAX_EXCHANGE_ITEMS = 50;

/** 保存してよい中身か。 */
export function isValidExchangeItem(item: Pick<ExchangeItem, 'text' | 'amount'>): boolean {
  return isValidRedeem({ amount: item.amount, text: item.text });
}

/** 保存した1件を、交換の中身として取り出す。 */
export function toRedeemRequest(item: ExchangeItem): RedeemRequest {
  return { amount: item.amount, text: item.text };
}

/**
 * 保存されている1件を読む。壊れていても落ちません。
 *
 * ★ 1件おかしいだけで、交換の画面ごと開けなくなるほうが困ります。
 */
export function toExchangeItem(id: string, raw: Record<string, unknown>): ExchangeItem {
  const amount = typeof raw.amount === 'number' && Number.isFinite(raw.amount) ? Math.trunc(raw.amount) : 0;
  return {
    id,
    text: typeof raw.text === 'string' ? raw.text.slice(0, MAX_REDEEM_TEXT) : '',
    amount: Math.min(MAX_REDEEM, Math.max(0, amount)),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : null,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : null,
  };
}

/**
 * 並び順。
 *
 * ★ 安い順にします。
 *
 *   交換の場でいちばん多いのは「いま持っているぶんで何ができるか」です。
 *   新しい順にすると、毎回いちばん上が入れ替わって探しにくくなります。
 *   同じ数なら、あとから作ったほうを先に出します。
 */
export function sortExchangeItems(items: readonly ExchangeItem[]): ExchangeItem[] {
  return [...items].sort((a, b) => {
    if (a.amount !== b.amount) return a.amount - b.amount;
    return (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });
}

/** 同じ内容がすでに保存されていないか。 */
export function findSameItem(
  items: readonly ExchangeItem[],
  item: Pick<ExchangeItem, 'text' | 'amount'>,
): ExchangeItem | undefined {
  const text = item.text.trim();
  return items.find((i) => i.text === text && i.amount === item.amount);
}

// -----------------------------------------------------------------------------
// 交換メニュー（追加仕様: 交換メニュー）
// -----------------------------------------------------------------------------

/**
 * 1枚の書類にまとめて入っているメニューを読む。
 *
 * ★ 1件ずつ別の書類にせず、まとめて1枚に入れています。
 *
 *   置き場所を config（すでに「管理者が書けて、契約者が読める」形に
 *   なっている場所）にするためです。専用の置き場所を作ると
 *   ルールを足すことになり、そのたびに Firebase の画面を開いて
 *   貼り直す必要が出ます。**開かずに済むなら、開かないほうがいい。**
 *
 *   読み取りも1回で済みます（1件ずつだと件数ぶん読みます）。
 *
 * ★ 壊れていても落ちません。
 *
 *   1件おかしいだけで品書きが丸ごと出なくなるほうが困ります。
 *   読めないものは黙って捨てて、読めたものだけ並べます。
 */
export function readExchangeMenu(raw: unknown): ExchangeItem[] {
  const list = (raw as { items?: unknown } | null | undefined)?.items;
  if (!Array.isArray(list)) return [];

  const out: ExchangeItem[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : '';
    if (id.length === 0) continue;

    const item = toExchangeItem(id, row);
    // ★ 中身が空、または0かけらのものは出しません。
    //   品書きに「（空）0かけら」と並ぶと、壊れて見えます。
    if (item.text.length === 0 || item.amount <= 0) continue;
    out.push(item);
  }

  return sortExchangeItems(out);
}

/** 保存する形に直す。読むときと同じ並びで書きます。 */
export function writeExchangeMenu(items: readonly ExchangeItem[]): {
  items: { id: string; text: string; amount: number }[];
} {
  return {
    items: sortExchangeItems([...items]).map((i) => ({
      id: i.id,
      text: i.text,
      amount: i.amount,
    })),
  };
}
