import { NextResponse } from 'next/server';
import { resolveMeIdentity } from '@/lib/server/identity';
import { setGuestIdCookie } from '@/lib/server/cookies';
import { jsonError, readJsonBody } from '@/lib/server/responses';
import { isTodayOrYesterdayNyDate, recordDailyResult, recordGuestDailyResult } from '@/lib/server/account';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = {
  date: string;
  completed: boolean;
  timeMs?: number;
  attemptsUsed?: number;
};

function isValidNyDateString(value: string | null): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function POST(request: Request) {
  const me = await resolveMeIdentity(request);

  let body: Body;
  try {
    body = await readJsonBody<Body>(request);
  } catch {
    return jsonError(400, 'INVALID_REQUEST', 'Invalid JSON body.');
  }

  if (!isValidNyDateString(body.date)) {
    return jsonError(400, 'INVALID_DATE', 'Invalid date.');
  }
  if (typeof body.completed !== 'boolean') {
    return jsonError(400, 'INVALID_COMPLETED', 'completed must be a boolean.');
  }
  if (!isTodayOrYesterdayNyDate(body.date)) {
    return jsonError(400, 'DATE_NOT_ALLOWED', 'Only today or yesterday can be recorded.');
  }

  const completed = body.completed;
  const timeMs =
    completed && typeof body.timeMs === 'number' && Number.isFinite(body.timeMs) && body.timeMs > 0
      ? Math.round(body.timeMs)
      : null;
  const attemptsUsed =
    completed && typeof body.attemptsUsed === 'number' && Number.isFinite(body.attemptsUsed) && body.attemptsUsed >= 1 && body.attemptsUsed <= 3
      ? Math.round(body.attemptsUsed)
      : null;

  if (completed && timeMs == null) {
    return jsonError(400, 'INVALID_TIME', 'timeMs is required for completed results.');
  }
  if (completed && attemptsUsed == null) {
    return jsonError(400, 'INVALID_ATTEMPTS', 'attemptsUsed must be 1..3 for completed results.');
  }

  try {
    const recorded = me.userId
      ? await recordDailyResult(me.userId, { date: body.date, completed, timeMs, attemptsUsed })
      : await recordGuestDailyResult(me.guestId, { date: body.date, completed, timeMs, attemptsUsed });
    const res = NextResponse.json(
      {
        ok: true,
        created: recorded.created,
        result: recorded.result,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
    if (me.setGuestCookie) {
      setGuestIdCookie(res, me.guestId);
    }
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to record result';
    if (message === 'DATE_NOT_ALLOWED') {
      return jsonError(400, 'DATE_NOT_ALLOWED', 'Only today or yesterday can be recorded.');
    }
    return jsonError(500, 'RECORD_FAILED', message);
  }
}
