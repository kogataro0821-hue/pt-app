import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  addDays,
  formatDateLong,
  isWithinEditWindow,
  monthOf,
  todayKey,
  ZERO,
  type DateKey,
  type Nutrients,
} from '@pt/core';
import type { Client } from '@/features/clients/clientTypes';
import { MealsSection } from '@/features/meals/MealsSection';
import { ExercisesSection } from '@/features/exercises/ExercisesSection';
import { PhotosSection } from '@/features/photos/PhotosSection';
import { NotesSection } from '@/features/notes/NotesSection';
import { ReviewSection } from '@/features/review/ReviewSection';
import { AI_RELAY_URL } from '@/config/firebase';
import { hasValidAiConsent } from '@/features/clients/clientTypes';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  getDay,
  saveBodyMetrics,
  setDayChecked,
  setDayStatus,
  validateBodyMetrics,
} from './daysRepo';
import { deleteAllPhotos } from '@/features/photos/photosRepo';
import { CheckCard } from './CheckCard';
import { emptyDay, type Day } from './dayTypes';

/**
 * その日の画面（設計書 §6 / §11.2）。
 *
 * からだ（体重）／食事／運動／1日確定 が1画面にまとまっています。
 *
 * ★ 編集可否の判定はここでも行いますが、これは親切のためです。
 *   本当の防衛線は Security Rules です（設計書 §7.1）。
 *   この画面の判定を書き換えても、古い日付は1バイトも保存できません。
 */
