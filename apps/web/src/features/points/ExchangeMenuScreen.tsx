import { useCallback, useEffect, useState } from 'react';
import {
  findSameItem,
  isValidRedeem,
  MAX_EXCHANGE_ITEMS,
  MAX_REDEEM,
  MAX_REDEEM_TEXT,
  SHARD_NAME,
  SHARD_UNIT,
  type ExchangeItem,
} from '@pt/core';
import { readErrorMessage, writeErrorMessage } from '@/lib/firestoreError';
import { Shards } from './ShardIcon';
import {
  deleteExchangeMenuItem,
  listExchangeMenu,
  saveExchangeMenuItem,
} from './exchangeMenuRepo';

/**
 * 交換メニューを登録する（追加仕様: 交換メニュー）。管理者だけが開けます。
 *
 * ★ これは「品書き」です。QRとは別のものです。
 *
 *   契約者に**何かけらで何がもらえるのか**を見せるためだけの一覧です。
 *   ここに登録しても、QRは作られません。交換そのものは今までどおり、
 *   その場でQRを出して行います。
 *
 *   形が似ているので一緒にしたくなりますが、一緒にすると
 *   **管理者が控えとして保存したQRまで全員に見えます。**
 *   見せるつもりのないものが並ぶ形は、あとから直しようがありません。
 *
 * ★ 全契約者に同じものが出ます。人によって変えられません。
 *   品書きは店頭の貼り紙と同じで、誰が見ても同じであるべきものです。
 */
export function ExchangeMenuScreen({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<ExchangeItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [amountText, setAmountText] = useState('3');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  /** 消す前に一度止めます。押し間違いで品書きが欠けないように */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await listExchangeMenu());
    } catch (e) {
      setError(readErrorMessage(e, '交換メニュー'));
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const amount = Number(amountText);
  const req = { amount, text: text.trim() };
  const ok = isValidRedeem(req);

  /** すでに同じ中身が登録されていないか（追加仕様: 交換メニュー） */
  const duplicate = items === null ? null : (findSameItem(items, req) ?? null);
  const full = (items?.length ?? 0) >= MAX_EXCHANGE_ITEMS;

  async function add() {
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveExchangeMenuItem(req);
      setText('');
      await load();
    } catch (e) {
      setError(writeErrorMessage(e, '交換メニュー'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteExchangeMenuItem(id);
      setConfirmDelete(null);
      await load();
    } catch (e) {
      setError(writeErrorMessage(e, '削除'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="section-head">
        <h2 className="title">交換メニュー</h2>
        <button className="button-secondary compact" type="button" onClick={onBack}>
          戻る
        </button>
      </div>

      <p className="lede">
        契約者の「{SHARD_NAME}」から見られる品書きです。<b>全員に同じものが出ます。</b>
      </p>

      {/* ★ 何が起きて、何が起きないのかを先に書きます。
             「登録したらQRもできる」と思われると、
             交換の場でQRが無くて困ります。 */}
      <p className="note">
        ここに登録しても、QRは作られません。交換そのものは今までどおり
        「交換QR」の画面で行ってください。
      </p>

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <section className="card">
        <h3 className="card-title">足す</h3>

        <label className="field">
          <span className="field-label">もらえるもの</span>
          <input
            className="input"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="プロテイン1杯"
            maxLength={MAX_REDEEM_TEXT}
            /* ★ 下に注意書きが続くので、読み上げ用の名前を別に付けます。
                  付けないと「もらえるもの40文字まで」がひと続きの名前になります。 */
            aria-label="もらえるもの" 
          />
          <span className="field-hint">{MAX_REDEEM_TEXT}文字まで</span>
        </label>

        <label className="field">
          <span className="field-label">必要な{SHARD_UNIT}の数</span>
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_REDEEM}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            aria-label={`必要な${SHARD_UNIT}の数`}
          />
        </label>

        {/* ★ 同じ中身が二重に並ぶのを、押す前に止めます。
               品書きに同じ行が2つあると、どちらが正しいのか分かりません。 */}
        {duplicate !== null && (
          <p className="note" role="status">
            同じ内容がすでに登録されています（{duplicate.text} / {duplicate.amount}
            {SHARD_UNIT}）。
          </p>
        )}

        {full && (
          <p className="note" role="status">
            登録できるのは{MAX_EXCHANGE_ITEMS}件までです。使わないものを消してください。
          </p>
        )}

        <div className="form-actions">
          <button
            className="button-primary"
            type="button"
            onClick={() => void add()}
            disabled={!ok || busy || duplicate !== null || full}
          >
            メニューに足す
          </button>
        </div>
      </section>

      {items === null && <p className="lede">読み込んでいます…</p>}

      {items !== null && items.length === 0 && (
        <section className="card">
          <p className="lede">まだ何も登録されていません。</p>
          <p className="field-hint">
            登録するまで、契約者の画面には品書きそのものが出ません。
          </p>
        </section>
      )}

      {/* ★ 並びは安い順です（core の sortExchangeItems）。
             契約者の画面と同じ順にしてあります。
             管理者だけ違う順で見えると、確かめようがありません。 */}
      {items !== null &&
        items.map((item) => (
          <section className="card client-row-wrap" key={item.id}>
            <div className="client-row">
              <div className="client-main">
                <span className="client-name">{item.text}</span>
                <Shards n={item.amount} className="client-meta" />
              </div>
              <div className="item-actions">
                <button
                  className="button-quiet"
                  type="button"
                  onClick={() => setConfirmDelete(item.id)}
                  disabled={busy}
                >
                  削除
                </button>
              </div>
            </div>

            {confirmDelete === item.id && (
              <div className="notice">
                <p>
                  「{item.text}」を品書きから消します。
                  <br />
                  <b>すでに交換したぶんの記録は残ります。</b>
                  これから契約者の画面に出なくなるだけです。
                </p>
                <div className="item-form-actions">
                  <button
                    className="button-secondary compact"
                    type="button"
                    onClick={() => void remove(item.id)}
                    disabled={busy}
                  >
                    消す
                  </button>
                  <button
                    className="button-quiet"
                    type="button"
                    onClick={() => setConfirmDelete(null)}
                  >
                    やめる
                  </button>
                </div>
              </div>
            )}
          </section>
        ))}
    </>
  );
}
