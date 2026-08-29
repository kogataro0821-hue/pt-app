import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aClient } from '@/test/factories';
import { MemberCard } from './MemberCard';

/**
 * 会員証（追加仕様: 会員ランク）。
 *
 * ★ ここで守りたいのは1つです。
 *
 *   **契約者の画面には、ランクを変える手段が1つも無いこと。**
 *
 *   条件を満たしたことは伝えます。でも上げるのはトレーナーです。
 *   契約者が自分でランクを書けるようにすると、アプリを迂回して
 *   いきなり CROWN にできます。Rules 側でも塞いでありますが、
 *   画面側にもボタンを置きません。
 */

const loadRankStats = vi.fn();
const setClientRank = vi.fn();
const updateClient = vi.fn();

vi.mock('./rankRepo', () => ({
  loadRankStats: (...a: unknown[]): unknown => loadRankStats(...a),
  clearRankCache: vi.fn(),
}));

vi.mock('@/features/clients/clientsRepo', () => ({
  setClientRank: (...a: unknown[]): unknown => setClientRank(...a),
  updateClient: (...a: unknown[]): unknown => updateClient(...a),
}));

function stats(over: Partial<{ mealDays: number; exerciseDays: number; longestMealStreak: number }> = {}) {
  return { mealDays: 0, exerciseDays: 0, longestMealStreak: 0, ...over };
}

function show(
  client = aClient({ clientId: 'taro', memberNo: 3, startDate: '2026-04-15' }),
  isAdmin = false,
) {
  render(<MemberCard client={client} isAdmin={isAdmin} />);
}

beforeEach(() => {
  loadRankStats.mockReset();
  setClientRank.mockReset();
  loadRankStats.mockResolvedValue(stats());
  setClientRank.mockResolvedValue(undefined);
  updateClient.mockReset();
  updateClient.mockResolvedValue(undefined);
});

describe('会員証に出るもの', () => {
  it('整理番号は4桁に揃える', async () => {
    show();
    expect(await screen.findByText('No. 0003')).toBeInTheDocument();
  });

  it('会員IDとランクを出す', async () => {
    show(aClient({ clientId: 'taro', rank: 'SAPPHIRE' }));
    expect(await screen.findByText('taro')).toBeInTheDocument();
    expect(screen.getByText('SAPPHIRE')).toBeInTheDocument();
  });

  it('CROWN AMBASSADOR は空白で区切って出す', async () => {
    show(aClient({ rank: 'CROWN_AMBASSADOR' }));
    expect(await screen.findByText('CROWN AMBASSADOR')).toBeInTheDocument();
  });

  it('入会年月と、累計の記録日数を出す', async () => {
    loadRankStats.mockResolvedValue(stats({ mealDays: 87, exerciseDays: 22 }));
    show();
    expect(await screen.findByText(/MEMBER SINCE 2026\.04/)).toBeInTheDocument();
    expect(screen.getByText(/食事 87日 ／ 運動 22日/)).toBeInTheDocument();
  });

  it('整理番号がまだ無ければ、番号の場所を空けておく', async () => {
    show(aClient({ memberNo: null }));
    expect(await screen.findByText('No. ----')).toBeInTheDocument();
  });
});

describe('次のランクまでの進み具合', () => {
  it('次の目標と、あと何日かを出す', async () => {
    loadRankStats.mockResolvedValue(stats({ longestMealStreak: 14 }));
    show();

    expect(await screen.findByText('RUBY')).toBeInTheDocument();
    expect(screen.getByText('食事を続けて記録した日数')).toBeInTheDocument();
    expect(screen.getByText('14 / 21')).toBeInTheDocument();
  });

  it('EMERALD の条件は2つとも出す', async () => {
    loadRankStats.mockResolvedValue(stats({ mealDays: 50, exerciseDays: 20 }));
    show(aClient({ rank: 'SAPPHIRE' }));

    expect(await screen.findByText('50 / 90')).toBeInTheDocument();
    expect(screen.getByText('20 / 24')).toBeInTheDocument();
  });

  it('★ EMERALD より上では、進み具合を出さない（記録では決まらないため）', async () => {
    // 「あと何日で上がる」と誤解させないため
    loadRankStats.mockResolvedValue(stats({ mealDays: 300 }));
    show(aClient({ rank: 'DIAMOND' }));

    expect(await screen.findByText(/ここから先のランクは、トレーナーが決めます/)).toBeInTheDocument();
    expect(screen.queryByText(/\/ 90/)).not.toBeInTheDocument();
  });
});

