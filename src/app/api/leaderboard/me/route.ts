import { NextResponse } from 'next/server';
import { resolveSubjectIdentity, subjectKeyFor } from '@/lib/server/identity';
import { getLeaderboardRedis } from '@/lib/server/redis';
import { jsonError } from '@/lib/server/responses';
import { setGuestIdCookie } from '@/lib/server/cookies';
import {
  decodeLeaderboardScore,
  leaderboardMemberIndexKey,
  leaderboardZsetKey,
  LB_NAMES_KEY,
} from '@/lib/server/leaderboard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isValidNyDateString(value: string | null): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dateParam = url.searchParams.get('date');

  if (!isValidNyDateString(dateParam)) {
    return jsonError(400, 'INVALID_DATE', 'Missing or invalid date.');
  }

  const redis = getLeaderboardRedis();
  if (!redis) {
    return jsonError(500, 'LEADERBOARD_NOT_CONFIGURED', 'Leaderboard Redis is not configured.');
  }

  try {
    const me = await resolveSubjectIdentity(request);
    const mySubjectKey = subjectKeyFor({ userId: me.subjectType === 'user' ? me.subjectId : null, guestId: me.guestId });
    const indexKey = leaderboardMemberIndexKey(dateParam);
    const zkey = leaderboardZsetKey(dateParam);

    const member = await redis.hget<string>(indexKey, mySubjectKey);
    if (!member) {
      const res = NextResponse.json(null, { headers: { 'Cache-Control': 'no-store' } });
      if (me.setGuestCookie) {
        setGuestIdCookie(res, me.guestId);
      }
      return res;
    }

    const score = await redis.zscore<number>(zkey, member);
    const rank0 = await redis.zrank(zkey, member);
    if (score == null || rank0 == null) {
      const res = NextResponse.json(null, { headers: { 'Cache-Control': 'no-store' } });
      if (me.setGuestCookie) {
        setGuestIdCookie(res, me.guestId);
      }
      return res;
    }

    const nameObj = await redis.hget<string>(LB_NAMES_KEY, mySubjectKey);
    const displayName = nameObj ?? me.displayName;
    const decoded = decodeLeaderboardScore(typeof score === 'number' ? score : Number(score));

    const res = NextResponse.json(
      {
        date: dateParam,
        rank: rank0 + 1,
        displayName,
        timeMs: decoded.timeMs,
        attemptsUsed: decoded.attemptsUsed,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
    if (me.setGuestCookie) {
      setGuestIdCookie(res, me.guestId);
    }
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load your rank';
    return jsonError(500, 'LEADERBOARD_FAILED', message);
  }
}

