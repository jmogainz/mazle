import { NextResponse } from 'next/server';
import { getKvRedis } from '@/lib/server/redis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function checkRedis(label: string, redis: ReturnType<typeof getKvRedis>) {
  if (!redis) {
    throw new Error(`${label} not configured`);
  }
  await redis.get('__health');
}

export async function GET() {
  const checks: Record<string, { ok: boolean; error?: string }> = {};
  let ok = true;

  try {
    await checkRedis('kv', getKvRedis());
    checks.kv = { ok: true };
  } catch (err) {
    ok = false;
    checks.kv = { ok: false, error: err instanceof Error ? err.message : 'KV check failed' };
  }

  return NextResponse.json(
    { ok, checks },
    {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
