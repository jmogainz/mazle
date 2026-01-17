import { NextResponse } from 'next/server';
import { ensureDbSchema, getDbPool } from '@/lib/server/db';
import { ensureDevSystemSeeded } from '@/lib/server/devSeed';
import { getSessionUserId } from '@/lib/server/identity';
import { jsonError } from '@/lib/server/responses';

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

  try {
    const publicEnv = process.env.NEXT_PUBLIC_ENV;
    if (publicEnv && publicEnv !== 'prod') {
      await ensureDevSystemSeeded();
    }

    await ensureDbSchema();
    const pool = getDbPool();
    const userId = await getSessionUserId(request);

    const res = await pool.query<{
      rank: number;
      user_id: string;
      time_ms: number;
      attempts_used: number;
      display_name_at_time: string;
      character_id_at_time: string;
      skin_id_at_time: string;
    }>(
      `select rank, user_id::text, time_ms, attempts_used, display_name_at_time, character_id_at_time, skin_id_at_time
       from leaderboard_podium
       where date=$1::date
       order by rank asc`,
      [dateParam]
    );

    const podium = res.rows.map((row) => ({
      rank: row.rank as 1 | 2 | 3,
      displayName: row.display_name_at_time,
      timeMs: row.time_ms,
      attemptsUsed: row.attempts_used,
      characterId: row.character_id_at_time,
      skinId: row.skin_id_at_time,
      isMe: userId ? row.user_id === userId : undefined,
    }));

    return NextResponse.json({ date: dateParam, podium }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load Hall of Fame';
    return jsonError(500, 'HALL_OF_FAME_FAILED', message);
  }
}
