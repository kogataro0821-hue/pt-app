import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  addMonths,
  currentMonthKey,
  formatMonth,
  isValidMonthKey,
  monthGrid,
  todayKey,
  weekdayLabel,
  type DateKey,
  type MonthKey,
} from '@pt/core';
import { listMonth } from '@/features/days/daysRepo';
import { hasAnyMarker, markersOf, type Day, type DayMarkers } from '@/features/days/dayTypes';

/**
 * 月表示のカレンダー（設計書 §6 / Q11）。
 *
 * ★ マスには「印」しか出しません。カロリー等の数字は出しません。
 *   月表示に数字を詰めると、スマホの幅では読めなくなるためです。
 *   数字はその日の画面で見ます。
 *
 * ★ 通信は月に1回だけです（daysRepo.listMonth）。
 */
export function CalendarScreen({ clientId, month }: { clientId: string; month: MonthKey }) {
  const navigate = useNavigate();
  const [days, setDays] = useState<Map<DateKey, Day> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const safeMonth = isValidMonthKey(month) ? month : currentMonthKey();
  const today = todayKey();

  useEffect(() => {
    let cancelled = false;
    setDays(null);
    setError(null);

    void (async () => {
      try {
        const loaded = await listMonth(clientId, safeMonth);
        if (!cancelled) setDays(loaded);
      } catch {
        if (!cancelled) {
          setError('記録を読み込めませんでした。通信状態を確認してください。');
          setDays(new Map());
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId, safeMonth]);

  const cells = monthGrid(safeMonth);
  const recordedDays = days === null ? 0 : [...days.values()].filter((d) => hasAnyMarker(markersOf(d))).length;

  return (
    <>
      <div className="month-head">
        <Link
          className="month-nav"
          to={`/c/${clientId}/m/${addMonths(safeMonth, -1)}`}
          aria-label="前の月"
        >
          ‹
        </Link>
        <h2 className="month-title">{formatMonth(safeMonth)}</h2>
        <Link
          className="month-nav"
          to={`/c/${clientId}/m/${addMonths(safeMonth, 1)}`}
          aria-label="次の月"
        >
          ›
        </Link>
      </div>

      {safeMonth !== currentMonthKey() && (
        <div className="month-today">
          <Link className="button-quiet" to={`/c/${clientId}/m/${currentMonthKey()}`}>
            今月に戻る
          </Link>
        </div>
      )}

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="calendar" role="grid">
        <div className="calendar-weekdays" role="row">
          {[0, 1, 2, 3, 4, 5, 6].map((w) => (
            <span key={w} className={weekdayClass(w, 'calendar-weekday')} role="columnheader">
              {weekdayLabel(w)}
            </span>
          ))}
        </div>

        <div className="calendar-grid">
          {cells.map((c) => {
            const m = markersOf(days?.get(c.date));
            return (
              <button
                key={c.date}
                type="button"
                className={cellClass(c.inMonth, c.weekday, c.date === today, m.done)}
                onClick={() => navigate(`/c/${clientId}/d/${c.date}`)}
                aria-label={c.date}
              >
                <span className="cell-day">{c.dayOfMonth}</span>
                <Markers markers={m} loading={days === null} />
              </button>
            );
          })}
        </div>
      </div>

      <section className="card legend">
        <h3 className="card-title">印の見かた</h3>
        <ul className="legend-list">
          <li>
            <span className="dot meals" /> 食事の記録あり
          </li>
          <li>
            <span className="dot exercise" /> 運動の記録あり
          </li>
          <li>
            <span className="dot weight" /> 体重の記録あり
          </li>
          <li>
            <span className="bar done" /> 確定済み／AI評価済み
          </li>
        </ul>
        {days !== null && (
          <p className="note">
            {formatMonth(safeMonth)}は {recordedDays} 日ぶんの記録があります。
          </p>
        )}
      </section>
    </>
  );
}

function Markers({ markers, loading }: { markers: DayMarkers; loading: boolean }) {
  if (loading) return <span className="cell-dots" aria-hidden="true" />;
  return (
    <span className="cell-dots">
      {markers.meals && <span className="dot meals" />}
      {markers.exercise && <span className="dot exercise" />}
      {markers.weight && <span className="dot weight" />}
    </span>
  );
}

function weekdayClass(weekday: number, base: string): string {
  if (weekday === 0) return `${base} sunday`;
  if (weekday === 6) return `${base} saturday`;
  return base;
}

/**
 * ★ 「確定済み」だけは点ではなく下線で表します。
 *   点が4つ並ぶと、色の違いを見分けるのが難しくなるためです。
 *   下線なら、色を見なくても形で分かります。
 */
function cellClass(inMonth: boolean, weekday: number, isToday: boolean, done: boolean): string {
  const parts = [weekdayClass(weekday, 'calendar-cell')];
  if (!inMonth) parts.push('outside');
  if (isToday) parts.push('today');
  if (done) parts.push('done');
  return parts.join(' ');
}
