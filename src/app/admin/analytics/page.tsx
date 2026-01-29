'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatTime } from '@/utils/storage';
import styles from './analytics.module.css';

type DailyRow = {
  date: string;
  starts: number;
  finishes: number;
  wins: number;
  avgFinishTimeMs: number | null;
  avgWinTimeMs: number | null;
  avgLossTimeMs: number | null;
  sharers: number;
  startsUser: number;
  startsGuest: number;
  newPlayers: number;
  returningPlayers: number;
  d1Cohort: number;
  d1Retained: number | null;
  d7Cohort: number;
  d7Retained: number | null;
};

type AdminAnalyticsOk = {
  ok: true;
  daily: DailyRow[];
  totals: {
    range: {
      startDate: string;
      endDate: string;
      days: number;
      starts: number;
      finishes: number;
      wins: number;
      avgFinishTimeMs: number | null;
      avgWinTimeMs: number | null;
      avgLossTimeMs: number | null;
      sharers: number;
      newPlayers: number;
    };
    lifetime: {
      totalPlayers: number;
      repeatPlayers: number;
    };
  };
};

type AdminAnalyticsResponse = AdminAnalyticsOk | { errorCode?: string; message?: string };

function isDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function pct(n: number | null, d: number | null): string {
  if (n == null || d == null || d <= 0) return '-';
  return `${Math.round((n / d) * 1000) / 10}%`;
}

