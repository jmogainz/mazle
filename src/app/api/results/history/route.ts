import { NextResponse } from 'next/server';
import { resolveMeIdentity } from '@/lib/server/identity';
import { setGuestIdCookie } from '@/lib/server/cookies';
import { jsonError } from '@/lib/server/responses';
import { getAllDailyResultsForUser } from '@/lib/server/account';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const me = await resolveMeIdentity(request);
  if (!me.userId) {
    return jsonError(401, 'AUTH_REQUIRED', 'Sign in to view history.');
  }

  try {
    const history = await getAllDailyResultsForUser(me.userId);
    const res = NextResponse.json({ ok: true, history }, { headers: { 'Cache-Control': 'no-store' } });
    if (me.setGuestCookie) {
      setGuestIdCookie(res, me.guestId);
    }
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load history';
    return jsonError(500, 'HISTORY_LOAD_FAILED', message);
  }
}
