import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { readScannedRedeem, SHARD_UNIT, type RedeemRequest } from '@pt/core';

/**
 * アプリの中でQRを読む（追加仕様: かけらの交換QR）。
 *
 * ★ スマホの標準カメラでも読めますが、こちらのほうが確実です。
 *
 *   標準カメラから開くと Safari 側で開くため、
 *   ホーム画面のアプリでログインしていても入り直しになることがあります
 *   （iPhone は保存領域が別になることがあります）。
 *   アプリの中で読めば、そのまま交換画面に進めます。
 *
 * ★ 読めたQRを、そのまま信じません。
 *
 *   カメラを向ければ、商品のバーコードも、よそのサイトのQRも読めます。
 *   **このアプリの交換URLでなければ、何もしません**（core の readScannedRedeem）。
 *
 * ★ カメラの映像は、どこにも送っていません。
 *   端末の中で1コマずつ調べているだけです。保存もしていません。
 *   その一文を画面にも出しています。
 */

type Status = 'starting' | 'scanning' | 'denied' | 'unavailable' | 'insecure';

export function ScanScreen({
  onFound,
  onCancel,
}: {
  onFound: (req: RedeemRequest) => void;
  onCancel: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);

  const [status, setStatus] = useState<Status>('starting');
  /** このアプリのものでないQRを読んだとき。読み続けながら伝えます */
  const [foreign, setForeign] = useState(false);

  /** カメラを確実に止める。止め忘れるとランプが点いたままになります。 */
  const stop = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    stream.current?.getTracks().forEach((t) => {
      t.stop();
    });
    stream.current = null;
  }, []);

  useEffect(() => {
    let alive = true;

    // ★ カメラは https（または localhost）でしか開けません。
    //   分かっている条件なので、権限を求める前に伝えます。
    if (!window.isSecureContext) {
      setStatus('insecure');
      return;
    }
    if (navigator.mediaDevices?.getUserMedia === undefined) {
      setStatus('unavailable');
      return;
    }

    void (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          // ★ 背面カメラを頼みます。無ければ端末が適当に選びます
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (!alive) {
          s.getTracks().forEach((t) => {
            t.stop();
          });
          return;
        }
        stream.current = s;
        const el = video.current;
        if (el !== null) {
          el.srcObject = s;
          await el.play().catch(() => undefined);
        }
        setStatus('scanning');
        tick();
      } catch (e) {
        if (!alive) return;
        // 許可されなかったのか、カメラが無いのかを分けて伝えます
        const name = e instanceof DOMException ? e.name : '';
        setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
      }
    })();

    /** 1コマ読んで、次のコマを予約する。 */
    function tick() {
      if (!alive) return;

      const v = video.current;
      const c = canvas.current;
      const ctx = c?.getContext('2d', { willReadFrequently: true }) ?? null;

      if (v !== null && c !== null && ctx !== null && v.readyState === v.HAVE_ENOUGH_DATA) {
        // ★ 大きすぎると1コマの処理が重くなり、画面が固まります。
        //   横 480 まで縮めてから読みます。QRはこれで十分読めます。
        const scale = Math.min(1, 480 / v.videoWidth);
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        ctx.drawImage(v, 0, 0, c.width, c.height);

        const image = ctx.getImageData(0, 0, c.width, c.height);
        const found = jsQR(image.data, image.width, image.height, {
          inversionAttempts: 'dontInvert',
        });

        if (found !== null && found.data.length > 0) {
          const req = readScannedRedeem(
            found.data,
            window.location.origin,
            import.meta.env.BASE_URL,
          );
          if (req !== null) {
            stop();
            onFound(req);
            return;
          }
          // このアプリの交換QRではない。伝えつつ、読み続けます
          setForeign(true);
        }
      }

      // ★ requestAnimationFrame ではなく間隔を空けます。
      //   毎コマ読むと電池を食うわりに、読み取りやすさは変わりません。
      timer.current = window.setTimeout(tick, 180);
    }

    return () => {
      alive = false;
      stop();
    };
  }, [onFound, stop]);

  // 画面を離れるときも必ず止めます
  useEffect(() => stop, [stop]);

  return (
    <section className="card scan">
      <h2 className="title">QRを読む</h2>

      {status === 'scanning' || status === 'starting' ? (
        <>
          <div className="scan-view">
            <video ref={video} className="scan-video" playsInline muted />
            <div className="scan-frame" aria-hidden="true" />
          </div>
          <canvas ref={canvas} className="scan-canvas" aria-hidden="true" />

          <p className="lede">
            {status === 'starting' ? 'カメラを準備しています…' : '交換のQRに向けてください。'}
          </p>

          {foreign && (
            <p className="note" role="status">
              このアプリの交換QRではないようです。別のQRを読んでいませんか。
            </p>
          )}

          <p className="note">
            カメラの映像は、この端末の中だけで見ています。どこにも送らず、保存もしません。
          </p>
        </>
      ) : (
        <>
          <p className="form-error" role="alert">
            {status === 'denied'
              ? 'カメラを使う許可がありません。'
              : status === 'insecure'
                ? 'この開き方ではカメラを使えません。'
                : 'この端末ではカメラを使えません。'}
          </p>
          <p className="note">
            {status === 'denied'
              ? '端末の設定でこのアプリにカメラを許可すると、読み取れるようになります。'
              : 'スマホの標準のカメラでQRに向けても、交換画面を開けます。そちらをお試しください。'}
          </p>
          <p className="note">
            うまくいかないときは、トレーナーに{SHARD_UNIT}を引いてもらってください。
          </p>
        </>
      )}

      <div className="form-actions">
        <button
          className="button-secondary"
          type="button"
          onClick={() => {
            stop();
            onCancel();
          }}
        >
          やめる
        </button>
      </div>
    </section>
  );
}
