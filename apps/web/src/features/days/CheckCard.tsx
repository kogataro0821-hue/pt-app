import { useState } from 'react';
import { PHOTO_RETENTION_DAYS } from '@pt/core';

/**
 * トレーナーの「確認しました」（Phase 11）。
 *
 * ★ 1日確定とは別ものです。
 *
 *   確定は契約者の「今日はもう食べません」という意思表示で、
 *   本人がいつでも解除できます（Q14の決定）。
 *   こちらはトレーナーが「食事と写真と運動を見ました」と記録するものです。
 *
 *   2つを1つにまとめると、
 *   「契約者が書き終えたのか」「トレーナーが見たのか」が
 *   区別できなくなります。別の出来事なので、別に持ちます。
 *
 * ★ 押すと、その日の写真が消えます。
 *
 *   写真は数値を確かめるための材料です。確認が済めば役目は終わりますし、
 *   無料枠が1GBしかない以上、置いておくと早晩いっぱいになります。
 *   ただし「消える」ことは押す前に必ず伝えます。
 *   黙って消すと、契約者から見れば写真が勝手に消えたことになります。
 *
 * ★ 取り消せます。
 *   押し間違いを直せないと、「写真は消えたのに確認済みだけ残る」という
 *   一番困る状態から抜けられません。
 */
export function CheckCard({
  checkedAt,
  photoCount,
  busy,
  onCheck,
  onUncheck,
}: {
  checkedAt: number | null;
  /** その日に残っている写真の枚数 */
  photoCount: number;
  busy: boolean;
  onCheck: () => void;
  onUncheck: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (checkedAt !== null) {
    return (
      <section className="card">
        <h3 className="card-title">確認済み</h3>
        <p className="note">
          {formatStamp(checkedAt)}に確認しました。
          {photoCount === 0 && <>この日の写真は削除済みです。</>}
        </p>
        <button className="button-quiet" type="button" onClick={onUncheck} disabled={busy}>
          確認を取り消す
        </button>
      </section>
    );
  }

  if (confirming) {
    return (
      <section className="card">
        <h3 className="card-title">確認しますか？</h3>
        <div className="notice">
          {photoCount > 0 ? (
            <p>
              この日の写真<b>{photoCount}枚</b>を削除します。
              <br />
              契約者の画面からも見えなくなります。<b>元には戻せません。</b>
              <br />
              食材・量・kcal・PFCの記録は消えません。
            </p>
          ) : (
            <p>この日に写真はありません。確認済みとして記録します。</p>
          )}
        </div>
        <div className="item-form-actions">
          <button
            className="button-primary compact"
            type="button"
            onClick={onCheck}
            disabled={busy}
          >
            {busy ? '処理しています…' : photoCount > 0 ? '確認して写真を削除する' : '確認済みにする'}
          </button>
          <button
            className="button-quiet"
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
          >
            やめる
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <h3 className="card-title">トレーナーの確認</h3>
      <p className="note">
        食事・写真・運動を見終えたら押してください。
        {photoCount > 0 && <>この日の写真{photoCount}枚は、そのとき削除されます。</>}
        <br />
        押さなかった写真も、{PHOTO_RETENTION_DAYS}日で自動的に消えます。
      </p>
      <button
        className="button-primary"
        type="button"
        onClick={() => setConfirming(true)}
        disabled={busy}
      >
        確認しました
      </button>
    </section>
  );
}

function formatStamp(ms: number): string {
  const at = new Date(ms);
  return `${at.getMonth() + 1}月${at.getDate()}日 ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
