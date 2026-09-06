import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  findSameItem,
  isValidRedeem,
  MAX_EXCHANGE_ITEMS,
  MAX_REDEEM,
  MAX_REDEEM_TEXT,
  redeemUrl,
  SHARD_NAME,
  SHARD_UNIT,
  type ExchangeItem,
} from '@pt/core';
import { getDb } from '@/lib/firebase';
import { Shards, ShardIcon } from './ShardIcon';
import {
  deleteExchangeItem,
  listExchangeItems,
  saveExchangeItem,
} from './exchangeItemsRepo';

/**
 * 交換のQRを作る（追加仕様: かけらの交換QR）。管理者だけが開けます。
 *
 * ★ QRの中身は、ただのURLです。
 *
 *   読み方は2通りあります。
 *
 *     1. アプリの中の読み取り（ScanScreen）… ログインしたまま進めます
 *     2. スマホの標準カメラ … アプリを開かなくても読めます
 *
 *   中身がURLなので、どちらでも同じQRが使えます。
 *   2 は Safari 側で開くため、ログインし直しになることがあります。
 *   だから 1 を主に案内しています。
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

  /** 保存した交換（追加仕様: かけらの交換QR）。同じQRを作り直さないため */
  const [items, setItems] = useState<ExchangeItem[] | null>(null);
  const [itemError, setItemError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  const loadItems = useCallback(async () => {
    setItemError(null);
    try {
      setItems(await listExchangeItems());
    } catch {
      setItemError('保存した交換を読み込めませんでした。');
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  /** いま入力している内容が、すでに保存されているか */
  const already = items === null ? undefined : findSameItem(items, req);
  const full = (items?.length ?? 0) >= MAX_EXCHANGE_ITEMS;

  async function save() {
    if (!ok || saving || already !== undefined || full) return;
    setSaving(true);
    setItemError(null);
    try {
      await saveExchangeItem({ text: req.text, amount: req.amount });
      await loadItems();
    } catch {
      setItemError('保存できませんでした。通信状態を確認してください。');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteExchangeItem(id);
      await loadItems();
    } catch {
      setItemError('消せませんでした。通信状態を確認してください。');
    }
  }

  return (
    <>
      <div className="section-head">
        <h2 className="title">交換のQR</h2>
        <button className="button-secondary compact" type="button" onClick={onBack}>
          戻る
        </button>
      </div>

      {/* ★ よく使うものを先に出します。
             毎回同じ内容を打ち直すのは無駄ですし、
             打ち直すたびに数を間違える余地が生まれます。 */}
      {items !== null && items.length > 0 && (
        <section className="card">
          <h3 className="card-title">保存した交換</h3>
          <ul className="exchange-items">
            {items.map((it) => {
              const on = it.text === req.text && it.amount === req.amount;
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    className={on ? 'exchange-item on' : 'exchange-item'}
                    aria-pressed={on}
                    onClick={() => {
                      setText(it.text);
                      setAmountText(String(it.amount));
                    }}
                  >
                    <span className="exchange-item-text">{it.text}</span>
                    <Shards n={it.amount} className="exchange-item-amount" />
                  </button>
                  <button
                    type="button"
                    className="button-secondary compact"
                    aria-label={`${it.text} を消す`}
                    onClick={() => void remove(it.id)}
                  >
                    消す
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

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

        {ok && (
          <div className="form-actions">
            <button
              className="button-secondary"
              type="button"
              disabled={saving || already !== undefined || full}
              onClick={() => void save()}
            >
              {already !== undefined
                ? '保存ずみ'
                : full
                  ? `保存は ${MAX_EXCHANGE_ITEMS} 件までです`
                  : saving
                    ? '保存しています…'
                    : 'この内容を保存する'}
            </button>
          </div>
        )}

        {itemError !== null && (
          <p className="form-error" role="alert">
            {itemError}
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
            読み方は2通りあります。
            <strong>アプリの中の「QRを読んで交換する」</strong>か、
            スマホの<strong>普通のカメラ</strong>を向けるかです。
            標準カメラだとログインし直しになることがあるので、
            うまくいかないときはアプリの中から読んでもらってください。
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
