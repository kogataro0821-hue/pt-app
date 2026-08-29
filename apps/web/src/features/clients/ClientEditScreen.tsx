import { useEffect, useState, type FormEvent } from 'react';
import { macroMismatchWarning, validateTargets, type Targets } from '@pt/core';
import {
  deleteProvisioningClient,
  nextMemberNo,
  ranksBelow,
  setRankGoal,
  getClient,
  setClientActive,
  setClientRank,
  updateClient,
} from './clientsRepo';
import { REVIEW_MODES, sexLabel, type Client, type ReviewMode, type Sex } from './clientTypes';
import { DangerZone } from './DangerZone';
import { GoalRow } from './GoalRow';
import { AUTO_MAX_RANK, RANKS, rankLabel, rankOrder, type Rank, type RankGoal } from '@pt/core';

/**
 * 契約者の編集（設計書 §11.3 A-3）。
 *
 * 目標値・評価モード・過去編集ウィンドウ・有効／無効をここで設定します。
 * 契約者IDだけは変更できません（データの置き場所に使っているため）。
 */
export function ClientEditScreen({ clientId, onBack }: { clientId: string; onBack: () => void }) {
  const [client, setClient] = useState<Client | null>(null);
  const [draft, setDraft] = useState<Client | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 会員整理番号の入力欄。空欄 = 未採番 */
  const [memberNoText, setMemberNoText] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await getClient(clientId);
        setClient(loaded);
        setDraft(loaded);
        setMemberNoText(loaded === null || loaded.memberNo === null ? '' : String(loaded.memberNo));

      } catch {
        setError('契約者の情報を読み込めませんでした。');
      }
    })();
  }, [clientId]);

  if (draft === null || client === null) {
    return <p className="lede">{error ?? '読み込んでいます…'}</p>;
  }

  const currentMemberNoText = client.memberNo === null ? '' : String(client.memberNo);
  const issues = validateTargets(draft.targets);
  const warning = macroMismatchWarning(draft.targets);

  function patch(changes: Partial<Client>) {
    setDraft((prev) => (prev === null ? prev : { ...prev, ...changes }));
    setSaved(false);
  }

  function patchTargets(changes: Partial<Targets>) {
    setDraft((prev) =>
      prev === null ? prev : { ...prev, targets: { ...prev.targets, ...changes } },
    );
    setSaved(false);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || draft === null) return;

    if (issues.length > 0) {
      setError(issues[0]?.message ?? '入力を確認してください。');
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await updateClient(draft.clientId, {
        displayName: draft.displayName,
        age: draft.age,
        sex: draft.sex,
        heightCm: draft.heightCm,
        startDate: draft.startDate,
        memo: draft.memo,
        targets: draft.targets,
        reviewMode: draft.reviewMode,
        permissions: draft.permissions,
      });
      setClient(draft);
      setSaved(true);
    } catch {
      setError('保存に失敗しました。通信状態を確認してください。');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (busy || client === null) return;
    setBusy(true);
    setError(null);
    try {
      const next = !client.active;
      await setClientActive(client, next);
      setClient({ ...client, active: next });
      patch({ active: next });
    } catch {
      setError('切り替えに失敗しました。');
    } finally {
      setBusy(false);
    }
  }

  /** 入力欄の文字列を、保存できる値に直す。空欄は「未採番」 */
  function parseMemberNo(text: string): number | null | 'invalid' {
    const trimmed = text.trim();
    if (trimmed.length === 0) return null;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0 || n > 9999) return 'invalid';
    return n;
  }

  async function saveMemberNo() {
    if (busy || client === null) return;
    const value = parseMemberNo(memberNoText);
    if (value === 'invalid') {
      setError('会員整理番号は 0 から 9999 の整数で入れてください。空欄なら未採番になります。');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await updateClient(client.clientId, { memberNo: value });
      setClient({ ...client, memberNo: value });
    } catch {
      setError('会員整理番号を保存できませんでした。');
    } finally {
      setBusy(false);
    }
  }

  async function fillNextMemberNo() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setMemberNoText(String(await nextMemberNo()));
    } catch {
      setError('次の番号を調べられませんでした。');
    } finally {
      setBusy(false);
    }
  }

  async function demote(rank: Rank) {
    if (busy || client === null || rank === client.rank) return;
    if (!window.confirm(`${rankLabel(client.rank)} から ${rankLabel(rank)} に下げます。よろしいですか？`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setClientRank(client, rank);
      setClient({ ...client, rank });
    } catch {
      setError('ランクを変更できませんでした。');
    } finally {
      setBusy(false);
    }
  }

  async function saveGoal(rank: Rank, goal: RankGoal | null) {
    if (busy || client === null) return;
    setBusy(true);
    setError(null);
    try {
      const next = await setRankGoal(client, rank, goal);
      setClient({ ...client, rankGoals: next });
    } catch {
      setError('条件を保存できませんでした。');
    } finally {
      setBusy(false);
    }
  }

  async function removeProvisioning() {
    if (busy || client === null) return;
    if (!window.confirm(`${client.clientId} の未完了データを削除します。よろしいですか？`)) return;
    setBusy(true);
    try {
      await deleteProvisioningClient(client);
      onBack();
    } catch {
      setError('削除に失敗しました。');
      setBusy(false);
    }
  }

  return (
    <>
      <div className="section-head">
        <button className="button-quiet back" type="button" onClick={onBack}>
          ‹ 契約者一覧
        </button>
      </div>

      <h2 className="title">{draft.displayName.length > 0 ? draft.displayName : draft.clientId}</h2>
      <p className="lede">
        契約者ID: <code>{draft.clientId}</code>
        {!client.active && <> ／ 現在は無効</>}
      </p>

      {client.provisionStatus !== 'ready' && (
        <section className="card warn">
          <h3 className="card-title">作成が完了していません</h3>
          <p className="note">
            ログインアカウントの作成が途中で止まっています。この契約者はまだログインできません。
            いったん削除して、作り直してください。
          </p>
          <button
            className="button-secondary danger"
            type="button"
            onClick={() => void removeProvisioning()}
          >
            この未完了データを削除する
          </button>
        </section>
      )}

      <form onSubmit={onSubmit} className="stack">
        <section className="card">
          <h3 className="card-title">基本情報</h3>

          <Field label="表示名">
            <input
              className="input"
              type="text"
              value={draft.displayName}
              onChange={(e) => patch({ displayName: e.target.value })}
            />
          </Field>

          <div className="grid-2">
            <Field label="年齢">
              <input
                className="input"
                type="number"
                inputMode="numeric"
                value={draft.age ?? ''}
                onChange={(e) => patch({ age: numberOrNull(e.target.value) })}
              />
            </Field>
            <Field label="身長（cm）">
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={draft.heightCm ?? ''}
                onChange={(e) => patch({ heightCm: numberOrNull(e.target.value) })}
              />
            </Field>
          </div>

          <Field label="性別">
            <select
              className="input"
              value={draft.sex}
              onChange={(e) => patch({ sex: e.target.value as Sex })}
            >
              {(['female', 'male', 'unspecified'] as Sex[]).map((s) => (
                <option key={s} value={s}>
                  {sexLabel(s)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="開始日">
            <input
              className="input"
              type="date"
              value={draft.startDate ?? ''}
              onChange={(e) => patch({ startDate: e.target.value || null })}
            />
          </Field>

          <Field label="メモ">
            <textarea
              className="input"
              rows={3}
              value={draft.memo}
              onChange={(e) => patch({ memo: e.target.value })}
              placeholder="怪我の有無、生活リズム、注意点など"
            />
          </Field>
        </section>

        <section className="card">
          <h3 className="card-title">目標</h3>

          <Field label="目標カロリー（kcal）">
            <input
              className="input"
              type="number"
              inputMode="numeric"
              value={draft.targets.kcal}
              onChange={(e) => patchTargets({ kcal: Number(e.target.value) })}
            />
          </Field>

          <div className="grid-3">
            <Field label="P（g）" accent="p">
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={draft.targets.p}
                onChange={(e) => patchTargets({ p: Number(e.target.value) })}
              />
            </Field>
            <Field label="F（g）" accent="f">
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={draft.targets.f}
                onChange={(e) => patchTargets({ f: Number(e.target.value) })}
              />
            </Field>
            <Field label="C（g）" accent="c">
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={draft.targets.c}
                onChange={(e) => patchTargets({ c: Number(e.target.value) })}
              />
            </Field>
          </div>

          {warning !== null && <p className="notice">{warning}</p>}

          <div className="grid-2">
            <Field label="目標体重（kg）">
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={draft.targets.weightKg ?? ''}
                onChange={(e) => patchTargets({ weightKg: numberOrNull(e.target.value) })}
              />
            </Field>
            <Field label="目標体脂肪率（%）">
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={draft.targets.bodyFatPct ?? ''}
                onChange={(e) => patchTargets({ bodyFatPct: numberOrNull(e.target.value) })}
              />
            </Field>
          </div>

          <Field label="運動目標">
            <input
              className="input"
              type="text"
              value={draft.targets.exercise}
              onChange={(e) => patchTargets({ exercise: e.target.value })}
              placeholder="週3回 / 1回45分"
            />
          </Field>
        </section>

        <section className="card">
          <h3 className="card-title">AI評価のトーン</h3>
          <div className="choices">
            {REVIEW_MODES.map((mode) => (
              <label key={mode.value} className="choice">
                <input
                  type="radio"
                  name="reviewMode"
                  value={mode.value}
                  checked={draft.reviewMode === mode.value}
                  onChange={() => patch({ reviewMode: mode.value as ReviewMode })}
                />
                <span className="choice-body">
                  <span className="choice-label">{mode.label}</span>
                  <span className="choice-desc">{mode.description}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="note">AI評価は Phase 10 で実装します。設定だけ先に保存できます。</p>
        </section>

        <section className="card">
          <h3 className="card-title">できること</h3>

          <Field label="過去を何日前まで自分で修正できるか">
            <input
              className="input"
              type="number"
              inputMode="numeric"
              min={0}
              max={3650}
              value={draft.permissions.pastEditWindowDays}
              onChange={(e) =>
                patch({
                  permissions: {
                    ...draft.permissions,
                    pastEditWindowDays: Math.max(0, Number(e.target.value) || 0),
                  },
                })
              }
            />
            <span className="field-hint">
              0 なら今日だけ。既定は7日。それより古い日付は、あなた（管理者）だけが編集できます。
              閲覧はいつでも可能です。
            </span>
          </Field>

          <Toggle
            label="自分で食品を登録できる"
            checked={draft.permissions.allowFoodCreate}
            onChange={(v) => patch({ permissions: { ...draft.permissions, allowFoodCreate: v } })}
          />
          <Toggle
            label="自分でレシピを登録できる"
            checked={draft.permissions.allowRecipeCreate}
            onChange={(v) => patch({ permissions: { ...draft.permissions, allowRecipeCreate: v } })}
          />
        </section>

        {error !== null && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {saved && <p className="form-ok">保存しました。</p>}

        <button className="button-primary" type="submit" disabled={busy}>
          {busy ? '保存中…' : '保存する'}
        </button>
      </form>

      <section className="card">
        <h3 className="card-title">アカウント</h3>
        <p className="note">
          無効にすると、その契約者はログインしてもデータを一切見られなくなります。
          <b>記録は消えません。</b>あとで有効に戻せば元どおりです。
        </p>
        <button
          className={client.active ? 'button-secondary danger' : 'button-secondary'}
          type="button"
          onClick={() => void toggleActive()}
          disabled={busy}
        >
          {client.active ? 'この契約者を無効にする' : 'この契約者を有効に戻す'}
        </button>
      </section>

      <section className="card">
        <h3 className="card-title">会員ランク</h3>
        <p className="note">
          現在のランク <b>{rankLabel(client.rank)}</b>
        </p>

        {/* ★ 番号は自動では振りません（追加仕様: 会員ランク）。
               動作確認用のアカウントや、トレーナー自身のアカウントには
               番号を振りたくない／別の番号にしたい、ということがあります。
               画面を開いただけで勝手に付くと、あとから直す手間になります。 */}
        <label className="field">
          <span className="field-label">会員整理番号</span>
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={memberNoText}
            onChange={(e) => setMemberNoText(e.target.value)}
            placeholder="未採番"
          />
          <span className="field-hint">
            空欄にすると「未採番」になり、会員証には <b>No. ----</b> と出ます。
            <b>0 も使えます</b>（トレーナー自身のアカウントを 0000 にする、など）。
            一度決めた番号は、なるべく変えないでください。会員証の番号が変わると、別人の証になります。
          </span>
        </label>

        <div className="item-form-actions">
          <button
            className="button-secondary compact"
            type="button"
            onClick={() => void saveMemberNo()}
            disabled={busy || memberNoText.trim() === currentMemberNoText}
          >
            整理番号を保存する
          </button>
          <button
            className="button-quiet compact"
            type="button"
            onClick={() => void fillNextMemberNo()}
            disabled={busy}
          >
            次の番号を入れる
          </button>
        </div>

        <p className="note">
          <b>ここから上げることはできません。</b>
          昇格は、条件を満たしたときに会員証の「昇格させる」ボタンから行います。
          <br />
          下げるほうは、いつでもできます。
        </p>

        {ranksBelow(client.rank).length === 0 ? (
          <p className="field-hint">いちばん下のランクなので、下げられません。</p>
        ) : (
          <label className="field">
            <span className="field-label">ランクを下げる</span>
            <select
              className="input"
              value=""
              onChange={(e) => {
                if (e.target.value !== '') void demote(e.target.value as Rank);
              }}
              disabled={busy}
            >
              <option value="">選んでください</option>
              {ranksBelow(client.rank).map((r) => (
                <option key={r} value={r}>
                  {rankLabel(r)} に下げる
                </option>
              ))}
            </select>
            <span className="field-hint">
              選ぶとすぐに変わります。<b>下げたことは相手の画面にも出ます。</b>
            </span>
          </label>
        )}
      </section>

      <section className="card">
        <h3 className="card-title">DIAMOND から先の条件</h3>
        <p className="note">
          RUBY・SAPPHIRE・EMERALD の条件は決まっています。
          <b>その先は、この人に何を続けてほしいかで決めてください。</b>
          <br />
          決めていないランクへは、記録がいくらあっても上がりません。
        </p>

        {RANKS.filter((r) => rankOrder(r) > rankOrder(AUTO_MAX_RANK)).map((r) => (
          <GoalRow
            key={r}
            rank={r}
            goal={client.rankGoals[r] ?? null}
            busy={busy}
            onSave={(goal) => void saveGoal(r, goal)}
          />
        ))}
      </section>

      {/* ★ 完全削除は、いちばん下に、いちばん目立たない形で置きます。
             よく使う操作の隣に置くと、いつか押されます。 */}
      <DangerZone client={client} onDeleted={onBack} />
    </>
  );
}

function Field({
  label,
  children,
  accent,
}: {
  label: string;
  children: React.ReactNode;
  accent?: 'p' | 'f' | 'c';
}) {
  return (
    <label className="field">
      <span className={accent === undefined ? 'field-label' : `field-label macro ${accent}`}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function numberOrNull(value: string): number | null {
  if (value.trim().length === 0) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
