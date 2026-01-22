import { NextResponse } from 'next/server';
import { resolveMeIdentity } from '@/lib/server/identity';
import { setGuestIdCookie } from '@/lib/server/cookies';
import { jsonError } from '@/lib/server/responses';
import { getDailyResultForGuest, getDailyResultForUser, isTodayOrYesterdayNyDate } from '@/lib/server/account';
import { getNewYorkDateString } from '@/game/puzzleGenerator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isValidNyDateString(value: string | null): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dateParam = url.searchParams.get('date');
  const date = dateParam ?? getNewYorkDateString();

  if (!isValidNyDateString(date)) {
    return jsonError(400, 'INVALID_DATE', 'Invalid date.');
  }
  if (!isTodayOrYesterdayNyDate(date)) {
    return jsonError(400, 'DATE_NOT_ALLOWED', 'Only today or yesterday can be requested.');
  }

  try {
    const me = await resolveMeIdentity(request);
    const result = me.userId ? await getDailyResultForUser(me.userId, date) : await getDailyResultForGuest(me.guestId, date);
    const res = NextResponse.json({ ok: true, result }, { headers: { 'Cache-Control': 'no-store' } });
    if (me.setGuestCookie) {
      setGuestIdCookie(res, me.guestId);
    }
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load result';
    return jsonError(500, 'RESULTS_LOAD_FAILED', message);
  }
}
