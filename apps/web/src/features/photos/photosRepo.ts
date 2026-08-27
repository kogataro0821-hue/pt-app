import { collection, deleteDoc, doc, getDocs, orderBy, query, setDoc } from 'firebase/firestore';
import { isPhotoExpired, type DateKey } from '@pt/core';
import { getDb } from '@/lib/firebase';
import type { ResizedPhoto } from './resize';

/**
 * 写真の読み書き（設計書 §4.3）。
 *
 * 置き場所: clients/{cid}/days/{date}/photos/{photoId}
 *
 * ★ 1枚 = 1ドキュメントです。まとめて1つのドキュメントに入れると、
 *   Firestore の1MiB上限にすぐ届きますし、1枚見るだけで全部読むことになります。
 *
 * ★ Rules 側で dataUrl のサイズ上限（400,000バイト）と、
 *   「更新はできない・消して撮り直す」という制約をかけています。
 *   写真を差し替えられると、確定済みの記録の意味が変わってしまうためです。
 */

export interface Photo {
  id: string;
  /** `data:image/jpeg;base64,...` */
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  /** どの食事に紐づくか。日単位の写真なら null */
  mealId: string | null;
  caption: string;
  createdAt: number;
}

function col(clientId: string, date: DateKey) {
  return collection(getDb(), 'clients', clientId, 'days', date, 'photos');
}

export async function listPhotos(clientId: string, date: DateKey): Promise<Photo[]> {
  const snap = await getDocs(query(col(clientId, date), orderBy('createdAt')));
  return snap.docs.map((d) => toPhoto(d.id, d.data()));
}

export async function addPhoto(
  clientId: string,
  date: DateKey,
  resized: ResizedPhoto,
  options: { mealId?: string | null; caption?: string } = {},
): Promise<Photo> {
  const photo: Photo = {
    id: newPhotoId(),
    dataUrl: resized.dataUrl,
    width: resized.width,
    height: resized.height,
    bytes: resized.bytes,
    mealId: options.mealId ?? null,
    caption: options.caption ?? '',
    createdAt: Date.now(),
  };

  await setDoc(doc(col(clientId, date), photo.id), {
    dataUrl: photo.dataUrl,
    width: photo.width,
    height: photo.height,
    bytes: photo.bytes,
    mealId: photo.mealId,
    caption: photo.caption,
    createdAt: photo.createdAt,
  });

  return photo;
}

/** ★ 写真は差し替えません。消して撮り直します（Rules でも update を禁止しています）。 */
export async function deletePhoto(
  clientId: string,
  date: DateKey,
  photoId: string,
): Promise<void> {
  await deleteDoc(doc(col(clientId, date), photoId));
}

/**
 * その日の写真をすべて消す（管理者の「確認しました」で使う）。
 *
 * ★ 数値は消えません。消えるのは画像だけです。
 *   食材・量・kcal・PFC は記録として残ります。
 *   写真は「その数値が正しいか確かめるための材料」なので、
 *   確認が済んだあとまで置いておく理由がありません（設計書 §8.2）。
 */
export async function deleteAllPhotos(clientId: string, date: DateKey): Promise<number> {
  const snap = await getDocs(col(clientId, date));
  for (const d of snap.docs) {
    await deleteDoc(d.ref);
  }
  return snap.size;
}

/**
 * 期限切れの写真を消す。
 *
 * ★ Cloud Functions が使えないので、自動では走りません。
 *   誰かがその日の写真欄を開いたときに、そこだけ掃除します。
 *   消し漏れは残りますが、それは「容量が減らない」だけで、
 *   記録が壊れるわけではありません。
 *
 * 戻り値は消した枚数です。0 なら画面は何も変える必要がありません。
 */
export async function deleteExpiredPhotos(
  clientId: string,
  date: DateKey,
  now: number = Date.now(),
): Promise<number> {
  const snap = await getDocs(col(clientId, date));
  let removed = 0;

  for (const d of snap.docs) {
    const createdAt = num(d.data().createdAt, 0);
    // createdAt が壊れている写真は消しません。
    // 0 として扱うと「大昔の写真」になり、消えてはいけないものが消えます。
    if (createdAt > 0 && isPhotoExpired(createdAt, now)) {
      await deleteDoc(d.ref);
      removed += 1;
    }
  }

  return removed;
}

function newPhotoId(): string {
  return `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function toPhoto(id: string, data: Record<string, unknown>): Photo {
  return {
    id,
    dataUrl: typeof data.dataUrl === 'string' ? data.dataUrl : '',
    width: num(data.width, 0),
    height: num(data.height, 0),
    bytes: num(data.bytes, 0),
    mealId: typeof data.mealId === 'string' ? data.mealId : null,
    caption: typeof data.caption === 'string' ? data.caption : '',
    createdAt: num(data.createdAt, 0),
  };
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
