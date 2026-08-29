import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotesSection } from './NotesSection';
import type { Note } from './notesRepo';
import { firstCall } from '@/test/helpers';
import { aClient } from '@/test/factories';
import type * as NoticesRepo from '@/features/notices/noticesRepo';
import type * as NotesRepo from './notesRepo';

/**
 * トレーナーのコメント（設計書 §11.3 A-8 / Phase 10）。
 *
 * ★ ここは実装中に見つけた本当の穴です。
 *
 *   最初は「過去を編集できる期間内かどうか」で書き込みを判定していました。
 *   つまり **契約者が自分でトレーナーのコメントを書き換えられる** 状態でした。
 *   指導の記録が本人の手で変えられるなら、記録として成り立ちません。
 *
 *   画面側でも書けないこと、Rules 側でも塞いであること（firebase/tests）の
 *   両方で守ります。ここは画面側の担当です。
 */

// お知らせ（追加仕様: お知らせ欄）は、ここでの主題ではありません。
// 本物を呼ぶと Firestore に触るので、差し替えておきます。
const pushNotice = vi.fn();
vi.mock('@/features/notices/noticesRepo', async () => {
  const actual = await vi.importActual<typeof NoticesRepo>('@/features/notices/noticesRepo');
  return { ...actual, pushNotice: (...a: unknown[]): unknown => pushNotice(...a) };
});

vi.mock('./notesRepo', async () => {
  const actual = await vi.importActual<typeof NotesRepo>('./notesRepo');
  return {
    ...actual,
    listNotes: vi.fn(),
    saveNote: vi.fn(),
    deleteNote: vi.fn(),
  };
});

const { listNotes, saveNote, deleteNote } = await import('./notesRepo');

function aNote(over: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    text: '夕食のたんぱく質、いい形で入っています。',
    by: 'uid-admin',
    createdAt: new Date('2026-08-28T23:30:00').getTime(),
    updatedAt: new Date('2026-08-28T23:30:00').getTime(),
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(listNotes).mockResolvedValue([]);
  vi.mocked(saveNote).mockResolvedValue(undefined);
  vi.mocked(deleteNote).mockResolvedValue(undefined);
  pushNotice.mockReset();
  pushNotice.mockResolvedValue([]);
});

function setup(isAdmin: boolean) {
  render(
    <NotesSection
      client={aClient({ clientId: 'tanaka01' })}
      date="2026-08-28"
      isAdmin={isAdmin}
      adminUid="uid-admin"
    />,
  );
}

describe('契約者が見るとき', () => {
  it('コメントを読める', async () => {
    vi.mocked(listNotes).mockResolvedValue([aNote()]);
    setup(false);
    expect(
      await screen.findByText('夕食のたんぱく質、いい形で入っています。'),
    ).toBeInTheDocument();
  });

  it('書く欄も、編集・削除のボタンも出ない', async () => {
    vi.mocked(listNotes).mockResolvedValue([aNote()]);
    setup(false);
    await screen.findByText('夕食のたんぱく質、いい形で入っています。');

    expect(screen.queryByLabelText('コメントを書く')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'コメントを送る' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '編集' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '削除' })).not.toBeInTheDocument();
  });

  it('コメントが1件も無い日は、欄そのものを出さない', async () => {
    // 空の欄が毎日並んでも意味がないので、ある日にだけ出します
    setup(false);
    await waitFor(() => {
      expect(screen.queryByText('トレーナーのコメント')).not.toBeInTheDocument();
    });
  });
});

