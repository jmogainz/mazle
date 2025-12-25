import { NextResponse } from 'next/server';
import { ensureDbSchema, getDbPool } from '@/lib/server/db';
import { resolveSubjectIdentity, subjectKeyFor } from '@/lib/server/identity';
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
  timeMs: number;
  attemptsUsed: number;
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
  if (!Number.isFinite(body.timeMs) || body.timeMs <= 0) {
    return jsonError(400, 'INVALID_TIME', 'Invalid timeMs.');
  }
  if (!Number.isFinite(body.attemptsUsed) || body.attemptsUsed < 1 || body.attemptsUsed > 3) {
    return jsonError(400, 'INVALID_ATTEMPTS', 'attemptsUsed must be 1..3.');
  }

  const today = getNewYorkDateString();
  if (body.date !== today) {
    return jsonError(400, 'DATE_NOT_TODAY', 'Only today’s puzzle can be submitted.');
  }

  try {
    const me = await resolveSubjectIdentity(request);
    const mySubjectKey = subjectKeyFor({ userId: me.subjectType === 'user' ? me.subjectId : null, guestId: me.guestId });

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

    const submittedAtMs = Date.now();
    const member = makeLeaderboardMember(submittedAtMs, mySubjectKey);
    const score = encodeLeaderboardScore(body.timeMs, body.attemptsUsed);

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
      [body.date, me.subjectType, me.subjectId, body.timeMs, body.attemptsUsed, submittedAtMs]
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

