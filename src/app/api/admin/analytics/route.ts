import { NextResponse } from 'next/server';
import { ensureDbSchema, getDbPool } from '@/lib/server/db';
import { jsonError } from '@/lib/server/responses';
import { addDays } from '@/lib/date';
import { getNewYorkDateString } from '@/game/puzzleGenerator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isValidDateString(value: string | null): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dateDiffDaysInclusive(start: string, end: string): number {
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return NaN;
  return Math.floor((e - s) / (24 * 60 * 60 * 1000)) + 1;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const todayNy = getNewYorkDateString();

  const startParam = url.searchParams.get('start');
  const endParam = url.searchParams.get('end');
  const daysParam = url.searchParams.get('days');

  let startDate: string;
  let endDate: string;

  if (startParam || endParam) {
    if (!isValidDateString(startParam)) {
      return jsonError(400, 'INVALID_START', 'Missing or invalid start date (YYYY-MM-DD).');
    }
    startDate = startParam;

    if (endParam == null || endParam.trim().length === 0) {
      endDate = todayNy;
    } else if (!isValidDateString(endParam)) {
      return jsonError(400, 'INVALID_END', 'Invalid end date (YYYY-MM-DD).');
    } else {
      endDate = endParam;
    }

    if (endDate > todayNy) {
      return jsonError(400, 'END_IN_FUTURE', 'End date must be today or earlier (NY date).');
    }
    if (startDate > endDate) {
      return jsonError(400, 'INVALID_RANGE', 'start must be <= end.');
    }
  } else {
    const daysRaw = Number(daysParam ?? '30');
    const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(365, Math.floor(daysRaw))) : 30;
    endDate = todayNy;
    startDate = addDays(endDate, -(days - 1));
  }

  const days = dateDiffDaysInclusive(startDate, endDate);
  if (!Number.isFinite(days) || days <= 0) {
    return jsonError(400, 'INVALID_RANGE', 'Invalid date range.');
  }
  if (days > 365) {
    return jsonError(400, 'RANGE_TOO_LARGE', 'Date range too large (max 365 days).');
  }

  try {
    await ensureDbSchema();
    const pool = getDbPool();

    const seriesRes = await pool.query<{
      date: string;
      starts: number;
      finishes: number;
      wins: number;
      avg_finish_time_ms: number | null;
      avg_win_time_ms: number | null;
      avg_loss_time_ms: number | null;
      sharers: number;
      starts_user: number;
      starts_guest: number;
    }>(
      `with days as (
         select d::date as date
         from generate_series($1::date, $2::date, '1 day') d
       ),
       agg as (
         select
           date,
           count(*) filter (where started_at is not null)::int as starts,
           count(*) filter (where finished_at is not null)::int as finishes,
           count(*) filter (where completed is true)::int as wins,
           avg(time_ms) filter (where finished_at is not null and time_ms is not null)::float as avg_finish_time_ms,
           avg(time_ms) filter (where completed is true and time_ms is not null)::float as avg_win_time_ms,
           avg(time_ms) filter (where finished_at is not null and completed is false and time_ms is not null)::float as avg_loss_time_ms,
           count(*) filter (where share_count > 0)::int as sharers,
           count(*) filter (where started_at is not null and user_id is not null)::int as starts_user,
           count(*) filter (where started_at is not null and user_id is null)::int as starts_guest
         from analytics_daily_plays
         where date between $1::date and $2::date
         group by date
       )
       select
         to_char(days.date, 'YYYY-MM-DD') as date,
         coalesce(agg.starts, 0)::int as starts,
         coalesce(agg.finishes, 0)::int as finishes,
         coalesce(agg.wins, 0)::int as wins,
         agg.avg_finish_time_ms as avg_finish_time_ms,
         agg.avg_win_time_ms as avg_win_time_ms,
         agg.avg_loss_time_ms as avg_loss_time_ms,
         coalesce(agg.sharers, 0)::int as sharers,
         coalesce(agg.starts_user, 0)::int as starts_user,
         coalesce(agg.starts_guest, 0)::int as starts_guest
       from days
       left join agg on agg.date = days.date
       order by days.date asc`,
      [startDate, endDate]
    );

    const cohortRes = await pool.query<{
      date: string;
      cohort_size: number;
      d1_retained: number | null;
      d7_retained: number | null;
    }>(
      `with first as (
         select player_id, min(date) as cohort_date
         from analytics_daily_plays
         where started_at is not null
         group by player_id
       )
       select
         to_char(cohort_date, 'YYYY-MM-DD') as date,
         count(*)::int as cohort_size,
         case
           when cohort_date <= $3::date - 1 then
             count(*) filter (
               where exists (
                 select 1
                 from analytics_daily_plays a2
                 where a2.player_id = first.player_id
                   and a2.date = first.cohort_date + 1
                   and a2.started_at is not null
               )
             )::int
           else null
         end as d1_retained,
         case
           when cohort_date <= $3::date - 7 then
             count(*) filter (
               where exists (
                 select 1
                 from analytics_daily_plays a7
                 where a7.player_id = first.player_id
                   and a7.date = first.cohort_date + 7
                   and a7.started_at is not null
               )
             )::int
           else null
         end as d7_retained
       from first
       where cohort_date between $1::date and $2::date
       group by cohort_date
       order by cohort_date asc`,
      [startDate, endDate, todayNy]
    );

    const totalsRes = await pool.query<{
      total_players: number;
      repeat_players: number;
    }>(
      `select
         (select count(*)::int
          from (select player_id from analytics_daily_plays where started_at is not null group by player_id) t) as total_players,
         (select count(*)::int
          from (select player_id from analytics_daily_plays where started_at is not null group by player_id having count(*) > 1) t) as repeat_players`
    );

    const summaryRes = await pool.query<{
      avg_finish_time_ms: number | null;
      avg_win_time_ms: number | null;
      avg_loss_time_ms: number | null;
    }>(
      `select
         avg(time_ms) filter (where finished_at is not null and time_ms is not null)::float as avg_finish_time_ms,
         avg(time_ms) filter (where completed is true and time_ms is not null)::float as avg_win_time_ms,
         avg(time_ms) filter (where finished_at is not null and completed is false and time_ms is not null)::float as avg_loss_time_ms
       from analytics_daily_plays
       where date between $1::date and $2::date`,
      [startDate, endDate]
    );

    const cohortsByDate = new Map(cohortRes.rows.map((r) => [r.date, r]));

    const daily = seriesRes.rows.map((row) => {
      const cohort = cohortsByDate.get(row.date);
      const newPlayers = cohort?.cohort_size ?? 0;
      const returningPlayers = Math.max(0, row.starts - newPlayers);
      return {
        date: row.date,
        starts: row.starts,
        finishes: row.finishes,
        wins: row.wins,
        avgFinishTimeMs: row.avg_finish_time_ms != null ? Math.round(Number(row.avg_finish_time_ms)) : null,
        avgWinTimeMs: row.avg_win_time_ms != null ? Math.round(Number(row.avg_win_time_ms)) : null,
        avgLossTimeMs: row.avg_loss_time_ms != null ? Math.round(Number(row.avg_loss_time_ms)) : null,
        sharers: row.sharers,
        startsUser: row.starts_user,
        startsGuest: row.starts_guest,
        newPlayers,
        returningPlayers,
        d1Cohort: cohort?.cohort_size ?? 0,
        d1Retained: cohort?.d1_retained ?? null,
        d7Cohort: cohort?.cohort_size ?? 0,
        d7Retained: cohort?.d7_retained ?? null,
      };
    });

    const totals = {
      range: {
        startDate,
        endDate,
        days,
        starts: daily.reduce((a, d) => a + d.starts, 0),
        finishes: daily.reduce((a, d) => a + d.finishes, 0),
        wins: daily.reduce((a, d) => a + d.wins, 0),
        avgFinishTimeMs:
          summaryRes.rows[0]?.avg_finish_time_ms != null ? Math.round(Number(summaryRes.rows[0]?.avg_finish_time_ms)) : null,
        avgWinTimeMs:
          summaryRes.rows[0]?.avg_win_time_ms != null ? Math.round(Number(summaryRes.rows[0]?.avg_win_time_ms)) : null,
        avgLossTimeMs:
          summaryRes.rows[0]?.avg_loss_time_ms != null ? Math.round(Number(summaryRes.rows[0]?.avg_loss_time_ms)) : null,
        sharers: daily.reduce((a, d) => a + d.sharers, 0),
        newPlayers: daily.reduce((a, d) => a + d.newPlayers, 0),
      },
      lifetime: {
        totalPlayers: totalsRes.rows[0]?.total_players ?? 0,
        repeatPlayers: totalsRes.rows[0]?.repeat_players ?? 0,
      },
    };

    return NextResponse.json({ ok: true, daily, totals }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load analytics';
    return jsonError(500, 'ANALYTICS_FAILED', message);
  }
}
