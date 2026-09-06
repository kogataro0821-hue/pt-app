import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aClient } from '@/test/factories';
import { PointsGrantScreen } from './PointsGrantScreen';
import type * as PointsRepo from './pointsRepo';

/**
 * ポイントを配る画面（追加仕様: ログインポイント）。
 *
 * ★ 守りたいのは4つです。
 *
 *   1. 相手を選んでいないのに送れないこと
 *   2. 個人・選択・全員が、ちゃんと相手を絞ること
 *   3. マイナスで減らせること（交換したとき）
 *   4. ポイントを動かしたら、お知らせが必ず一緒に届くこと
 */

const listClients = vi.fn();
const grantPoints = vi.fn();

vi.mock('@/features/clients/clientsRepo', () => ({
  listClients: (...a: unknown[]): unknown => listClients(...a),
}));

vi.mock('./pointsRepo', async () => {
  const actual = await vi.importActual<typeof PointsRepo>('./pointsRepo');
  return {
    ...actual,
    grantPoints: (...a: unknown[]): unknown => grantPoints(...a),
  };
});

const alice = aClient({ clientId: 'alice', displayName: 'アリス', points: 5 });
const bob = aClient({ clientId: 'bob', displayName: 'ボブ', points: 12 });
const carol = aClient({ clientId: 'carol', displayName: 'キャロル', points: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  listClients.mockResolvedValue([alice, bob, carol]);
  grantPoints.mockImplementation((clients: { clientId: string; displayName: string }[]) =>
    Promise.resolve(
      clients.map((c) => ({ clientId: c.clientId, displayName: c.displayName, applied: 1, points: 1 })),
    ),
  );
});

/** 画面を出して、一覧が読み終わるまで待つ。 */
async function open() {
  render(<PointsGrantScreen onBack={() => {}} />);
  await screen.findByText('アリス');
}

describe('★ 相手を選ぶ', () => {
  it('誰も選んでいないうちは、送れない', async () => {
    await open();
    expect(screen.getByRole('button', { name: '送信' })).toBeDisabled();
  });

  it('個人を選ぶと、送れるようになる', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: /アリス/ }));
    expect(screen.getByRole('button', { name: '送信' })).toBeEnabled();
  });

  it('★ 「個人」では、2人目を押すと1人目が外れる', async () => {
    // ★ 個人のつもりで2人に配ってしまうのを防ぎます
    await open();
    await userEvent.click(screen.getByRole('button', { name: /アリス/ }));
    await userEvent.click(screen.getByRole('button', { name: /ボブ/ }));

    await userEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(grantPoints).toHaveBeenCalled());

    const targets = grantPoints.mock.calls[0]?.[0] as { clientId: string }[];
    expect(targets.map((c) => c.clientId)).toEqual(['bob']);
  });

  it('★ 「選ぶ」では、複数まとめて送れる', async () => {
    await open();
    await userEvent.click(screen.getByRole('radio', { name: '選ぶ' }));
    await userEvent.click(screen.getByRole('button', { name: /アリス/ }));
    await userEvent.click(screen.getByRole('button', { name: /キャロル/ }));

    await userEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(grantPoints).toHaveBeenCalled());

    const targets = grantPoints.mock.calls[0]?.[0] as { clientId: string }[];
    expect(targets.map((c) => c.clientId)).toEqual(['alice', 'carol']);
  });

  it('★ 「全員」では、選ばなくても全員に送れる', async () => {
    await open();
    await userEvent.click(screen.getByRole('radio', { name: '全員' }));

    expect(screen.getByRole('button', { name: '送信' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(grantPoints).toHaveBeenCalled());

    const targets = grantPoints.mock.calls[0]?.[0] as { clientId: string }[];
    expect(targets.map((c) => c.clientId)).toEqual(['alice', 'bob', 'carol']);
  });

  it('★ 作りかけ・停止中の人は出てこない', async () => {
    // ★ ポイントの置き場所がまだ無い人に配ると、静かに消えます
    listClients.mockResolvedValue([
      alice,
      aClient({ clientId: 'zzz', displayName: '作りかけ', provisionStatus: 'provisioning' }),
      aClient({ clientId: 'yyy', displayName: '停止中', active: false }),
    ]);
    await open();

    expect(screen.queryByText('作りかけ')).not.toBeInTheDocument();
    expect(screen.queryByText('停止中')).not.toBeInTheDocument();
  });

  it('いまの残高が、選ぶところに出る', async () => {
    await open();
    expect(screen.getByText('5 かけら')).toBeInTheDocument();
    expect(screen.getByText('12 かけら')).toBeInTheDocument();
  });
});

