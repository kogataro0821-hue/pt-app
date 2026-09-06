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
