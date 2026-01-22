import { addDays } from '@/lib/date';
import { getNewYorkDateString, LAUNCH_DATE_NY } from '@/game/puzzleGenerator';
import { ensureDbSchema, getDbPool } from './db';
import { 
  getGuestDailyResults, 
  getGuestDailyResult, 
  recordGuestDailyResult as recordGuestDailyResultRedis,
  deleteGuestData,
} from './guestStore';

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
  maxPlayedStreak: number;
  totalPlayed: number;
  totalWins: number;
  avgSolveTimeMs: number | null;
  goldCount: number;
  silverCount: number;
  bronzeCount: number;
};

const ENTITLEMENT_SKIN_ROYAL = 'skin_royal';

export async function maybeGrantRoyalSkin(userId: string, playedStreak: number): Promise<void> {
  if (playedStreak < 20) return;

  await ensureDbSchema();
  const pool = getDbPool();

  // Already unlocked? (fast path)
  const existing = await pool.query('select 1 from entitlements where user_id=$1 and key=$2 limit 1', [userId, ENTITLEMENT_SKIN_ROYAL]);
  if ((existing.rowCount ?? 0) > 0) return;

  await pool.query(
    `insert into entitlements (user_id, key, source)
     values ($1, $2, $3)
     on conflict do nothing`,
    [userId, ENTITLEMENT_SKIN_ROYAL, 'streak_20_play']
  );
}

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

  if (created) {
    // Best-effort: unlock cosmetics without blocking gameplay if it fails.
    computeUserStats(userId).then((s) => maybeGrantRoyalSkin(userId, s.playedStreak)).catch(() => null);
  }

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

export async function recordGuestDailyResult(
  guestId: string,
  input: { date: string; completed: boolean; timeMs: number | null; attemptsUsed: number | null }
): Promise<{ created: boolean; result: { date: string; completed: boolean; timeMs: number | null; attemptsUsed: number | null } }> {
  if (!isTodayOrYesterdayNyDate(input.date)) {
    throw new Error('DATE_NOT_ALLOWED');
  }

  const { created, result } = await recordGuestDailyResultRedis(guestId, input);

  return {
    created,
    result: {
      date: result.date,
      completed: result.completed,
      timeMs: result.timeMs,
      attemptsUsed: result.attemptsUsed,
    },
  };
}

export async function getDailyResultForUser(
  userId: string,
  date: string
): Promise<{ date: string; completed: boolean; timeMs: number | null; attemptsUsed: number | null } | null> {
  await ensureDbSchema();
  const pool = getDbPool();
  const res = await pool.query<{ date: string; completed: boolean; time_ms: number | null; attempts_used: number | null }>(
    `select to_char(date, 'YYYY-MM-DD') as date, completed, time_ms, attempts_used
     from daily_results
     where user_id=$1 and date=$2::date`,
    [userId, date]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    date: row.date,
    completed: row.completed,
    timeMs: row.time_ms,
    attemptsUsed: row.attempts_used,
  };
}

export async function getAllDailyResultsForUser(
  userId: string
): Promise<Array<{ date: string; completed: boolean; timeMs: number | null; attemptsUsed: number | null }>> {
  await ensureDbSchema();
  const pool = getDbPool();
  const res = await pool.query<{ date: string; completed: boolean; time_ms: number | null; attempts_used: number | null }>(
    `select to_char(date, 'YYYY-MM-DD') as date, completed, time_ms, attempts_used
     from daily_results
     where user_id=$1
     order by date asc`,
    [userId]
  );
  return res.rows.map((row) => ({
    date: row.date,
    completed: row.completed,
    timeMs: row.time_ms,
    attemptsUsed: row.attempts_used,
  }));
}

export async function getDailyResultForGuest(
  guestId: string,
  date: string
): Promise<{ date: string; completed: boolean; timeMs: number | null; attemptsUsed: number | null } | null> {
  const result = await getGuestDailyResult(guestId, date);
  if (!result) return null;
  return {
    date: result.date,
    completed: result.completed,
    timeMs: result.timeMs,
    attemptsUsed: result.attemptsUsed,
  };
}

