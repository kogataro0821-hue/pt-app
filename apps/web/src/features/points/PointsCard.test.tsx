import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pointDayKey } from '@pt/core';
import { aClient } from '@/test/factories';
import { PointsCard } from './PointsCard';
import type * as PointsRepo from './pointsRepo';

/**
 * ★ 札の中に「QRを読んで交換する」のリンクがあるので、
 *   Router の中で描かないと壊れます。
 */
function inRouter(node: React.ReactNode) {
  return <MemoryRouter>{node}</MemoryRouter>;
}

/**
 * ポイントの札（追加仕様: ログインポイント）。
 *
 * ★ 守りたいのは3つです。
 *
 *   1. 開いたら勝手にたまること（ボタンを押させない）
 *   2. **同じ日に2回投げないこと**
 *   3. 管理者が代理で見ているときは、たまらないこと
 */

const claimDailyPoints = vi.fn();

vi.mock('./pointsRepo', async () => {
  const actual = await vi.importActual<typeof PointsRepo>('./pointsRepo');
  return {
    ...actual,
    claimDailyPoints: (...a: unknown[]): unknown => claimDailyPoints(...a),
  };
});

const TODAY = pointDayKey();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('★ 開いたら、たまる', () => {
  it('まだ受け取っていなければ、受け取りにいく', async () => {
    claimDailyPoints.mockResolvedValue({
      points: 1,
      dailyPoints: 1,
      lastDate: TODAY,
      totalDays: 1,
    });

    render(inRouter(<PointsCard client={aClient({ points: 0 })} isAdmin={false} />));

    await waitFor(() => expect(claimDailyPoints).toHaveBeenCalledTimes(1));
    expect(await screen.findByLabelText('1 かけら')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('きょうのぶん +1');
  });

  it('★ きょうのぶんを受け取ってあれば、投げない', async () => {
    render(
      inRouter(
        <PointsCard
        client={aClient({ points: 5, pointsLastDate: TODAY, pointsTotalDays: 5 })}
        isAdmin={false}
        />,
      ),
    );

    await waitFor(() => expect(screen.getByLabelText('5 かけら')).toBeInTheDocument());
    expect(claimDailyPoints).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('★ 描き直されても、1回しか投げない', async () => {
    // ★ 親が再描画するたびに投げると、同じ日に何度も弾かれ続けます
    claimDailyPoints.mockResolvedValue({
      points: 1,
      dailyPoints: 1,
      lastDate: TODAY,
      totalDays: 1,
    });
    const client = aClient({ points: 0 });

    const { rerender } = render(inRouter(<PointsCard client={client} isAdmin={false} />));
    rerender(inRouter(<PointsCard client={client} isAdmin={false} />));
    rerender(inRouter(<PointsCard client={client} isAdmin={false} />));

    await waitFor(() => expect(claimDailyPoints).toHaveBeenCalledTimes(1));
  });

  it('★ 管理者が代理で見ているときは、たまらない', async () => {
    // ★ トレーナーが様子を見ただけで、その人のポイントが増えては困ります
    render(inRouter(<PointsCard client={aClient({ points: 5 })} isAdmin={true} />));

    await waitFor(() => expect(screen.getByLabelText('5 かけら')).toBeInTheDocument());
    expect(claimDailyPoints).not.toHaveBeenCalled();
    expect(screen.getByText(/トレーナーが見ている/)).toBeInTheDocument();
  });

  it('★ 受け取りに失敗しても、エラーを出さない', async () => {
    // ★ 通信が切れているだけなら、あす開けば受け取れます。
    //   ここで赤いエラーを出しても、本人にできることがありません
    claimDailyPoints.mockRejectedValue(new Error('offline'));

    render(inRouter(<PointsCard client={aClient({ points: 3 })} isAdmin={false} />));

    await waitFor(() => expect(claimDailyPoints).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('3 かけら')).toBeInTheDocument();
  });
});

describe('表示', () => {
  it('1日にたまる額を伝える', async () => {
    render(
      inRouter(
        <PointsCard
        client={aClient({ points: 1, pointsLastDate: TODAY, pointsDailyAmount: 3 })}
        isAdmin={false}
        />,
      ),
    );
    expect(await screen.findByText(/3 つ たまります/)).toBeInTheDocument();
    expect(screen.getByText(/朝4時/)).toBeInTheDocument();
  });

  it('これまでの日数を出す', async () => {
    render(
      inRouter(
        <PointsCard
        client={aClient({ points: 12, pointsLastDate: TODAY, pointsTotalDays: 12 })}
        isAdmin={false}
        />,
      ),
    );
    expect(await screen.findByText('これまで 12 日')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'これまでの記録' })).toBeInTheDocument();
  });

  it('まだ0日なら、日数は出さない', async () => {
    render(
      inRouter(
        <PointsCard
        client={aClient({ points: 0, pointsLastDate: TODAY, pointsTotalDays: 0 })}
        isAdmin={false}
        />,
      ),
    );
    await waitFor(() => expect(screen.getByLabelText('0 かけら')).toBeInTheDocument());
    // ★ 「これまでの記録」のリンクは常に出るので、日数の行だけを見ます
    expect(screen.queryByText(/これまで \d+ 日/)).not.toBeInTheDocument();
  });

  it('桁区切りが入る', async () => {
    render(
      inRouter(
        <PointsCard
        client={aClient({ points: 12345, pointsLastDate: TODAY })}
        isAdmin={false}
        />,
      ),
    );
    expect(await screen.findByLabelText('12,345 かけら')).toBeInTheDocument();
  });
});

/**
 * ★ その日ぶんの演出（追加仕様: 導入の演出）。
 *
 * ★ 出るのは1日1回だけです。かけらは1日1つしかたまらないので、
 *   「受け取れた瞬間」に出すだけで自然にそうなります。
 */
describe('★ その日ぶんの演出', () => {
  it('受け取れたら、演出が出る', async () => {
    claimDailyPoints.mockResolvedValue({
      points: 1,
      dailyPoints: 1,
      lastDate: TODAY,
      totalDays: 1,
    });
    render(inRouter(<PointsCard client={aClient({ points: 0 })} isAdmin={false} />));

    expect(await screen.findByText(/どこでも触ると閉じます/)).toBeInTheDocument();
  });

  it('★ すでに受け取ってあれば、演出は出ない', async () => {
    // ★ 1日に何度も開くアプリです。毎回出たら3日で嫌われます
    render(
      inRouter(
        <PointsCard
          client={aClient({ points: 5, pointsLastDate: TODAY, pointsTotalDays: 5 })}
          isAdmin={false}
        />,
      ),
    );

    await waitFor(() => expect(screen.getByLabelText('5 かけら')).toBeInTheDocument());
    expect(screen.queryByText(/どこでも触ると閉じます/)).not.toBeInTheDocument();
  });

  it('★ 管理者が代理で見ているときは、演出は出ない', async () => {
    render(inRouter(<PointsCard client={aClient({ points: 5 })} isAdmin={true} />));

    await waitFor(() => expect(screen.getByLabelText('5 かけら')).toBeInTheDocument());
    expect(screen.queryByText(/どこでも触ると閉じます/)).not.toBeInTheDocument();
  });

  it('★ 動きを減らす設定の端末では、演出を出さない', async () => {
    // ★ 画面いっぱいに動くものが出るのは、人によっては具合が悪くなります。
    //   受け取れた事実は札の数字に出ているので、無くても困りません
    const original = window.matchMedia;
    window.matchMedia = ((q: string) =>
      ({
        matches: q.includes('prefers-reduced-motion'),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;

    claimDailyPoints.mockResolvedValue({
      points: 1,
      dailyPoints: 1,
      lastDate: TODAY,
      totalDays: 1,
    });

    try {
      render(inRouter(<PointsCard client={aClient({ points: 0 })} isAdmin={false} />));
      await waitFor(() => expect(claimDailyPoints).toHaveBeenCalled());
      // 札の数字は出るが、全面の演出は出ない
      expect(await screen.findByLabelText('1 かけら')).toBeInTheDocument();
      expect(screen.queryByText(/どこでも触ると閉じます/)).not.toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });
});