describe('管理者が見るとき', () => {
  it('コメントが無くても、書く欄は出る', async () => {
    setup(true);
    expect(await screen.findByText('まだコメントはありません。')).toBeInTheDocument();
    expect(screen.getByLabelText('コメントを書く')).toBeInTheDocument();
  });

  it('書いて送ると保存される', async () => {
    setup(true);
    await screen.findByLabelText('コメントを書く');

    await userEvent.type(screen.getByLabelText('コメントを書く'), '明日は朝に卵を1つ。');
    await userEvent.click(screen.getByRole('button', { name: 'コメントを送る' }));

    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1));
    const [clientId, date, note] = firstCall(vi.mocked(saveNote));
    expect(clientId).toBe('tanaka01');
    expect(date).toBe('2026-08-28');
    expect(note.text).toBe('明日は朝に卵を1つ。');
    expect(note.by).toBe('uid-admin');
  });

  it('空のままでは送れない', async () => {
    setup(true);
    await screen.findByLabelText('コメントを書く');
    expect(screen.getByRole('button', { name: 'コメントを送る' })).toBeDisabled();
  });

  it('契約者から読めることを、書く人に伝える', async () => {
    setup(true);
    expect(
      await screen.findByText('契約者はこの日の画面で読めます。書き直しも削除もできます。'),
    ).toBeInTheDocument();
  });

  it('編集と削除ができる', async () => {
    vi.mocked(listNotes).mockResolvedValue([aNote()]);
    setup(true);
    await screen.findByText('夕食のたんぱく質、いい形で入っています。');

    expect(screen.getByRole('button', { name: '編集' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '削除' }));
    await waitFor(() => expect(deleteNote).toHaveBeenCalledTimes(1));
  });

  it('削除は、確認してからにする', async () => {
    window.confirm = vi.fn(() => false);
    vi.mocked(listNotes).mockResolvedValue([aNote()]);
    setup(true);
    await screen.findByText('夕食のたんぱく質、いい形で入っています。');

    await userEvent.click(screen.getByRole('button', { name: '削除' }));
    expect(deleteNote).not.toHaveBeenCalled();
  });
});

/**
 * コメントが届いたことを、契約者に知らせる（追加仕様: お知らせ欄）。
 *
 * ★ ここが無いと、契約者はコメントに気づけません。
 *   コメントは日ごとのページの中にあるので、
 *   その日を開き直さないかぎり、書かれたことが分かりません。
 */
describe('★ お知らせを出す', () => {
  it('コメントを保存すると、契約者にお知らせが届く', async () => {
    setup(true);
    await userEvent.type(
      await screen.findByLabelText(/コメント/),
      'よく続いています。',
    );
    await userEvent.click(screen.getByRole('button', { name: 'コメントを送る' }));

    await waitFor(() => expect(pushNotice).toHaveBeenCalledTimes(1));
    const [, notice] = firstCall(pushNotice) as [unknown, { id: string; date: string }];
    expect(notice.date).toBe('2026-08-28');
  });

  it('★ 同じ日のコメントを直しても、同じ目印になる（だから増えない）', async () => {
    // ★ 目印を日付から作っているので、2件目にはなりません。
    //   直すたびに増えると、ベルの数字ばかり大きくなって中身が読まれません。
    vi.mocked(listNotes).mockResolvedValue([aNote()]);
    setup(true);
    await screen.findByText('夕食のたんぱく質、いい形で入っています。');

    await userEvent.click(screen.getByRole('button', { name: '編集' }));
    await userEvent.click(screen.getByRole('button', { name: '保存する' }));

    await waitFor(() => expect(pushNotice).toHaveBeenCalledTimes(1));
    const [, notice] = firstCall(pushNotice) as [unknown, { id: string }];
    // 追加したときと同じ目印になる（日付から作っているため）
    expect(notice.id).toBe('comment-2026-08-28');
  });

  it('★ お知らせを出せなくても、コメントは保存できている', async () => {
    // ★ お知らせが出ないだけのことです。
    //   書いた言葉を失うほうが、ずっと困ります。
    pushNotice.mockRejectedValue(new Error('offline'));
    setup(true);
    await userEvent.type(await screen.findByLabelText(/コメント/), 'よく続いています。');
    await userEvent.click(screen.getByRole('button', { name: 'コメントを送る' }));

    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('よく続いています。')).toBeInTheDocument();
  });
});
