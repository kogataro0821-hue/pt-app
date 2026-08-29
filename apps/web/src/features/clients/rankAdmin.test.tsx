import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aClient } from '@/test/factories';
import { ClientEditScreen } from './ClientEditScreen';

/**
 * 管理者側のランク操作（追加仕様: 会員ランク）。
 *
 * ★ 守りたいのは2つです。
 *
 *   1. **ここから上げられないこと。**
 *      昇格は「条件を満たしたとき」だけです。設定画面から好きなランクに
 *      できてしまうと、条件を決めた意味がありません。
 *
 *   2. **DIAMOND から先は、条件を決めないと上がらないこと。**
 *      目標を渡していないのに上がるのは、おかしいためです。
 */

const getClient = vi.fn();
const setClientRank = vi.fn();
const setRankGoal = vi.fn();

vi.mock('./clientsRepo', async () => {
  const { RANKS, rankOrder } = await import('@pt/core');
  return {
    getClient: (...a: unknown[]): unknown => getClient(...a),
    setClientRank: (...a: unknown[]): unknown => setClientRank(...a),
    setRankGoal: (...a: unknown[]): unknown => setRankGoal(...a),
    updateClient: vi.fn(),
    nextMemberNo: vi.fn(),
    setClientActive: vi.fn(),
    deleteProvisioningClient: vi.fn(),
    ranksBelow: (rank: string): string[] =>
      RANKS.filter((r) => rankOrder(r) < rankOrder(rank as never)),
  };
});

vi.mock('./DangerZone', () => ({ DangerZone: () => null }));

function show(client = aClient({ clientId: 'taro', rank: 'SAPPHIRE' })) {
  getClient.mockResolvedValue(client);
  render(<ClientEditScreen clientId="taro" onBack={vi.fn()} />);
  return screen.findByText('会員ランク');
}

beforeEach(() => {
  getClient.mockReset();
  setClientRank.mockReset();
  setRankGoal.mockReset();
  setClientRank.mockResolvedValue(undefined);
  setRankGoal.mockResolvedValue({});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('★ 設定画面からは、ランクを上げられない', () => {
  it('選べるのは、いまより下のランクだけ', async () => {
    await show(aClient({ rank: 'SAPPHIRE' }));

    const select = screen.getByLabelText(/ランクを下げる/);
    const options = [...select.querySelectorAll('option')].map((o) => o.value);

    expect(options).toContain('PLATINUM');
    expect(options).toContain('RUBY');
    // いまのランクと、それより上は出てこない
    expect(options).not.toContain('SAPPHIRE');
    expect(options).not.toContain('EMERALD');
    expect(options).not.toContain('CROWN');
  });

  it('昇格はここではできない、と画面に書いてある', async () => {
    await show();
    expect(screen.getByText(/ここから上げることはできません/)).toBeInTheDocument();
  });

  it('いちばん下のランクなら、下げる欄そのものが出ない', async () => {
    await show(aClient({ rank: 'PLATINUM' }));
    expect(screen.queryByLabelText(/ランクを下げる/)).not.toBeInTheDocument();
    expect(screen.getByText(/いちばん下のランクなので/)).toBeInTheDocument();
  });

  it('下げるときは、確認してから', async () => {
    await show(aClient({ clientId: 'taro', rank: 'SAPPHIRE' }));

    await userEvent.selectOptions(screen.getByLabelText(/ランクを下げる/), 'RUBY');

    await waitFor(() => {
      expect(setClientRank).toHaveBeenCalledWith('taro', 'RUBY');
    });
    expect(window.confirm).toHaveBeenCalled();
  });

  it('確認で「やめる」を選べば、何も起きない', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await show(aClient({ rank: 'SAPPHIRE' }));

    await userEvent.selectOptions(screen.getByLabelText(/ランクを下げる/), 'RUBY');
    expect(setClientRank).not.toHaveBeenCalled();
  });
});

describe('DIAMOND から先の条件', () => {
  it('3つのランクぶんの欄が出る', async () => {
    await show();
    expect(screen.getByText('DIAMOND')).toBeInTheDocument();
    expect(screen.getByText('CROWN')).toBeInTheDocument();
    expect(screen.getByText('CROWN AMBASSADOR')).toBeInTheDocument();
  });

  it('決めていなければ「未設定」と出る', async () => {
    // ★ 性別の「未設定」も同じ言葉なので、印（badge）だけを数えます
    await show(aClient({ rankGoals: {} }));
    const badges = screen
      .getAllByText('未設定')
      .filter((el) => el.classList.contains('badge'));
    expect(badges).toHaveLength(3);
  });

  it('決めた条件が、そのまま読める形で出る', async () => {
    await show(
      aClient({ rankGoals: { DIAMOND: { target: 'exercise', mode: 'streak', days: 30 } } }),
    );
    expect(screen.getByText('運動を続けて記録した日数 30日')).toBeInTheDocument();
  });

  it('日数を入れないと、保存できない', async () => {
    await show(aClient({ rankGoals: {} }));
    const buttons = screen.getAllByRole('button', { name: 'この条件にする' });
    expect(buttons[0]).toBeDisabled();
  });

  it('選んで日数を入れれば、保存できる', async () => {
    await show(aClient({ clientId: 'taro', rankGoals: {} }));

    const dayInputs = screen.getAllByLabelText('何日');
    await userEvent.type(dayInputs[0] as HTMLElement, '120');
    await userEvent.click(screen.getAllByRole('button', { name: 'この条件にする' })[0] as HTMLElement);

    await waitFor(() => {
      expect(setRankGoal).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'taro' }),
        'DIAMOND',
        { target: 'meal', mode: 'total', days: 120 },
      );
    });
  });

  it('条件を消せる（消すと、そこから先へは上がらなくなる）', async () => {
    await show(
      aClient({ rankGoals: { DIAMOND: { target: 'meal', mode: 'total', days: 120 } } }),
    );

    await userEvent.click(screen.getByRole('button', { name: '条件を消す' }));

    await waitFor(() => {
      expect(setRankGoal).toHaveBeenCalledWith(expect.anything(), 'DIAMOND', null);
    });
  });
});
