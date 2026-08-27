import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import type { DateKey } from '@pt/core';
import { getDb } from '@/lib/firebase';

/**
 * AI評価の読み書き（設計書 §26 / Phase 14）。
 *
 * 置き場所: clients/{cid}/days/{date}/review/latest
 *
 * ★ 1日につき1件だけ持ちます。
 *
 *   何度でも作り直せますが、履歴は残しません。
 *   評価は「いまの記録に対する言葉」なので、
 *   記録が変わったあとの古い評価に意味はありません。
 *   溜めると無料枠も食います。
 *
 * ★ トレーナーのコメントとは別物です（notes とは別のコレクション）。
 *   人が書いた言葉とAIが書いた言葉が混ざると、
 *   契約者はどちらの発言か分からなくなります。
 */

export interface DayReview {
  text: string;
  /** 生成に使った評価モード */
  mode: string;
  /** 誰が作らせたか（契約者本人か管理者か）。UID */
  by: string;
  createdAt: number;
}

export const REVIEW_DOC_ID = 'latest';

function reviewRef(clientId: string, date: DateKey) {
  return doc(getDb(), 'clients', clientId, 'days', date, 'review', REVIEW_DOC_ID);
}

export async function getReview(clientId: string, date: DateKey): Promise<DayReview | null> {
  const snap = await getDoc(reviewRef(clientId, date));
  if (!snap.exists()) return null;

  const data = snap.data();
  return {
    text: typeof data.text === 'string' ? data.text : '',
    mode: typeof data.mode === 'string' ? data.mode : 'standard',
    by: typeof data.by === 'string' ? data.by : '',
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
  };
}

export async function saveReview(
  clientId: string,
  date: DateKey,
  review: DayReview,
): Promise<void> {
  await setDoc(reviewRef(clientId, date), {
    text: review.text,
    mode: review.mode,
    by: review.by,
    createdAt: review.createdAt,
  });
}

export async function deleteReview(clientId: string, date: DateKey): Promise<void> {
  await deleteDoc(reviewRef(clientId, date));
}
