import crypto from 'node:crypto';
import { getToken } from 'next-auth/jwt';
import { ensureDbSchema, getDbPool } from './db';
import { env } from './env';
import { ensureUserSettings, migrateGuestDailyResults } from './account';
import { getLeaderboardRedis } from './redis';
import {
  encodeLeaderboardScore,
  leaderboardMemberIndexKey,
  leaderboardZsetKey,
  LB_NAMES_KEY,
  makeLeaderboardMember,
} from './leaderboard';
import { getGuestProfile, guestDisplayNameExists, reserveGuestDisplayName, saveGuestProfile } from './guestStore';
import { randomDisplayNameCandidate } from './displayNames';

export type MeIdentity = {
  mode: 'guest' | 'user';
  displayName: string;
  entitlements: {
    archiveAccess: boolean;
    adsRemoved: boolean;
  };
  userId: string | null;
  guestId: string;
  setGuestCookie: boolean;
};

export const GUEST_COOKIE = 'mazle_guest_id';

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function randomInt(min: number, max: number): number {
  return crypto.randomInt(min, max + 1);
}

async function isUserDisplayNameTaken(name: string, excludeUserId?: string | null): Promise<boolean> {
  const pool = getDbPool();
  const res = await pool.query(
    `select 1
     from users
     where display_name is not null
       and lower(display_name)=lower($1)
       and ($2::uuid is null or id <> $2)
     limit 1`,
    [name, excludeUserId ?? null]
  );
  return (res.rowCount ?? 0) > 0;
}

async function generateUniqueDisplayNameForUser(): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const candidate = randomDisplayNameCandidate(randomInt);
    // eslint-disable-next-line no-await-in-loop
    const userTaken = await isUserDisplayNameTaken(candidate);
    if (userTaken) continue;
    // eslint-disable-next-line no-await-in-loop
    const guestTaken = await guestDisplayNameExists(candidate);
    if (!guestTaken) return candidate;
  }
  return `Player${crypto.randomBytes(3).toString('hex')}`;
}

async function generateUniqueDisplayNameForGuest(guestId: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const candidate = randomDisplayNameCandidate(randomInt);
    // eslint-disable-next-line no-await-in-loop
    const userTaken = await isUserDisplayNameTaken(candidate);
    if (userTaken) continue;
    // eslint-disable-next-line no-await-in-loop
    const reserved = await reserveGuestDisplayName(candidate, guestId);
    if (reserved) return candidate;
  }
  for (let i = 0; i < 10; i++) {
    const fallback = `Player${crypto.randomBytes(3).toString('hex')}`;
    // eslint-disable-next-line no-await-in-loop
    const userTaken = await isUserDisplayNameTaken(fallback);
    if (userTaken) continue;
    // eslint-disable-next-line no-await-in-loop
    const reserved = await reserveGuestDisplayName(fallback, guestId);
    if (reserved) return fallback;
  }
  throw new Error('Failed to allocate guest display name');
}

export async function getSessionUserId(request: Request): Promise<string | null> {
  const secret = env('AUTH_SECRET') || env('NEXTAUTH_SECRET');
  if (!secret) return null;
  const token = await getToken({ req: request as any, secret }).catch(() => null);
  const userId = (token as any)?.userId;
  return typeof userId === 'string' && userId.length > 0 ? userId : null;
}

export function subjectKeyFor(identity: { userId: string | null; guestId: string }): string {
  return identity.userId ? `user:${identity.userId}` : `guest:${identity.guestId}`;
}

async function getOrCreateGuest(guestIdCandidate: string | null): Promise<{ guestId: string; displayName: string; setCookie: boolean }> {
  if (guestIdCandidate && isUuid(guestIdCandidate)) {
    const existing = await getGuestProfile(guestIdCandidate);
    if (existing) {
      return { guestId: existing.guestId, displayName: existing.displayName, setCookie: false };
    }
    
    // Guest profile expired in Redis but the guest ID is still valid from cookie.
    // Recreate the profile so we can migrate their data (guest_daily_results uses guest_id).
    const displayName = await generateUniqueDisplayNameForGuest(guestIdCandidate);
    await saveGuestProfile(guestIdCandidate, displayName);
    return { guestId: guestIdCandidate, displayName, setCookie: false };
  }

  const guestId = crypto.randomUUID();
  const displayName = await generateUniqueDisplayNameForGuest(guestId);
  await saveGuestProfile(guestId, displayName);
  return { guestId, displayName, setCookie: true };
}

