import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExchangeMenuList } from './ExchangeMenuList';
import type * as Repo from './exchangeMenuRepo';

/**
 * 交換メニューを見る画面（追加仕様: 交換メニュー）。
 *
 * ★ 守りたいのは3つです。
 *
 *   1. **ここから交換できないこと**（品書きと、引く操作は別）
 *   2. 届かないものも同じ見た目で並ぶこと
 *   3. 安い順に並ぶこと
 */

vi.mock('./exchangeMenuRepo', async () => {
  const actual = await vi.importActual<typeof Repo>('./exchangeMenuRepo');
  return { ...actual, listExchangeMenu: vi.fn() };
});

const { listExchangeMenu } = await import('./exchangeMenuRepo');

function item(id: string, text: string, amount: number) {
  return { id, text, amount, createdAt: null, updatedAt: null };
}

/** 安い順に並べ替えられて返る（repo がそうしている） */
const MENU = [
  item('a', 'プロテイン1杯', 3),
  item('b', 'タオル', 10),
  item('c', 'パーソナル1回', 30),
];

beforeEach(() => {
  vi.mocked(listExchangeMenu).mockResolvedValue(MENU);
});

describe('出るもの', () => {
  it('品目と、必要な数が並ぶ', async () => {
    render(<ExchangeMenuList points={5} />);

    expect(await screen.findByText('プロテイン1杯')).toBeInTheDocument();
    expect(screen.getByLabelText('3 かけら')).toBeInTheDocument();
    expect(screen.getByText('パーソナル1回')).toBeInTheDocument();
  });

  it('いま持っている数も出る', async () => {
    render(<ExchangeMenuList points={5} />);
    expect(await screen.findByLabelText('5 かけら')).toBeInTheDocument();
  });

  it('★ 届かないものも、同じように並ぶ', async () => {
    // ★ 先に何があるのかが見えることが、この画面の値打ちです。
    //   届かないものこそ見せます
    render(<ExchangeMenuList points={5} />);

    expect(await screen.findByText('タオル')).toBeInTheDocument();
    expect(screen.getByText('パーソナル1回')).toBeInTheDocument();
  });

  it('★ 安い順に並ぶ', async () => {
    render(<ExchangeMenuList points={5} />);
    await screen.findByText('プロテイン1杯');

    const names = screen.getAllByText(/プロテイン1杯|タオル|パーソナル1回/).map((n) => n.textContent);
    expect(names).toEqual(['プロテイン1杯', 'タオル', 'パーソナル1回']);
  });

  it('★ ここからは交換できない', async () => {
    // ★ 押せてしまうと、相手がいないところで引けることになります。
    //   交換は対面でQRを読んで行うものです
    render(<ExchangeMenuList points={100} />);
    await screen.findByText('プロテイン1杯');

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('どうやって交換するのかが書いてある', async () => {
    // ★ 品書きだけ置くと「ここから押すのでは」と探させます
    render(<ExchangeMenuList points={5} />);
    expect(await screen.findByText(/トレーナーが出すQRを/)).toBeInTheDocument();
  });
});

describe('中身が無いとき', () => {
  it('まだ登録されていない、と出る', async () => {
    vi.mocked(listExchangeMenu).mockResolvedValue([]);
    render(<ExchangeMenuList points={5} />);

    expect(await screen.findByText('まだ何も登録されていません。')).toBeInTheDocument();
  });

  it('★ 空のときは、交換のしかたを書かない', async () => {
    // ★ 何も無いのに手順だけ出ると、探すものがあるように見えます
    vi.mocked(listExchangeMenu).mockResolvedValue([]);
    render(<ExchangeMenuList points={5} />);
    await screen.findByText('まだ何も登録されていません。');

    expect(screen.queryByText(/トレーナーが出すQRを/)).not.toBeInTheDocument();
  });
});

describe('読めなかったとき', () => {
  it('★ 画面ごと壊れない', async () => {
    // ★ 品書きが読めないだけで、かけらが使えなくなるわけではありません
    vi.mocked(listExchangeMenu).mockRejectedValue({ code: 'unavailable' });
    render(<ExchangeMenuList points={5} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText('交換メニュー')).toBeInTheDocument();
  });
});

describe('持っている数が分からないとき', () => {
  it('その行は出さない（0と書かない）', async () => {
    // ★ 0 と書くと「0個しかない」と読めます。分からないなら黙ります
    render(<ExchangeMenuList points={null} />);
    await screen.findByText('プロテイン1杯');

    expect(screen.queryByText(/いま .* 持っています/)).not.toBeInTheDocument();
  });
});
