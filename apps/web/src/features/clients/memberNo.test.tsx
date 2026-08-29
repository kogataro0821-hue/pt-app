import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aClient } from '@/test/factories';
import { ClientEditScreen } from './ClientEditScreen';

/**
 * 会員整理番号（追加仕様: 会員ランク）。
 *
 * ★ ここで守りたいのは「勝手に振らないこと」です。
 *
 *   動作確認用のアカウントや、トレーナー自身のアカウントには
 *   番号を振りたくない／別の番号にしたい、ということがあります。
 *   設定画面を開いただけで番号が付くと、あとから直す手間になります。
 *
 *   一度決めた番号は、会員証に出る「その人の証」です。
 *   勝手に付けたり変えたりしてよいものではありません。
 */

const getClient = vi.fn();
const updateClient = vi.fn();
const nextMemberNo = vi.fn();

vi.mock('./clientsRepo', () => ({
  getClient: (...a: unknown[]): unknown => getClient(...a),
  updateClient: (...a: unknown[]): unknown => updateClient(...a),
  nextMemberNo: (...a: unknown[]): unknown => nextMemberNo(...a),
  setClientActive: vi.fn(),
  setClientRank: vi.fn(),
  setRankGoal: vi.fn(),
  ranksBelow: (): unknown[] => [],
  deleteProvisioningClient: vi.fn(),
}));

vi.mock('./DangerZone', () => ({ DangerZone: () => null }));

function show() {
  render(<ClientEditScreen clientId="test01" onBack={vi.fn()} />);
  return screen.findByLabelText(/会員整理番号/);
}

beforeEach(() => {
  getClient.mockReset();
  updateClient.mockReset();
  nextMemberNo.mockReset();
  updateClient.mockResolvedValue(undefined);
  nextMemberNo.mockResolvedValue(5);
  getClient.mockResolvedValue(aClient({ clientId: 'test01', memberNo: null }));
});

describe('★ 番号を勝手に振らない', () => {
  it('設定画面を開いただけでは、番号が付かない', async () => {
    await show();

    expect(updateClient).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/会員整理番号/)).toHaveValue(null);
  });

  it('未採番のままなら、会員証には No. ---- と出ると伝える', async () => {
    await show();
    expect(screen.getByText(/No\. ----/)).toBeInTheDocument();
  });

  it('番号があるときは、その値を出す', async () => {
    getClient.mockResolvedValue(aClient({ clientId: 'taro', memberNo: 3 }));
    await show();
    expect(screen.getByLabelText(/会員整理番号/)).toHaveValue(3);
  });
});

describe('番号を入れる', () => {
  it('入れて保存すると、その番号で保存される', async () => {
    await show();

    await userEvent.type(screen.getByLabelText(/会員整理番号/), '12');
    await userEvent.click(screen.getByRole('button', { name: '整理番号を保存する' }));

    await waitFor(() => {
      expect(updateClient).toHaveBeenCalledWith('test01', { memberNo: 12 });
    });
  });

  it('★ 0 も入れられる（トレーナー自身のアカウントを 0000 にするため）', async () => {
    await show();

    await userEvent.type(screen.getByLabelText(/会員整理番号/), '0');
    await userEvent.click(screen.getByRole('button', { name: '整理番号を保存する' }));

    await waitFor(() => {
      expect(updateClient).toHaveBeenCalledWith('test01', { memberNo: 0 });
    });
  });

  it('空欄にして保存すると、未採番に戻せる', async () => {
    getClient.mockResolvedValue(aClient({ clientId: 'test01', memberNo: 4 }));
    await show();

    await userEvent.clear(screen.getByLabelText(/会員整理番号/));
    await userEvent.click(screen.getByRole('button', { name: '整理番号を保存する' }));

    await waitFor(() => {
      expect(updateClient).toHaveBeenCalledWith('test01', { memberNo: null });
    });
  });

  it('変えていなければ、保存のボタンは押せない', async () => {
    getClient.mockResolvedValue(aClient({ clientId: 'taro', memberNo: 3 }));
    await show();

    expect(screen.getByRole('button', { name: '整理番号を保存する' })).toBeDisabled();
  });

  it('「次の番号を入れる」で、いまの最大＋1が入る（保存はまだしない）', async () => {
    await show();

    await userEvent.click(screen.getByRole('button', { name: '次の番号を入れる' }));

    await waitFor(() => {
      expect(screen.getByLabelText(/会員整理番号/)).toHaveValue(5);
    });
    // ★ 入れただけでは保存しません。人が「保存する」を押したときだけです
    expect(updateClient).not.toHaveBeenCalled();
  });

  it('おかしな値は、はっきり断る', async () => {
    await show();

    await userEvent.type(screen.getByLabelText(/会員整理番号/), '-1');
    await userEvent.click(screen.getByRole('button', { name: '整理番号を保存する' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/0 から 9999/);
    expect(updateClient).not.toHaveBeenCalled();
  });

  it('保存に失敗したら、そのことを出す', async () => {
    updateClient.mockRejectedValue(new Error('offline'));
    await show();

    await userEvent.type(screen.getByLabelText(/会員整理番号/), '12');
    await userEvent.click(screen.getByRole('button', { name: '整理番号を保存する' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '会員整理番号を保存できませんでした。',
    );
  });
});
