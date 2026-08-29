import { useEffect, useRef, useState } from 'react';
import type { DateKey } from '@pt/core';
import { readErrorMessage, writeErrorMessage } from '@/lib/firestoreError';
import type { Client } from '@/features/clients/clientTypes';
import { commentNotice, pushNotice } from '@/features/notices/noticesRepo';
import {
  deleteNote,
  listNotes,
  newNoteId,
  NOTE_MAX_LENGTH,
  saveNote,
  type Note,
} from './notesRepo';

/**
 * トレーナーのコメント（設計書 §11.3 A-8 / Phase 10）。
 *
 * ★ 書けるのは管理者だけ。契約者は読むだけです。
 *   画面での出し分けは見せ方でしかなく、本当の制限は Rules 側にあります。
 *
 * ★ 契約者側は、コメントが無ければ何も出しません。
 *
 *   「まだコメントはありません」と毎日出すと、
 *   毎日その空欄を見ることになり、無いこと自体が目立ってしまいます。
 *   トレーナーは毎日書くとは限らないので、無い日は静かにしておきます。
 */
export function NotesSection({
  client,
  date,
  isAdmin,
  adminUid,
}: {
  client: Client;
  date: DateKey;
  isAdmin: boolean;
  /** 書いた人として記録するUID。管理者以外では使いません */
  adminUid: string;
}) {
  const clientId = client.clientId;
  /**
   * いまのお知らせ一覧（追加仕様: お知らせ欄）。
   *
   * ★ props の client は、この画面を開いた時点のものです。
   *   コメントを2回保存するとき、2回目も古い一覧を渡してしまうと
   *   1回目のお知らせが消えます。書いたぶんをここで覚えておきます。
   */
  const noticesRef = useRef(client.notices);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setNotes(null);
    setError(null);
    setDraft('');
    setEditingId(null);

    void (async () => {
      try {
        const loaded = await listNotes(clientId, date);
        if (!cancelled) setNotes(loaded);
      } catch (e) {
        if (!cancelled) {
          setError(readErrorMessage(e, 'コメント'));
          setNotes([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId, date]);

  /**
   * コメントが届いたことを、契約者に知らせる（追加仕様: お知らせ欄）。
   *
   * ★ 同じ日のコメントは、何度直しても**お知らせ1件**です。
   *   目印を日付から作っているので、2件目にはなりません。
   *
   * ★ ここが失敗しても、コメント自体は保存できています。
   *   お知らせが出ないだけのことで、書いた言葉を失うほうがずっと困ります。
   *   エラーは出しません。
   */
  async function notifyClient() {
    if (!isAdmin) return;
    try {
      noticesRef.current = await pushNotice(
        { ...client, notices: noticesRef.current },
        commentNotice(date),
      );
    } catch {
      // お知らせを出せなくても、コメントは保存できている
    }
  }

  async function add() {
    const text = draft.trim();
    if (text.length === 0) return;

    const note: Note = {
      id: newNoteId(),
      text,
      by: adminUid,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setBusy(true);
    setError(null);
    try {
      await saveNote(clientId, date, note);
      setNotes([...(notes ?? []), note]);
      setDraft('');
      await notifyClient();
    } catch (e) {
      setError(writeErrorMessage(e, 'コメント'));
    } finally {
      setBusy(false);
    }
  }

  async function commitEdit(note: Note) {
    const text = editText.trim();
    if (text.length === 0) return;

    const updated = { ...note, text, updatedAt: Date.now() };
    setBusy(true);
    setError(null);
    try {
      await saveNote(clientId, date, updated);
      setNotes((notes ?? []).map((n) => (n.id === note.id ? updated : n)));
      setEditingId(null);
      await notifyClient();
    } catch (e) {
      setError(writeErrorMessage(e, 'コメント'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(note: Note) {
    if (!window.confirm('このコメントを削除します。よろしいですか？')) return;

    setBusy(true);
    setError(null);
    try {
      await deleteNote(clientId, date, note.id);
      setNotes((notes ?? []).filter((n) => n.id !== note.id));
    } catch (e) {
      setError(writeErrorMessage(e, 'コメント'));
    } finally {
      setBusy(false);
    }
  }

  if (notes === null) {
    // 読み込み中に枠だけ出すと、コメントが無い日でも一瞬空欄が見えます。
    // 管理者は必ず欄が要るので出し、契約者には出しません。
    return isAdmin ? (
      <section className="card">
        <h3 className="card-title">トレーナーのコメント</h3>
        <p className="lede">読み込んでいます…</p>
      </section>
    ) : null;
  }

  // 契約者側で、コメントも失敗も無いなら、何も出しません
  if (!isAdmin && notes.length === 0 && error === null) return null;

  return (
    <section className="card">
      <h3 className="card-title">トレーナーのコメント</h3>

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {notes.length === 0 && isAdmin && (
        <p className="lede">まだコメントはありません。</p>
      )}

      {notes.map((note) => (
        <div className="note-item" key={note.id}>
          {editingId === note.id ? (
            <>
              <textarea
                className="input note-input"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                maxLength={NOTE_MAX_LENGTH}
                rows={4}
                aria-label="コメントを編集"
              />
              <div className="item-form-actions">
                <button
                  className="button-primary compact"
                  type="button"
                  onClick={() => void commitEdit(note)}
                  disabled={busy || editText.trim().length === 0}
                >
                  保存する
                </button>
                <button
                  className="button-quiet"
                  type="button"
                  onClick={() => setEditingId(null)}
                  disabled={busy}
                >
                  やめる
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="note-text">{note.text}</p>
              <div className="note-meta">
                <span>{formatWhen(note)}</span>
                {isAdmin && (
                  <span className="item-actions">
                    <button
                      className="button-quiet"
                      type="button"
                      onClick={() => {
                        setEditingId(note.id);
                        setEditText(note.text);
                      }}
                      disabled={busy}
                    >
                      編集
                    </button>
                    <button
                      className="button-quiet"
                      type="button"
                      onClick={() => void remove(note)}
                      disabled={busy}
                    >
                      削除
                    </button>
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      ))}

      {isAdmin && editingId === null && (
        <>
          <textarea
            className="input note-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={NOTE_MAX_LENGTH}
            rows={3}
            placeholder="この日の記録について、伝えたいことを書きます。"
            aria-label="コメントを書く"
          />
          <div className="item-form-actions">
            <button
              className="button-primary compact"
              type="button"
              onClick={() => void add()}
              disabled={busy || draft.trim().length === 0}
            >
              {busy ? '送っています…' : 'コメントを送る'}
            </button>
          </div>
          <p className="field-hint">
            契約者はこの日の画面で読めます。書き直しも削除もできます。
          </p>
        </>
      )}
    </section>
  );
}

/** 「8月27日 14:30」。直したものには印を付ける。 */
function formatWhen(note: Note): string {
  const at = new Date(note.createdAt);
  const stamp = `${at.getMonth() + 1}月${at.getDate()}日 ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  // 1分以上あとに更新されていれば「直した」とみなします。
  // 保存直後の数ミリ秒差で毎回「編集済み」が付くのを避けるためです。
  return note.updatedAt - note.createdAt > 60_000 ? `${stamp}（編集済み）` : stamp;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
