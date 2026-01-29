import { NextRequest, NextResponse } from 'next/server';
import { ensureDbSchema, getDbPool } from '@/lib/server/db';
import { getLeaderboardRedis } from '@/lib/server/redis';
import { decodeLeaderboardScore, leaderboardZsetKey, parseLeaderboardMember } from '@/lib/server/leaderboard';
import { addDays } from '@/lib/date';
import { getNewYorkDateString } from '@/game/puzzleGenerator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isValidNyDateString(value: string | null): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(request: NextRequest) {
  try {
    console.log(`[cron/podium-snapshot] start ${new Date().toISOString()}`);

    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[cron/podium-snapshot] unauthorized request - invalid or missing Authorization header');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const requestedDate = url.searchParams.get('date');

    const fallbackDate = addDays(getNewYorkDateString(), -1);
    const dateParam = requestedDate && requestedDate.trim().length > 0 ? requestedDate : fallbackDate;
    if (!isValidNyDateString(dateParam)) {
      console.warn(`[cron/podium-snapshot] invalid date param: ${dateParam}`);
      return NextResponse.json({ error: 'Missing or invalid date.' }, { status: 400 });
    }

    console.log(`[cron/podium-snapshot] date=${dateParam} requested=${requestedDate ?? ''} fallback=${fallbackDate}`);

    const redis = getLeaderboardRedis();
    if (!redis) {
      console.error('[cron/podium-snapshot] leaderboard redis not configured');
      return NextResponse.json({ error: 'Leaderboard Redis is not configured.' }, { status: 500 });
    }

    const zkey = leaderboardZsetKey(dateParam);
    const raw = await redis.zrange<(string | number)[]>(zkey, 0, 2, { withScores: true });
    console.log(`[cron/podium-snapshot] zrange ${zkey} returned ${raw.length} items`);

    const members: string[] = [];
    const scores: number[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      members.push(raw[i] as string);
      const scoreRaw = raw[i + 1] as string | number;
      scores.push(typeof scoreRaw === 'number' ? scoreRaw : Number(scoreRaw));
    }

    const podium = members
      .map((member, idx) => {
        const parsed = parseLeaderboardMember(member);
        const subjectKey = parsed.subjectKey;
        if (!subjectKey?.startsWith('user:')) return null;
        const userId = subjectKey.slice('user:'.length);
        if (!isUuid(userId)) return null;
        const decoded = decodeLeaderboardScore(scores[idx] ?? 0);
        return {
          rank: (idx + 1) as 1 | 2 | 3,
          userId,
          timeMs: decoded.timeMs,
          attemptsUsed: decoded.attemptsUsed,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null);

    if (podium.length === 0) {
      console.log(`[cron/podium-snapshot] no podium entries found for ${dateParam}`);
      return NextResponse.json({ ok: true, date: dateParam, snapped: 0 });
    }

    await ensureDbSchema();
    const pool = getDbPool();
    console.log(`[cron/podium-snapshot] snapping ${podium.length} entries`);

    const userIds = Array.from(new Set(podium.map((p) => p.userId)));

    // Ensure FK rows exist (dev safety; no-op for real users)
    await pool.query(
      `insert into users (id)
       select unnest($1::uuid[])
       on conflict do nothing`,
      [userIds]
    );
    await pool.query(
      `insert into user_profiles (user_id)
       select unnest($1::uuid[])
       on conflict do nothing`,
      [userIds]
    );

    const metaRes = await pool.query<{
      user_id: string;
      display_name: string | null;
      character_id: string | null;
      skin_id: string | null;
    }>(
      `select
         u.id::text as user_id,
         u.display_name,
         p.character_id,
         p.skin_id
       from users u
       left join user_profiles p on p.user_id=u.id
       where u.id = any($1::uuid[])`,
      [userIds]
    );

    const metaById = new Map(
      metaRes.rows.map((r) => [
        r.user_id,
        {
          displayName: r.display_name ?? 'Player',
          characterId: r.character_id ?? 'default',
          skinId: r.skin_id ?? 'default',
        },
      ])
    );

    const payload = JSON.stringify(
      podium.map((entry) => {
        const meta = metaById.get(entry.userId) ?? { displayName: 'Player', characterId: 'default', skinId: 'default' };
        return {
          date: dateParam,
          rank: entry.rank,
          user_id: entry.userId,
          time_ms: entry.timeMs,
          attempts_used: entry.attemptsUsed,
          display_name_at_time: meta.displayName,
          character_id_at_time: meta.characterId,
          skin_id_at_time: meta.skinId,
        };
      })
    );

    const insertRes = await pool.query(
      `insert into leaderboard_podium
         (date, rank, user_id, time_ms, attempts_used, display_name_at_time, character_id_at_time, skin_id_at_time)
       select r.date, r.rank, r.user_id, r.time_ms, r.attempts_used, r.display_name_at_time, r.character_id_at_time, r.skin_id_at_time
       from jsonb_to_recordset($1::jsonb)
         as r(
           date date,
           rank integer,
           user_id uuid,
           time_ms integer,
           attempts_used integer,
           display_name_at_time text,
           character_id_at_time text,
           skin_id_at_time text
         )
       on conflict do nothing`,
      [payload]
    );

    const inserted = insertRes.rowCount ?? 0;
    console.log(`[cron/podium-snapshot] inserted ${inserted} rows for ${dateParam}`);
    return NextResponse.json({ ok: true, date: dateParam, snapped: inserted }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[cron/podium-snapshot] error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
