import { NextResponse } from 'next/server';
import type { AdventureCompleteRequest } from '@/lib/adventureApi';
import { completeAdventureAttempt } from '@/lib/server/adventure';
import {
  adventureErrorResponse,
  adventureMutationRequestError,
  readAdventureJson,
  withAdventureGuestCookie,
} from '@/lib/server/adventureResponses';
import { resolveMeIdentity, type MeIdentity } from '@/lib/server/identity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const requestError = adventureMutationRequestError(request);
  if (requestError) return requestError;

  let me: MeIdentity | undefined;
  try {
    me = await resolveMeIdentity(request);
    const body = await readAdventureJson<AdventureCompleteRequest>(request);
    const result = await completeAdventureAttempt(me, body);
    return withAdventureGuestCookie(
      NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } }),
      me
    );
  } catch (error) {
    return adventureErrorResponse(error, me);
  }
}
