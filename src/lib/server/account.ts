import { addDays } from '@/lib/date';
import { getNewYorkDateString, LAUNCH_DATE_NY } from '@/game/puzzleGenerator';
import { ensureDbSchema, getDbPool } from './db';
import { isDevMode } from './env';
import { getGuestProfile } from './guestStore';

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

type AttemptPosition = { x: number; y: number };
type AttemptPayload = {
  moveCount: number;
  correctMoves?: number | null;
  deviationIndex?: number | null;
  failedAt?: AttemptPosition | null;
  path?: AttemptPosition[];
};

const MAX_ATTEMPTS = 3;
const MAX_PATH = 512;

const ENTITLEMENT_SKIN_ROYAL = 'skin_royal';
const ENTITLEMENT_SKIN_OBSIDIAN = 'skin_obsidian';
const ENTITLEMENT_SKIN_PENGUIN = 'skin_penguin';

async function maybeSeedDevWinStreak(userId: string, pool: ReturnType<typeof getDbPool>): Promise<void> {
  if (!isDevMode()) return;

  const target = 50;
  const today = getNewYorkDateString();
  const rows: Array<{ date: string; completed: boolean; time_ms: number; attempts_used: number }> = [];

  for (let i = 0; i < target; i += 1) {
    const date = addDays(today, -i);
    if (date < LAUNCH_DATE_NY) break;
    rows.push({
      date,
      completed: true,
      time_ms: 60_000 + i * 1000,
      attempts_used: 1,
    });
  }

  if (rows.length === 0) return;

  const payload = JSON.stringify(rows);
  await pool.query(
    `insert into daily_results (user_id, date, completed, time_ms, attempts_used)
     select $1::uuid, r.date::date, r.completed, r.time_ms, r.attempts_used
     from jsonb_to_recordset($2::jsonb) as r(
       date text,
       completed boolean,
       time_ms integer,
       attempts_used integer
     )
     on conflict (user_id, date) do update
       set completed = (daily_results.completed or excluded.completed),
           time_ms = coalesce(daily_results.time_ms, excluded.time_ms),
           attempts_used = coalesce(daily_results.attempts_used, excluded.attempts_used)`,
    [userId, payload]
  );
}

async function maybeSeedDevPodiums(userId: string, pool: ReturnType<typeof getDbPool>): Promise<void> {
  if (!isDevMode()) return;

  const countRes = await pool.query<{ count: string }>(
    'select count(*)::text as count from leaderboard_podium where user_id=$1',
    [userId]
  );
  const existing = Number(countRes.rows[0]?.count ?? '0');
  const missing = 10 - existing;
  if (missing <= 0) return;

  const metaRes = await pool.query<{ display_name: string | null; character_id: string | null; skin_id: string | null }>(
    `select u.display_name, p.character_id, p.skin_id
     from users u
     left join user_profiles p on p.user_id = u.id
     where u.id=$1`,
    [userId]
  );
  const row = metaRes.rows[0];
  const displayName = row?.display_name ?? 'Player';
  const characterId = row?.character_id ?? 'default';
  const skinId = row?.skin_id ?? 'default';

  const seedDaysRaw = Number(process.env.DEV_SEED_DAYS ?? 30);
  const seedDays = Number.isFinite(seedDaysRaw) ? Math.max(1, Math.min(365, Math.floor(seedDaysRaw))) : 30;
  const today = getNewYorkDateString();
  const startOffset = seedDays + 10;

  let inserted = 0;
  const maxAttempts = Math.max(200, missing * 40);
  for (let i = 0; i < maxAttempts && inserted < missing; i += 1) {
    const date = addDays(today, -(startOffset + i));
    const timeMs = 45_000 + (i % 120) * 1000;
    const attemptsUsed = 1 + (i % 3);
    const res = await pool.query(
      `insert into leaderboard_podium
         (date, rank, user_id, time_ms, attempts_used, display_name_at_time, character_id_at_time, skin_id_at_time)
       values ($1::date, 1, $2::uuid, $3, $4, $5, $6, $7)
       on conflict do nothing`,
      [date, userId, timeMs, attemptsUsed, displayName, characterId, skinId]
    );
    if ((res.rowCount ?? 0) > 0) inserted += 1;
  }
}

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

