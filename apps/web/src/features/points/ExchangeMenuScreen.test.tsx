import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firstCall } from '@/test/helpers';
import { ExchangeMenuScreen } from './ExchangeMenuScreen';
import type * as Repo from './exchangeMenuRepo';

/**
 * 交換メニューを登録する画面（追加仕様: 交換メニュー）。
 *
 * ★ 守りたいのは3つです。
 *
 *   1. 何件でも足せること
 *   2. **同じ中身を二重に登録させないこと**（品書きに同じ行が2つ並ぶと、
 *      どちらが正しいのか分かりません）
 *   3. 消す前に一度止めること
 */

vi.mock('./exchangeMenuRepo', async () => {
  const actual = await vi.importActual<typeof Repo>('./exchangeMenuRepo');
  return {
    ...actual,
    listExchangeMenu: vi.fn(),
    saveExchangeMenuItem: vi.fn(),
    deleteExchangeMenuItem: vi.fn(),
  };
});

const { listExchangeMenu, saveExchangeMenuItem, deleteExchangeMenuItem } = await import(
  './exchangeMenuRepo'
);

function item(id: string, text: string, amount: number) {
  return { id, text, amount, createdAt: null, updatedAt: null };
}

beforeEach(() => {
  vi.mocked(listExchangeMenu).mockResolvedValue([item('a', 'プロテイン1杯', 3)]);
  vi.mocked(saveExchangeMenuItem).mockResolvedValue(item('b', 'タオル', 10));
  vi.mocked(deleteExchangeMenuItem).mockResolvedValue(undefined);
});

function show() {
  const onBack = vi.fn();
  render(<ExchangeMenuScreen onBack={onBack} />);
  return { onBack };
}

describe('足す', () => {
  it('名前と数を入れて足せる', async () => {
    show();
    await screen.findByText('プロテイン1杯');

    await userEvent.type(screen.getByLabelText('もらえるもの'), 'タオル');
    await userEvent.clear(screen.getByLabelText('必要なかけらの数'));
    await userEvent.type(screen.getByLabelText('必要なかけらの数'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'メニューに足す' }));

    await waitFor(() => expect(saveExchangeMenuItem).toHaveBeenCalled());
    expect(firstCall(vi.mocked(saveExchangeMenuItem))[0]).toEqual({ text: 'タオル', amount: 10 });
  });

  it('名前が空では足せない', async () => {
    show();
    await screen.findByText('プロテイン1杯');

    expect(screen.getByRole('button', { name: 'メニューに足す' })).toBeDisabled();
  });

  it('★ 同じ中身は二重に登録できない', async () => {
    // ★ 品書きに同じ行が2つあると、どちらが正しいのか分かりません
    show();
    await screen.findByText('プロテイン1杯');

    await userEvent.type(screen.getByLabelText('もらえるもの'), 'プロテイン1杯');

    expect(await screen.findByText(/同じ内容がすでに登録されています/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'メニューに足す' })).toBeDisabled();
  });

  it('足したら、入力欄を空に戻す', async () => {
    // ★ 続けて足すことが多いので、打ち直さなくていいようにします
    show();
    await screen.findByText('プロテイン1杯');

    await userEvent.type(screen.getByLabelText('もらえるもの'), 'タオル');
    await userEvent.click(screen.getByRole('button', { name: 'メニューに足す' }));

    await waitFor(() => expect(screen.getByLabelText('もらえるもの')).toHaveValue(''));
  });
});

describe('消す', () => {
  it('★ いきなり消さない', async () => {
    // ★ 押し間違いで品書きが欠けると、契約者には何も見えません
    show();
    await screen.findByText('プロテイン1杯');

    await userEvent.click(screen.getByRole('button', { name: '削除' }));
    expect(deleteExchangeMenuItem).not.toHaveBeenCalled();
    expect(screen.getByText(/品書きから消します/)).toBeInTheDocument();
  });

  it('確かめてから消える', async () => {
    show();
    await screen.findByText('プロテイン1杯');

    await userEvent.click(screen.getByRole('button', { name: '削除' }));
    await userEvent.click(screen.getByRole('button', { name: '消す' }));

    await waitFor(() => expect(deleteExchangeMenuItem).toHaveBeenCalledWith('a'));
  });

  it('やめれば、何も起きない', async () => {
    show();
    await screen.findByText('プロテイン1杯');

    await userEvent.click(screen.getByRole('button', { name: '削除' }));
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }));

    expect(deleteExchangeMenuItem).not.toHaveBeenCalled();
  });

  it('★ 過去の記録は消えないと書いてある', async () => {
    // ★ 「消したら履歴も消えるのでは」と思わせない
    show();
    await screen.findByText('プロテイン1杯');
    await userEvent.click(screen.getByRole('button', { name: '削除' }));

    expect(screen.getByText(/すでに交換したぶんの記録は残ります/)).toBeInTheDocument();
  });
});

describe('画面の説明', () => {
  it('★ QRは作られない、と書いてある', async () => {
    // ★ 「登録したらQRもできる」と思われると、交換の場でQRが無くて困ります
    show();
    expect(await screen.findByText(/QRは作られません/)).toBeInTheDocument();
  });

  it('全員に同じものが出る、と書いてある', async () => {
    show();
    expect(await screen.findByText(/全員に同じものが出ます/)).toBeInTheDocument();
  });
});

describe('読めなかったとき', () => {
  it('画面ごと壊れない', async () => {
    vi.mocked(listExchangeMenu).mockRejectedValue({ code: 'unavailable' });
    show();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('もらえるもの')).toBeInTheDocument();
  });
});