async function getUserDisplayName(userId: string): Promise<string | null> {
  await ensureDbSchema();
  const pool = getDbPool();
  const res = await pool.query<{ display_name: string | null }>('select display_name from users where id=$1', [userId]);
  return res.rows[0]?.display_name ?? null;
}

async function ensureUserDisplayName(userId: string, preferredName: string | null): Promise<string> {
  await ensureDbSchema();
  const pool = getDbPool();

  const current = await getUserDisplayName(userId);
  if (current) return current;

  // Check if preferred name is available (not taken by another user)
  let next: string;
  if (preferredName && !(await isUserDisplayNameTaken(preferredName, userId))) {
    next = preferredName;
  } else {
    next = await generateUniqueDisplayNameForUser();
  }
  
  await pool.query('update users set display_name=$2, updated_at=now() where id=$1 and display_name is null', [userId, next]);
  return (await getUserDisplayName(userId)) ?? next;
}

async function linkGuestToUser(userId: string, guestId: string): Promise<void> {
  console.log(`[LINK] Linking guest ${guestId} to user ${userId}`);
  await ensureDbSchema();
  const pool = getDbPool();
  if (!isUuid(userId)) {
    console.log(`[LINK] Invalid userId: ${userId}`);
    return;
  }
  await pool.query('insert into users (id) values ($1) on conflict do nothing', [userId]);

  const guest = await getGuestProfile(guestId);
  console.log(`[LINK] Guest profile: ${guest ? guest.displayName : 'null'}`);
  const guestName = guest?.displayName ?? null;
  const userDisplayName = guestName ? await ensureUserDisplayName(userId, guestName) : await ensureUserDisplayName(userId, null);

  await migrateTodayLeaderboardIfPresent({ userId, guestId, userDisplayName }).catch((e) => {
    console.log(`[LINK] migrateTodayLeaderboardIfPresent error:`, e);
    return null;
  });
  await migrateGuestDailyResults(guestId, userId).catch((e) => {
    console.log(`[LINK] migrateGuestDailyResults error:`, e);
    return null;
  });
  
  // Auto-submit today's result if user has auto-submit enabled and result exists but wasn't submitted
  await autoSubmitTodayIfEnabled({ userId, userDisplayName }).catch((e) => {
    console.log(`[LINK] autoSubmitTodayIfEnabled error:`, e);
    return null;
  });
}

export async function getEntitlementsForUser(userId: string): Promise<{ archiveAccess: boolean; adsRemoved: boolean }> {
  await ensureDbSchema();
  const pool = getDbPool();
  const res = await pool.query<{ key: string }>(
    "select key from entitlements where user_id=$1 and (expires_at is null or expires_at > now())",
    [userId]
  );
  const keys = new Set(res.rows.map((r) => r.key));
  return {
    archiveAccess: keys.has('archive_access'),
    adsRemoved: keys.has('ads_removed'),
  };
}

export async function resolveMeIdentity(request: Request): Promise<MeIdentity> {
  await ensureDbSchema();

  const guestCookie = (request as any).cookies?.get?.(GUEST_COOKIE)?.value as string | undefined;
  console.log(`[RESOLVE] Guest cookie: ${guestCookie ?? 'none'}`);
  const guest = await getOrCreateGuest(guestCookie ?? null);
  console.log(`[RESOLVE] Guest ID: ${guest.guestId}, setCookie: ${guest.setCookie}`);

  const userId = await getSessionUserId(request);
  if (!userId) {
    return {
      mode: 'guest',
      displayName: guest.displayName,
      entitlements: { archiveAccess: false, adsRemoved: false },
      userId: null,
      guestId: guest.guestId,
      setGuestCookie: guest.setCookie,
    };
  }

  console.log(`[RESOLVE] User ID: ${userId}, linking with guest ${guest.guestId}`);
  await linkGuestToUser(userId, guest.guestId);
  const displayName = await ensureUserDisplayName(userId, null);
  const entitlements = await getEntitlementsForUser(userId);

  return {
    mode: 'user',
    displayName,
    entitlements,
    userId,
    guestId: guest.guestId,
    setGuestCookie: guest.setCookie,
  };
}

export async function resolveSubjectIdentity(request: Request): Promise<{ subjectType: 'guest' | 'user'; subjectId: string; displayName: string; guestId: string; setGuestCookie: boolean }> {
  const me = await resolveMeIdentity(request);
  if (me.userId) {
    return { subjectType: 'user', subjectId: me.userId, displayName: me.displayName, guestId: me.guestId, setGuestCookie: me.setGuestCookie };
  }
  return { subjectType: 'guest', subjectId: me.guestId, displayName: me.displayName, guestId: me.guestId, setGuestCookie: me.setGuestCookie };
}