function num(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

type MetricId = 'starts' | 'newPlayers' | 'avgWinTime' | 'avgFinishTime' | 'avgLossTime' | 'finishRate' | 'winRate' | 'shareRate';

function metricValue(row: DailyRow, metric: MetricId): number {
  switch (metric) {
    case 'starts':
      return row.starts;
    case 'newPlayers':
      return row.newPlayers;
    case 'avgWinTime':
      return row.avgWinTimeMs ?? 0;
    case 'avgFinishTime':
      return row.avgFinishTimeMs ?? 0;
    case 'avgLossTime':
      return row.avgLossTimeMs ?? 0;
    case 'finishRate':
      return row.starts > 0 ? row.finishes / row.starts : 0;
    case 'winRate':
      return row.finishes > 0 ? row.wins / row.finishes : 0;
    case 'shareRate':
      return row.starts > 0 ? row.sharers / row.starts : 0;
  }
}

function metricLabel(metric: MetricId): string {
  switch (metric) {
    case 'starts':
      return 'Starts (DAU)';
    case 'newPlayers':
      return 'New Players';
    case 'avgWinTime':
      return 'Avg Win Time';
    case 'avgFinishTime':
      return 'Avg Finish Time';
    case 'avgLossTime':
      return 'Avg Loss Time';
    case 'finishRate':
      return 'Finish Rate';
    case 'winRate':
      return 'Win Rate';
    case 'shareRate':
      return 'Share Rate';
  }
}

function formatMetric(metric: MetricId, value: number): string {
  if (metric === 'finishRate' || metric === 'winRate' || metric === 'shareRate') {
    return pct(value, 1);
  }
  if (metric === 'avgFinishTime' || metric === 'avgLossTime' || metric === 'avgWinTime') {
    return value > 0 ? formatTime(Math.round(value)) : '-';
  }
  return num(Math.round(value));
}

function Sparkline({
  rows,
  metric,
  secondary,
}: {
  rows: DailyRow[];
  metric: MetricId;
  secondary?: (row: DailyRow) => number;
}) {
  const width = 960;
  const height = 140;
  const padX = 10;
  const padY = 12;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const series = useMemo(() => rows.map((r) => metricValue(r, metric)), [rows, metric]);
  const series2 = useMemo(() => (secondary ? rows.map((r) => secondary(r)) : null), [rows, secondary]);

  const all = useMemo(() => (series2 ? [...series, ...series2] : series), [series, series2]);
  const min = Math.min(...all, 0);
  const max = Math.max(...all, 1e-9);
  const range = max - min || 1;

  const points = series
    .map((v, i) => {
      const x = padX + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
      const y = padY + (1 - (v - min) / range) * innerH;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const points2 = series2
    ? series2
        .map((v, i) => {
          const x = padX + (series2.length === 1 ? innerW / 2 : (i / (series2.length - 1)) * innerW);
          const y = padY + (1 - (v - min) / range) * innerH;
          return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(' ')
    : null;

  const gridLines = 4;

  return (
    <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {Array.from({ length: gridLines + 1 }).map((_, idx) => {
        const y = padY + (idx / gridLines) * innerH;
        return <line key={idx} className={styles.chartGrid} x1={padX} x2={padX + innerW} y1={y} y2={y} />;
      })}
      {points2 && <polyline className={styles.chartLineSecondary} points={points2} />}
      <polyline className={styles.chartLinePrimary} points={points} />
      {rows.map((r, idx) => {
        const title = `${r.date}: ${formatMetric(metric, series[idx] ?? 0)}`;
        const x = padX + (rows.length === 1 ? innerW / 2 : (idx / (rows.length - 1)) * innerW);
        const y = padY + (1 - ((series[idx] ?? 0) - min) / range) * innerH;
        return (
          <circle key={r.date} className={styles.chartPointPrimary} cx={x} cy={y} r={2.6}>
            <title>{title}</title>
          </circle>
        );
      })}
      {series2 &&
        rows.map((r, idx) => {
          const v = series2[idx] ?? 0;
          const title = `${r.date}: ${Math.round(v)}`;
          const x = padX + (rows.length === 1 ? innerW / 2 : (idx / (rows.length - 1)) * innerW);
          const y = padY + (1 - (v - min) / range) * innerH;
          return (
            <circle key={`${r.date}-s2`} className={styles.chartPointSecondary} cx={x} cy={y} r={2.2}>
              <title>{title}</title>
            </circle>
          );
        })}
    </svg>
  );
}

export default function AdminAnalyticsPage() {
  const [data, setData] = useState<AdminAnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [start, setStart] = useState<string>('');
  const [end, setEnd] = useState<string>('');
  const [metric, setMetric] = useState<MetricId>('starts');
  const [activePreset, setActivePreset] = useState<'1' | '7' | '30' | null>('30');

  const fetchAnalytics = useCallback(async (params: { start?: string; end?: string; days?: number }) => {
    const sp = new URLSearchParams();
    if (params.start) sp.set('start', params.start);
    if (params.end) sp.set('end', params.end);
    if (params.days) sp.set('days', String(params.days));

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/analytics?${sp.toString()}`, { method: 'GET', cache: 'no-store' });
      const json = (await res.json()) as AdminAnalyticsResponse;
      setData(json);
      const ok = (json as any).ok === true;
      if (!ok) {
        const msg = (json as any).message;
        setError(typeof msg === 'string' ? msg : 'Failed to load analytics');
      } else {
        setError(null);
        const range = (json as any).totals?.range;
        if (range?.startDate && range?.endDate) {
          setStart(String(range.startDate));
          setEnd(String(range.endDate));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics({ days: 30 }).catch(() => null);
  }, [fetchAnalytics]);

  const ok = data && (data as any).ok === true;
  const daily = ok ? ((data as AdminAnalyticsOk).daily ?? []) : [];
  const totals = ok ? (data as AdminAnalyticsOk).totals : null;

  const headline = useMemo(() => {
    if (!totals) return null;
    const startsN = totals.range.starts;
    const finishesN = totals.range.finishes;
    const winsN = totals.range.wins;
    const avgFinishTimeMs = totals.range.avgFinishTimeMs;
    const avgWinTimeMs = totals.range.avgWinTimeMs;
    const avgLossTimeMs = totals.range.avgLossTimeMs;
    const sharersN = totals.range.sharers;
    const newPlayersN = totals.range.newPlayers;
    return {
      range: `${totals.range.startDate} → ${totals.range.endDate} (${totals.range.days}d)`,
      starts: startsN,
      newPlayers: newPlayersN,
      finishRate: pct(finishesN, startsN),
      winRate: pct(winsN, finishesN),
      shareRate: pct(sharersN, startsN),
      avgFinishTime: avgFinishTimeMs != null ? formatTime(avgFinishTimeMs) : '-',
      avgWinTime: avgWinTimeMs != null ? formatTime(avgWinTimeMs) : '-',
      avgLossTime: avgLossTimeMs != null ? formatTime(avgLossTimeMs) : '-',
      totalPlayers: totals.lifetime.totalPlayers,
      repeatPlayers: totals.lifetime.repeatPlayers,
    };
  }, [totals]);

  const onPreset = useCallback(
    (days: 1 | 7 | 30) => {
      setActivePreset(String(days) as any);
      fetchAnalytics({ days }).catch(() => null);
    },
    [fetchAnalytics]
  );

  const canApplyCustom = isDateString(start) && isDateString(end) && start <= end;
  const onApplyCustom = useCallback(() => {
    if (!canApplyCustom) return;
    setActivePreset(null);
    fetchAnalytics({ start, end }).catch(() => null);
  }, [canApplyCustom, fetchAnalytics, start, end]);

  const primaryKpi = useMemo(() => {
    if (!daily.length) return null;
    const last = daily[daily.length - 1]!;
    const v = metricValue(last, metric);
    return `${metricLabel(metric)}: ${formatMetric(metric, v)}`;
  }, [daily, metric]);

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <section className={styles.header}>
          <div className={styles.headerTop}>
            <div>
              <div className={styles.title}>Admin Analytics</div>
              <div className={styles.subtitle}>Daily puzzle performance (guest-inclusive). “Starts” = first move.</div>
            </div>
            {headline && <div className={styles.mono}>{headline.range}</div>}
          </div>

          <div className={styles.rangeRow}>
            <div className={styles.rangePills}>
              <button
                className={`${styles.pill} ${activePreset === '1' ? styles.pillActive : ''}`}
                onClick={() => onPreset(1)}
                type="button"
              >
                1d
              </button>
              <button
                className={`${styles.pill} ${activePreset === '7' ? styles.pillActive : ''}`}
                onClick={() => onPreset(7)}
                type="button"
              >
                7d
              </button>
              <button
                className={`${styles.pill} ${activePreset === '30' ? styles.pillActive : ''}`}
                onClick={() => onPreset(30)}
                type="button"
              >
                30d
              </button>
            </div>

            <div className={styles.rangeInputs}>
              <input className={styles.dateInput} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              <span className={styles.mono} style={{ opacity: 0.65 }}>
                to
              </span>
              <input className={styles.dateInput} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              <button className={styles.applyButton} type="button" onClick={onApplyCustom} disabled={!canApplyCustom || loading}>
                Apply
              </button>
            </div>
          </div>
        </section>

        <section className={styles.content}>
          {error && <div className={styles.error}>Error: {error}</div>}
          {loading && <div className={styles.loading}>Refreshing…</div>}
          {!data && !error && <div className={styles.loading}>Loading…</div>}

          {headline && (
            <div className={styles.cards}>
              <div className={styles.card}>
                <div className={styles.cardLabel}>Starts</div>
                <div className={styles.cardValue}>{num(headline.starts)}</div>
                <div className={styles.cardNote}>Unique players/day summed over range</div>
              </div>
              <div className={styles.card}>
                <div className={styles.cardLabel}>New Players</div>
                <div className={styles.cardValue}>{num(headline.newPlayers)}</div>
                <div className={styles.cardNote}>First-ever start date is within range</div>
              </div>
              <div className={styles.card}>
                <div className={styles.cardLabel}>Finish Rate</div>
                <div className={styles.cardValue}>{headline.finishRate}</div>
                <div className={styles.cardNote}>Finished / started</div>
              </div>
              <div className={styles.card}>
                <div className={styles.cardLabel}>Win Rate</div>
                <div className={styles.cardValue}>{headline.winRate}</div>
                <div className={styles.cardNote}>Wins / finished</div>
              </div>
              <div className={styles.card}>
                <div className={styles.cardLabel}>Avg Finish Time</div>
                <div className={styles.cardValue}>{headline.avgFinishTime}</div>
                <div className={styles.cardNote}>Wins + losses</div>
              </div>
              <div className={styles.card}>
                <div className={styles.cardLabel}>Avg Win Time</div>
                <div className={styles.cardValue}>{headline.avgWinTime}</div>
                <div className={styles.cardNote}>Among wins</div>
              </div>
              <div className={styles.card}>
                <div className={styles.cardLabel}>Avg Loss Time</div>
                <div className={styles.cardValue}>{headline.avgLossTime}</div>
                <div className={styles.cardNote}>Among losses</div>
              </div>
              <div className={styles.card}>
                <div className={styles.cardLabel}>Share Rate</div>
                <div className={styles.cardValue}>{headline.shareRate}</div>
                <div className={styles.cardNote}>Unique sharers / started</div>
              </div>
              <div className={styles.card}>
                <div className={styles.cardLabel}>Players (lifetime)</div>
                <div className={styles.cardValue}>{num(headline.totalPlayers)}</div>
                <div className={styles.cardNote}>Cookie-UUID based</div>
              </div>
              <div className={styles.card}>
                <div className={styles.cardLabel}>Repeat Players (lifetime)</div>
                <div className={styles.cardValue}>{num(headline.repeatPlayers)}</div>
                <div className={styles.cardNote}>Played on 2+ distinct days</div>
              </div>
              <div className={styles.card}>
                <div className={styles.cardLabel}>Primary</div>
                <div className={styles.cardValue} style={{ fontSize: 16 }}>
                  {primaryKpi ?? '-'}
                </div>
                <div className={styles.cardNote}>Last day in range</div>
              </div>
            </div>
          )}

          {ok && (
            <div className={styles.gridTwo}>
              <div className={styles.panel}>
                <div className={styles.panelTitleRow}>
                  <div className={styles.panelTitle}>Trend</div>
                  <select className={styles.metricSelect} value={metric} onChange={(e) => setMetric(e.target.value as MetricId)}>
                    <option value="starts">Starts</option>
                    <option value="newPlayers">New players</option>
                    <option value="avgWinTime">Avg win time</option>
                    <option value="avgFinishTime">Avg finish time</option>
                    <option value="avgLossTime">Avg loss time</option>
                    <option value="finishRate">Finish rate</option>
                    <option value="winRate">Win rate</option>
                    <option value="shareRate">Share rate</option>
                  </select>
                </div>
                <Sparkline rows={daily} metric={metric} />
              </div>

              <div className={styles.panel}>
                <div className={styles.panelTitleRow}>
                  <div className={styles.panelTitle}>Starts split</div>
                  <div className={styles.mono} style={{ opacity: 0.7 }}>
                    user vs guest
                  </div>
                </div>
                <Sparkline rows={daily} metric="starts" secondary={(r) => r.startsUser} />
                <div className={styles.subtitle} style={{ marginTop: 8 }}>
                  Green = total starts, gray = signed-in starts.
                </div>
              </div>
            </div>
          )}

          {ok && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.th}>date</th>
                    <th className={`${styles.th} ${styles.thNum}`}>starts</th>
                    <th className={`${styles.th} ${styles.thNum}`}>new</th>
                    <th className={`${styles.th} ${styles.thNum}`}>returning</th>
                    <th className={`${styles.th} ${styles.thNum}`}>finishes</th>
                    <th className={`${styles.th} ${styles.thNum}`}>wins</th>
                    <th className={`${styles.th} ${styles.thNum}`}>avg fin</th>
                    <th className={`${styles.th} ${styles.thNum}`}>avg win</th>
                    <th className={`${styles.th} ${styles.thNum}`}>avg loss</th>
                    <th className={`${styles.th} ${styles.thNum}`}>finish%</th>
                    <th className={`${styles.th} ${styles.thNum}`}>win%</th>
                    <th className={`${styles.th} ${styles.thNum}`}>sharers</th>
                    <th className={`${styles.th} ${styles.thNum}`}>share%</th>
                    <th className={`${styles.th} ${styles.thNum}`}>guest</th>
                    <th className={`${styles.th} ${styles.thNum}`}>user</th>
                    <th className={`${styles.th} ${styles.thNum}`}>D1%</th>
                    <th className={`${styles.th} ${styles.thNum}`}>D7%</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.map((d, idx) => (
                    <tr key={d.date} className={idx % 2 === 1 ? styles.rowAlt : undefined}>
                      <td className={`${styles.td} ${styles.mono}`}>{d.date}</td>
                      <td className={`${styles.td} ${styles.num}`}>{num(d.starts)}</td>
                      <td className={`${styles.td} ${styles.num}`}>{num(d.newPlayers)}</td>
                      <td className={`${styles.td} ${styles.num}`}>{num(d.returningPlayers)}</td>
                      <td className={`${styles.td} ${styles.num}`}>{num(d.finishes)}</td>
                      <td className={`${styles.td} ${styles.num}`}>{num(d.wins)}</td>
                      <td className={`${styles.td} ${styles.num}`}>{d.avgFinishTimeMs != null ? formatTime(d.avgFinishTimeMs) : '-'}</td>
                      <td className={`${styles.td} ${styles.num}`}>{d.avgWinTimeMs != null ? formatTime(d.avgWinTimeMs) : '-'}</td>
                      <td className={`${styles.td} ${styles.num}`}>{d.avgLossTimeMs != null ? formatTime(d.avgLossTimeMs) : '-'}</td>
                      <td className={`${styles.td} ${styles.num}`}>{pct(d.finishes, d.starts)}</td>
                      <td className={`${styles.td} ${styles.num}`}>{pct(d.wins, d.finishes)}</td>
                      <td className={`${styles.td} ${styles.num}`}>{num(d.sharers)}</td>
                      <td className={`${styles.td} ${styles.num}`}>{pct(d.sharers, d.starts)}</td>
                      <td className={`${styles.td} ${styles.num}`}>{num(d.startsGuest)}</td>
                      <td className={`${styles.td} ${styles.num}`}>{num(d.startsUser)}</td>
                      <td className={`${styles.td} ${styles.num}`}>{pct(d.d1Retained, d.d1Cohort)}</td>
                      <td className={`${styles.td} ${styles.num}`}>{pct(d.d7Retained, d.d7Cohort)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
