import { describe, expect, it } from 'vitest';
import {
  findSameItem,
  isValidExchangeItem,
  MAX_EXCHANGE_ITEMS,
  readExchangeMenu,
  sortExchangeItems,
  toExchangeItem,
  toRedeemRequest,
  writeExchangeMenu,
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

/**
 * 交換メニュー（追加仕様: 交換メニュー）。
 *
 * ★ 1枚の書類にまとめて入っています。
 *   置き場所を config にするためです（すでに「管理者が書けて、
 *   契約者が読める」形になっている場所）。専用の場所を作ると
 *   ルールを足すことになり、Firebase の画面を開く用事が増えます。
 */
describe('★ メニューを読む', () => {
  it('中身を安い順に並べて返す', () => {
    const got = readExchangeMenu({
      items: [
        { id: 'b', text: 'タオル', amount: 10 },
        { id: 'a', text: 'プロテイン1杯', amount: 3 },
      ],
    });
    expect(got.map((i) => i.text)).toEqual(['プロテイン1杯', 'タオル']);
  });

  it('★ まだ何も無くても、落ちない', () => {
    // ★ 置き場所そのものが無い状態から始まります
    expect(readExchangeMenu(undefined)).toEqual([]);
    expect(readExchangeMenu(null)).toEqual([]);
    expect(readExchangeMenu({})).toEqual([]);
  });

  it('★ 1件おかしくても、残りは出す', () => {
    // ★ 1件のせいで品書きが丸ごと出なくなるほうが困ります
    const got = readExchangeMenu({
      items: [
        { id: 'a', text: 'プロテイン1杯', amount: 3 },
        null,
        'こわれている',
        { text: 'IDが無い', amount: 5 },
      ],
    });
    expect(got.map((i) => i.id)).toEqual(['a']);
  });

  it('★ 中身が空のものは出さない', () => {
    // ★ 品書きに「（空）0かけら」と並ぶと、壊れて見えます
    const got = readExchangeMenu({
      items: [
        { id: 'a', text: '', amount: 3 },
        { id: 'b', text: 'タオル', amount: 0 },
        { id: 'c', text: 'プロテイン1杯', amount: 3 },
      ],
    });
    expect(got.map((i) => i.id)).toEqual(['c']);
  });

  it('配列でないものが入っていても、落ちない', () => {
    expect(readExchangeMenu({ items: 'こわれている' })).toEqual([]);
  });
});

describe('メニューを書く', () => {
  const items = [
    { id: 'b', text: 'タオル', amount: 10, createdAt: 2, updatedAt: 2 },
    { id: 'a', text: 'プロテイン1杯', amount: 3, createdAt: 1, updatedAt: 1 },
  ];

  it('安い順で書く（読むときと同じ並び）', () => {
    expect(writeExchangeMenu(items).items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('★ 書いたものを読み戻せる', () => {
    // ★ 書き方と読み方が食い違うと、保存した瞬間に消えます
    const got = readExchangeMenu(writeExchangeMenu(items));
    expect(got.map((i) => i.text)).toEqual(['プロテイン1杯', 'タオル']);
    expect(got.map((i) => i.amount)).toEqual([3, 10]);
  });

  it('日時は書かない（書類ごとに1つ持つので）', () => {
    expect(Object.keys(writeExchangeMenu(items).items[0] ?? {})).toEqual([
      'id',
      'text',
      'amount',
    ]);
  });
});