async function migrateTodayLeaderboardIfPresent(identity: { userId: string; guestId: string; userDisplayName: string }): Promise<void> {
  const redis = getLeaderboardRedis();
  if (!redis) return;

  const { getNewYorkDateString } = await import('@/game/puzzleGenerator');
  const date = getNewYorkDateString();
  const zkey = `lb:${date}`;
  const indexKey = `lb:member:${date}`;

  const guestKey = `guest:${identity.guestId}`;
  const userKey = `user:${identity.userId}`;

  const guestMember = await redis.hget<string>(indexKey, guestKey);
  if (!guestMember) return;

  const existingUser = await redis.hget<string>(indexKey, userKey);
  if (existingUser) return;

  const score = await redis.zscore(zkey, guestMember);
  if (score == null) return;

  const submittedAtPrefix = guestMember.split(':', 1)[0] ?? '';
  const nextMember = `${submittedAtPrefix}:${userKey}`;

  await redis.multi()
    .zadd(zkey, { score, member: nextMember })
    .zrem(zkey, guestMember)
    .hset(indexKey, { [userKey]: nextMember })
    .hdel(indexKey, guestKey)
    .hset(LB_NAMES_KEY, { [userKey]: identity.userDisplayName })
    .exec();

  await ensureDbSchema();
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const guestRow = await client.query<{
      time_ms: number;
      attempts_used: number;
      submitted_at: string;
    }>(
      `select time_ms, attempts_used, submitted_at
       from leaderboard_submissions
       where date=$1 and subject_type='guest' and subject_id=$2`,
      [date, identity.guestId]
    );

    const hasUser = await client.query(
      `select 1 from leaderboard_submissions
       where date=$1 and subject_type='user' and subject_id=$2`,
      [date, identity.userId]
    );

    if ((guestRow.rowCount ?? 0) > 0 && (hasUser.rowCount ?? 0) === 0) {
      const g = guestRow.rows[0];
      await client.query(
        `insert into leaderboard_submissions (date, subject_type, subject_id, time_ms, attempts_used, submitted_at)
         values ($1, 'user', $2, $3, $4, $5)
         on conflict do nothing`,
        [date, identity.userId, g.time_ms, g.attempts_used, g.submitted_at]
      );
      await client.query(
        `delete from leaderboard_submissions
         where date=$1 and subject_type='guest' and subject_id=$2`,
        [date, identity.guestId]
      );
    }

    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
}

async function autoSubmitTodayIfEnabled(identity: { userId: string; userDisplayName: string }): Promise<void> {
  const redis = getLeaderboardRedis();
  if (!redis) return;

  // Check if user has auto-submit enabled (default true for new accounts)
  const settings = await ensureUserSettings(identity.userId);
  if (!settings.leaderboardAutoSubmit) return;

  const { getNewYorkDateString } = await import('@/game/puzzleGenerator');
  const date = getNewYorkDateString();
  const zkey = leaderboardZsetKey(date);
  const indexKey = leaderboardMemberIndexKey(date);
  const userKey = `user:${identity.userId}`;

  // Check if already submitted
  const existingMember = await redis.hget<string>(indexKey, userKey);
  if (existingMember) return;

  // Check if user has a completed result for today
  const pool = getDbPool();
  const dailyRes = await pool.query<{ completed: boolean; time_ms: number | null; attempts_used: number | null }>(
    `select completed, time_ms, attempts_used
     from daily_results
     where user_id=$1 and date=$2::date`,
    [identity.userId, date]
  );

  if ((dailyRes.rowCount ?? 0) === 0) return;
  const daily = dailyRes.rows[0]!;
  if (!daily.completed || daily.time_ms == null || daily.attempts_used == null) return;

  const timeMs = daily.time_ms;
  const attemptsUsed = daily.attempts_used;

  const submittedAtMs = Date.now();
  const member = makeLeaderboardMember(submittedAtMs, userKey);
  const score = encodeLeaderboardScore(timeMs, attemptsUsed);

  // Submit to Redis
  await redis.multi()
    .zadd(zkey, { score, member })
    .hset(indexKey, { [userKey]: member })
    .hset(LB_NAMES_KEY, { [userKey]: identity.userDisplayName })
    .exec();

  // Durable audit row
  await pool.query(
    `insert into leaderboard_submissions (date, subject_type, subject_id, time_ms, attempts_used, submitted_at)
     values ($1, 'user', $2, $3, $4, to_timestamp($5 / 1000.0))
     on conflict do nothing`,
    [date, identity.userId, timeMs, attemptsUsed, submittedAtMs]
  );
}
