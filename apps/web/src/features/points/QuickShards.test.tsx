import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aClient } from '@/test/factories';
import { QuickShards } from './QuickShards';
import type * as PointsRepo from './pointsRepo';

/**
 * その場で増やす・減らす（追加仕様: ログインポイント）。
 *
 * ★ 守りたいのは3つです。
 *
 *   1. **押した瞬間に反映されること**（保存ボタンを挟まない）
 *   2. 減らすときに、いつでも減らせること（時間の制限を持ち込まない）
 *   3. 引ききれなかったら、そう伝えること
 */

const grantPoints = vi.fn();

vi.mock('./pointsRepo', async () => {
  const actual = await vi.importActual<typeof PointsRepo>('./pointsRepo');
  return {
    ...actual,
    grantPoints: (...a: unknown[]): unknown => grantPoints(...a),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

/** 結果を1件返す約束を作る小道具。 */
function resolvesTo(applied: number, points: number) {
  grantPoints.mockResolvedValue([
    { clientId: 'tanaka01', displayName: '田中 花子', applied, points },
  ]);
}

describe('★ その場で動かす', () => {
  it('増やせる', async () => {
    resolvesTo(1, 6);
    const onChanged = vi.fn();
    render(<QuickShards client={aClient({ points: 5 })} onChanged={onChanged} />);

    await userEvent.click(screen.getByRole('button', { name: '増やす' }));

    await waitFor(() => expect(grantPoints).toHaveBeenCalled());
    expect(grantPoints.mock.calls[0]?.[1]).toBe(1);
    expect(onChanged).toHaveBeenCalledWith(6);
  });

  it('★ 減らせる（交換したとき）', async () => {
    resolvesTo(-3, 2);
    render(<QuickShards client={aClient({ points: 5 })} onChanged={() => {}} />);

    const amount = screen.getByRole('spinbutton');
    await userEvent.clear(amount);
    await userEvent.type(amount, '3');
    await userEvent.click(screen.getByRole('button', { name: '減らす' }));

    await waitFor(() => expect(grantPoints).toHaveBeenCalled());
    expect(grantPoints.mock.calls[0]?.[1]).toBe(-3);
  });

  it('★ 減らすのに、日付や時刻の条件は付いていない', async () => {
    // ★ 朝4時の区切りは「契約者がその日ぶんを受け取る」ときだけの話です。
    //   交換はいつ起きるか分からないので、ここに時間の条件を持ち込みません。
    resolvesTo(-1, 4);
    render(<QuickShards client={aClient({ points: 5 })} onChanged={() => {}} />);

    expect(screen.getByRole('button', { name: '減らす' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: '減らす' }));
    await waitFor(() => expect(grantPoints).toHaveBeenCalled());
  });

  it('反映した数と、残りが出る', async () => {
    resolvesTo(-3, 2);
    render(<QuickShards client={aClient({ points: 5 })} onChanged={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: '減らす' }));

    const ok = await screen.findByRole('status');
    expect(ok).toHaveTextContent('−3 かけら');
    expect(ok).toHaveTextContent('2 かけら');
  });

  it('★ 引ききれなかったら、そう伝える', async () => {
    // 3 しか無い人から 5 引こうとした
    resolvesTo(-3, 0);
    render(<QuickShards client={aClient({ points: 3 })} onChanged={() => {}} />);

    const amount = screen.getByRole('spinbutton');
    await userEvent.clear(amount);
    await userEvent.type(amount, '5');
    await userEvent.click(screen.getByRole('button', { name: '減らす' }));

    const ok = await screen.findByRole('status');
    expect(ok).toHaveTextContent('残っていたぶんだけ');
  });

  it('ちょうど引ききれたときは、余計なことを言わない', async () => {
    resolvesTo(-3, 0);
    render(<QuickShards client={aClient({ points: 3 })} onChanged={() => {}} />);

    const amount = screen.getByRole('spinbutton');
    await userEvent.clear(amount);
    await userEvent.type(amount, '3');
    await userEvent.click(screen.getByRole('button', { name: '減らす' }));

    const ok = await screen.findByRole('status');
    expect(ok).not.toHaveTextContent('残っていたぶんだけ');
  });
});

describe('★ お知らせ', () => {
  it('減らしたときも、本人にお知らせが届く', async () => {
    // ★ 数字だけ黙って減っているのが、いちばん不安にさせます
    resolvesTo(-3, 2);
    render(<QuickShards client={aClient({ points: 5 })} onChanged={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: '減らす' }));

    await waitFor(() => expect(grantPoints).toHaveBeenCalled());
    const notice = grantPoints.mock.calls[0]?.[2] as { kind: string; title: string };
    expect(notice.kind).toBe('points');
    expect(notice.title).toBe('かけらを引きました');
  });

  it('ひとことが、お知らせに載る', async () => {
    resolvesTo(-3, 2);
    render(<QuickShards client={aClient({ points: 5 })} onChanged={() => {}} />);

    await userEvent.type(screen.getByRole('textbox'), 'プロテインと交換');
    await userEvent.click(screen.getByRole('button', { name: '減らす' }));

    await waitFor(() => expect(grantPoints).toHaveBeenCalled());
    const notice = grantPoints.mock.calls[0]?.[2] as { body: string };
    expect(notice.body).toContain('プロテインと交換');
  });

  it('送ったあと、ひとことは消える（次の人に持ち越さない）', async () => {
    resolvesTo(-1, 4);
    render(<QuickShards client={aClient({ points: 5 })} onChanged={() => {}} />);

    await userEvent.type(screen.getByRole('textbox'), 'タオルと交換');
    await userEvent.click(screen.getByRole('button', { name: '減らす' }));

    await screen.findByRole('status');
    expect(screen.getByRole('textbox')).toHaveValue('');
  });
});

describe('打ち間違い', () => {
  it('0 では押せない', async () => {
    render(<QuickShards client={aClient({ points: 5 })} onChanged={() => {}} />);

    const amount = screen.getByRole('spinbutton');
    await userEvent.clear(amount);
    await userEvent.type(amount, '0');

    expect(screen.getByRole('button', { name: '減らす' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '増やす' })).toBeDisabled();
  });

  it('★ 桁を打ち間違えたら止める', async () => {
    render(<QuickShards client={aClient({ points: 5 })} onChanged={() => {}} />);

    const amount = screen.getByRole('spinbutton');
    await userEvent.clear(amount);
    await userEvent.type(amount, '99999');

    expect(screen.getByRole('button', { name: '増やす' })).toBeDisabled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('よく使う数は、押すだけで入る', async () => {
    render(<QuickShards client={aClient({ points: 5 })} onChanged={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: '3' }));
    expect(screen.getByRole('spinbutton')).toHaveValue(3);
  });
});

describe('うまくいかないとき', () => {
  it('反映できなければ、そう出す', async () => {
    grantPoints.mockRejectedValue(new Error('offline'));
    render(<QuickShards client={aClient({ points: 5 })} onChanged={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: '増やす' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('反映できませんでした');
  });

  it('失敗したら、親には知らせない', async () => {
    // ★ 反映されていないのに残高を書き換えると、画面と中身がずれます
    grantPoints.mockRejectedValue(new Error('offline'));
    const onChanged = vi.fn();
    render(<QuickShards client={aClient({ points: 5 })} onChanged={onChanged} />);

    await userEvent.click(screen.getByRole('button', { name: '増やす' }));

    await screen.findByRole('alert');
    expect(onChanged).not.toHaveBeenCalled();
  });
});
