import { NextResponse } from 'next/server';
import { resolveMeIdentity } from '@/lib/server/identity';
import { setGuestIdCookie } from '@/lib/server/cookies';
import { jsonError, readJsonBody } from '@/lib/server/responses';
import { importDailyResults } from '@/lib/server/account';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = {
  history: Array<{
    date: string;
    completed: boolean;
    timeMs?: number;
    attemptsUsed?: number;
  }>;
};

export async function POST(request: Request) {
  const me = await resolveMeIdentity(request);
  if (!me.userId) {
    return jsonError(401, 'AUTH_REQUIRED', 'Sign in to import results.');
  }

  let body: Body;
  try {
    body = await readJsonBody<Body>(request);
  } catch {
    return jsonError(400, 'INVALID_REQUEST', 'Invalid JSON body.');
  }

  if (!body || !Array.isArray(body.history)) {
    return jsonError(400, 'INVALID_HISTORY', 'history must be an array.');
  }

  if (body.history.length > 5000) {
    return jsonError(400, 'HISTORY_TOO_LARGE', 'Too many history rows.');
  }

  const normalized = body.history.map((row) => ({
    date: row?.date,
    completed: !!row?.completed,
    timeMs: typeof row?.timeMs === 'number' && Number.isFinite(row.timeMs) ? Math.round(row.timeMs) : null,
    attemptsUsed:
      typeof row?.attemptsUsed === 'number' && Number.isFinite(row.attemptsUsed) ? Math.round(row.attemptsUsed) : null,
  }));

  try {
    const result = await importDailyResults(me.userId, normalized);
    const res = NextResponse.json(
      { ok: true, imported: result.imported, skipped: result.skipped },
      { headers: { 'Cache-Control': 'no-store' } }
    );
    if (me.setGuestCookie) {
      setGuestIdCookie(res, me.guestId);
    }
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to import results';
    return jsonError(500, 'IMPORT_FAILED', message);
  }
}
