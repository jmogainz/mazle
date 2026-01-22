import { NextResponse } from 'next/server';
import { ensureDbSchema, getDbPool } from '@/lib/server/db';
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
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');

  if (!isValidNyDateString(dateParam)) {
    return jsonError(400, 'INVALID_DATE', 'Missing or invalid date.');
  }

  const today = getNewYorkDateString();
  if (dateParam !== today) {
    return jsonError(400, 'DATE_NOT_TODAY', 'Only today’s leaderboard is available.');
  }

  const limit = Math.max(1, Math.min(200, Number(limitParam ?? '50') || 50));
  const offsetRaw = Number(offsetParam ?? '0');
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

  const redis = getLeaderboardRedis();
  if (!redis) {
    return jsonError(500, 'LEADERBOARD_NOT_CONFIGURED', 'Leaderboard Redis is not configured.');
  }

  try {
    await ensureDevLeaderboardSeed(redis, dateParam);
    const me = await resolveSubjectIdentity(request);
    const mySubjectKey = subjectKeyFor({ userId: me.subjectType === 'user' ? me.subjectId : null, guestId: me.guestId });

    const zkey = leaderboardZsetKey(dateParam);
    const start = offset;
    const end = Math.min(offset + limit - 1, LEADERBOARD_MAX_ROWS - 1);
    const shouldFetch = start < LEADERBOARD_MAX_ROWS && end >= start;
    const [raw, total] = await Promise.all([
      shouldFetch ? redis.zrange<(string | number)[]>(zkey, start, end, { withScores: true }) : Promise.resolve([]),
      redis.zcard(zkey),
    ]);
    const cappedTotal = Math.min(total, LEADERBOARD_MAX_ROWS);

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
        rank: offset + idx + 1,
        displayName,
        timeMs,
        attemptsUsed,
        isMe: subjectKey === mySubjectKey,
      };
    });

    const top3SubjectKeys =
      offset === 0
        ? parsed.slice(0, 3).map((p) => p.subjectKey).filter((k): k is string => !!k)
        : [];

    const profilesBySubjectKey = new Map<string, { characterId: string; skinId: string }>();
    if (top3SubjectKeys.length > 0) {
      const userIds = top3SubjectKeys
        .filter((k) => k.startsWith('user:'))
        .map((k) => k.slice('user:'.length))
        .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));

      if (userIds.length > 0) {
        try {
          await ensureDbSchema();
          const pool = getDbPool();
          const res = await pool.query<{ user_id: string; character_id: string; skin_id: string }>(
            `select user_id::text as user_id, character_id, skin_id
             from user_profiles
             where user_id = any($1::uuid[])`,
            [userIds]
          );
          const byUserId = new Map(res.rows.map((r) => [r.user_id, { characterId: r.character_id, skinId: r.skin_id }]));
          for (const subjectKey of top3SubjectKeys) {
            if (!subjectKey.startsWith('user:')) continue;
            const userId = subjectKey.slice('user:'.length);
            profilesBySubjectKey.set(subjectKey, byUserId.get(userId) ?? { characterId: 'default', skinId: 'default' });
          }
        } catch {
          for (const subjectKey of top3SubjectKeys) {
            profilesBySubjectKey.set(subjectKey, { characterId: 'default', skinId: 'default' });
          }
        }
      }
    }

    const podium =
      offset === 0 && entries.length > 0
        ? entries.slice(0, 3).map((entry) => {
            const subjectKey = parsed[entry.rank - 1]?.subjectKey;
            const profile = subjectKey ? profilesBySubjectKey.get(subjectKey) : null;
            return {
              rank: entry.rank as 1 | 2 | 3,
              displayName: entry.displayName,
              timeMs: entry.timeMs,
              attemptsUsed: entry.attemptsUsed,
              characterId: profile?.characterId ?? 'default',
              skinId: profile?.skinId ?? 'default',
              isMe: entry.isMe,
            };
          })
        : undefined;

    const nextOffset = offset + entries.length < cappedTotal ? offset + entries.length : null;

    const res = NextResponse.json(
      { date: dateParam, entries, podium, total: cappedTotal, nextOffset },
      { headers: { 'Cache-Control': 'no-store' } }
    );
    if (me.setGuestCookie) {
      setGuestIdCookie(res, me.guestId);
    }
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load leaderboard';
    return jsonError(500, 'LEADERBOARD_FAILED', message);
  }
}