describe('★ 契約者の画面では、ランクを変えられない', () => {
  const ready = stats({ longestMealStreak: 21 });

  it('条件を満たしても、押せるボタンは出ない', async () => {
    loadRankStats.mockResolvedValue(ready);
    show(aClient({ rank: 'PLATINUM' }), false);

    await screen.findByText(/RUBY の条件を満たしました/);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(setClientRank).not.toHaveBeenCalled();
  });

  it('代わりに「トレーナーの確認をお待ちください」と伝える', async () => {
    loadRankStats.mockResolvedValue(ready);
    show(aClient({ rank: 'PLATINUM' }), false);

    expect(await screen.findByText(/トレーナーの確認をお待ちください/)).toBeInTheDocument();
  });

  it('表示されるランクは、保存されている値のまま（条件を満たしても勝手に上がらない）', async () => {
    loadRankStats.mockResolvedValue(stats({ longestMealStreak: 300, exerciseDays: 300, mealDays: 300 }));
    show(aClient({ rank: 'PLATINUM' }), false);

    await screen.findByText(/条件を満たしました/);
    expect(screen.getByText('PLATINUM')).toBeInTheDocument();
    expect(screen.queryByText('EMERALD')).toBeNull();
  });
});

describe('管理者の画面では、その場で昇格させられる', () => {
  const ready = stats({ longestMealStreak: 21 });

  it('条件を満たすと、昇格のボタンが出る', async () => {
    loadRankStats.mockResolvedValue(ready);
    show(aClient({ rank: 'PLATINUM' }), true);

    expect(await screen.findByRole('button', { name: 'RUBY に昇格させる' })).toBeInTheDocument();
  });

  it('押すと保存され、その場で表示が変わる', async () => {
    loadRankStats.mockResolvedValue(ready);
    show(aClient({ clientId: 'taro', rank: 'PLATINUM' }), true);

    await userEvent.click(await screen.findByRole('button', { name: 'RUBY に昇格させる' }));

    await waitFor(() => {
      expect(setClientRank).toHaveBeenCalledWith('taro', 'RUBY');
    });
    expect(await screen.findByText('RUBY')).toBeInTheDocument();
  });

  it('一気に上がれるときは、上がれるところまでを1回で示す', async () => {
    // ★ 1段ずつ何度も押させる理由がありません
    loadRankStats.mockResolvedValue(
      stats({ longestMealStreak: 21, exerciseDays: 24, mealDays: 90 }),
    );
    show(aClient({ rank: 'PLATINUM' }), true);

    expect(await screen.findByRole('button', { name: 'EMERALD に昇格させる' })).toBeInTheDocument();
  });

  it('条件を満たしていなければ、ボタンは出ない', async () => {
    loadRankStats.mockResolvedValue(stats({ longestMealStreak: 20 }));
    show(aClient({ rank: 'PLATINUM' }), true);

    await screen.findByText('20 / 21');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('保存に失敗したら、そのことを出す', async () => {
    loadRankStats.mockResolvedValue(ready);
    setClientRank.mockRejectedValue(new Error('offline'));
    show(aClient({ rank: 'PLATINUM' }), true);

    await userEvent.click(await screen.findByRole('button', { name: 'RUBY に昇格させる' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ランクを変更できませんでした。');
  });
});

describe('数えられなかったとき', () => {
  it('会員証そのものは出す（ランクと番号は保存された値なので）', async () => {
    loadRankStats.mockRejectedValue(new Error('offline'));
    show(aClient({ rank: 'RUBY', memberNo: 3 }));

    expect(await screen.findByText('RUBY')).toBeInTheDocument();
    expect(screen.getByText('No. 0003')).toBeInTheDocument();
  });
});

describe('★ 昇格の目印（トレーナーが気づけるようにする）', () => {
  const ready = stats({ longestMealStreak: 21 });

  it('契約者の画面で条件を満たすと、目印を書き残す', async () => {
    // ★ これが無いと、トレーナーは一人ひとりのカレンダーを開いて回ることになります
    loadRankStats.mockResolvedValue(ready);
    show(aClient({ clientId: 'taro', rank: 'PLATINUM', extra: {} }), false);

    await waitFor(() => {
      expect(updateClient).toHaveBeenCalledWith('taro', { extra: { rankReady: 'RUBY' } });
    });
  });

  it('すでに同じ目印があれば、書き直さない', async () => {
    loadRankStats.mockResolvedValue(ready);
    show(aClient({ rank: 'PLATINUM', extra: { rankReady: 'RUBY' } }), false);

    await screen.findByText(/条件を満たしました/);
    expect(updateClient).not.toHaveBeenCalled();
  });

  it('条件を満たさなくなったら、目印を消す', async () => {
    loadRankStats.mockResolvedValue(stats({ longestMealStreak: 3 }));
    show(aClient({ clientId: 'taro', rank: 'PLATINUM', extra: { rankReady: 'RUBY' } }), false);

    await waitFor(() => {
      expect(updateClient).toHaveBeenCalledWith('taro', { extra: { rankReady: null } });
    });
  });

  it('管理者の画面では、目印を書かない（本人の画面で数えた結果だけを残す）', async () => {
    loadRankStats.mockResolvedValue(ready);
    show(aClient({ rank: 'PLATINUM', extra: {} }), true);

    await screen.findByRole('button', { name: 'RUBY に昇格させる' });
    expect(updateClient).not.toHaveBeenCalled();
  });

  it('昇格させたら、目印を消す', async () => {
    loadRankStats.mockResolvedValue(ready);
    show(aClient({ clientId: 'taro', rank: 'PLATINUM', extra: { rankReady: 'RUBY' } }), true);

    await userEvent.click(await screen.findByRole('button', { name: 'RUBY に昇格させる' }));

    await waitFor(() => {
      expect(updateClient).toHaveBeenCalledWith('taro', { extra: { rankReady: null } });
    });
  });
});

describe('カードの見た目', () => {
  it('ロゴが入っている', async () => {
    show();
    expect(await screen.findByAltText('たろZAP')).toBeInTheDocument();
  });

  it('★ カードはクレジットカードと同じ比率のまま（中身を詰め込まない）', async () => {
    // ★ 進み具合や累計はカードの外に出しています。
    //   中に入れると、比率が崩れるか、字が読めない大きさになります。
    loadRankStats.mockResolvedValue(stats({ longestMealStreak: 14, mealDays: 20 }));
    show();

    const card = (await screen.findByAltText('たろZAP')).closest('.member-card');
    expect(card).not.toBeNull();
    // カードの中にあるのは、ロゴ・番号・ランク・会員ID・入会年月だけ
    expect(card).toHaveTextContent('No. 0003');
    expect(card).toHaveTextContent('MEMBER SINCE 2026.04');
    expect(card).not.toHaveTextContent('14 / 21');
    expect(card).not.toHaveTextContent('食事 20日');
  });

  it('ランクごとに、カードの見た目が変わる', async () => {
    show(aClient({ rank: 'CROWN_AMBASSADOR' }));
    const card = (await screen.findByAltText('たろZAP')).closest('.member-card');
    expect(card).toHaveClass('rank-crown_ambassador');
  });
});
