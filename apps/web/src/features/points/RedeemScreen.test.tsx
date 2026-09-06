import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aClient } from '@/test/factories';
import { RedeemScreen } from './RedeemScreen';
import type * as PointsRepo from './pointsRepo';

/**
 * QRを読んで、かけらを使う画面（追加仕様: かけらの交換QR）。
 *
 * ★ 守りたいのは4つです。
 *
 *   1. **押すまでは引かれないこと**（読んだだけで減らない）
 *   2. 足りないときに交換できないこと
 *   3. おかしいQRで交換画面を出さないこと
 *   4. 管理者が代理で開いても、その人のかけらが減らないこと
 */

const spendShards = vi.fn();

vi.mock('./pointsRepo', async () => {
  const actual = await vi.importActual<typeof PointsRepo>('./pointsRepo');
  return {
    ...actual,
    spendShards: (...a: unknown[]): unknown => spendShards(...a),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

function show(opts: { points?: number; query?: string; isAdmin?: boolean } = {}) {
  const { points = 5, query = 'a=3&t=プロテイン', isAdmin = false } = opts;
  render(
    <RedeemScreen
      client={aClient({ points })}
      isAdmin={isAdmin}
      params={new URLSearchParams(query)}
      onDone={() => {}}
    />,
  );
}

describe('★ 押すまでは、引かれない', () => {
  it('読んだだけでは何も起きない', async () => {
    // ★ 間違えて読んでしまった人が取り返せなくなります
    show();
    await screen.findByText('プロテイン');
    expect(spendShards).not.toHaveBeenCalled();
  });

  it('何と、いくつ払うのかが出る', async () => {
    show();
    expect(await screen.findByText('プロテイン')).toBeInTheDocument();
    expect(screen.getAllByLabelText('3 かけら').length).toBeGreaterThan(0);
  });

  it('交換したあとの残りが出る', async () => {
    show({ points: 5 });
    // 5 − 3 = 2
    expect(await screen.findByLabelText('2 かけら')).toBeInTheDocument();
  });

  it('押すと引かれる', async () => {
    spendShards.mockResolvedValue(2);
    show({ points: 5 });

    await userEvent.click(screen.getByRole('button', { name: /払って交換する/ }));

    await waitFor(() => expect(spendShards).toHaveBeenCalled());
    expect(spendShards.mock.calls[0]?.[1]).toBe(3);
    expect(spendShards.mock.calls[0]?.[2]).toBe('プロテイン');
  });

  it('済んだら、残りが出る', async () => {
    spendShards.mockResolvedValue(2);
    show({ points: 5 });
    await userEvent.click(screen.getByRole('button', { name: /払って交換する/ }));

    expect(await screen.findByText('交換しました')).toBeInTheDocument();
  });

  it('★ 済んだ画面を見せれば終わり、とは書かない', async () => {
    // ★ この画面は契約者の端末が出すものなので、証拠になりません。
    //   トレーナー側の画面で確かめてもらう必要があります。
    spendShards.mockResolvedValue(2);
    show({ points: 5 });
    await userEvent.click(screen.getByRole('button', { name: /払って交換する/ }));

    await screen.findByText('交換しました');
    expect(screen.getByText(/トレーナーの画面にも届いています/)).toBeInTheDocument();
  });

  it('取り消せないことを、押す前に伝える', async () => {
    show();
    expect(await screen.findByText(/あとから取り消せません/)).toBeInTheDocument();
  });
});

describe('★ 足りないとき', () => {
  it('押せない', async () => {
    show({ points: 2 });
    expect(screen.getByRole('button', { name: /払って交換する/ })).toBeDisabled();
  });

  it('あといくつ足りないかを出す', async () => {
    show({ points: 2 });
    expect(await screen.findByRole('alert')).toHaveTextContent('1 つ足りません');
  });

  it('ちょうどなら交換できる', async () => {
    show({ points: 3 });
    expect(screen.getByRole('button', { name: /払って交換する/ })).toBeEnabled();
  });
});

describe('★ おかしいQR', () => {
  it('中身が読めなければ、交換画面を出さない', async () => {
    show({ query: 'a=0&t=x' });
    expect(await screen.findByText('交換できません')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /払って交換する/ })).not.toBeInTheDocument();
  });

  it('★ マイナスのQRでも、交換画面を出さない', async () => {
    // ★ 通してしまうと、QRを読むだけでかけらが増えます
    show({ query: 'a=-5&t=x' });
    expect(await screen.findByText('交換できません')).toBeInTheDocument();
  });

  it('からっぽのQR', async () => {
    show({ query: '' });
    expect(await screen.findByText('交換できません')).toBeInTheDocument();
  });
});

describe('★ 管理者が代理で開いたとき', () => {
  it('交換できない', async () => {
    // ★ トレーナーが確認のつもりで開いて、その人のかけらが減っては困ります
    show({ isAdmin: true });
    expect(screen.getByRole('button', { name: /払って交換する/ })).toBeDisabled();
    expect(screen.getByText(/トレーナーとして開いています/)).toBeInTheDocument();
  });
});

describe('うまくいかないとき', () => {
  it('通信に失敗したら、そう出す', async () => {
    spendShards.mockRejectedValue(new Error('offline'));
    show({ points: 5 });
    await userEvent.click(screen.getByRole('button', { name: /払って交換する/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('交換できませんでした');
  });

  it('★ 失敗したら、済んだ画面にはしない', async () => {
    spendShards.mockRejectedValue(new Error('offline'));
    show({ points: 5 });
    await userEvent.click(screen.getByRole('button', { name: /払って交換する/ }));

    await screen.findByRole('alert');
    expect(screen.queryByText('交換しました')).not.toBeInTheDocument();
  });

  it('書く直前に足りなくなっていたら、止まる', async () => {
    // ★ 画面を開いたあと、別の場所で減らされることがあります
    spendShards.mockResolvedValue(null);
    show({ points: 5 });
    await userEvent.click(screen.getByRole('button', { name: /払って交換する/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('足りませんでした');
    expect(screen.queryByText('交換しました')).not.toBeInTheDocument();
  });
});
