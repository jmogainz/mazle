import { ensureDbSchema, getDbPool } from './db';
import { env } from './env';

export type AnalyticsSubject = {
  date: string; // YYYY-MM-DD (NY date string)
  playerId: string; // guest cookie UUID
  userId: string | null; // signed-in user UUID (nullable)
};

export async function recordAnalyticsStart(subject: AnalyticsSubject): Promise<boolean> {
  if (!env('DB_URL')) return false;
  await ensureDbSchema();
  const pool = getDbPool();
  await pool.query(
    `insert into analytics_daily_plays (date, player_id, user_id, started_at, updated_at)
     values ($1::date, $2::uuid, $3::uuid, now(), now())
     on conflict (date, player_id) do update
       set started_at = coalesce(analytics_daily_plays.started_at, excluded.started_at),
           user_id = coalesce(analytics_daily_plays.user_id, excluded.user_id),
           updated_at = now()`,
    [subject.date, subject.playerId, subject.userId]
  );
  return true;
}

export async function recordAnalyticsFinish(
  subject: AnalyticsSubject,
  input: { completed: boolean; timeMs: number | null; attemptsUsed: number | null }
): Promise<boolean> {
  if (!env('DB_URL')) return false;
  await ensureDbSchema();
  const pool = getDbPool();
  await pool.query(
    `insert into analytics_daily_plays (date, player_id, user_id, started_at, finished_at, completed, time_ms, attempts_used, updated_at)
     values ($1::date, $2::uuid, $3::uuid, now(), now(), $4, $5, $6, now())
     on conflict (date, player_id) do update
       set started_at = coalesce(analytics_daily_plays.started_at, excluded.started_at),
           finished_at = coalesce(analytics_daily_plays.finished_at, excluded.finished_at),
           completed = coalesce(analytics_daily_plays.completed, excluded.completed),
           time_ms = coalesce(analytics_daily_plays.time_ms, excluded.time_ms),
           attempts_used = coalesce(analytics_daily_plays.attempts_used, excluded.attempts_used),
           user_id = coalesce(analytics_daily_plays.user_id, excluded.user_id),
           updated_at = now()`,
    [subject.date, subject.playerId, subject.userId, input.completed, input.timeMs, input.attemptsUsed]
  );
  return true;
}

export async function recordAnalyticsShare(
  subject: AnalyticsSubject,
  input: { kind: 'copy' | 'native' }
): Promise<boolean> {
  void input;
  if (!env('DB_URL')) return false;
  await ensureDbSchema();
  const pool = getDbPool();
  await pool.query(
    `insert into analytics_daily_plays (date, player_id, user_id, started_at, share_count, shared_at, updated_at)
     values ($1::date, $2::uuid, $3::uuid, now(), 1, now(), now())
     on conflict (date, player_id) do update
       set started_at = coalesce(analytics_daily_plays.started_at, excluded.started_at),
           share_count = analytics_daily_plays.share_count + 1,
           shared_at = coalesce(analytics_daily_plays.shared_at, excluded.shared_at),
           user_id = coalesce(analytics_daily_plays.user_id, excluded.user_id),
           updated_at = now()`,
    [subject.date, subject.playerId, subject.userId]
  );
  return true;
}

