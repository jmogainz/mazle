import { NextResponse } from 'next/server';
import { resolveMeIdentity } from '@/lib/server/identity';
import { setGuestIdCookie } from '@/lib/server/cookies';
import { jsonError, readJsonBody } from '@/lib/server/responses';
import { coerceThemePreference, updateUserSettings } from '@/lib/server/account';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = {
  theme?: unknown;
  leaderboardAutoSubmit?: unknown;
};

export async function PATCH(request: Request) {
  const me = await resolveMeIdentity(request);
  if (!me.userId) {
    return jsonError(401, 'AUTH_REQUIRED', 'Sign in to update settings.');
  }

  let body: Body;
  try {
    body = await readJsonBody<Body>(request);
  } catch {
    return jsonError(400, 'INVALID_REQUEST', 'Invalid JSON body.');
  }

  const theme = body.theme != null ? coerceThemePreference(body.theme) : null;
  if (body.theme != null && theme == null) {
    return jsonError(400, 'INVALID_THEME', 'theme must be one of: system, light, dark.');
  }

  const leaderboardAutoSubmit =
    body.leaderboardAutoSubmit != null ? (typeof body.leaderboardAutoSubmit === 'boolean' ? body.leaderboardAutoSubmit : null) : null;
  if (body.leaderboardAutoSubmit != null && leaderboardAutoSubmit == null) {
    return jsonError(400, 'INVALID_AUTOSUBMIT', 'leaderboardAutoSubmit must be a boolean.');
  }

  try {
    const settings = await updateUserSettings(me.userId, {
      theme: theme ?? undefined,
      leaderboardAutoSubmit: leaderboardAutoSubmit ?? undefined,
    });

    const res = NextResponse.json({ ok: true, settings }, { headers: { 'Cache-Control': 'no-store' } });
    if (me.setGuestCookie) {
      setGuestIdCookie(res, me.guestId);
    }
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update settings';
    return jsonError(500, 'SETTINGS_FAILED', message);
  }
}
