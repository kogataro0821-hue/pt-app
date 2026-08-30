import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addDays,
  changeOverPeriod,
  formatDateLong,
  layoutChart,
  todayKey,
  type DateKey,
  type Point,
} from '@pt/core';
import type { Client } from '@/features/clients/clientTypes';
import { listRange } from '@/features/days/daysRepo';

/**
 * 体重の推移（設計書 §25）。
 *
 * ★ グラフ用の外部ライブラリは入れず、SVG で自前で描いています。
 *   必要なのは折れ線1本と目標線1本だけで、そのために数十KBを
 *   読み込ませるのは、通信の遅い場所で開く利用者に対して割に合いません。
 *   座標の計算は @pt/core にあり、テストで検証しています。
 */

const RANGES = [
  { key: '1m', label: '1か月', days: 30 },
  { key: '3m', label: '3か月', days: 90 },
  { key: '1y', label: '1年', days: 365 },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

/** 描画領域。CSSで横幅いっぱいに伸ばすので、ここは比率としての意味しかない。 */
const W = 320;
const H = 140;
const PAD = { top: 8, right: 8, bottom: 20, left: 34 };

export function WeightScreen({ client }: { client: Client }) {
  const [rangeKey, setRangeKey] = useState<RangeKey>('3m');
  const [rows, setRows] = useState<
    | { date: DateKey; weightKg: number | null; bodyFatPct: number | null; muscleKg: number | null }[]
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[1];
  const to = todayKey();
  const from = addDays(to, -(range.days - 1));

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);

    void (async () => {
      try {
        const days = await listRange(client.clientId, from, to);
        if (!cancelled) {
          setRows(
            days.map((d) => ({
              date: d.date,
              weightKg: d.weightKg,
              bodyFatPct: d.bodyFatPct,
              muscleKg: d.muscleKg,
            })),
          );
        }
      } catch {
        if (!cancelled) {
          setError('記録を読み込めませんでした。通信状態を確認してください。');
          setRows([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client.clientId, from, to]);

  const weightPoints: Point[] = useMemo(
    () =>
      (rows ?? [])
        .filter((r): r is typeof r & { weightKg: number } => r.weightKg !== null)
        .map((r) => ({ date: r.date, value: r.weightKg })),
    [rows],
  );

  const fatPoints: Point[] = useMemo(
    () =>
      (rows ?? [])
        .filter((r): r is typeof r & { bodyFatPct: number } => r.bodyFatPct !== null)
        .map((r) => ({ date: r.date, value: r.bodyFatPct })),
    [rows],
  );

  // ★ 筋肉量（追加仕様: 筋肉量）。
  //   「体重は減っていないが筋肉は増えている」が見えるのが、この欄の値打ちです。
  const musclePoints: Point[] = useMemo(
    () =>
      (rows ?? [])
        .filter((r): r is typeof r & { muscleKg: number } => r.muscleKg !== null)
        .map((r) => ({ date: r.date, value: r.muscleKg })),
    [rows],
  );

  return (
    <>
      <div className="section-head">
        <Link className="button-quiet back" to={`/c/${client.clientId}`}>
          ‹ カレンダー
        </Link>
      </div>

      <h2 className="title">体重の推移</h2>

      <div className="range-tabs" role="tablist">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            role="tab"
            aria-selected={r.key === rangeKey}
            className={r.key === rangeKey ? 'range-tab active' : 'range-tab'}
            onClick={() => setRangeKey(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {rows === null && <p className="lede">読み込んでいます…</p>}

      {rows !== null && (
        <>
          <Chart
            title="体重"
            unit="kg"
            points={weightPoints}
            target={client.targets.weightKg}
            from={from}
            to={to}
            accent="weight"
          />

          <Chart
            title="体脂肪率"
            unit="%"
            points={fatPoints}
            target={client.targets.bodyFatPct}
            from={from}
            to={to}
            accent="fat"
          />

          {/* ★ 記録がまだ1件も無くても、必ず出します。
                 最初は「空のグラフを並べたくない」と考えて隠していましたが、
                 隠したせいで「筋肉量の機能が入っていない」と受け取られました。
                 欄が無いのと機能が無いのは、使う側からは区別が付きません。
                 中身が空のときは「記録がありません」と書いてあるので、
                 見えているほうが、次に何をすればいいか分かります。 */}
          <Chart
            title="筋肉量"
            unit="kg"
            points={musclePoints}
            target={client.targets.muscleKg}
            from={from}
            to={to}
            accent="muscle"
          />
        </>
      )}
    </>
  );
}

function Chart({
  title,
  unit,
  points,
  target,
  from,
  to,
  accent,
}: {
  title: string;
  unit: string;
  points: Point[];
  target: number | null;
  from: DateKey;
  to: DateKey;
  accent: 'weight' | 'fat' | 'muscle';
}) {
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const layout = layoutChart(points, { width: innerW, height: innerH, from, to, target });
  const change = changeOverPeriod(points);

  const latest = points[points.length - 1];

  return (
    <section className="card">
      <div className="chart-head">
        <h3 className="card-title">{title}</h3>
        {latest !== undefined && (
          <span className="chart-latest">
            {latest.value}
            {unit}
          </span>
        )}
      </div>

      {points.length === 0 ? (
        <p className="note">この期間に{title}の記録がありません。</p>
      ) : (
        <>
          <svg
            className="chart"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${title}の推移`}
          >
            <g transform={`translate(${PAD.left},${PAD.top})`}>
              {/* 目盛りの横線と数値 */}
              {layout.ticks.map((tick) => {
                const y =
                  innerH - ((tick - layout.min) / Math.max(1e-9, layout.max - layout.min)) * innerH;
                return (
                  <g key={tick}>
                    <line className="chart-grid" x1={0} y1={y} x2={innerW} y2={y} />
                    <text className="chart-tick" x={-6} y={y + 3} textAnchor="end">
                      {tick}
                    </text>
                  </g>
                );
              })}

              {/* 目標線 */}
              {layout.targetY !== null && (
                <line
                  className="chart-target"
                  x1={0}
                  y1={layout.targetY}
                  x2={innerW}
                  y2={layout.targetY}
                />
              )}

              {/* 折れ線 */}
              {layout.path !== '' && (
                <path className={`chart-line ${accent}`} d={layout.path} fill="none" />
              )}

              {/* 点 */}
              {layout.points.map((p) => (
                <circle key={p.date} className={`chart-dot ${accent}`} cx={p.x} cy={p.y} r={2.5} />
              ))}
            </g>

            <text className="chart-axis" x={PAD.left} y={H - 5} textAnchor="start">
              {from.slice(5).replace('-', '/')}
            </text>
            <text className="chart-axis" x={W - PAD.right} y={H - 5} textAnchor="end">
              {to.slice(5).replace('-', '/')}
            </text>
          </svg>

          <div className="chart-facts">
            {change !== null && (
              <span className={change > 0 ? 'diff-over' : change < 0 ? 'diff-under' : 'diff-even'}>
                この期間で {change > 0 ? '+' : ''}
                {change}
                {unit}
              </span>
            )}
            {target !== null && (
              <span className="chart-target-label">
                目標 {target}
                {unit}
              </span>
            )}
            <span className="chart-count">{points.length}日ぶん</span>
          </div>

          {latest !== undefined && (
            <p className="note">最新の記録: {formatDateLong(latest.date)}</p>
          )}
        </>
      )}
    </section>
  );
}
