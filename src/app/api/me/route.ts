import { NextResponse } from 'next/server';
import { resolveMeIdentity } from '@/lib/server/identity';
import { jsonError } from '@/lib/server/responses';
import { setGuestIdCookie } from '@/lib/server/cookies';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const me = await resolveMeIdentity(request);
    const res = NextResponse.json(
      {
        mode: me.mode,
        displayName: me.displayName,
        entitlements: me.entitlements,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
    if (me.setGuestCookie) {
      setGuestIdCookie(res, me.guestId);
    }
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load profile';
    return jsonError(500, 'ME_FAILED', message);
  }
}

