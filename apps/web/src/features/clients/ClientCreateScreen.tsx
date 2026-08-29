import { useState, type FormEvent } from 'react';
import { INITIAL_RANK, RANKS, checkClientId, clientIdErrorMessage, rankLabel, type Rank } from '@pt/core';
import { CLIENT_LOGIN_DOMAIN } from '@/config/firebase';
import { ClientOperationError, createClient, createClientErrorMessage } from './clientsRepo';

/**
 * 契約者の新規作成（設計書 §11.3 A-2 / §6.5）。
 *
 * ここで作るのは「入り口」だけです。目標値などの細かい設定は、
 * 作成後の編集画面でゆっくり決められます。
 */
export function ClientCreateScreen({
  onDone,
  onCancel,
}: {
  onDone: (clientId: string) => void;
  onCancel: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [rank, setRank] = useState<Rank>(INITIAL_RANK);
  const [memberNo, setMemberNo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const idCheck = checkClientId(clientId);
  const idProblem =
    clientId.length > 0 && !idCheck.ok ? clientIdErrorMessage(idCheck.reason) : null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    if (!idCheck.ok) {
      setError(clientIdErrorMessage(idCheck.reason));
      return;
    }
    if (password.length < 8) {
      setError('初期パスワードは8文字以上にしてください。');
      return;
    }
    if (displayName.trim().length === 0) {
      setError('表示名を入力してください。');
      return;
    }
    if (memberNo.trim().length > 0) {
      const n = Number(memberNo);
      if (!Number.isInteger(n) || n < 0 || n > 9999) {
        setError('会員整理番号は 0 から 9999 の整数で入れてください。空欄なら自動で振ります。');
        return;
      }
    }

    setError(null);
    setBusy(true);
    try {
      await createClient({
        clientId: idCheck.id,
        displayName,
        initialPassword: password,
        rank,
        // 空欄なら、いまある番号の次を自動で振ります
        ...(memberNo.trim().length === 0 ? {} : { memberNo: Number(memberNo) }),
      });
      onDone(idCheck.id);
    } catch (e) {
      setError(
        e instanceof ClientOperationError
          ? createClientErrorMessage(e)
          : '契約者の作成に失敗しました。',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="section-head">
        <h2 className="title">契約者を追加</h2>
      </div>

      <form onSubmit={onSubmit} className="card form">
        <label className="field">
          <span className="field-label">契約者ID</span>
          <input
            className="input"
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="tanaka01"
            required
          />
          <span className="field-hint">
            英小文字・数字・記号（. _ -）が使えます。
            <b>後から変更できません。</b>
            {idCheck.ok && (
              <>
                <br />
                ログインID: <code>{idCheck.id}</code>
              </>
            )}
          </span>
          {idProblem !== null && <span className="field-error">{idProblem}</span>}
        </label>

        <label className="field">
          <span className="field-label">表示名</span>
          <input
            className="input"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="田中 花子"
            required
          />
          <span className="field-hint">画面に表示される名前です。後から変更できます。</span>
        </label>

        <label className="field">
          <span className="field-label">初期パスワード（8文字以上）</span>
          <input
            className="input"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <span className="field-hint">
            本人に口頭やメッセージでお伝えください。
            <b>初回ログイン時に、本人が必ず変更します。</b>
          </span>
        </label>

        {/* ★ ここで決めるのは「開始地点」です（追加仕様: 会員ランク）。
               作ったあとに上げることはできません（条件を満たしたときだけ）。
               トレーナー自身のアカウントのように、
               最初から上の段で始めたい場合のためのものです。 */}
        <label className="field">
          <span className="field-label">初期ランク</span>
          <select
            className="input"
            value={rank}
            onChange={(e) => setRank(e.target.value as Rank)}
          >
            {RANKS.map((r) => (
              <option key={r} value={r}>
                {rankLabel(r)}
              </option>
            ))}
          </select>
          <span className="field-hint">
            ふつうは <b>PLATINUM</b> のままで大丈夫です。
            <br />
            <b>作ったあとに上げることはできません</b>（昇格は条件を満たしたときだけ）。
            上の段から始めたいときだけ、ここで選んでください。
          </span>
        </label>

        <label className="field">
          <span className="field-label">会員整理番号</span>
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            max={9999}
            value={memberNo}
            onChange={(e) => setMemberNo(e.target.value)}
            placeholder="空欄なら自動"
          />
          <span className="field-hint">
            空欄にすると、いまある番号の次が自動で入ります。
            <b>0 も使えます</b>（トレーナー自身のアカウントを 0000 にする、など）。
          </span>
        </label>

        {error !== null && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button className="button-primary" type="submit" disabled={busy}>
          {busy ? '作成中…' : '契約者を作成する'}
        </button>
        <button className="button-quiet" type="button" onClick={onCancel} disabled={busy}>
          やめる
        </button>
      </form>

      <section className="card">
        <h3 className="card-title">補足</h3>
        <p className="note">
          目標カロリー・PFC・評価モードなどは、作成したあとの編集画面で設定できます。
          いまは既定値（1800kcal / P130 / F50 / C200 / 標準）で作られます。
        </p>
        <p className="note">
          契約者IDはログイン時に <code>{`〈ID〉@${CLIENT_LOGIN_DOMAIN}`}</code>{' '}
          という形に変換されます。実際にメールが送られることはありません。
        </p>
      </section>
    </>
  );
}
