import { NextResponse } from 'next/server';
import { getEntitlementsForUser, resolveMeIdentity } from '@/lib/server/identity';
import { jsonError } from '@/lib/server/responses';
import { setGuestIdCookie } from '@/lib/server/cookies';
import { computeUserStats, ensureUserProfile, ensureUserSettings, maybeGrantRoyalSkin } from '@/lib/server/account';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const me = await resolveMeIdentity(request);

    const profile = me.userId ? await ensureUserProfile(me.userId) : undefined;
    const settings = me.userId ? await ensureUserSettings(me.userId) : undefined;
    const stats = me.userId ? await computeUserStats(me.userId, me.provider) : undefined;
    let entitlements = me.entitlements;
    if (me.userId && stats) {
      await maybeGrantRoyalSkin(me.userId, stats.playedStreak);
      entitlements = await getEntitlementsForUser(me.userId);
    }

    const res = NextResponse.json(
      {
        mode: me.mode,
        userId: me.userId,
        displayName: me.displayName,
        entitlements,
        profile,
        settings,
        stats,
        provider: me.provider,
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
