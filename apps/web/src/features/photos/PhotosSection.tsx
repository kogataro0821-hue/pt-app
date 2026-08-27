import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PHOTO_RETENTION_DAYS,
  isPhotoExpiringSoon,
  photoExpiryLabel,
  type DateKey,
} from '@pt/core';
import { syncDayPhotoState } from '@/features/days/daysRepo';
import {
  addPhoto,
  deleteExpiredPhotos,
  deletePhoto,
  listPhotos,
  type Photo,
} from './photosRepo';
import { PhotoResizeError, formatBytes, photoErrorMessage, resizePhoto } from './resize';

/**
 * その日の写真（設計書 §4.3）。
 *
 * ★ 撮った写真をそのまま送りません。ブラウザ側で必ず縮小してから保存します。
 *   理由は resize.ts の説明のとおりで、これが無いと保存自体ができません。
 *
 * ★ 写真は差し替えられません。消して撮り直す形にしています。
 *   確定した記録の写真だけが後から変わると、記録の意味が変わってしまうためです。
 */
export function PhotosSection({
  clientId,
  date,
  canEdit,
  onPhotosChanged,
}: {
  clientId: string;
  date: DateKey;
  canEdit: boolean;
  /** 写真の枚数が変わったことを親へ伝える（確認カードの表示に使う） */
  onPhotosChanged?: (count: number) => void;
}) {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [zoomed, setZoomed] = useState<Photo | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * 写真の状況を日ドキュメントへ写す。
   *
   * 「もうすぐ消える写真」を1回のクエリで探すために、
   * その日でいちばん古い写真の時刻だけを持たせておきます。
   * 失敗しても写真そのものは無事なので、握りつぶします。
   */
  const syncOldest = useCallback(
    (list: Photo[]) => {
      onPhotosChanged?.(list.length);
      const oldest = list.reduce<number | null>(
        (min, p) => (p.createdAt > 0 && (min === null || p.createdAt < min) ? p.createdAt : min),
        null,
      );
      void syncDayPhotoState(clientId, date, oldest).catch(() => undefined);
    },
    [clientId, date, onPhotosChanged],
  );

  useEffect(() => {
    let cancelled = false;
    setPhotos(null);
    setError(null);

    void (async () => {
      try {
        // ★ 期限切れをここで消します。
        //   Cloud Functions が使えないので、自動では走りません。
        //   開いた人が掃除する形です（設計書 §8.2）。
        //   消せなくても表示は続けます。権限や通信の問題で消せないことがあり、
        //   そのために写真が1枚も見られなくなるほうが困ります。
        try {
          await deleteExpiredPhotos(clientId, date);
        } catch {
          // 掃除できなくても、写真の表示そのものは成立する
        }

        const loaded = await listPhotos(clientId, date);
        if (cancelled) return;
        setPhotos(loaded);
        syncOldest(loaded);
      } catch {
        if (!cancelled) {
          setError('写真を読み込めませんでした。');
          setPhotos([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId, date, syncOldest]);

  async function onPick(files: FileList | null) {
    if (files === null || files.length === 0) return;

    setBusy(true);
    setError(null);

    // 複数選ばれても1枚ずつ処理する。まとめて送ると失敗したときに
    // どれが保存できたのか分からなくなるため。
    for (const file of Array.from(files)) {
      try {
        const resized = await resizePhoto(file);
        const saved = await addPhoto(clientId, date, resized);
        setPhotos((prev) => {
          const next = [...(prev ?? []), saved];
          syncOldest(next);
          return next;
        });
      } catch (e) {
        setError(
          e instanceof PhotoResizeError
            ? photoErrorMessage(e.kind)
            : canEdit
              ? '写真を保存できませんでした。通信状態を確認してください。'
              : 'この日は編集できないため保存されませんでした。',
        );
        break;
      }
    }

    setBusy(false);
    if (fileInput.current !== null) fileInput.current.value = '';
  }

  async function remove(photo: Photo) {
    if (!window.confirm('この写真を削除します。よろしいですか？')) return;
    const previous = photos;
    const next = (photos ?? []).filter((p) => p.id !== photo.id);
    setPhotos(next);
    try {
      await deletePhoto(clientId, date, photo.id);
      syncOldest(next);
    } catch {
      setPhotos(previous);
      setError('写真を削除できませんでした。');
    }
  }

  const now = Date.now();
  const expiring = (photos ?? []).filter((p) => p.createdAt > 0 && isPhotoExpiringSoon(p.createdAt, now));

  if (photos === null) {
    return (
      <section className="card">
        <h3 className="card-title">写真</h3>
        <p className="lede">読み込んでいます…</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h3 className="card-title">写真</h3>

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {photos.length === 0 && <p className="note">この日の写真はありません。</p>}

      {expiring.length > 0 && (
        <p className="notice" role="status">
          <b>{photoExpiryLabel(expiring[0]!.createdAt, Date.now())}。</b>
          <br />
          写真は{PHOTO_RETENTION_DAYS}日で消えます。残しておきたいものは、
          写真を長押しして端末に保存してください。
          <br />
          食材・量・kcal・PFCの記録は消えません。
        </p>
      )}

      {photos.length > 0 && (
        <div className="photo-grid">
          {photos.map((photo) => (
            <div className="photo-cell" key={photo.id}>
              <button
                type="button"
                className="photo-open"
                onClick={() => setZoomed(photo)}
                aria-label="写真を拡大"
              >
                <img src={photo.dataUrl} alt="" loading="lazy" />
              </button>
              {canEdit && (
                <button
                  type="button"
                  className="photo-remove"
                  onClick={() => void remove(photo)}
                  aria-label="この写真を削除"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => void onPick(e.target.files)}
          />
          <button
            className="button-secondary"
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
          >
            {busy ? '処理中…' : '+ 写真を追加'}
          </button>
          <p className="note">
            撮った写真はこの端末の中で縮小してから保存します。通信量も保存容量も抑えられます。
            <br />
            写真は差し替えできません。撮り直すときは、いったん削除してください。
            <br />
            写真は{PHOTO_RETENTION_DAYS}日で消えます（トレーナーが確認したときも消えます）。
            記録の数字は残ります。
          </p>
        </>
      )}

      {zoomed !== null && (
        <div
          className="photo-zoom"
          role="dialog"
          aria-modal="true"
          onClick={() => setZoomed(null)}
        >
          <img src={zoomed.dataUrl} alt="" />
          <div className="photo-zoom-bar">
            <span>
              {zoomed.width}×{zoomed.height} · {formatBytes(zoomed.bytes)}
            </span>
            <button className="button-quiet" type="button" onClick={() => setZoomed(null)}>
              閉じる
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
