import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientCreateScreen } from './ClientCreateScreen';

/**
 * 契約者の新規作成（追加仕様: 会員ランク）。
 *
 * ★ 初期ランクをここで選べるようにしました。
 *
 *   「昇格は条件を満たしたときだけ」という決まりとは矛盾しません。
 *   ここで決めるのは**開始地点**で、昇格ではないためです。
 *   トレーナー自身のアカウントのように、最初から上の段で始めたい場合があります。
 *
 *   作ったあとの画面からは、やはり上げられません。
 */

const createClient = vi.fn();

vi.mock('./clientsRepo', () => ({
  createClient: (...a: unknown[]): unknown => createClient(...a),
  ClientOperationError: class extends Error {},
  createClientErrorMessage: (): string => 'エラー',
}));

vi.mock('@/config/firebase', () => ({ CLIENT_LOGIN_DOMAIN: 'pt-app.local' }));

function show() {
  render(<ClientCreateScreen onDone={vi.fn()} onCancel={vi.fn()} />);
}

async function fillBasics(id = 'kintaro', name = '金太郎', pw = '19190721') {
  await userEvent.type(screen.getByLabelText(/契約者ID/), id);
  await userEvent.type(screen.getByLabelText(/表示名/), name);
  await userEvent.type(screen.getByLabelText(/初期パスワード/), pw);
}

beforeEach(() => {
  createClient.mockReset();
  createClient.mockResolvedValue(undefined);
});

describe('初期ランク', () => {
  it('既定は PLATINUM', async () => {
    show();
    expect(screen.getByLabelText(/初期ランク/)).toHaveValue('PLATINUM');
  });

  it('7段階すべて選べる', async () => {
    show();
    const options = [...screen.getByLabelText(/初期ランク/).querySelectorAll('option')].map(
      (o) => o.value,
    );
    expect(options).toHaveLength(7);
    expect(options).toContain('DIAMOND');
    expect(options).toContain('CROWN_AMBASSADOR');
  });

  it('★ 「開始地点であって昇格ではない」と、その場に書いてある', async () => {
    // ★ ここが分からないと、あとから上げられると思われます
    show();
    expect(screen.getByText(/作ったあとに上げることはできません/)).toBeInTheDocument();
  });

  it('選んだランクで作られる', async () => {
    show();
    await fillBasics();
    await userEvent.selectOptions(screen.getByLabelText(/初期ランク/), 'DIAMOND');
    await userEvent.click(screen.getByRole('button', { name: '契約者を作成する' }));

    await waitFor(() => {
      expect(createClient).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'kintaro', rank: 'DIAMOND' }),
      );
    });
  });
});

describe('会員整理番号', () => {
  it('空欄なら、番号を指定せずに作る（自動で振られる）', async () => {
    show();
    await fillBasics();
    await userEvent.click(screen.getByRole('button', { name: '契約者を作成する' }));

    await waitFor(() => {
      expect(createClient).toHaveBeenCalled();
    });
    const [arg] = createClient.mock.calls[0] as [Record<string, unknown>];
    expect('memberNo' in arg).toBe(false);
  });

  it('★ 0 を入れられる（トレーナー自身のアカウントを 0000 にするため）', async () => {
    show();
    await fillBasics();
    await userEvent.type(screen.getByLabelText(/会員整理番号/), '0');
    await userEvent.click(screen.getByRole('button', { name: '契約者を作成する' }));

    await waitFor(() => {
      expect(createClient).toHaveBeenCalledWith(expect.objectContaining({ memberNo: 0 }));
    });
  });

  it('★ 範囲外の番号では、作成に進まない', async () => {
    // ★ 欄に min/max を付けてあるので、ブラウザがそこで止めます。
    //   （こちら側にも同じ検査を置いてありますが、通常はそこまで来ません）
    //   大事なのは「おかしな番号のまま作られないこと」です。
    show();
    await fillBasics();
    await userEvent.type(screen.getByLabelText(/会員整理番号/), '99999');
    await userEvent.click(screen.getByRole('button', { name: '契約者を作成する' }));

    expect(createClient).not.toHaveBeenCalled();
  });
});
