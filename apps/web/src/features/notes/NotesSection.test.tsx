import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotesSection } from './NotesSection';
import type { Note } from './notesRepo';
import { firstCall } from '@/test/helpers';
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
});

function setup(isAdmin: boolean) {
  render(
    <NotesSection clientId="tanaka01" date="2026-08-28" isAdmin={isAdmin} adminUid="uid-admin" />,
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
