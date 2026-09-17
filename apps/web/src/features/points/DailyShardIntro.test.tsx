import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyShardIntro } from './DailyShardIntro';

/**
 * その日ぶんの演出（追加仕様: 導入の演出）。
 *
 * ★ 守りたいのは3つです。
 *
 *   1. **どこを触ってもすぐ消えること**（待たせない）
 *   2. 放っておいても消えること
 *   3. 2回閉じても、1回しか伝わらないこと
 */

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

function show(onClose = vi.fn()) {
  render(<DailyShardIntro name="田中 花子" gained={1} total={12} onClose={onClose} />);
  return onClose;
}

describe('出るもの', () => {
  it('あいさつに名前が入る', () => {
    show();
    expect(screen.getByText(/田中 花子さん/)).toBeInTheDocument();
  });

  it('きょうのぶんと、ぜんぶの数が出る', () => {
    show();
    expect(screen.getByText(/きょうのぶん \+1/)).toBeInTheDocument();
    expect(screen.getByText(/ぜんぶで 12/)).toBeInTheDocument();
  });

  it('★ 読み上げは、裏の札にまかせている', () => {
    // ★ ここでも伝えると二重に読み上げられます。
    //   同じ役割の要素が2つあると、検査でも取り違えます
    show();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('★ 閉じ方が書いてある', () => {
    // ★ 消し方が分からない画面を全面に出されるのが、いちばん不安です
    show();
    expect(screen.getByText(/どこでも触ると閉じます/)).toBeInTheDocument();
  });

  it('名前が空でも、あいさつだけ出る', () => {
    render(<DailyShardIntro name="" gained={1} total={1} onClose={() => {}} />);
    expect(screen.getByText(/^(おはようございます|こんにちは|こんばんは)$/)).toBeInTheDocument();
  });
});

describe('★ 閉じる', () => {
  it('触るとすぐ消える', async () => {
    const onClose = show();
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('★ 放っておいても消える', async () => {
    // ★ 触り方が分からない人を、画面に閉じ込めないためです
    const onClose = show();
    expect(onClose).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3200);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('キーボードでも消える', async () => {
    const onClose = show();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('★ 連打しても、閉じるのは1回だけ', async () => {
    // ★ 2回伝わると、親が2回消そうとして不安定になります
    const onClose = show();
    const box = screen.getByRole('button', { name: '閉じる' });

    await userEvent.click(box);
    await userEvent.click(box);
    await userEvent.click(box);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('★ 触って消したあと、時間切れで2回目が来ない', async () => {
    const onClose = show();
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    vi.advanceTimersByTime(5000);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
