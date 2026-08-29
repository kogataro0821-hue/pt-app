import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aClient } from '@/test/factories';
import { ClientCreateScreen } from './ClientCreateScreen';

/**
 * 契約者の新規作成（追加仕様: 会員ランク）。
 *
 * ★ 初期ランクをここで選べるようにしました。ただし**1人だけ**です。
 *
 *   「昇格は条件を満たしたときだけ」という決まりとは矛盾しません。
 *   ここで決めるのは**開始地点**で、昇格ではないためです。
 *   トレーナー自身のアカウントのように、最初から上の段で始めたい場合があります。
 *
 *   とはいえ、誰でも好きな段から始められるなら、ランクの意味が無くなります。
 *   そこで**枠は1つだけ**にして、使い切ったら以後は選べなくします。
 *
 *   作ったあとの画面からは、やはり上げられません。
 */

const createClient = vi.fn();
const seededRankClient = vi.fn();

vi.mock('./clientsRepo', () => ({
  createClient: (...a: unknown[]): unknown => createClient(...a),
  seededRankClient: (...a: unknown[]): unknown => seededRankClient(...a),
  ClientOperationError: class extends Error {},
  createClientErrorMessage: (): string => 'エラー',
}));

vi.mock('@/config/firebase', () => ({ CLIENT_LOGIN_DOMAIN: 'pt-app.local' }));

function show() {
  render(<ClientCreateScreen onDone={vi.fn()} onCancel={vi.fn()} />);
}

/** 「初期ランクの枠は、まだ空いている」状態になるまで待つ */
async function showOpen() {
  show();
  await waitFor(() => {
    expect(screen.getByLabelText(/初期ランク/)).toBeEnabled();
  });
}

async function fillBasics(id = 'kintaro', name = '金太郎', pw = '19190721') {
  await userEvent.type(screen.getByLabelText(/契約者ID/), id);
  await userEvent.type(screen.getByLabelText(/表示名/), name);
  await userEvent.type(screen.getByLabelText(/初期パスワード/), pw);
}

beforeEach(() => {
  createClient.mockReset();
  createClient.mockResolvedValue(undefined);
  seededRankClient.mockReset();
  // 既定は「枠はまだ空いている」
  seededRankClient.mockResolvedValue(null);
});

describe('初期ランク', () => {
  it('既定は PLATINUM', async () => {
    await showOpen();
    expect(screen.getByLabelText(/初期ランク/)).toHaveValue('PLATINUM');
  });

  it('7段階すべて選べる', async () => {
    await showOpen();
    const options = [...screen.getByLabelText(/初期ランク/).querySelectorAll('option')].map(
      (o) => o.value,
    );
    expect(options).toHaveLength(7);
    expect(options).toContain('DIAMOND');
    expect(options).toContain('CROWN_AMBASSADOR');
  });

  it('★ 「開始地点であって昇格ではない」と、その場に書いてある', async () => {
    // ★ ここが分からないと、あとから上げられると思われます
    await showOpen();
    expect(screen.getByText(/作ったあとに上げることはできません/)).toBeInTheDocument();
  });

  it('選んだランクで作られる', async () => {
    await showOpen();
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

describe('★ 初期ランクを指定して作れるのは、1人だけ', () => {
  /**
   * ★ ここが、この画面でいちばん大事な決まりです。
   *
   *   初期ランクを何人にも付けられるなら、ランクは「頑張った印」ではなく
   *   「作るときに選ぶ飾り」になってしまいます。
   */

  it('すでに使われていれば、初期ランクの欄は使えない', async () => {
    seededRankClient.mockResolvedValue(aClient({ clientId: 'kintaro', displayName: '金太郎' }));
    show();

    await waitFor(() => {
      expect(screen.getByLabelText(/初期ランク/)).toBeDisabled();
    });
  });

  it('使えないときは PLATINUM しか残らない', async () => {
    seededRankClient.mockResolvedValue(aClient({ clientId: 'kintaro', displayName: '金太郎' }));
    show();

    await waitFor(() => {
      expect(screen.getByLabelText(/初期ランク/)).toBeDisabled();
    });
    const options = [...screen.getByLabelText(/初期ランク/).querySelectorAll('option')].map(
      (o) => o.value,
    );
    expect(options).toEqual(['PLATINUM']);
  });

  it('★ 誰が使っているのかが分かる', async () => {
    // ★ 「使えません」だけでは、どうすればよいのか分かりません。
    seededRankClient.mockResolvedValue(aClient({ clientId: 'kintaro', displayName: '金太郎' }));
    show();

    expect(await screen.findByText('金太郎')).toBeInTheDocument();
    expect(screen.getByText(/この欄は使えません/)).toBeInTheDocument();
  });

  it('表示名が空なら、契約者IDで示す', async () => {
    seededRankClient.mockResolvedValue(aClient({ clientId: 'kintaro', displayName: '' }));
    show();

    expect(await screen.findByText('kintaro')).toBeInTheDocument();
  });

  it('★ 調べられなかったときは、安全側（選べない）に倒す', async () => {
    // ★ 分からないまま2人目を作らせるより、作れないほうがましです。
    //   作れなかった場合は、通信が戻ってから開き直せば済みます。
    //   逆に2人目を作ってしまうと、ランクの意味が戻りません。
    seededRankClient.mockRejectedValue(new Error('offline'));
    show();

    await waitFor(() => {
      expect(screen.getByLabelText(/初期ランク/)).toBeDisabled();
    });
  });

  it('調べ終わるまでは、選べない', async () => {
    // 返事が来るまで解決しない約束
    seededRankClient.mockReturnValue(new Promise(() => {}));
    show();

    expect(screen.getByLabelText(/初期ランク/)).toBeDisabled();
    expect(screen.getByText(/調べています/)).toBeInTheDocument();
  });

  it('使えないときでも、契約者そのものは作れる（PLATINUM で）', async () => {
    seededRankClient.mockResolvedValue(aClient({ clientId: 'kintaro', displayName: '金太郎' }));
    show();
    await waitFor(() => {
      expect(screen.getByLabelText(/初期ランク/)).toBeDisabled();
    });

    await fillBasics('tanaka01', '田中 花子', 'password123');
    await userEvent.click(screen.getByRole('button', { name: '契約者を作成する' }));

    await waitFor(() => {
      expect(createClient).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'tanaka01', rank: 'PLATINUM' }),
      );
    });
  });
});

describe('会員整理番号', () => {
  it('空欄なら、番号を指定せずに作る（自動で振られる）', async () => {
    await showOpen();
    await fillBasics();
    await userEvent.click(screen.getByRole('button', { name: '契約者を作成する' }));

    await waitFor(() => {
      expect(createClient).toHaveBeenCalled();
    });
    const [arg] = createClient.mock.calls[0] as [Record<string, unknown>];
    expect('memberNo' in arg).toBe(false);
  });

  it('★ 0 を入れられる（トレーナー自身のアカウントを 0000 にするため）', async () => {
    await showOpen();
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
    await showOpen();
    await fillBasics();
    await userEvent.type(screen.getByLabelText(/会員整理番号/), '99999');
    await userEvent.click(screen.getByRole('button', { name: '契約者を作成する' }));

    expect(createClient).not.toHaveBeenCalled();
  });
});
