import { useState } from 'react';
import {
  deleteClientCompletely,
  estimateDeletion,
  type DeleteProgress,
  type DeletionEstimate,
} from './deleteClient';
import type { Client } from './clientTypes';

/**
 * 契約者の完全削除（設計書 §6.6 / §46）。
 *
 * ★ この画面の役目は「消すこと」ではなく、**「間違って消させないこと」**です。
 *
 *   消す処理そのものは deleteClient.ts にあります。ここがやるのは、
 *   押した人が「何が起きるか分かっている」状態を作ることです。
 *
 *     1. まず、何日ぶんの記録が消えるのかを数えて見せる
 *     2. 契約者IDを**手で打たせる**（押し間違いでは進めない）
 *     3. 消えないもの（ログインアカウント）を、先に伝える
 *     4. 進み具合を出す（止まっていないことが分かるように）
 *
 * ★ 2 が要です。「本当によろしいですか？」は、3回目からは読まれません。
 *   打たせるのは手間ですが、その手間が最後の歯止めになります。
 */

type Step =
  | { kind: 'closed' }
  | { kind: 'counting' }
  | { kind: 'confirm'; estimate: DeletionEstimate }
  | { kind: 'deleting'; progress: DeleteProgress }
  | { kind: 'done'; deleted: number; authUid: string | null };

export function DangerZone({ client, onDeleted }: { client: Client; onDeleted: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'closed' });
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function openConfirm() {
    setError(null);
    setStep({ kind: 'counting' });
    try {
      const estimate = await estimateDeletion(client);
      setStep({ kind: 'confirm', estimate });
    } catch {
      setError('記録の量を調べられませんでした。通信を確認してからお試しください。');
      setStep({ kind: 'closed' });
    }
  }

  async function run() {
    setError(null);
    setStep({
      kind: 'deleting',
      progress: { phase: '準備しています', done: 0, total: 0, deleted: 0 },
    });

    try {
      const result = await deleteClientCompletely(client, (progress) => {
        setStep({ kind: 'deleting', progress });
      });
      setStep({ kind: 'done', deleted: result.deleted, authUid: result.authUid });
    } catch {
      // ★ 途中で止まっても、消えたぶんは戻りません。
      //   それを隠さずに伝えて、やり直しを促します。
      setError(
        '途中で失敗しました。消えたぶんは元に戻りません。' +
          'もう一度「完全に削除する」を実行すると、残りから続きます。',
      );
      setStep({ kind: 'closed' });
      setTyped('');
    }
  }

  // --- 消し終わったあと -------------------------------------------------------
  if (step.kind === 'done') {
    return (
      <section className="card warn">
        <h3 className="card-title">削除しました</h3>
        <p className="note">
          {client.clientId} の記録を {step.deleted} 件削除しました。
        </p>

        {step.authUid !== null && (
          <>
            <p className="notice">
              <b>ログインアカウントだけは、ここでは消せません。</b>
              <br />
              Firebase の管理画面 →「Authentication」→ ユーザーの一覧から
              <b> {client.clientId}@pt-app.local </b>
              を探して削除してください。
            </p>
            <p className="field-hint">
              消すまで、このアドレスは使われたままになります。
              <b>同じ契約者ID（{client.clientId}）で作り直すことはできません。</b>
              別のIDを使うか、先に上の削除を済ませてください。
            </p>
          </>
        )}

        <button className="button-primary" type="button" onClick={onDeleted}>
          契約者一覧へ戻る
        </button>
      </section>
    );
  }

  // --- 削除中 -----------------------------------------------------------------
  if (step.kind === 'deleting') {
    const { phase, done, total, deleted } = step.progress;
    return (
      <section className="card warn">
        <h3 className="card-title">削除しています</h3>
        <p className="note" role="status">
          {phase}
          {total > 0 && <> … {done} / {total}</>}
          <br />
          これまでに {deleted} 件消しました。
        </p>
        <p className="field-hint">
          <b>この画面を閉じないでください。</b>
          途中で止まっても、もう一度実行すれば残りから続きます。
        </p>
      </section>
    );
  }

  // --- 確認 -------------------------------------------------------------------
  if (step.kind === 'confirm') {
    const { estimate } = step;
    const matches = typed.trim() === client.clientId;

    return (
      <section className="card warn">
        <h3 className="card-title">完全に削除する</h3>

        <p className="notice">
          <b>取り消せません。</b>
          {client.clientId} の記録をすべて削除します。
        </p>

        <ul className="note">
          <li>記録のある日: {estimate.days}日ぶん（食事・運動・写真・メモ・評価）</li>
          <li>変更履歴: {estimate.audits}件</li>
          <li>体のサイズ・お気に入り・レシピ・AIとのやりとり</li>
          <li>この人が出した登録依頼</li>
        </ul>

        {estimate.authUid !== null && (
          <p className="field-hint">
            <b>ログインアカウントは、ここでは消せません。</b>
            あとで Firebase の管理画面から手で消してください。
            消すまで、同じ契約者IDで作り直すことはできません。
          </p>
        )}

        <p className="note">
          消さずに済ませたいなら、上の<b>「この契約者を無効にする」</b>で足りることがあります。
          ログインしても何も見られなくなり、記録は残ります。
        </p>

        <label className="field">
          <span className="field-label">
            確認のため、契約者ID「{client.clientId}」を入力してください
          </span>
          <input
            className="input"
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={client.clientId}
            autoComplete="off"
          />
        </label>

        {error !== null && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="item-form-actions">
          <button
            className="button-secondary danger"
            type="button"
            onClick={() => void run()}
            disabled={!matches}
          >
            完全に削除する
          </button>
          <button
            className="button-quiet"
            type="button"
            onClick={() => {
              setStep({ kind: 'closed' });
              setTyped('');
            }}
          >
            やめる
          </button>
        </div>
      </section>
    );
  }

  // --- 入口 -------------------------------------------------------------------
  return (
    <section className="card">
      <h3 className="card-title">完全に削除する</h3>
      <p className="note">
        契約者と、その人の記録をすべて消します。<b>取り消せません。</b>
        <br />
        ふだんは上の「無効にする」で足ります。
      </p>

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <button
        className="button-quiet danger"
        type="button"
        onClick={() => void openConfirm()}
        disabled={step.kind === 'counting'}
      >
        {step.kind === 'counting' ? '記録の量を調べています…' : '完全な削除に進む'}
      </button>
    </section>
  );
}
