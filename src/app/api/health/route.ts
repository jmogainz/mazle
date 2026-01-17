import { NextResponse } from 'next/server';
import { ensureDbSchema } from '@/lib/server/db';
import { ensureDevSystemSeeded } from '@/lib/server/devSeed';
import { getKvRedis, getLeaderboardRedis } from '@/lib/server/redis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function checkRedis(label: string, redis: ReturnType<typeof getKvRedis>) {
  if (!redis) {
    throw new Error(`${label} not configured`);
  }
  await redis.get('__health');
}

async function checkGeneratorHealth(url: string) {
  const healthUrl = `${url.replace(/\/$/, '')}/health`;
  const response = await fetch(healthUrl, { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) {
    throw new Error(`Generator health returned ${response.status}`);
  }
}

export async function GET() {
  const checks: Record<string, { ok: boolean; error?: string }> = {};
  let ok = true;

  const publicEnv = process.env.NEXT_PUBLIC_ENV;
  if (publicEnv && publicEnv !== 'prod') {
    try {
      const seeded = await ensureDevSystemSeeded();
      checks.devSeed = { ok: seeded };
    } catch (err) {
      checks.devSeed = { ok: false, error: err instanceof Error ? err.message : 'Dev seed failed' };
    }
  }

  try {
    await ensureDbSchema();
    checks.db = { ok: true };
  } catch (err) {
    ok = false;
    checks.db = { ok: false, error: err instanceof Error ? err.message : 'DB check failed' };
  }

  try {
    await checkRedis('kv', getKvRedis());
    checks.kv = { ok: true };
  } catch (err) {
    ok = false;
    checks.kv = { ok: false, error: err instanceof Error ? err.message : 'KV check failed' };
  }

  try {
    await checkRedis('leaderboard', getLeaderboardRedis());
    checks.leaderboard = { ok: true };
  } catch (err) {
    ok = false;
    checks.leaderboard = { ok: false, error: err instanceof Error ? err.message : 'Leaderboard check failed' };
  }

  // Only check generator reachability when a generator URL is explicitly configured.
  // (Avoids recursion if NEXT_PUBLIC_DEV_GENERATOR_URL points back at this app.)
  const generatorUrl = process.env.GENERATOR_URL || process.env.NEXT_PUBLIC_GENERATOR_URL;
  if (generatorUrl) {
    try {
      await checkGeneratorHealth(generatorUrl);
      checks.generator = { ok: true };
    } catch (err) {
      ok = false;
      checks.generator = {
        ok: false,
        error: err instanceof Error ? err.message : 'Generator check failed',
      };
    }
  }

  return NextResponse.json(
    { ok, checks },
    {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
