import { addDays } from '@/lib/date';
import { getNewYorkDateString, LAUNCH_DATE_NY } from '@/game/puzzleGenerator';
import { ensureDbSchema, getDbPool } from './db';

export type ThemePreference = 'system' | 'light' | 'dark';

export type UserProfile = {
  characterId: string;
  skinId: string;
};

export type UserSettings = {
  theme: ThemePreference;
  leaderboardAutoSubmit: boolean;
};

export type UserStats = {
  playedStreak: number;
  winStreak: number;
  totalPlayed: number;
  totalWins: number;
  avgSolveTimeMs: number | null;
};

function isValidNyDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isTodayOrYesterdayNyDate(dateStr: string): boolean {
  if (!isValidNyDateString(dateStr)) return false;
  const today = getNewYorkDateString();
  const yesterday = addDays(today, -1);
  return dateStr === today || dateStr === yesterday;
}

export function coerceThemePreference(value: unknown): ThemePreference | null {
  if (value === 'system' || value === 'light' || value === 'dark') return value;
  return null;
}

export async function ensureUserProfile(userId: string): Promise<UserProfile> {
  await ensureDbSchema();
  const pool = getDbPool();
  await pool.query('insert into user_profiles (user_id) values ($1) on conflict do nothing', [userId]);
  const res = await pool.query<{ character_id: string; skin_id: string }>(
    'select character_id, skin_id from user_profiles where user_id=$1',
    [userId]
  );
  const row = res.rows[0];
  return {
    characterId: row?.character_id ?? 'default',
    skinId: row?.skin_id ?? 'default',
  };
}

export async function ensureUserSettings(userId: string): Promise<UserSettings> {
  await ensureDbSchema();
  const pool = getDbPool();
  await pool.query('insert into user_settings (user_id) values ($1) on conflict do nothing', [userId]);
  const res = await pool.query<{ theme: string; leaderboard_auto_submit: boolean }>(
    'select theme, leaderboard_auto_submit from user_settings where user_id=$1',
    [userId]
  );
  const row = res.rows[0];
  const theme = coerceThemePreference(row?.theme) ?? 'system';
  return {
    theme,
    leaderboardAutoSubmit: row?.leaderboard_auto_submit ?? true,
  };
}

export async function updateUserSettings(
  userId: string,
  patch: Partial<{ theme: ThemePreference; leaderboardAutoSubmit: boolean }>
): Promise<UserSettings> {
  await ensureDbSchema();
  const pool = getDbPool();
  await pool.query('insert into user_settings (user_id) values ($1) on conflict do nothing', [userId]);

  if (patch.theme != null || patch.leaderboardAutoSubmit != null) {
    await pool.query(
      `update user_settings
       set theme=coalesce($2, theme),
           leaderboard_auto_submit=coalesce($3, leaderboard_auto_submit),
           updated_at=now()
       where user_id=$1`,
      [userId, patch.theme ?? null, patch.leaderboardAutoSubmit ?? null]
    );
  }

  return ensureUserSettings(userId);
}

export async function updateUserProfile(
  userId: string,
  patch: Partial<UserProfile>
): Promise<UserProfile> {
  await ensureDbSchema();
  const pool = getDbPool();
  await pool.query('insert into user_profiles (user_id) values ($1) on conflict do nothing', [userId]);

  if (patch.characterId != null || patch.skinId != null) {
    await pool.query(
      `update user_profiles
       set character_id=coalesce($2, character_id),
           skin_id=coalesce($3, skin_id),
           updated_at=now()
       where user_id=$1`,
      [userId, patch.characterId ?? null, patch.skinId ?? null]
    );
  }

  return ensureUserProfile(userId);
}

export async function recordDailyResult(
  userId: string,
  input: { date: string; completed: boolean; timeMs: number | null; attemptsUsed: number | null }
): Promise<{ created: boolean; result: { date: string; completed: boolean; timeMs: number | null; attemptsUsed: number | null } }> {
  if (!isTodayOrYesterdayNyDate(input.date)) {
    throw new Error('DATE_NOT_ALLOWED');
  }

  await ensureDbSchema();
  const pool = getDbPool();

  const insertRes = await pool.query(
    `insert into daily_results (user_id, date, completed, time_ms, attempts_used)
     values ($1, $2::date, $3, $4, $5)
     on conflict do nothing`,
    [userId, input.date, input.completed, input.timeMs, input.attemptsUsed]
  );

  const created = (insertRes.rowCount ?? 0) > 0;

  const res = await pool.query<{ date: string; completed: boolean; time_ms: number | null; attempts_used: number | null }>(
    `select to_char(date, 'YYYY-MM-DD') as date, completed, time_ms, attempts_used
     from daily_results
     where user_id=$1 and date=$2::date`,
    [userId, input.date]
  );
  const row = res.rows[0];
  if (!row) {
    throw new Error('RESULT_NOT_FOUND');
  }

  return {
    created,
    result: {
      date: row.date,
      completed: row.completed,
      timeMs: row.time_ms,
      attemptsUsed: row.attempts_used,
    },
  };
}

