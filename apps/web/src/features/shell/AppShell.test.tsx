import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

/**
 * 全画面共通の外枠（設計書 §11.1 / §21）。
 *
 * ★ ここで固定したいのは、未処理の登録依頼の件数です。
 *
 *   依頼は、契約者が「マスタに無い食材」を使うたびに静かに積まれます。
 *   トレーナーが「登録依頼」を開かないかぎり気づけません。
 *   気づかないあいだ、その食材は栄養値0のまま集計され、
 *   数字を根拠にした指導ができない日が黙って増えます。
 *
 * ★ そして、契約者の画面には何も出ないこと。
 *   件数そのものが「他の契約者が何を食べているか」の手がかりになります。
 */

let role: 'admin' | 'client' = 'admin';

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    state: {
      status: 'signedIn',
      user: { uid: 'uid-1', role, clientId: role === 'client' ? 'c1' : null },
    },
    signOutNow: vi.fn(),
  }),
}));

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  useLocation: () => ({ pathname: '/clients' }),
}));

const ensureRequestCount = vi.fn();
const clearRequestCount = vi.fn();
let count: number | null = null;

vi.mock('@/features/foods/requestCount', () => ({
  ensureRequestCount: (): unknown => ensureRequestCount(),
  clearRequestCount: (): unknown => clearRequestCount(),
  requestCountSnapshot: () => count,
  subscribeRequestCount: () => () => undefined,
}));

function show() {
  return render(
    <AppShell onChangePassword={vi.fn()}>
      <p>中身</p>
    </AppShell>,
  );
}

beforeEach(() => {
  role = 'admin';
  count = null;
  ensureRequestCount.mockReset();
  clearRequestCount.mockReset();
});

describe('未処理の登録依頼の数', () => {
  it('溜まっていれば、行き先の横に数を出す', () => {
    count = 3;
    show();

    const link = screen.getByRole('link', { name: /登録依頼/ });
    expect(link).toHaveTextContent('3');
  });

  it('0件のときは、何も出さない', () => {
    // ★ 常に出ていると、見なくなります。出ているだけで意味がある状態にします
    count = 0;
    show();

    expect(screen.getByRole('link', { name: /登録依頼/ })).toHaveTextContent(/^登録依頼$/);
  });

  it('まだ数えられていないときも、何も出さない', () => {
    count = null;
    show();

    expect(screen.getByRole('link', { name: /登録依頼/ })).toHaveTextContent(/^登録依頼$/);
  });

  it('3桁になったら 99+ にする（横並びが崩れないように）', () => {
    count = 130;
    show();

    const link = screen.getByRole('link', { name: /登録依頼/ });
    expect(link).toHaveTextContent('99+');
    expect(link).not.toHaveTextContent('130');
  });

  it('読み上げでも件数が分かる', () => {
    count = 3;
    show();
    expect(screen.getByLabelText('未処理の依頼が3件')).toBeInTheDocument();
  });

  it('管理者の画面を出したら、数えにいく', async () => {
    show();
    await waitFor(() => {
      expect(ensureRequestCount).toHaveBeenCalled();
    });
  });
});

describe('★ 契約者には、何も見せない', () => {
  it('契約者の画面には、管理者の行き先そのものが出ない', () => {
    role = 'client';
    count = 3;
    show();

    expect(screen.queryByRole('link', { name: /登録依頼/ })).not.toBeInTheDocument();
    expect(screen.queryByText('3')).not.toBeInTheDocument();
  });

  it('契約者の画面では、数えにいかない（読む権限がない）', () => {
    role = 'client';
    show();

    expect(ensureRequestCount).not.toHaveBeenCalled();
    // 前に管理者が見ていた数を、持ち続けない
    expect(clearRequestCount).toHaveBeenCalled();
  });
});
