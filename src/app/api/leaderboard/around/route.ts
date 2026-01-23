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
import { ensureDevLeaderboardSeed } from '@/lib/server/leaderboardSeed';
import { getNewYorkDateString } from '@/game/puzzleGenerator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LEADERBOARD_MAX_ROWS = 1000;

function isValidNyDateString(value: string | null): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dateParam = url.searchParams.get('date');
  const rankParam = url.searchParams.get('rank');
  const windowParam = url.searchParams.get('window');

  if (!isValidNyDateString(dateParam)) {
    return jsonError(400, 'INVALID_DATE', 'Missing or invalid date.');
  }

  const today = getNewYorkDateString();
  if (dateParam !== today) {
    return jsonError(400, 'DATE_NOT_TODAY', 'Only today’s leaderboard is available.');
  }

  const rank = Math.max(1, Number(rankParam ?? '1') || 1);
  const windowSize = Math.max(1, Math.min(50, Number(windowParam ?? '5') || 5));

  const redis = getLeaderboardRedis();
  if (!redis) {
    return jsonError(500, 'LEADERBOARD_NOT_CONFIGURED', 'Leaderboard Redis is not configured.');
  }

  try {
    await ensureDevLeaderboardSeed(redis, dateParam);
    const me = await resolveSubjectIdentity(request);
    const mySubjectKey = subjectKeyFor({ userId: me.subjectType === 'user' ? me.subjectId : null, guestId: me.guestId });

    if (rank > LEADERBOARD_MAX_ROWS) {
      const res = NextResponse.json({ date: dateParam, entries: [] }, { headers: { 'Cache-Control': 'no-store' } });
      if (me.setGuestCookie) {
        setGuestIdCookie(res, me.guestId);
      }
      return res;
    }

    const start = Math.max(0, rank - 1 - windowSize);
    const stop = Math.min(rank - 1 + windowSize, LEADERBOARD_MAX_ROWS - 1);

    const zkey = leaderboardZsetKey(dateParam);
    const raw = await redis.zrange<(string | number)[]>(zkey, start, stop, { withScores: true });

    const members: string[] = [];
    const scores: number[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      members.push(raw[i] as string);
      const scoreRaw = raw[i + 1] as string | number;
      scores.push(typeof scoreRaw === 'number' ? scoreRaw : Number(scoreRaw));
    }

    const parsed = members.map((m) => parseLeaderboardMember(m));
    const subjectKeys = parsed.map((p) => p.subjectKey ?? '');
    const nameMap =
      subjectKeys.length > 0
        ? (await redis.hmget<Record<string, string | null>>(LB_NAMES_KEY, ...subjectKeys)) ?? {}
        : {};

    const entries = members.map((member, idx) => {
      const subjectKey = parsed[idx]?.subjectKey;
      const { timeMs, attemptsUsed } = decodeLeaderboardScore(scores[idx] ?? 0);
      const displayName = (subjectKey && nameMap[subjectKey]) || 'Player';
      return {
        rank: start + idx + 1,
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
