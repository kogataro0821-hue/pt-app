import { describe, expect, it } from 'vitest';
import {
  findSameItem,
  isValidExchangeItem,
  MAX_EXCHANGE_ITEMS,
  sortExchangeItems,
  toExchangeItem,
  toRedeemRequest,
  type ExchangeItem,
} from './exchangeItem';

/**
 * 保存した交換（追加仕様: かけらの交換QR）。
 *
 * ★ 守りたいのは2つです。
 *
 *   1. 同じ内容を二重に保存しないこと
 *   2. 交換の場で探しやすい順に並ぶこと
 */

const item = (over: Partial<ExchangeItem> = {}): ExchangeItem => ({
  id: 'i1',
  text: 'プロテイン1杯',
  amount: 3,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...over,
});

describe('★ 並び', () => {
  it('安い順に並ぶ', () => {
    // ★ 交換の場でいちばん多いのは「いま持っているぶんで何ができるか」です
    const items = [
      item({ id: 'a', amount: 10 }),
      item({ id: 'b', amount: 1 }),
      item({ id: 'c', amount: 5 }),
    ];
    expect(sortExchangeItems(items).map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('同じ数なら、あとから作ったほうが先', () => {
    const items = [
      item({ id: 'old', amount: 3, createdAt: 100 }),
      item({ id: 'new', amount: 3, createdAt: 300 }),
    ];
    expect(sortExchangeItems(items).map((i) => i.id)).toEqual(['new', 'old']);
  });

  it('元の配列は変えない', () => {
    const items = [item({ id: 'a', amount: 10 }), item({ id: 'b', amount: 1 })];
    sortExchangeItems(items);
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('★ 二重に保存しない', () => {
  it('同じ内容・同じ数なら、見つかる', () => {
    const items = [item()];
    expect(findSameItem(items, { text: 'プロテイン1杯', amount: 3 })?.id).toBe('i1');
  });

  it('前後の空白は無視して見つける', () => {
    const items = [item()];
    expect(findSameItem(items, { text: '  プロテイン1杯  ', amount: 3 })?.id).toBe('i1');
  });

  it('数が違えば、別のもの', () => {
    const items = [item()];
    expect(findSameItem(items, { text: 'プロテイン1杯', amount: 5 })).toBeUndefined();
  });

  it('内容が違えば、別のもの', () => {
    const items = [item()];
    expect(findSameItem(items, { text: 'タオル', amount: 3 })).toBeUndefined();
  });
});

describe('保存してよい中身か', () => {
  it('ふつうの中身', () => {
    expect(isValidExchangeItem({ text: 'プロテイン', amount: 3 })).toBe(true);
  });

  it('★ 0やマイナスは保存できない', () => {
    expect(isValidExchangeItem({ text: 'x', amount: 0 })).toBe(false);
    expect(isValidExchangeItem({ text: 'x', amount: -3 })).toBe(false);
  });

  it('内容が空なら保存できない', () => {
    expect(isValidExchangeItem({ text: '   ', amount: 3 })).toBe(false);
  });

  it('上限は決めてある', () => {
    expect(MAX_EXCHANGE_ITEMS).toBeGreaterThan(0);
  });
});

describe('保存されたものを読む', () => {
  it('ふつうに読める', () => {
    expect(toExchangeItem('i1', { text: 'プロテイン1杯', amount: 3, createdAt: 1, updatedAt: 1 })).toEqual(
      { id: 'i1', text: 'プロテイン1杯', amount: 3, createdAt: 1, updatedAt: 1 },
    );
  });

  it('★ 壊れた行でも落ちない', () => {
    const e = toExchangeItem('i1', { text: 42, amount: 'たくさん' });
    expect(e.text).toBe('');
    expect(e.amount).toBe(0);
    expect(e.createdAt).toBeNull();
  });

  it('マイナスや大きすぎる数は、範囲に収める', () => {
    expect(toExchangeItem('i1', { amount: -5 }).amount).toBe(0);
    expect(toExchangeItem('i1', { amount: 999999 }).amount).toBe(1000);
  });

  it('交換の中身として取り出せる', () => {
    expect(toRedeemRequest(item())).toEqual({ amount: 3, text: 'プロテイン1杯' });
  });
});