describe('★ ポイントの額', () => {
  it('既定は +1', async () => {
    await open();
    expect(screen.getByRole('spinbutton')).toHaveValue(1);
  });

  it('★ マイナスを打つと、減らせる（交換したとき）', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: /アリス/ }));

    const amount = screen.getByRole('spinbutton');
    await userEvent.clear(amount);
    await userEvent.type(amount, '-3');

    await userEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(grantPoints).toHaveBeenCalled());
    expect(grantPoints.mock.calls[0]?.[1]).toBe(-3);
  });

  it('★ 0 は送れない', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: /アリス/ }));

    const amount = screen.getByRole('spinbutton');
    await userEvent.clear(amount);
    await userEvent.type(amount, '0');

    expect(screen.getByRole('button', { name: '送信' })).toBeDisabled();
  });

  it('★ 桁を打ち間違えたら、止まる', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: /アリス/ }));

    const amount = screen.getByRole('spinbutton');
    await userEvent.clear(amount);
    await userEvent.type(amount, '99999');

    expect(screen.getByRole('button', { name: '送信' })).toBeDisabled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('ポイントを動かさず、お知らせだけ送れる', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: /アリス/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /かけらを動かす/ }));

    // 文面が空なら、送るものが何も無いので止める
    expect(screen.getByRole('button', { name: '送信' })).toBeDisabled();

    await userEvent.type(screen.getByRole('textbox', { name: /本文/ }), 'こんばんは');
    expect(screen.getByRole('button', { name: '送信' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(grantPoints).toHaveBeenCalled());
    expect(grantPoints.mock.calls[0]?.[1]).toBe(0);
  });
});

describe('★ お知らせ', () => {
  it('★ ポイントが動いたら、文面が空でも必ず1件届く', async () => {
    // ★ 残高だけ変わって何も知らされないのが、いちばん不安にさせます
    await open();
    await userEvent.click(screen.getByRole('button', { name: /アリス/ }));
    await userEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(grantPoints).toHaveBeenCalled());

    const notice = grantPoints.mock.calls[0]?.[2] as { kind: string; title: string; body: string };
    expect(notice).not.toBeNull();
    expect(notice.kind).toBe('points');
    expect(notice.title).toBe('かけらが届きました');
    expect(notice.body).toContain('+1 かけら');
  });

  it('減らしたときは、見出しが変わる', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: /アリス/ }));

    const amount = screen.getByRole('spinbutton');
    await userEvent.clear(amount);
    await userEvent.type(amount, '-3');
    await userEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(grantPoints).toHaveBeenCalled());

    const notice = grantPoints.mock.calls[0]?.[2] as { title: string; body: string };
    expect(notice.title).toBe('かけらを引きました');
    expect(notice.body).toContain('−3 かけら');
  });

  it('書いた見出しと本文が、そのまま入る', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: /アリス/ }));
    await userEvent.type(screen.getByRole('textbox', { name: /見出し/ }), '今月おつかれさま');
    await userEvent.type(screen.getByRole('textbox', { name: /本文/ }), 'よく続きました。');

    await userEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(grantPoints).toHaveBeenCalled());

    const notice = grantPoints.mock.calls[0]?.[2] as { title: string; body: string };
    expect(notice.title).toBe('今月おつかれさま');
    expect(notice.body).toContain('よく続きました。');
  });
});

describe('送ったあと', () => {
  it('誰にいくら動いたかが出る', async () => {
    grantPoints.mockResolvedValue([
      { clientId: 'alice', displayName: 'アリス', applied: -3, points: 2 },
    ]);
    await open();
    await userEvent.click(screen.getByRole('button', { name: /アリス/ }));
    await userEvent.click(screen.getByRole('button', { name: '送信' }));

    const result = await screen.findByText('送りました');
    expect(result).toBeInTheDocument();
    expect(screen.getByText('−3 かけら')).toBeInTheDocument();
    expect(screen.getByText('2 かけら')).toBeInTheDocument();
  });

  it('★ 残高が足りなくて引ききれなかったら、そう伝える', async () => {
    // ★ 500 引くつもりが 300 しか引けなかった、を黙って済ませません。
    //   交換の場で「引いた」と思ったまま帰されると、後から合いません。
    grantPoints.mockResolvedValue([
      { clientId: 'carol', displayName: 'キャロル', applied: -3, points: 0 },
    ]);
    await open();
    await userEvent.click(screen.getByRole('button', { name: /キャロル/ }));

    const amount = screen.getByRole('spinbutton');
    await userEvent.clear(amount);
    await userEvent.type(amount, '-5');
    await userEvent.click(screen.getByRole('button', { name: '送信' }));

    await screen.findByText('送りました');
    expect(screen.getByRole('status')).toHaveTextContent('残っていたぶんだけ');
  });

  it('送れなかったときは、そう出る', async () => {
    grantPoints.mockRejectedValue(new Error('offline'));
    await open();
    await userEvent.click(screen.getByRole('button', { name: /アリス/ }));
    await userEvent.click(screen.getByRole('button', { name: '送信' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('送信できませんでした');
  });

  it('続けて送ると、選んだ相手と文面が消えている', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: /アリス/ }));
    await userEvent.type(screen.getByRole('textbox', { name: /見出し/ }), 'おつかれさま');
    await userEvent.click(screen.getByRole('button', { name: '送信' }));

    await screen.findByText('送りました');
    await userEvent.click(screen.getByRole('button', { name: '続けて送る' }));

    await screen.findByText('アリス');
    expect(screen.getByRole('textbox', { name: /見出し/ })).toHaveValue('');
    expect(screen.getByRole('button', { name: '送信' })).toBeDisabled();
  });
});

describe('一覧が読めないとき', () => {
  it('その旨を出して、送信は止めておく', async () => {
    listClients.mockRejectedValue(new Error('offline'));
    render(<PointsGrantScreen onBack={() => {}} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('読み込めませんでした');
    expect(screen.getByRole('button', { name: '送信' })).toBeDisabled();
  });
});
