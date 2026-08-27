import { collection, deleteDoc, doc, getDocs, orderBy, query, setDoc } from 'firebase/firestore';
import type { DateKey } from '@pt/core';
import { getDb } from '@/lib/firebase';

/**
 * トレーナーのコメント（設計書 §11.3 A-8 / Phase 10）。
 *
 * 置き場所: clients/{cid}/days/{date}/notes/{noteId}
 *
 * ★ 書けるのは管理者だけです。契約者は読むだけです。
 *
 *   これはAI評価とは別枠の、人が書く言葉です。
 *   契約者が書き換えられると、トレーナーが言ったことが
 *   あとから変わってしまい、指導の記録になりません。
 *   Rules 側でも管理者だけに限定しています。
 *
 * ★ 確定済みの日にも書けます。
 *
 *   1日の確定は「今日はもう食べません」という契約者の意思表示であって、
 *   トレーナーが黙る合図ではありません。
 *   むしろ確定したあとに書くほうが自然です。
 */

export interface Note {
  id: string;
  text: string;
  /** 書いた管理者のUID */
  by: string;
  createdAt: number;
  updatedAt: number;
}

/** 1件の上限。長文はここで扱うものではないので、抑えめにしてあります。 */
export const NOTE_MAX_LENGTH = 2000;

function notesCol(clientId: string, date: DateKey) {
  return collection(getDb(), 'clients', clientId, 'days', date, 'notes');
}

export async function listNotes(clientId: string, date: DateKey): Promise<Note[]> {
  const snap = await getDocs(query(notesCol(clientId, date), orderBy('createdAt')));
  return snap.docs.map((d) => toNote(d.id, d.data()));
}

export async function saveNote(
  clientId: string,
  date: DateKey,
  note: Note,
): Promise<void> {
  await setDoc(doc(notesCol(clientId, date), note.id), {
    text: note.text,
    by: note.by,
    createdAt: note.createdAt,
    updatedAt: Date.now(),
  });
}

export async function deleteNote(
  clientId: string,
  date: DateKey,
  noteId: string,
): Promise<void> {
  await deleteDoc(doc(notesCol(clientId, date), noteId));
}

/** 時系列に並ぶIDにしておくと、並び順が壊れても復元しやすい。 */
export function newNoteId(): string {
  return `n${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function toNote(id: string, data: Record<string, unknown>): Note {
  return {
    id,
    text: typeof data.text === 'string' ? data.text : '',
    by: typeof data.by === 'string' ? data.by : '',
    createdAt: num(data.createdAt),
    updatedAt: num(data.updatedAt),
  };
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
