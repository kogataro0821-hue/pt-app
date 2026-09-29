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

/**
 * 一度カメラを使えた、という覚え書きの置き場所。
 *
 * ★ 2回目からは、断り方の説明を挟みません。
 *
 *   説明が要るのは「これから許可を聞かれる人」だけです。
 *   もう許可した人に毎回1枚挟むと、レジの前で1タップ増えます。
 *   毎日使うものなので、そこは削ります。
 *
 * ★ 読めなくても困りません。説明が1枚増えるだけです。
 *   だから失敗を握りつぶします（プライベートモードでは読めません）。
 */
const SEEN_KEY = 'shard-scan-camera-ok';

function cameraUsedBefore(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberCameraUsed(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // 覚えられなくても、説明が1枚増えるだけです
  }
}

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

  /**
   * ★ 初めての人には、カメラを開く**前に**1枚挟みます。
   *
   *   ここで断ると、iPhone では戻す道がほとんどありません。
   *   設定にこのアプリが出てこないので、**アイコンを作り直す**しか
   *   なくなります（作り直すとログインし直しです）。
   *   実際にそれで詰まった人がいました。
   *
   *   断ったあとに直し方を書くより、**断らせないほうが早い**です。
   */
  const [status, setStatus] = useState<Status>('starting');

  /**
   * カメラを触ってよいか。
   *
   * ★ status とは別に持ちます。
   *
   *   status を材料にすると、'starting' → 'scanning' に変わった時点で
   *   この仕掛け全体が組み直され、**開いたばかりのカメラを自分で止めます**。
   *   一度だけ切り替わる値を材料にします。
   */
  const [started, setStarted] = useState<boolean>(() => cameraUsedBefore());
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
    // ★ 説明を出しているあいだは、カメラに触りません。
    //   触った時点で許可を聞かれてしまい、1枚挟んだ意味がなくなります。
    if (!started) return;

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
        // ★ ここまで来たら、この端末では許可が取れています。
        //   次からは説明を挟みません。
        rememberCameraUsed();
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
  }, [onFound, stop, started]);

  // 画面を離れるときも必ず止めます
  useEffect(() => stop, [stop]);

  return (
    <section className="card scan">
      <h2 className="title">QRを読む</h2>

      {!started ? (
        /* ★ カメラを開く前の1枚（追加仕様: 交換QR）。
               ここで断られると、iPhone では戻す道がほとんどありません。
               **断らせないことが、直し方を書くことより効きます。** */
        <>
          <p className="lede">このあと、カメラを使ってよいか聞かれます。</p>
          <p className="note">
            <b>「許可」を押してください。</b>
            ここで断ると、あとから戻すのがとても面倒になります
            （iPhone はアイコンを作り直すことになり、ログインし直しです）。
          </p>
          <p className="note">
            カメラの映像は、この端末の中だけで見ています。どこにも送らず、保存もしません。
            読むのは交換のQRだけです。
          </p>
          <div className="form-actions">
            <button
              className="button-primary"
              type="button"
              onClick={() => {
                setStarted(true);
              }}
            >
              カメラを使う
            </button>
            {/* ★ ここにも出口を置きます。
                   説明だけ出して閉じられない画面は、それ自体が行き止まりです。 */}
            <button className="button-secondary" type="button" onClick={onCancel}>
              やめる
            </button>
          </div>
        </>
      ) : status === 'scanning' || status === 'starting' ? (
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

          {/* ★ ここには「設定で許可してください」としか書いていませんでした。
                 いちばん知りたいこと（**いま使う方法**）が書いていない画面です。
                 まず今日の逃げ道、次に元に戻す道、の順に置きます。 */}
          <p className="note">
            <b>いますぐ使うなら、スマホの標準のカメラアプリでQRに向けてください。</b>
            画面に出るリンクを押せば、交換の画面が開きます。
            許可を断ったままでも通ります。
          </p>

          {status === 'denied' && (
            <p className="note">
              このアプリの中で読めるように戻すには、
              <b>ホーム画面のアイコンを作り直します</b>
              （長押しして削除 → Safariで開き直して「ホーム画面に追加」）。
              ホーム画面に追加したアプリは、設定の一覧に出てこないことがあり、
              スイッチで戻せません。
              <br />
              <b>作り直すとログインし直しになります。</b>
              メールアドレスとパスワードが分かることを確かめてから行ってください。
              記録した内容は消えません。
            </p>
          )}

          <p className="note">
            うまくいかないときは、トレーナーに{SHARD_UNIT}を引いてもらってください。
          </p>
        </>
      )}

      {started && (
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
      )}
    </section>
  );
}
