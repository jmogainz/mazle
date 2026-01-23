import { NextResponse } from 'next/server';
import { ensureDbSchema, getDbPool } from '@/lib/server/db';
import { resolveMeIdentity, subjectKeyFor } from '@/lib/server/identity';
import { getLeaderboardRedis } from '@/lib/server/redis';
import { jsonError, readJsonBody } from '@/lib/server/responses';
import { setGuestIdCookie } from '@/lib/server/cookies';
import {
  encodeLeaderboardScore,
  leaderboardMemberIndexKey,
  leaderboardZsetKey,
  LB_NAMES_KEY,
  makeLeaderboardMember,
} from '@/lib/server/leaderboard';
import { getNewYorkDateString } from '@/game/puzzleGenerator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = {
  date: string;
};

function isValidNyDateString(value: string | null): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function POST(request: Request) {
  const redis = getLeaderboardRedis();
  if (!redis) {
    return jsonError(500, 'LEADERBOARD_NOT_CONFIGURED', 'Leaderboard Redis is not configured.');
  }

  let body: Body;
  try {
    body = await readJsonBody<Body>(request);
  } catch {
    return jsonError(400, 'INVALID_REQUEST', 'Invalid JSON body.');
  }

  if (!isValidNyDateString(body.date)) {
    return jsonError(400, 'INVALID_DATE', 'Invalid date.');
  }

  const today = getNewYorkDateString();
  if (body.date !== today) {
    return jsonError(400, 'DATE_NOT_TODAY', 'Only today’s puzzle can be submitted.');
  }

  try {
    const me = await resolveMeIdentity(request);
    if (!me.userId) {
      return jsonError(401, 'AUTH_REQUIRED', 'Sign in to submit to the leaderboard.');
    }

    const mySubjectKey = subjectKeyFor({ userId: me.userId, guestId: me.guestId });

    const zkey = leaderboardZsetKey(body.date);
    const indexKey = leaderboardMemberIndexKey(body.date);

    const existingMember = await redis.hget<string>(indexKey, mySubjectKey);
    if (existingMember) {
      const rank0 = await redis.zrank(zkey, existingMember);
      const res = NextResponse.json(
        { ok: true, updated: false, rank: rank0 != null ? rank0 + 1 : undefined },
        { headers: { 'Cache-Control': 'no-store' } }
      );
      if (me.setGuestCookie) {
        setGuestIdCookie(res, me.guestId);
      }
      return res;
    }

    await ensureDbSchema();
    const pool = getDbPool();

    const dailyRes = await pool.query<{ completed: boolean; time_ms: number | null; attempts_used: number | null }>(
      `select completed, time_ms, attempts_used
       from daily_results
       where user_id=$1 and date=$2::date`,
      [me.userId, body.date]
    );

    if ((dailyRes.rowCount ?? 0) === 0) {
      return jsonError(400, 'NO_RECORDED_RESULT', 'No recorded result found for today.');
    }

    const daily = dailyRes.rows[0]!;
    if (!daily.completed || daily.time_ms == null || daily.attempts_used == null) {
      return jsonError(400, 'NOT_COMPLETED', 'Only completed wins can be submitted.');
    }

    const timeMs = daily.time_ms;
    const attemptsUsed = daily.attempts_used;

    const submittedAtMs = Date.now();
    const member = makeLeaderboardMember(submittedAtMs, mySubjectKey);
    const score = encodeLeaderboardScore(timeMs, attemptsUsed);

    // Write-through to Redis (hot path)
    await redis.multi()
      .zadd(zkey, { score, member })
      .hset(indexKey, { [mySubjectKey]: member })
      .hset(LB_NAMES_KEY, { [mySubjectKey]: me.displayName })
      .exec();

    // Durable audit row (future verification)
    await pool.query(
      `insert into leaderboard_submissions (date, subject_type, subject_id, time_ms, attempts_used, submitted_at)
       values ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))
       on conflict do nothing`,
      [body.date, 'user', me.userId, timeMs, attemptsUsed, submittedAtMs]
    );

    const rank0 = await redis.zrank(zkey, member);
    const res = NextResponse.json(
      { ok: true, updated: true, rank: rank0 != null ? rank0 + 1 : undefined },
      { headers: { 'Cache-Control': 'no-store' } }
    );
    if (me.setGuestCookie) {
      setGuestIdCookie(res, me.guestId);
    }
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to submit score';
    return jsonError(500, 'SUBMIT_FAILED', message);
  }
}
