import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
const signOutNow = vi.fn();

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    state: {
      status: 'signedIn',
      user: { uid: 'uid-1', role, clientId: role === 'client' ? 'c1' : null },
    },
    signOutNow: (): unknown => signOutNow(),
  }),
}));

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
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
  signOutNow.mockReset();
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

/**
 * お知らせのベル（追加仕様: お知らせ欄）。
 *
 * ★ 件数はここで数えません。渡してもらいます。
 *
 *   数えるには契約者ドキュメントが要ります。それを持っているのは
 *   ClientGate を通った画面だけです。この外枠にもう一度読ませると、
 *   同じものを2回読むことになります（読み取りが2倍）。
 */
describe('お知らせのベル', () => {
  function showWithBell(bell?: { to: string; unread: number }) {
    return render(
      <AppShell onChangePassword={vi.fn()} bell={bell}>
        <p>中身</p>
      </AppShell>,
    );
  }

  it('渡されなければ、ベルは出ない', () => {
    role = 'admin';
    showWithBell(undefined);
    expect(screen.queryByRole('link', { name: /お知らせ/ })).not.toBeInTheDocument();
  });

  it('未読があれば、数字が出る', () => {
    role = 'client';
    showWithBell({ to: '/c/c1/notices', unread: 3 });

    const bell = screen.getByRole('link', { name: 'お知らせ（新しいものが3件）' });
    expect(bell).toHaveAttribute('href', '/c/c1/notices');
    expect(bell).toHaveTextContent('3');
  });

  it('★ 未読が0なら、数字は出さない', () => {
    // ★ 0 を出すと、毎日「0」を見ることになります。
    //   何も無いことは、何も出さないことで伝わります。
    role = 'client';
    showWithBell({ to: '/c/c1/notices', unread: 0 });

    const bell = screen.getByRole('link', { name: 'お知らせ' });
    expect(bell).not.toHaveTextContent('0');
  });

  it('溜まりすぎたら、3桁で打ち切る', () => {
    role = 'client';
    showWithBell({ to: '/c/c1/notices', unread: 120 });
    expect(screen.getByRole('link', { name: /お知らせ/ })).toHaveTextContent('99+');
  });
});

/**
 * 右上のメニュー（追加仕様: メニュー）。
 *
 * ★ 固定したいのは、ログアウトが「開いてから押す」形になっていることです。
 *
 *   以前は上部にログアウトのボタンが常時出ていました。
 *   スマホで戻るつもりの指がかすると、それだけで落ちます。
 *   落ちること自体は壊れませんが、記録の途中なら書きかけが消えます。
 *
 * ★ そして、管理者・契約者のどちらにも同じ形で出ること。
 */
describe('右上のメニュー', () => {
  function showMenu(settings?: { to: string; label: string }) {
    return render(
      <AppShell onChangePassword={onChangePassword} settings={settings}>
        <p>中身</p>
      </AppShell>,
    );
  }

  const onChangePassword = vi.fn();

  beforeEach(() => {
    onChangePassword.mockReset();
  });

  it('★ 閉じているうちは、ログアウトが画面に出ていない', async () => {
    showMenu();
    expect(screen.queryByRole('button', { name: 'ログアウト' })).not.toBeInTheDocument();
  });

  it('押すと開き、3つの行き先が出る', async () => {
    showMenu({ to: '/c/c1/settings', label: '設定' });
    await userEvent.click(screen.getByRole('button', { name: 'メニュー' }));

    expect(screen.getByRole('menuitem', { name: '設定' })).toHaveAttribute(
      'href',
      '/c/c1/settings',
    );
    expect(screen.getByRole('menuitem', { name: 'パスワードの変更' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'ログアウト' })).toBeInTheDocument();
  });

  it('契約者にも、同じ形で出る', async () => {
    role = 'client';
    showMenu({ to: '/c/c1/settings', label: '設定' });
    await userEvent.click(screen.getByRole('button', { name: 'メニュー' }));

    expect(screen.getByRole('menuitem', { name: '設定' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'ログアウト' })).toBeInTheDocument();
  });

  it('★ 行き先の無い画面では、設定を出さない', async () => {
    // ★ 押しても行くところが無い項目は、出さないほうが親切です
    showMenu(undefined);
    await userEvent.click(screen.getByRole('button', { name: 'メニュー' }));

    expect(screen.queryByRole('menuitem', { name: /設定/ })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'ログアウト' })).toBeInTheDocument();
  });

  it('パスワードの変更を押すと、呼ばれて閉じる', async () => {
    showMenu();
    await userEvent.click(screen.getByRole('button', { name: 'メニュー' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'パスワードの変更' }));

    expect(onChangePassword).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('ログアウトを押すと、ログアウトする', async () => {
    showMenu();
    await userEvent.click(screen.getByRole('button', { name: 'メニュー' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'ログアウト' }));

    expect(signOutNow).toHaveBeenCalledTimes(1);
  });

  it('★ 外側を触ると閉じる', async () => {
    // ★ 開いたまま別の場所を押して「押したのに何も起きない」を防ぎます
    showMenu();
    await userEvent.click(screen.getByRole('button', { name: 'メニュー' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await userEvent.click(screen.getByText('中身'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Esc でも閉じる', async () => {
    showMenu();
    await userEvent.click(screen.getByRole('button', { name: 'メニュー' }));
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('★ 版が出る（この端末で動いているものが分かる）', async () => {
    // ★ これが無くて、実際に半日つぶしました。
    //   「直したはずなのに直っていない」のか「まだ古いアプリが動いている」のか、
    //   区別する手段がありませんでした。
    showMenu();
    await userEvent.click(screen.getByRole('button', { name: 'メニュー' }));

    expect(screen.getByText(/^ver /)).toBeInTheDocument();
  });

  it('★ 「最新に更新する」がある', async () => {
    // ★ ホーム画面から開いたアプリは、勝手には新しくなりません。
    //   自分で押せる道を1つ用意して、そこを断ち切ります。
    showMenu();
    await userEvent.click(screen.getByRole('button', { name: 'メニュー' }));

    expect(screen.getByRole('menuitem', { name: '最新に更新する' })).toBeInTheDocument();
  });

  it('読み上げに、開いているかどうかが伝わる', async () => {
    showMenu();
    const button = screen.getByRole('button', { name: 'メニュー' });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });
});
