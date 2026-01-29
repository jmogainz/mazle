import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSessionUserId, GUEST_COOKIE } from '@/lib/server/identity';
import { setGuestIdCookie } from '@/lib/server/cookies';
import { jsonError, readJsonBody } from '@/lib/server/responses';
import { isTodayOrYesterdayNyDate } from '@/lib/server/account';
import { recordAnalyticsView } from '@/lib/server/analytics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = {
  date: string;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await readJsonBody<Body>(request);
  } catch {
    return jsonError(400, 'INVALID_REQUEST', 'Invalid JSON body.');
  }

  if (!isTodayOrYesterdayNyDate(body.date)) {
    return jsonError(400, 'DATE_NOT_ALLOWED', 'Only today or yesterday can be recorded.');
  }

  const cookieValue = (request as any).cookies?.get?.(GUEST_COOKIE)?.value as string | undefined;
  const playerId = cookieValue && isUuid(cookieValue) ? cookieValue : crypto.randomUUID();
  const setCookie = !cookieValue || cookieValue !== playerId;

  const userId = await getSessionUserId(request);

  let stored = false;
  try {
    stored = await recordAnalyticsView({ date: body.date, playerId, userId });
  } catch {
    stored = false;
  }

  const res = NextResponse.json({ ok: true, stored }, { headers: { 'Cache-Control': 'no-store' } });
  if (setCookie) {
    setGuestIdCookie(res, playerId);
  }
  return res;
}
