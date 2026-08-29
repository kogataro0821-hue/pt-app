import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notice } from '@pt/core';
import { aClient } from '@/test/factories';
import type * as NoticesRepo from './noticesRepo';
import { NoticesScreen } from './NoticesScreen';

/**
 * お知らせの一覧（追加仕様: お知らせ欄）。
 *
 * ★ ここで守りたいのは3つです。
 *
 *   1. お知らせを出すのに、通信を増やさないこと
 *   2. 同じ出来事で2件出さないこと
 *   3. 読んだら、ベルの数字が消えること
 *
 *   1 がこの画面の要です。個人あては契約者ドキュメントの中、
 *   全員向けはアプリの中の定数です。**この画面は何も読みに行きません。**
 */

const markNoticesRead = vi.fn();

vi.mock('./noticesRepo', async () => {
  const actual = await vi.importActual<typeof NoticesRepo>('./noticesRepo');
  return {
    ...actual,
    markNoticesRead: (...a: unknown[]): unknown => markNoticesRead(...a),
  };
});

// ★ 全員向けのお知らせは、配布のたびに中身が変わります。
//   本物を使うと、文面を1行足すだけでテストが落ちます。
//   ここで確かめたいのは「同梱のものも一緒に並ぶか」だけです。
vi.mock('./appNotices', () => ({
  APP_NOTICES: [
    {
      id: 'app-x',
      kind: 'app',
      at: 500,
      title: 'アプリが新しくなりました',
      body: '',
      date: null,
    },
  ] satisfies Notice[],
}));

function aNotice(over: Partial<Notice> = {}): Notice {
  return {
    id: 'n1',
    kind: 'comment',
    at: 1000,
    title: 'トレーナーからコメントが届きました',
    body: '2026-08-28 の記録にコメントがあります。',
    date: '2026-08-28',
    ...over,
  };
}

function show(over: Parameters<typeof aClient>[0] = {}, isAdmin = false) {
  render(
    <MemoryRouter>
      <NoticesScreen client={aClient({ clientId: 'taro', ...over })} isAdmin={isAdmin} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  markNoticesRead.mockReset();
  markNoticesRead.mockResolvedValue(9_999);
});

describe('一覧', () => {
  it('個人あてとアプリ同梱が、両方出る', () => {
    show({ notices: [aNotice()] });

    expect(screen.getByText('トレーナーからコメントが届きました')).toBeInTheDocument();
    expect(screen.getByText('アプリが新しくなりました')).toBeInTheDocument();
  });

  it('新しいものが上に来る', () => {
    show({ notices: [aNotice({ id: 'old', at: 100, title: '古いお知らせ' })] });

    const titles = [...document.querySelectorAll('.notice-title')].map((e) => e.textContent);
    expect(titles).toEqual(['アプリが新しくなりました', '古いお知らせ']); // 500 → 100
  });

  it('★ コメントのお知らせからは、その日の記録へ行ける', () => {
    // ★ 「コメントが来ました」だけでは、どこを見ればよいのか分かりません
    show({ notices: [aNotice()] });

    expect(screen.getByRole('link', { name: 'その日の記録を見る' })).toHaveAttribute(
      'href',
      '/c/taro/d/2026-08-28',
    );
  });

  it('日付のないお知らせには、リンクを出さない', () => {
    show({ notices: [aNotice({ kind: 'rankUp', title: 'RUBY になりました', date: null })] });

    expect(screen.queryByRole('link', { name: 'その日の記録を見る' })).not.toBeInTheDocument();
  });
});

describe('未読', () => {
  it('一度も読んでいなければ、全部が未読', () => {
    show({ notices: [aNotice()] });
    expect(screen.getByText('新しいお知らせが 2 件')).toBeInTheDocument();
  });

  it('読んだ時刻より古いものは、数えない', () => {
    show({ notices: [aNotice({ at: 100 })], extra: { noticeReadAt: 600 } });
    // 同梱の at:500 も、個人の at:100 も、600 より古い
    expect(screen.queryByText(/新しいお知らせが/)).not.toBeInTheDocument();
  });

  it('★ 「すべて閉じる」で、数字が消える', async () => {
    show({ notices: [aNotice()] });

    await userEvent.click(screen.getByRole('button', { name: 'すべて閉じる' }));

    await waitFor(() => {
      expect(screen.queryByText(/新しいお知らせが/)).not.toBeInTheDocument();
    });
    expect(markNoticesRead).toHaveBeenCalled();
  });

  it('★ 閉じたあとも、お知らせ自体は残る', async () => {
    // ★ 「消せる」のは未読の印であって、お知らせではありません。
    //   あとから読み直せないと、コメントの在りかが分からなくなります。
    show({ notices: [aNotice()] });

    await userEvent.click(screen.getByRole('button', { name: 'すべて閉じる' }));

    await waitFor(() => {
      expect(screen.queryByText(/新しいお知らせが/)).not.toBeInTheDocument();
    });
    expect(screen.getByText('トレーナーからコメントが届きました')).toBeInTheDocument();
  });

  it('閉じられなかったら、そのことを出す', async () => {
    markNoticesRead.mockRejectedValue(new Error('offline'));
    show({ notices: [aNotice()] });

    await userEvent.click(screen.getByRole('button', { name: 'すべて閉じる' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('既読にできませんでした');
  });
});

describe('管理者が見るとき', () => {
  it('★ 既読にはしない（本人の未読を消してしまわない）', () => {
    // ★ 管理者が様子を見に来ただけで既読になると、
    //   本人はお知らせに気づかないまま終わります。
    show({ notices: [aNotice()] }, true);

    expect(screen.queryByRole('button', { name: 'すべて閉じる' })).not.toBeInTheDocument();
    expect(screen.getByText(/ここでは既読になりません/)).toBeInTheDocument();
  });

  it('中身は読める', () => {
    show({ notices: [aNotice()] }, true);
    expect(screen.getByText('トレーナーからコメントが届きました')).toBeInTheDocument();
  });
});
