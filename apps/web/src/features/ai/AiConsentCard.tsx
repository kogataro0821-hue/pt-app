import { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { getDb } from '@/lib/firebase';
import {
  AI_CONSENT_VERSION,
  hasValidAiConsent,
  type AiConsent,
  type Client,
} from '@/features/clients/clientTypes';

/**
 * AI利用への同意（設計書 §35）。
 *
 * ★ 契約者本人だけが同意でき、本人だけが取り消せます。
 *   管理者が代わりに同意することはできません。
 *   自分のデータが外部に送られることを、本人以外が決めてよい話ではないためです。
 *
 * ★ 隠さずに書きます。
 *   無料のAIに送ったデータは、提供事業者のモデル改善に使われる可能性があります。
 *   これを小さく書いたり、専門用語でぼかしたりはしません。
 *   読んだうえで断れることが、同意が同意であるための条件です。
 */
export function AiConsentCard({
  client,
  isSelf,
  onChanged,
}: {
  client: Client;
  /** 本人が見ているか（管理者が見ているときは false） */
  isSelf: boolean;
  onChanged: (consent: AiConsent) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const active = hasValidAiConsent(client.aiConsent);
  const outdated = client.aiConsent.granted && client.aiConsent.version < AI_CONSENT_VERSION;

  async function change(granted: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);

    const next: AiConsent = {
      granted,
      updatedAt: Date.now(),
      version: granted ? AI_CONSENT_VERSION : 0,
    };

    try {
      await setDoc(
        doc(getDb(), 'clients', client.clientId),
        { aiConsent: next, updatedAt: Date.now() },
        { merge: true },
      );
      onChanged(next);
      setReading(false);
    } catch {
      setError('設定を変更できませんでした。通信状態を確認してください。');
    } finally {
      setBusy(false);
    }
  }

  if (!isSelf) {
    return (
      <section className="card">
        <h3 className="card-title">AIの利用</h3>
        <p className="note">
          {active
            ? 'この契約者はAIの利用に同意しています。'
            : 'この契約者はAIの利用に同意していません。AIの機能は表示されません。'}
        </p>
        <p className="note">
          <b>同意はご本人だけが行えます。</b>
          あなた（管理者）が代わりに同意することはできません。
        </p>
      </section>
    );
  }

  return (
    <section className={active ? 'card' : 'card'}>
      <h3 className="card-title">AIの利用</h3>

      {active && !reading && (
        <>
          <p className="note">
            AIによる入力の補助を使えます。「白米180gと鶏むね肉150g」のように書けば、
            食材と量に分けてくれます。
          </p>
          <button
            className="button-secondary danger"
            type="button"
            onClick={() => void change(false)}
            disabled={busy}
          >
            AIの利用をやめる
          </button>
        </>
      )}

      {outdated && (
        <p className="notice">
          説明の内容が変わりました。お手数ですが、もう一度ご確認ください。
        </p>
      )}

      {!active && !reading && (
        <>
          <p className="note">
            AIを使うと、食べたものを文章で書くだけで食材と量に分けてくれます。
            使わなくても、手で入力すればすべての機能が使えます。
          </p>
          <button className="button-secondary" type="button" onClick={() => setReading(true)}>
            AIの利用について読む
          </button>
        </>
      )}

      {reading && (
        <>
          <div className="consent-body">
            <h4>お伝えしておきたいこと</h4>

            <p>
              AIを使うと、あなたが書いた食事の内容が、Googleが提供するAIサービスへ送られます。
            </p>

            <p>
              <b>
                無料で利用しているため、送られた内容がGoogleのAIの改善に使われる可能性があります。
              </b>
              これは推測ではなく、Googleが公表している条件です。
            </p>

            <h4>送られないもの</h4>
            <ul>
              <li>お名前、契約者ID</li>
              <li>体重、体脂肪率、目標値</li>
              <li>他の日の記録</li>
            </ul>
            <p className="note">
              送るのは、あなたがその場で書いた食事の文章だけです。
              誰の記録かをAIに伝えることはありません。
            </p>

            <h4>いつでもやめられます</h4>
            <p>
              同意したあとでも、この画面からいつでも取り消せます。
              取り消しても、それまでに記録したデータが消えることはありません。
            </p>

            <h4>同意しない場合</h4>
            <p>
              AIのボタンが表示されなくなるだけです。
              手で入力すれば、カロリー計算も記録もすべて同じように使えます。
              <b>不利になることはありません。</b>
            </p>
          </div>

          {error !== null && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button
            className="button-primary"
            type="button"
            onClick={() => void change(true)}
            disabled={busy}
          >
            読みました。AIの利用に同意します
          </button>
          <button className="button-quiet" type="button" onClick={() => setReading(false)}>
            やめておく
          </button>
        </>
      )}

      {error !== null && !reading && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
