import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aClient } from '@/test/factories';
import { DangerZone } from './DangerZone';

/**
 * 契約者の完全削除（設計書 §6.6 / §46）。
 *
 * ★ ここで守りたいのは「消せること」ではありません。**間違って消えないこと**です。
 *
 *   消す処理そのものはテストできても、消してしまった記録は戻りません。
 *   だからテストの重心は、押す前の歯止めに置きます。
 */

const estimateDeletion = vi.fn();
const deleteClientCompletely = vi.fn();

vi.mock('./deleteClient', () => ({
  estimateDeletion: (...a: unknown[]): unknown => estimateDeletion(...a),
  deleteClientCompletely: (...a: unknown[]): unknown => deleteClientCompletely(...a),
}));

const client = aClient({ clientId: 'taro', authUid: 'uid-taro' });

function show(onDeleted = vi.fn()) {
  render(<DangerZone client={client} onDeleted={onDeleted} />);
  return { onDeleted };
}

/** 確認画面まで進める */
async function openConfirm() {
  await userEvent.click(screen.getByRole('button', { name: '完全な削除に進む' }));
  await screen.findByLabelText(/契約者ID「taro」を入力/);
}

beforeEach(() => {
  estimateDeletion.mockReset();
  deleteClientCompletely.mockReset();
  estimateDeletion.mockResolvedValue({ days: 142, audits: 3, authUid: 'uid-taro' });
  deleteClientCompletely.mockResolvedValue({ deleted: 980, authUid: 'uid-taro' });
});

describe('★ 間違って消えないこと', () => {
  it('入口では、まだ何も消えない', async () => {
    show();
    expect(screen.getByText(/取り消せません/)).toBeInTheDocument();
    expect(deleteClientCompletely).not.toHaveBeenCalled();
  });

  it('契約者IDを打つまで、削除のボタンは押せない', async () => {
    // ★ 「本当によろしいですか？」は3回目から読まれません。
    //   打たせる手間が、最後の歯止めです。
    show();
    await openConfirm();

    expect(screen.getByRole('button', { name: '完全に削除する' })).toBeDisabled();
  });

  it('契約者IDが1文字でも違えば、押せない', async () => {
    show();
    await openConfirm();

    await userEvent.type(screen.getByLabelText(/契約者ID「taro」を入力/), 'taroo');
    expect(screen.getByRole('button', { name: '完全に削除する' })).toBeDisabled();
  });

  it('ぴったり合ったときだけ押せる', async () => {
    show();
    await openConfirm();

    await userEvent.type(screen.getByLabelText(/契約者ID「taro」を入力/), 'taro');
    expect(screen.getByRole('button', { name: '完全に削除する' })).toBeEnabled();
  });

  it('やめれば、何も起きない', async () => {
    show();
    await openConfirm();
    await userEvent.type(screen.getByLabelText(/契約者ID「taro」を入力/), 'taro');
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }));

    expect(deleteClientCompletely).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '完全な削除に進む' })).toBeInTheDocument();
  });
});

describe('消す前に、何が消えるかを見せる', () => {
  it('記録のある日数と履歴の件数を出す', async () => {
    show();
    await openConfirm();

    expect(screen.getByText(/142日ぶん/)).toBeInTheDocument();
    expect(screen.getByText(/変更履歴: 3件/)).toBeInTheDocument();
  });

  it('★ 消さずに済ませる道（無効にする）も、その場で示す', async () => {
    // ★ 削除の画面でしか思い出せない選択肢です。
    //   ここに書いておかないと、消さなくてよかった人まで消えます。
    show();
    await openConfirm();

    expect(screen.getByText(/この契約者を無効にする/)).toBeInTheDocument();
    expect(screen.getByText(/記録は残ります/)).toBeInTheDocument();
  });

  it('ログインアカウントが残ることを、消す前に伝える', async () => {
    show();
    await openConfirm();

    expect(screen.getByText(/ログインアカウントは、ここでは消せません/)).toBeInTheDocument();
    expect(screen.getByText(/同じ契約者IDで作り直すことはできません/)).toBeInTheDocument();
  });
});

describe('消したあと', () => {
  it('件数と、次にやることを伝える', async () => {
    show();
    await openConfirm();
    await userEvent.type(screen.getByLabelText(/契約者ID「taro」を入力/), 'taro');
    await userEvent.click(screen.getByRole('button', { name: '完全に削除する' }));

    await screen.findByText('削除しました');
    expect(screen.getByText(/980 件削除しました/)).toBeInTheDocument();
    // 手で消すアドレスを、そのまま出す（探させない）
    expect(screen.getByText(/taro@pt-app\.local/)).toBeInTheDocument();
  });

  it('★ 途中で失敗したら、消えたぶんが戻らないことを隠さない', async () => {
    // ★ 「失敗しました」だけだと、何も起きなかったと受け取られます。
    //   実際には途中まで消えています。それを言わないのは不誠実です。
    deleteClientCompletely.mockRejectedValue(new Error('network'));
    show();
    await openConfirm();
    await userEvent.type(screen.getByLabelText(/契約者ID「taro」を入力/), 'taro');
    await userEvent.click(screen.getByRole('button', { name: '完全に削除する' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/消えたぶんは元に戻りません/);
    });
    // やり直せることも、同じ場所で伝える
    expect(screen.getByRole('alert')).toHaveTextContent(/残りから続きます/);
  });

  it('数えられなければ、削除に進ませない', async () => {
    estimateDeletion.mockRejectedValue(new Error('offline'));
    show();
    await userEvent.click(screen.getByRole('button', { name: '完全な削除に進む' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/契約者ID「taro」を入力/)).not.toBeInTheDocument();
    expect(deleteClientCompletely).not.toHaveBeenCalled();
  });
});