export async function importDailyResults(
  userId: string,
  history: Array<{ date: string; completed: boolean; timeMs: number | null; attemptsUsed: number | null }>
): Promise<{ imported: number; skipped: number }> {
  await ensureDbSchema();
  const pool = getDbPool();

  const today = getNewYorkDateString();
  const sanitized = history
    .filter((h) => isValidNyDateString(h.date))
    .filter((h) => h.date >= LAUNCH_DATE_NY && h.date <= today)
    .map((h) => ({
      date: h.date,
      completed: !!h.completed,
      timeMs: h.completed && typeof h.timeMs === 'number' && Number.isFinite(h.timeMs) && h.timeMs > 0 ? h.timeMs : null,
      attemptsUsed:
        h.completed && typeof h.attemptsUsed === 'number' && Number.isFinite(h.attemptsUsed) && h.attemptsUsed >= 1 && h.attemptsUsed <= 3
          ? h.attemptsUsed
          : null,
    }));

  const payload = JSON.stringify(
    sanitized.map((h) => ({
      date: h.date,
      completed: h.completed,
      time_ms: h.timeMs,
      attempts_used: h.attemptsUsed,
    }))
  );

  const insertRes = await pool.query(
    `insert into daily_results (user_id, date, completed, time_ms, attempts_used)
     select $1::uuid, r.date, r.completed, r.time_ms, r.attempts_used
     from jsonb_to_recordset($2::jsonb) as r(date date, completed boolean, time_ms integer, attempts_used integer)
     on conflict do nothing`,
    [userId, payload]
  );

  const imported = insertRes.rowCount ?? 0;
  const skipped = sanitized.length - imported;
  return { imported, skipped };
}

export async function computeUserStats(userId: string): Promise<UserStats> {
  await ensureDbSchema();
  const pool = getDbPool();

  const totalsRes = await pool.query<{
    total_played: string;
    total_wins: string;
    avg_solve_time_ms: string | null;
  }>(
    `select
       count(*)::text as total_played,
       sum(case when completed then 1 else 0 end)::text as total_wins,
       avg(time_ms) filter (where completed)::text as avg_solve_time_ms
     from daily_results
     where user_id=$1`,
    [userId]
  );

  const totalPlayed = Number(totalsRes.rows[0]?.total_played ?? '0');
  const totalWins = Number(totalsRes.rows[0]?.total_wins ?? '0');
  const avgSolveTimeMsRaw = totalsRes.rows[0]?.avg_solve_time_ms;
  const avgSolveTimeMs = avgSolveTimeMsRaw != null ? Math.round(Number(avgSolveTimeMsRaw)) : null;

  const recentRes = await pool.query<{ date: string; completed: boolean }>(
    `select to_char(date, 'YYYY-MM-DD') as date, completed
     from daily_results
     where user_id=$1
     order by date desc
     limit 2000`,
    [userId]
  );

  const rows = recentRes.rows;
  const playedStreak = computePlayedStreak(rows.map((r) => r.date));
  const winStreak = computeWinStreak(rows.map((r) => ({ date: r.date, completed: r.completed })));

  return { playedStreak, winStreak, totalPlayed, totalWins, avgSolveTimeMs };
}

function computePlayedStreak(datesDesc: string[]): number {
  if (datesDesc.length === 0) return 0;
  const today = getNewYorkDateString();
  const yesterday = addDays(today, -1);
  const mostRecent = datesDesc[0]!;
  if (mostRecent !== today && mostRecent !== yesterday) return 0;
  let streak = 1;
  let prev = mostRecent;
  for (let i = 1; i < datesDesc.length; i += 1) {
    const expected = addDays(prev, -1);
    const next = datesDesc[i]!;
    if (next !== expected) break;
    streak += 1;
    prev = next;
  }
  return streak;
}

function computeWinStreak(rowsDesc: Array<{ date: string; completed: boolean }>): number {
  if (rowsDesc.length === 0) return 0;
  const today = getNewYorkDateString();
  const yesterday = addDays(today, -1);
  const mostRecent = rowsDesc[0]!;
  if (!mostRecent.completed) return 0;
  if (mostRecent.date !== today && mostRecent.date !== yesterday) return 0;
  let streak = 1;
  let prev = mostRecent.date;
  for (let i = 1; i < rowsDesc.length; i += 1) {
    const row = rowsDesc[i]!;
    const expected = addDays(prev, -1);
    if (row.date !== expected) break;
    if (!row.completed) break;
    streak += 1;
    prev = row.date;
  }
  return streak;
}
