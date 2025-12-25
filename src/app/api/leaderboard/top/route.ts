import { NextResponse } from 'next/server';
import { resolveSubjectIdentity, subjectKeyFor } from '@/lib/server/identity';
import { getLeaderboardRedis } from '@/lib/server/redis';
import { jsonError } from '@/lib/server/responses';
import { setGuestIdCookie } from '@/lib/server/cookies';
import {
  decodeLeaderboardScore,
  leaderboardZsetKey,
  LB_NAMES_KEY,
  parseLeaderboardMember,
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
  const limitParam = url.searchParams.get('limit');

  if (!isValidNyDateString(dateParam)) {
    return jsonError(400, 'INVALID_DATE', 'Missing or invalid date.');
  }

  const limit = Math.max(1, Math.min(200, Number(limitParam ?? '50') || 50));

  const redis = getLeaderboardRedis();
  if (!redis) {
    return jsonError(500, 'LEADERBOARD_NOT_CONFIGURED', 'Leaderboard Redis is not configured.');
  }

  try {
    const me = await resolveSubjectIdentity(request);
    const mySubjectKey = subjectKeyFor({ userId: me.subjectType === 'user' ? me.subjectId : null, guestId: me.guestId });

    const zkey = leaderboardZsetKey(dateParam);
    const raw = await redis.zrange<(string | number)[]>(zkey, 0, limit - 1, { withScores: true });

    const members: string[] = [];
    const scores: number[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      const member = raw[i] as string;
      const score = raw[i + 1] as number;
      members.push(member);
      scores.push(typeof score === 'number' ? score : Number(score));
    }

    const parsed = members.map((m) => parseLeaderboardMember(m));
    const subjectKeys = parsed.map((p) => p.subjectKey ?? '');

    const nameMap =
      subjectKeys.length > 0
        ? (await redis.hmget<Record<string, string | null>>(LB_NAMES_KEY, ...subjectKeys)) ?? {}
        : {};

    const entries = members.map((member, idx) => {
      const { subjectKey } = parsed[idx];
      const { timeMs, attemptsUsed } = decodeLeaderboardScore(scores[idx] ?? 0);
      const displayName = (subjectKey && nameMap[subjectKey]) || 'Player';
      return {
        rank: idx + 1,
        displayName,
        timeMs,
        attemptsUsed,
        isMe: subjectKey === mySubjectKey,
      };
    });

    const res = NextResponse.json({ date: dateParam, entries }, { headers: { 'Cache-Control': 'no-store' } });
    if (me.setGuestCookie) {
      setGuestIdCookie(res, me.guestId);
    }
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load leaderboard';
    return jsonError(500, 'LEADERBOARD_FAILED', message);
  }
}
