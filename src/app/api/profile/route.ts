import { NextResponse } from 'next/server';
import { resolveMeIdentity } from '@/lib/server/identity';
import { setGuestIdCookie } from '@/lib/server/cookies';
import { jsonError, readJsonBody } from '@/lib/server/responses';
import { updateUserProfile } from '@/lib/server/account';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = {
    characterId?: unknown;
    skinId?: unknown;
};

export async function PATCH(request: Request) {
    const me = await resolveMeIdentity(request);
    if (!me.userId) {
        return jsonError(401, 'AUTH_REQUIRED', 'Sign in to update profile.');
    }

    let body: Body;
    try {
        body = await readJsonBody<Body>(request);
    } catch {
        return jsonError(400, 'INVALID_REQUEST', 'Invalid JSON body.');
    }

    const characterId = typeof body.characterId === 'string' ? body.characterId : undefined;
    const skinId = typeof body.skinId === 'string' ? body.skinId : undefined;

    try {
        const profile = await updateUserProfile(me.userId, {
            characterId,
            skinId,
        });

        const res = NextResponse.json({ ok: true, profile }, { headers: { 'Cache-Control': 'no-store' } });
        if (me.setGuestCookie) {
            setGuestIdCookie(res, me.guestId);
        }
        return res;
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update profile';
        return jsonError(500, 'PROFILE_FAILED', message);
    }
}
