import { ZERO, toInternal, DEFAULT_TARGETS } from '@pt/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewSection } from './ReviewSection';
import { firstCall } from '@/test/helpers';
import type * as Gemini from '@/features/ai/gemini';
import type * as ReviewRepo from './reviewRepo';

/**
 * AI評価（設計書 §26 / §13 リスク12 / Phase 10）。
 *
 * ★ 安全は2段構えです。
 *
 *   第1層は、AIへの指示文で禁じること。ただしこれは
 *   「守られることを期待している」だけで、確かめてはいません。
 *   第2層が、出てきた文章を**表示する前に機械的に検査**すること。
 *
 *   ここで確かめるのは第2層です。指示文をどう直しても、
 *   まずい文章が画面に出ないことを機械で保証します。
 */

vi.mock('@/features/ai/gemini', async () => {
  const actual = await vi.importActual<typeof Gemini>('@/features/ai/gemini');
  return { ...actual, requestDayReview: vi.fn() };
});

vi.mock('./reviewRepo', async () => {
  const actual = await vi.importActual<typeof ReviewRepo>('./reviewRepo');
  return { ...actual, getReview: vi.fn(), saveReview: vi.fn(), deleteReview: vi.fn() };
});

const { requestDayReview } = await import('@/features/ai/gemini');
const { getReview, saveReview, deleteReview } = await import('./reviewRepo');

const GOOD =
  'たんぱく質は目標130gに対して118gで、あと12gです。夕食に卵を1つ足すと届きます。';

beforeEach(() => {
  vi.mocked(getReview).mockResolvedValue(null);
  vi.mocked(saveReview).mockResolvedValue(undefined);
  vi.mocked(deleteReview).mockResolvedValue(undefined);
  vi.mocked(requestDayReview).mockResolvedValue(GOOD);
});

function setup(over: Partial<Parameters<typeof ReviewSection>[0]> = {}) {
  render(
    <ReviewSection
      clientId="tanaka01"
      date="2026-08-28"
      totals={toInternal({ kcal: 863, p: 62.5, f: 16.5, c: 129.9 })}
      targets={DEFAULT_TARGETS}
      exerciseMinutes={25}
      mealCount={3}
      pendingCount={1}
      reviewMode="standard"
      aiAvailable
      canEdit
      uid="uid-tanaka"
      {...over}
    />,
  );
}

describe('生成', () => {
  it('押したときだけ作る（開いただけでは呼ばない）', async () => {
    setup();
    await screen.findByRole('button', { name: 'AIに評価してもらう' });
    expect(requestDayReview).not.toHaveBeenCalled();
  });

  it('押すと文章が出て、保存される', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'AIに評価してもらう' }));

    expect(await screen.findByText(GOOD)).toBeInTheDocument();
    await waitFor(() => expect(saveReview).toHaveBeenCalledTimes(1));
  });

  it('AIに送るのは数字だけ。名前も契約者IDも体重も送らない', async () => {
    // ★ 設計書 §35。ここが崩れると、AIの提供元に誰の記録かが渡ります。
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'AIに評価してもらう' }));
    await waitFor(() => expect(requestDayReview).toHaveBeenCalledTimes(1));

    const [input] = firstCall(vi.mocked(requestDayReview));
    expect(Object.keys(input).sort()).toEqual(
      ['actual', 'exerciseMinutes', 'mealCount', 'pendingCount', 'reviewMode', 'target'].sort(),
    );
    const asText = JSON.stringify(input);
    expect(asText).not.toContain('tanaka01');
    expect(asText).not.toContain('田中');
  });

  it('数字は人間の単位（kcal・g）に直してから送る', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'AIに評価してもらう' }));
    await waitFor(() => expect(requestDayReview).toHaveBeenCalledTimes(1));

    const [input] = firstCall(vi.mocked(requestDayReview));
    expect(input.actual.kcal).toBe(863);
    expect(input.target.kcal).toBe(1800);
  });
});

describe('第2層の検査', () => {
  it('病名が混ざった文章は、画面に出さない', async () => {
    vi.mocked(requestDayReview).mockResolvedValue(
      'このままでは糖尿病になる恐れがあります。受診してください。',
    );
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'AIに評価してもらう' }));

    expect(await screen.findByText(/医療に関わる内容/)).toBeInTheDocument();
    expect(screen.queryByText(/糖尿病/)).not.toBeInTheDocument();
    expect(saveReview).not.toHaveBeenCalled();
  });

  it('体に負担のかかるやり方をすすめる文章も、出さない', async () => {
    vi.mocked(requestDayReview).mockResolvedValue(
      '明日は断食して、水だけで過ごすとよいでしょう。しっかり体重を落としましょう。',
    );
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'AIに評価してもらう' }));

    expect(await screen.findByText(/体に負担のかかるやり方/)).toBeInTheDocument();
    expect(saveReview).not.toHaveBeenCalled();
  });

  it('ふつうの体調の話は通す（そこまで止めると指導にならない）', async () => {
    const text = '疲れが残っているときは、朝のたんぱく質を少し増やすと立て直しやすくなります。';
    vi.mocked(requestDayReview).mockResolvedValue(text);
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'AIに評価してもらう' }));

    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('AIの呼び出しが失敗しても、画面は壊れない', async () => {
    const { AiError } = await import('@/features/ai/gemini');
    vi.mocked(requestDayReview).mockRejectedValue(new AiError('rate_limited'));
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'AIに評価してもらう' }));

    expect(await screen.findByText(/混み合っています/)).toBeInTheDocument();
  });
});

describe('免責', () => {
  it('評価が無くても、必ず出す', async () => {
    setup();
    expect(await screen.findByText(/医療的な判断ではありません/)).toBeInTheDocument();
  });

  it('評価が出たあとも、消えない', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'AIに評価してもらう' }));
    await screen.findByText(GOOD);
    expect(screen.getByText(/医療的な判断ではありません/)).toBeInTheDocument();
  });
});

describe('出し分け', () => {
  it('AIが使えず、評価も無ければ、欄そのものを出さない', async () => {
    setup({ aiAvailable: false });
    await waitFor(() => {
      expect(screen.queryByText('AIの評価')).not.toBeInTheDocument();
    });
  });

  it('AIが使えなくても、前に作った評価は読める', async () => {
    vi.mocked(getReview).mockResolvedValue({
      text: GOOD,
      mode: 'standard',
      by: 'uid-tanaka',
      createdAt: 1,
    });
    setup({ aiAvailable: false });
    expect(await screen.findByText(GOOD)).toBeInTheDocument();
    // ただし作り直すボタンは出さない
    expect(screen.queryByRole('button', { name: 'もう一度書いてもらう' })).not.toBeInTheDocument();
  });

  it('確定した日（canEdit=false）は、作るボタンを出さない', async () => {
    setup({ canEdit: false });
    await screen.findByText(/医療的な判断ではありません/);
    expect(screen.queryByRole('button', { name: 'AIに評価してもらう' })).not.toBeInTheDocument();
  });

  it('食事が0件の日は、記録が無いことを先に伝える', async () => {
    setup({ mealCount: 0, totals: ZERO });
    expect(await screen.findByText(/まだ食事が記録されていません/)).toBeInTheDocument();
  });
});
