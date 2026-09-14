import { NextResponse } from 'next/server';
import { getAdventureState } from '@/lib/server/adventure';
import { adventureErrorResponse, withAdventureGuestCookie } from '@/lib/server/adventureResponses';
import { resolveMeIdentity, type MeIdentity } from '@/lib/server/identity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  let me: MeIdentity | undefined;
  try {
    me = await resolveMeIdentity(request);
    const state = await getAdventureState(me);
    return withAdventureGuestCookie(
      NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } }),
      me
    );
  } catch (error) {
    return adventureErrorResponse(error, me);
  }
}
