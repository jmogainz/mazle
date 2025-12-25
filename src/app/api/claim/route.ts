import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/server/identity';
import { ensureDbSchema, getDbPool } from '@/lib/server/db';
import { jsonError, readJsonBody } from '@/lib/server/responses';
import { getLeaderboardRedis } from '@/lib/server/redis';
import { LB_NAMES_KEY } from '@/lib/server/leaderboard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = {
  displayName?: string;
};

function normalizeDisplayName(raw: string): string {
  return raw.trim().slice(0, 24);
}

function isValidDisplayName(name: string): boolean {
  // Keep it simple for v1: alnum only, 3-24 chars.
  return /^[A-Za-z0-9]{3,24}$/.test(name);
}

export async function POST(request: Request) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return jsonError(401, 'AUTH_REQUIRED', 'Sign in to claim your name.');
  }

  try {
    await ensureDbSchema();
    const pool = getDbPool();

    const body = await readJsonBody<Body>(request).catch(() => ({} as Body));
    const requested = body.displayName ? normalizeDisplayName(body.displayName) : null;

    if (requested && !isValidDisplayName(requested)) {
      return jsonError(400, 'INVALID_NAME', 'Display name must be 3–24 letters/numbers.');
    }

    if (requested) {
      const taken = await pool.query(
        `select 1
         from (
           select display_name from guest_profiles where lower(display_name)=lower($1)
           union all
           select display_name from users where display_name is not null and lower(display_name)=lower($1) and id <> $2
         ) t
         limit 1`,
        [requested, userId]
      );

      if (taken.rowCount) {
        return jsonError(409, 'NAME_TAKEN', 'That name is already taken.');
      }

      await pool.query('update users set display_name=$2, updated_at=now() where id=$1', [userId, requested]);

      const redis = getLeaderboardRedis();
      if (redis) {
        await redis.hset(LB_NAMES_KEY, { [`user:${userId}`]: requested });
      }
    }

    const res = await pool.query<{ display_name: string | null }>('select display_name from users where id=$1', [userId]);
    const displayName = res.rows[0]?.display_name ?? 'Player';

    return NextResponse.json({ displayName }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to claim name';
    return jsonError(500, 'CLAIM_FAILED', message);
  }
}
