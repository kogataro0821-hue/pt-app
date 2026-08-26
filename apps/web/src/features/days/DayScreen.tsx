import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  addDays,
  formatDateLong,
  isWithinEditWindow,
  monthOf,
  todayKey,
  type DateKey,
} from '@pt/core';
import type { Client } from '@/features/clients/clientTypes';
import { MealsSection } from '@/features/meals/MealsSection';
import { getDay, saveBodyMetrics, validateBodyMetrics } from './daysRepo';
import { emptyDay, type Day } from './dayTypes';

/**
 * その日の画面（設計書 §6 / §11.2）。
 *
 * Phase 5 の時点では「体重・体脂肪率」だけが入力できます。
 * 食事と運動、そして1日確定は Phase 6 で足します。
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
  const [day, setDay] = useState<Day | null>(null);
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
                ? 'この日は確定済みです。修正が必要なときはトレーナーにご連絡ください。'
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
            allowFoodCreate={isAdmin || client.permissions.allowFoodCreate}
            onMealsChanged={(hasMeals) => setDay((prev) => (prev === null ? prev : { ...prev, hasMeals }))}
          />

          <section className="card placeholder">
            <h3 className="card-title">運動</h3>
            <p className="note">
              運動の記録は <b>Phase 6B</b> で作ります。1日確定もそちらで足します。
            </p>
          </section>
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