export async function migrateGuestDailyResults(guestId: string, userId: string): Promise<void> {
  await ensureDbSchema();
  const pool = getDbPool();
  
  // Check if this guest was already migrated (to a different user)
  await pool.query(
    `insert into guest_user_links (guest_id, user_id)
     values ($1, $2)
     on conflict (guest_id) do nothing`,
    [guestId, userId]
  );

  const res = await pool.query<{ user_id: string; migrated_at: string | null }>(
    'select user_id::text, migrated_at from guest_user_links where guest_id=$1',
    [guestId]
  );
  const row = res.rows[0];
  if (!row) return;
  if (row.user_id !== userId) return; // Guest already linked to a different user
  if (row.migrated_at) {
    console.log(`[MIGRATE] Guest ${guestId} already migrated at ${row.migrated_at}`);
    return; // Already migrated
  }

  // Get guest daily results from Redis
  const guestResults = await getGuestDailyResults(guestId);
  console.log(`[MIGRATE] Guest ${guestId} has ${guestResults.length} results to migrate`);
  if (guestResults.length === 0) {
    // No results to migrate, but still mark as migrated and clean up
    await pool.query('update guest_user_links set migrated_at=now() where guest_id=$1', [guestId]);
    await deleteGuestData(guestId);
    return;
  }

  // Insert each result into the user's daily_results table
  let migratedCount = 0;
  for (const result of guestResults) {
    console.log(`[MIGRATE] Migrating result for date ${result.date}: completed=${result.completed}, timeMs=${result.timeMs}`);
    const insertRes = await pool.query(
      `insert into daily_results (user_id, date, completed, time_ms, attempts_used, played_at)
       values ($1, $2::date, $3, $4, $5, to_timestamp($6 / 1000.0))
       on conflict do nothing`,
      [userId, result.date, result.completed, result.timeMs, result.attemptsUsed, result.playedAt]
    );
    if ((insertRes.rowCount ?? 0) > 0) {
      migratedCount++;
    }
  }
  console.log(`[MIGRATE] Migrated ${migratedCount} results for user ${userId}`);

  // Mark as migrated
  await pool.query('update guest_user_links set migrated_at=now() where guest_id=$1', [guestId]);

  // Delete guest data from Redis now that it's migrated
  await deleteGuestData(guestId);
}

export async function importDailyResults(
  userId: string,
  history: Array<{ date: string; completed: boolean; timeMs: number | null; attemptsUsed: number | null }>
): Promise<{ imported: number; skipped: number }> {
  await ensureDbSchema();
  const pool = getDbPool();

  const today = getNewYorkDateString();
  const yesterday = addDays(today, -1);
  const sanitized = history
    .filter((h) => isValidNyDateString(h.date))
    .filter((h) => h.date >= LAUNCH_DATE_NY && h.date <= yesterday)
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

  if (imported > 0) {
    computeUserStats(userId).then((s) => maybeGrantRoyalSkin(userId, s.playedStreak)).catch(() => null);
  }
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
     order by date desc`,
    [userId]
  );

  const rows = recentRes.rows;
  const datesDesc = rows.map((r) => r.date);
  const playedStreak = computePlayedStreak(datesDesc);
  const winStreak = computeWinStreak(rows.map((r) => ({ date: r.date, completed: r.completed })));
  const maxPlayedStreak = computeMaxPlayedStreak(datesDesc);

  // Query podium counts from hall of fame snapshot (final positions, not submission-time ranks)
  const podiumRes = await pool.query<{
    gold_count: string;
    silver_count: string;
    bronze_count: string;
  }>(
    `select
       sum(case when rank = 1 then 1 else 0 end)::text as gold_count,
       sum(case when rank = 2 then 1 else 0 end)::text as silver_count,
       sum(case when rank = 3 then 1 else 0 end)::text as bronze_count
     from leaderboard_podium
     where user_id=$1`,
    [userId]
  );

  const goldCount = Number(podiumRes.rows[0]?.gold_count ?? '0');
  const silverCount = Number(podiumRes.rows[0]?.silver_count ?? '0');
  const bronzeCount = Number(podiumRes.rows[0]?.bronze_count ?? '0');

  maybeGrantRoyalSkin(userId, playedStreak).catch(() => null);

  return { playedStreak, winStreak, maxPlayedStreak, totalPlayed, totalWins, avgSolveTimeMs, goldCount, silverCount, bronzeCount };
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

function computeMaxPlayedStreak(datesDesc: string[]): number {
  if (datesDesc.length === 0) return 0;
  let maxStreak = 1;
  let current = 1;
  let prev = datesDesc[0]!;
  for (let i = 1; i < datesDesc.length; i += 1) {
    const date = datesDesc[i]!;
    if (date === addDays(prev, -1)) {
      current += 1;
    } else {
      current = 1;
    }
    if (current > maxStreak) maxStreak = current;
    prev = date;
  }
  return maxStreak;
}
