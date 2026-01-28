import { NextResponse } from 'next/server';
import { addDays } from '@/lib/date';
import { LAUNCH_DATE_NY, getNewYorkDateString } from '@/game/puzzleGenerator';
import { resolveMeIdentity } from '@/lib/server/identity';
import { jsonError } from '@/lib/server/responses';
import { setGuestIdCookie } from '@/lib/server/cookies';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isValidNyDateString(value: string | null): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  if (!isValidNyDateString(from) || !isValidNyDateString(to)) {
    return jsonError(400, 'INVALID_RANGE', 'from/to must be YYYY-MM-DD.');
  }

  try {
    const me = await resolveMeIdentity(request);
    const entitled = me.entitlements.archiveAccess;
    const today = getNewYorkDateString();

    const start = from < LAUNCH_DATE_NY ? LAUNCH_DATE_NY : from;
    const end = to;
    const days: Array<{ date: string; locked: boolean }> = [];

    let cursor = start <= end ? start : end;
    const max = start <= end ? end : start;

    while (cursor <= max) {
      const locked =
        cursor > today ? true
        : cursor === today ? false
        : !entitled;
      days.push({ date: cursor, locked });
      cursor = addDays(cursor, 1);
      if (days.length > 5000) break;
    }

    const res = NextResponse.json({ entitled, days }, { headers: { 'Cache-Control': 'no-store' } });
    if (me.setGuestCookie) {
      setGuestIdCookie(res, me.guestId);
    }
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load archive';
    return jsonError(500, 'ARCHIVE_FAILED', message);
  }
}