export function DayScreen({
  client,
  date,
  isAdmin,
}: {
  client: Client;
  date: DateKey;
  isAdmin: boolean;
}) {
  const { state } = useAuth();
  const adminUid = state.status === 'signedIn' ? state.user.uid : '';

  const [day, setDay] = useState<Day | null>(null);
  const [photoCount, setPhotoCount] = useState(0);
  /** AIに送った写真が保存されたら、写真欄を読み直させる */
  const [photoRefresh, setPhotoRefresh] = useState(0);
  /** AI評価に渡すための、その日の集計 */
  const [summary, setSummary] = useState<{
    totals: Nutrients;
    mealCount: number;
    pendingCount: number;
  }>({ totals: ZERO, mealCount: 0, pendingCount: 0 });
  const [exerciseMinutes, setExerciseMinutes] = useState(0);
  const [weight, setWeight] = useState('');
  const [bodyFat, setBodyFat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDay(null);
    setSaved(false);
    setError(null);

    void (async () => {
      try {
        const loaded = (await getDay(client.clientId, date)) ?? emptyDay(date);
        if (cancelled) return;
        setDay(loaded);
        setWeight(loaded.weightKg === null ? '' : String(loaded.weightKg));
        setBodyFat(loaded.bodyFatPct === null ? '' : String(loaded.bodyFatPct));
      } catch {
        if (!cancelled) setError('この日の記録を読み込めませんでした。');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client.clientId, date]);

  const isFuture = date > todayKey();
  const inWindow = isWithinEditWindow(date, client.permissions.pastEditWindowDays);
  const isFinalized = day?.status === 'finalized';
  const canEdit = isAdmin || (!isFinalized && inWindow && !isFuture);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || day === null) return;

    const metrics = { weightKg: numberOrNull(weight), bodyFatPct: numberOrNull(bodyFat) };
    const problem = validateBodyMetrics(metrics);
    if (problem !== null) {
      setError(problem);
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await saveBodyMetrics(client.clientId, date, metrics);
      setDay({ ...day, ...metrics });
      setSaved(true);
    } catch {
      setError(
        canEdit
          ? '保存に失敗しました。通信状態を確認してください。'
          : 'この日は編集できないため保存されませんでした。',
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * トレーナーの「確認しました」。
   *
   * ★ 写真を先に消し、そのあとで確認済みにします。
   *   順番を逆にすると、写真の削除に失敗したときに
   *   「確認済みなのに写真が残っている」状態になります。
   *   写真が残っているだけなら、もう一度押せば済みます。
   */
  async function check() {
    setBusy(true);
    setError(null);
    try {
      await deleteAllPhotos(client.clientId, date);
      await setDayChecked(client.clientId, date, adminUid);
      setPhotoCount(0);
      setDay((prev) =>
        prev === null ? prev : { ...prev, checkedAt: Date.now(), checkedBy: adminUid, photoOldestAt: null },
      );
    } catch {
      setError('確認を記録できませんでした。通信状態を確認してください。');
    } finally {
      setBusy(false);
    }
  }

  /** 押し間違いを直せるようにしておく。消えた写真は戻りません。 */
  async function uncheck() {
    setBusy(true);
    setError(null);
    try {
      await setDayChecked(client.clientId, date, null);
      setDay((prev) => (prev === null ? prev : { ...prev, checkedAt: null, checkedBy: null }));
    } catch {
      setError('確認を取り消せませんでした。');
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(next: 'open' | 'finalized') {
    if (busy || day === null) return;
    if (next === 'finalized' && !window.confirm('この日を確定します。よろしいですか？')) return;

    setBusy(true);
    setError(null);
    try {
      await setDayStatus(client.clientId, date, next);
      setDay({ ...day, status: next, finalizedAt: next === 'finalized' ? Date.now() : null });
    } catch {
      setError(
        next === 'open'
          ? '確定を解除できませんでした。編集できる期間を過ぎている可能性があります。'
          : '確定できませんでした。通信状態を確認してください。',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="section-head">
        <Link className="button-quiet back" to={`/c/${client.clientId}/m/${monthOf(date)}`}>
          ‹ カレンダー
        </Link>
      </div>

      <div className="day-head">
        <Link className="day-nav" to={`/c/${client.clientId}/d/${addDays(date, -1)}`} aria-label="前の日">
          ‹
        </Link>
        <h2 className="day-title">{formatDateLong(date)}</h2>
        <Link className="day-nav" to={`/c/${client.clientId}/d/${addDays(date, 1)}`} aria-label="次の日">
          ›
        </Link>
      </div>

      {day === null && error === null && <p className="lede">読み込んでいます…</p>}

      {day !== null && (
        <>
          {!canEdit && (
            <p className="notice">
              {isFinalized
                ? 'この日は確定済みです。書き直すには、下の「確定を解除する」を押してください。'
                : isFuture
                  ? 'まだ先の日付です。当日になったら記録できます。'
                  : `自分で修正できるのは${client.permissions.pastEditWindowDays}日前までです。ここから先はトレーナーにご連絡ください。`}
            </p>
          )}

          <form onSubmit={onSubmit} className="card">
            <h3 className="card-title">からだ</h3>

            <div className="grid-2">
              <label className="field">
                <span className="field-label">体重（kg）</span>
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={weight}
                  onChange={(e) => {
                    setWeight(e.target.value);
                    setSaved(false);
                  }}
                  disabled={!canEdit}
                  placeholder="未入力"
                />
              </label>

              <label className="field">
                <span className="field-label">体脂肪率（%）</span>
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={bodyFat}
                  onChange={(e) => {
                    setBodyFat(e.target.value);
                    setSaved(false);
                  }}
                  disabled={!canEdit}
                  placeholder="未入力"
                />
              </label>
            </div>

            {client.targets.weightKg !== null && (
              <p className="note">目標体重 {client.targets.weightKg}kg</p>
            )}

            {error !== null && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {saved && <p className="form-ok">保存しました。</p>}

            {canEdit && (
              <button className="button-primary" type="submit" disabled={busy}>
                {busy ? '保存中…' : '保存する'}
              </button>
            )}
          </form>

          <MealsSection
            clientId={client.clientId}
            date={date}
            targets={client.targets}
            canEdit={canEdit}
            isAdmin={isAdmin}
            aiConsent={client.aiConsent}
            onMealsChanged={(hasMeals) => setDay((prev) => (prev === null ? prev : { ...prev, hasMeals }))}
            onPhotoSaved={() => setPhotoRefresh((n) => n + 1)}
            onSummary={setSummary}
          />

          <ExercisesSection
            clientId={client.clientId}
            date={date}
            canEdit={canEdit}
            onExercisesChanged={(hasExercise, minutes) => {
              setDay((prev) => (prev === null ? prev : { ...prev, hasExercise }));
              setExerciseMinutes(minutes);
            }}
          />

          <PhotosSection
            clientId={client.clientId}
            date={date}
            canEdit={canEdit}
            onPhotosChanged={setPhotoCount}
            refreshToken={photoRefresh}
          />

          {/* ★ 確定カードより前に置きます。
              確定は「この日はおしまい」の合図なので、その下に読むものがあると
              目に入りません。トレーナーの言葉は記録の一部として上に置きます。 */}
          <NotesSection
            clientId={client.clientId}
            date={date}
            isAdmin={isAdmin}
            adminUid={adminUid}
          />

          {/* ★ AI評価は、トレーナーのコメントの「下」に置きます。
              人が書いた言葉が先に目に入る並びにするためです。 */}
          <ReviewSection
            clientId={client.clientId}
            date={date}
            totals={summary.totals}
            targets={client.targets}
            exerciseMinutes={exerciseMinutes}
            mealCount={summary.mealCount}
            pendingCount={summary.pendingCount}
            reviewMode={client.reviewMode}
            aiAvailable={AI_RELAY_URL !== null && hasValidAiConsent(client.aiConsent)}
            canEdit={canEdit || isAdmin}
            uid={adminUid}
          />

          {/* ★ 管理者だけ。1日確定（契約者の意思表示）とは別ものです。 */}
          {isAdmin && (
            <CheckCard
              checkedAt={day.checkedAt}
              photoCount={photoCount}
              busy={busy}
              onCheck={() => void check()}
              onUncheck={() => void uncheck()}
            />
          )}

          <FinalizeCard
            status={day.status}
            canFinalize={canEdit && !isFuture}
            canUnfinalize={isAdmin || (inWindow && !isFuture)}
            windowDays={client.permissions.pastEditWindowDays}
            busy={busy}
            onChange={(next) => void changeStatus(next)}
          />
        </>
      )}

      {error !== null && day === null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function numberOrNull(value: string): number | null {
  if (value.trim().length === 0) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 1日確定（設計書 §7 / Q14）。
 *
 * ★ 確定は「トレーナーへの提出」ではありません。
 *   「今日はもう食べません」という本人の意思表示です。
 *   だから、書き直したくなったら本人が解除できます。
 *
 *   それでも解除という一手間を残しているのは、
 *   確定済みの日をうっかり上書きする事故を防ぐためです。
 */
function FinalizeCard({
  status,
  canFinalize,
  canUnfinalize,
  windowDays,
  busy,
  onChange,
}: {
  status: 'open' | 'finalized';
  canFinalize: boolean;
  canUnfinalize: boolean;
  windowDays: number;
  busy: boolean;
  onChange: (next: 'open' | 'finalized') => void;
}) {
  if (status === 'finalized') {
    return (
      <section className="card finalized">
        <h3 className="card-title">この日は確定済みです</h3>
        <p className="note">
          記録が締められています。書き直したいときは、いったん解除してください。
        </p>
        {canUnfinalize ? (
          <button
            className="button-secondary"
            type="button"
            onClick={() => onChange('open')}
            disabled={busy}
          >
            確定を解除する
          </button>
        ) : (
          <p className="note">
            自分で解除できるのは{windowDays}日前までです。トレーナーにご連絡ください。
          </p>
        )}
      </section>
    );
  }

  if (!canFinalize) return null;

  return (
    <section className="card">
      <h3 className="card-title">1日を確定する</h3>
      <p className="note">
        「今日はもう食べません」という区切りです。確定すると、この日の記録は締められます。
        あとから書き直したくなったら、自分で解除できます。
      </p>
      <button
        className="button-primary"
        type="button"
        onClick={() => onChange('finalized')}
        disabled={busy}
      >
        1日を確定する
      </button>
    </section>
  );
}