export async function maybeGrantObsidianSkin(userId: string, totalPodiums: number): Promise<void> {
  if (totalPodiums < 10) return;

  await ensureDbSchema();
  const pool = getDbPool();

  // Already unlocked? (fast path)
  const existing = await pool.query('select 1 from entitlements where user_id=$1 and key=$2 limit 1', [userId, ENTITLEMENT_SKIN_OBSIDIAN]);
  if ((existing.rowCount ?? 0) > 0) return;

  await pool.query(
    `insert into entitlements (user_id, key, source)
     values ($1, $2, $3)
     on conflict do nothing`,
    [userId, ENTITLEMENT_SKIN_OBSIDIAN, 'podium_10']
  );
}

export async function maybeGrantPenguinSkin(userId: string, winStreak: number): Promise<void> {
  if (winStreak < 50) return;

  await ensureDbSchema();
  const pool = getDbPool();

  // Already unlocked? (fast path)
  const existing = await pool.query('select 1 from entitlements where user_id=$1 and key=$2 limit 1', [userId, ENTITLEMENT_SKIN_PENGUIN]);
  if ((existing.rowCount ?? 0) > 0) return;

  await pool.query(
    `insert into entitlements (user_id, key, source)
     values ($1, $2, $3)
     on conflict do nothing`,
    [userId, ENTITLEMENT_SKIN_PENGUIN, 'win_streak_50']
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
  input: {
    date: string;
    completed: boolean;
    timeMs: number | null;
    attemptsUsed: number | null;
    attemptScores?: number[] | null;
    attempts?: AttemptPayload[] | null;
  }
): Promise<{
  created: boolean;
  result: { date: string; completed: boolean; timeMs: number | null; attemptsUsed: number | null; attemptScores: number[] | null; attempts: AttemptPayload[] | null };
}> {
  if (!isTodayOrYesterdayNyDate(input.date)) {
    throw new Error('DATE_NOT_ALLOWED');
  }

  await ensureDbSchema();
  const pool = getDbPool();

  const attemptScores = coerceAttemptScores(input.attemptScores);
  const normalizedAttempts = coerceAttempts(input.attempts);
  const derivedScores = attemptScores ?? (normalizedAttempts ? deriveAttemptScores(normalizedAttempts) : null);
  const attemptScoresPayload = derivedScores ? JSON.stringify(derivedScores) : null;
  const attemptsPayload = normalizedAttempts ? JSON.stringify(normalizedAttempts) : null;
  const insertRes = await pool.query(
    `insert into daily_results (user_id, date, completed, time_ms, attempts_used, attempt_scores, attempts_json)
     values ($1, $2::date, $3, $4, $5, $6::jsonb, $7::jsonb)
     on conflict (user_id, date) do update
       set attempt_scores = coalesce(daily_results.attempt_scores, excluded.attempt_scores),
           attempts_json = coalesce(daily_results.attempts_json, excluded.attempts_json),
           time_ms = coalesce(daily_results.time_ms, excluded.time_ms),
           attempts_used = coalesce(daily_results.attempts_used, excluded.attempts_used)`,
    [userId, input.date, input.completed, input.timeMs, input.attemptsUsed, attemptScoresPayload, attemptsPayload]
  );

  const created = (insertRes.rowCount ?? 0) > 0;

  if (created) {
    // Best-effort: unlock cosmetics without blocking gameplay if it fails.
    computeUserStats(userId).then((s) => maybeGrantRoyalSkin(userId, s.playedStreak)).catch(() => null);
  }

  const res = await pool.query<{ date: string; completed: boolean; time_ms: number | null; attempts_used: number | null; attempt_scores: unknown; attempts_json: unknown }>(
    `select to_char(date, 'YYYY-MM-DD') as date, completed, time_ms, attempts_used, attempt_scores, attempts_json
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
      attemptScores: coerceAttemptScores(row.attempt_scores),
      attempts: coerceAttempts(row.attempts_json),
    },
  };
}

export async function recordGuestDailyResult(
  guestId: string,
  input: {
    date: string;
    completed: boolean;
    timeMs: number | null;
    attemptsUsed: number | null;
    attemptScores?: number[] | null;
    attempts?: AttemptPayload[] | null;
  }
): Promise<{
  created: boolean;
  result: { date: string; completed: boolean; timeMs: number | null; attemptsUsed: number | null; attemptScores: number[] | null; attempts: AttemptPayload[] | null };
}> {
  if (!isTodayOrYesterdayNyDate(input.date)) {
    throw new Error('DATE_NOT_ALLOWED');
  }

  // Best-effort refresh for the guest profile TTL; no guest stats are stored server-side.
  void getGuestProfile(guestId).catch(() => null);

  const normalizedAttempts = coerceAttempts(input.attempts);
  const attemptScores = coerceAttemptScores(input.attemptScores);
  const derivedScores = attemptScores ?? (normalizedAttempts ? deriveAttemptScores(normalizedAttempts) : null);

  return {
    created: false,
    result: {
      date: input.date,
      completed: input.completed,
      timeMs: input.timeMs,
      attemptsUsed: input.attemptsUsed,
      attemptScores: derivedScores ?? null,
      attempts: normalizedAttempts ?? null,
    },
  };
}

export async function getDailyResultForUser(
  userId: string,
  date: string
): Promise<{
  date: string;
  completed: boolean;
  timeMs: number | null;
  attemptsUsed: number | null;
  attemptScores: number[] | null;
  attempts: AttemptPayload[] | null;
} | null> {
  await ensureDbSchema();
  const pool = getDbPool();
  const res = await pool.query<{ date: string; completed: boolean; time_ms: number | null; attempts_used: number | null; attempt_scores: unknown; attempts_json: unknown }>(
    `select to_char(date, 'YYYY-MM-DD') as date, completed, time_ms, attempts_used, attempt_scores, attempts_json
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
    attemptScores: coerceAttemptScores(row.attempt_scores),
    attempts: coerceAttempts(row.attempts_json),
  };
}

export async function getAllDailyResultsForUser(
  userId: string
): Promise<Array<{ date: string; completed: boolean; timeMs: number | null; attemptsUsed: number | null; attemptScores: number[] | null }>> {
  await ensureDbSchema();
  const pool = getDbPool();
  const res = await pool.query<{ date: string; completed: boolean; time_ms: number | null; attempts_used: number | null; attempt_scores: unknown }>(
    `select to_char(date, 'YYYY-MM-DD') as date, completed, time_ms, attempts_used, attempt_scores
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
    attemptScores: coerceAttemptScores(row.attempt_scores),
  }));
}

export async function getDailyResultForGuest(
  guestId: string,
  date: string
): Promise<{
  date: string;
  completed: boolean;
  timeMs: number | null;
  attemptsUsed: number | null;
  attemptScores: number[] | null;
  attempts: AttemptPayload[] | null;
} | null> {
  void guestId;
  void date;
  return null;
}

export async function migrateGuestDailyResults(guestId: string, userId: string): Promise<void> {
  void guestId;
  void userId;
}

export async function importDailyResults(
  userId: string,
  history: Array<{
    date: string;
    completed: boolean;
    timeMs: number | null;
    attemptsUsed: number | null;
    attemptScores?: number[] | null;
    attempts?: AttemptPayload[] | null;
  }>
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
      timeMs: typeof h.timeMs === 'number' && Number.isFinite(h.timeMs) && h.timeMs > 0 ? h.timeMs : null,
      attemptsUsed:
        typeof h.attemptsUsed === 'number' && Number.isFinite(h.attemptsUsed) && h.attemptsUsed >= 1 && h.attemptsUsed <= 3
          ? h.attemptsUsed
          : null,
      attemptScores: coerceAttemptScores(h.attemptScores),
      attempts: coerceAttempts(h.attempts),
    }));

  const payload = JSON.stringify(
    sanitized.map((h) => ({
      date: h.date,
      completed: h.completed,
      time_ms: h.timeMs,
      attempts_used: h.attemptsUsed,
      attempt_scores: h.attemptScores,
      attempts_json: h.attempts,
    }))
  );

  const insertRes = await pool.query(
    `insert into daily_results (user_id, date, completed, time_ms, attempts_used, attempt_scores, attempts_json)
     select $1::uuid, r.date, r.completed, r.time_ms, r.attempts_used, r.attempt_scores, r.attempts_json
     from jsonb_to_recordset($2::jsonb) as r(
       date date,
       completed boolean,
       time_ms integer,
       attempts_used integer,
       attempt_scores jsonb,
       attempts_json jsonb
     )
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

  if (isDevMode()) {
    await maybeSeedDevWinStreak(userId, pool).catch(() => null);
  }

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

  if (isDevMode()) {
    await maybeSeedDevPodiums(userId, pool).catch(() => null);
  }

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
  const totalPodiums = goldCount + silverCount + bronzeCount;

  maybeGrantRoyalSkin(userId, playedStreak).catch(() => null);
  maybeGrantObsidianSkin(userId, totalPodiums).catch(() => null);
  maybeGrantPenguinSkin(userId, winStreak).catch(() => null);

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

function coerceNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function coercePosition(value: unknown): AttemptPosition | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { x?: unknown; y?: unknown };
  const x = coerceNumber(raw.x);
  const y = coerceNumber(raw.y);
  if (x == null || y == null) return null;
  return { x, y };
}

function coerceAttempts(value: unknown): AttemptPayload[] | null {
  if (!Array.isArray(value)) return null;
  const attempts: AttemptPayload[] = [];
  for (const raw of value.slice(0, MAX_ATTEMPTS)) {
    if (!raw || typeof raw !== 'object') continue;
    const attempt = raw as {
      moveCount?: unknown;
      correctMoves?: unknown;
      deviationIndex?: unknown;
      failedAt?: unknown;
      path?: unknown;
    };

    const moveCount = coerceNumber(attempt.moveCount) ?? 0;
    const correctMoves = coerceNumber(attempt.correctMoves);
    const deviationIndex = coerceNumber(attempt.deviationIndex);
    const failedAt = coercePosition(attempt.failedAt);

    let path: AttemptPosition[] | undefined;
    if (Array.isArray(attempt.path)) {
      const cleaned: AttemptPosition[] = [];
      for (const pos of attempt.path.slice(0, MAX_PATH)) {
        const coerced = coercePosition(pos);
        if (coerced) cleaned.push(coerced);
      }
      if (cleaned.length > 0) path = cleaned;
    }

    attempts.push({
      moveCount,
      correctMoves: correctMoves ?? undefined,
      deviationIndex: deviationIndex ?? undefined,
      failedAt: failedAt ?? undefined,
      path,
    });
  }
  return attempts.length > 0 ? attempts : null;
}

function deriveAttemptScores(attempts: AttemptPayload[]): number[] {
  return attempts.map((attempt) => {
    if (typeof attempt.correctMoves === 'number' && Number.isFinite(attempt.correctMoves)) {
      return Math.max(0, Math.round(attempt.correctMoves));
    }
    if (typeof attempt.deviationIndex === 'number' && Number.isFinite(attempt.deviationIndex) && attempt.deviationIndex >= 0) {
      return Math.max(0, Math.round(attempt.deviationIndex - 1));
    }
    if (typeof attempt.moveCount === 'number' && Number.isFinite(attempt.moveCount)) {
      return Math.max(0, Math.round(attempt.moveCount));
    }
    return 0;
  });
}

function coerceAttemptScores(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const scores = value
    .map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null))
    .filter((v): v is number => v != null);
  return scores.length > 0 ? scores : null;
}
