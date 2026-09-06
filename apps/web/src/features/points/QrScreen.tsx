import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  isValidRedeem,
  MAX_REDEEM,
  MAX_REDEEM_TEXT,
  redeemUrl,
  SHARD_NAME,
  SHARD_UNIT,
} from '@pt/core';
import { getDb } from '@/lib/firebase';
import { Shards, ShardIcon } from './ShardIcon';

/**
 * 交換のQRを作る（追加仕様: かけらの交換QR）。管理者だけが開けます。
 *
 * ★ QRの中身は、ただのURLです。
 *
 *   カメラの機能は作っていません。iPhone・Android の標準カメラが
 *   URLを読んで「開く」を出してくれるので、それに任せます。
 *   自前で読み取りを作ると、カメラの許可・機種ごとの差・
 *   失敗したときの案内が全部こちらの持ち物になります。
 *
 * ★ このQRは「値札」です。1回きりの切符ではありません。
 *
 *   誰あてかは入っていないので、読んだ人が自分のぶんを払います。
 *   だから印刷して棚に貼れます。毎回作り直す必要はありません。
 *
 * ★ 「払いました」は、契約者の画面では判断しません。
 *
 *   契約者の端末に出る「済みました」の画面は、いくらでも作れます。
 *   **この画面が Firestore を見て**、本当に減ったのを確かめてから
 *   緑に変わります。交換の場では、こちらの画面をご覧ください。
 */
export function QrScreen({ onBack }: { onBack: () => void }) {
  const [amountText, setAmountText] = useState('3');
  const [text, setText] = useState('');
  const [png, setPng] = useState<string | null>(null);

  /** 直近に届いた交換。この画面を開いている間だけ拾います */
  const [paid, setPaid] = useState<
    { name: string; amount: number; text: string; left: number; at: number }[]
  >([]);

  const amount = Number(amountText);
  const req = useMemo(() => ({ amount, text: text.trim() }), [amount, text]);
  const ok = isValidRedeem(req);

  const url = useMemo(() => {
    if (!ok) return '';
    return redeemUrl(window.location.origin, import.meta.env.BASE_URL, req);
  }, [ok, req]);

  useEffect(() => {
    if (url.length === 0) {
      setPng(null);
      return;
    }
    let alive = true;
    void QRCode.toDataURL(url, {
      width: 640,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#14201e', light: '#ffffff' },
    }).then((d) => {
      if (alive) setPng(d);
    });
    return () => {
      alive = false;
    };
  }, [url]);

  /**
   * 交換が起きたかを見張ります。
   *
   * ★ 開いた時点の中身は「すでに済んだもの」として無視します。
   *   画面を開いた瞬間に、先週の交換が「いま払われました」と
   *   出てしまうのを防ぐためです。
   */
  const seen = useRef<Map<string, number> | null>(null);

  useEffect(() => {
    const stop = onSnapshot(collection(getDb(), 'clients'), (snap) => {
      const first = seen.current === null;
      if (first) seen.current = new Map();
      const marks = seen.current;
      if (marks === null) return;

      const fresh: typeof paid = [];

      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>;
        const r = data.lastRedemption as
          | { at?: { toMillis?: () => number }; amount?: number; text?: string }
          | undefined;
        if (r === undefined || typeof r.amount !== 'number') continue;

        const at = typeof r.at?.toMillis === 'function' ? r.at.toMillis() : 0;
        const before = marks.get(d.id);
        marks.set(d.id, at);

        // 開いた時点のものと、変わっていないものは出しません
        if (first || before === undefined || at <= before) continue;

        fresh.push({
          name: typeof data.displayName === 'string' ? data.displayName : d.id,
          amount: r.amount,
          text: typeof r.text === 'string' ? r.text : '',
          left: typeof data.points === 'number' ? data.points : 0,
          at,
        });
      }

      if (fresh.length > 0) setPaid((prev) => [...fresh, ...prev].slice(0, 10));
    });

    return () => {
      stop();
    };
  }, []);

  const clearPaid = useCallback(() => setPaid([]), []);

  return (
    <>
      <div className="section-head">
        <h2 className="title">交換のQR</h2>
        <button className="button-secondary compact" type="button" onClick={onBack}>
          戻る
        </button>
      </div>

      <section className="card">
        <h3 className="card-title">なにと、いくつで交換するか</h3>

        <label className="field">
          <span className="field-label">交換するもの</span>
          <input
            className="input"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="プロテイン1杯"
            maxLength={MAX_REDEEM_TEXT}
          />
        </label>

        <label className="field">
          <span className="field-label">{SHARD_UNIT}の数</span>
          <input
            className="input quick-shards-amount"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_REDEEM}
            step={1}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
          />
        </label>

        <div className="quick-shards-presets">
          {[1, 3, 5, 10, 30].map((n) => (
            <button
              key={n}
              type="button"
              className={amountText === String(n) ? 'choice on' : 'choice'}
              onClick={() => setAmountText(String(n))}
            >
              {n}
            </button>
          ))}
        </div>

        {!ok && (
          <p className="note">
            交換するものを書いて、数を 1 〜 {MAX_REDEEM.toLocaleString('ja-JP')} で入れてください。
          </p>
        )}
      </section>

      {ok && png !== null && (
        <section className="card qr-card">
          <p className="qr-caption">
            {req.text}
            <span className="qr-amount">
              <Shards n={req.amount} />
            </span>
          </p>

          <img className="qr-image" src={png} alt={`${req.text} ${req.amount}${SHARD_UNIT} の交換QR`} />

          <p className="note">
            契約者にスマホの<strong>普通のカメラ</strong>で読んでもらってください。
            アプリを開かなくても、カメラを向けるだけで交換画面が出ます。
          </p>
          <p className="note">
            ★ このQRは<strong>何度でも使えます</strong>。印刷して棚に貼っておけます。
            読んだ人が自分の{SHARD_UNIT}を払います。
          </p>
        </section>
      )}

      {/* ★ ここが「本当に払われたか」の確認です。
             相手のスマホの画面ではなく、こちらを見てください。 */}
      <section className="card">
        <div className="section-head">
          <h3 className="card-title">受け取り</h3>
          {paid.length > 0 && (
            <button className="button-secondary compact" type="button" onClick={clearPaid}>
              消す
            </button>
          )}
        </div>

        {paid.length === 0 ? (
          <p className="note">
            ここに出たら、{SHARD_UNIT}が確かに引かれています。
            <strong>相手の画面ではなく、こちらでご確認ください。</strong>
            相手の端末に出る「済みました」は、こちらが確かめたものではありません。
          </p>
        ) : (
          <ul className="qr-paid">
            {paid.map((p) => (
              <li key={`${p.name}-${p.at}`}>
                <span className="qr-paid-mark" aria-hidden="true">
                  <ShardIcon />
                </span>
                <span className="qr-paid-name">{p.name}</span>
                <span className="qr-paid-what">{p.text}</span>
                <span className="points-delta minus">
                  <Shards n={p.amount} />
                </span>
                <span className="qr-paid-left">
                  残り <Shards n={p.left} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="note">
        {SHARD_NAME}は、この画面を開いている間だけ見張っています。
        画面を閉じると受け取りの一覧は消えますが、引かれたこと自体は残ります。
      </p>
    </>
  );
}
