import type { NextResponse } from 'next/server';
import { AdventureError } from './adventure';
import { validateAdventureMutationRequest } from './adventureRequest';
import { setGuestIdCookie } from './cookies';
import type { MeIdentity } from './identity';
import { jsonError } from './responses';
import { readJsonBody } from './responses';

export function adventureMutationRequestError(request: Request): NextResponse | null {
  const validation = validateAdventureMutationRequest(request);
  if (validation.ok) return null;
  return jsonError(validation.status, validation.errorCode, validation.message);
}

export async function readAdventureJson<T>(request: Request): Promise<T> {
  try {
    return await readJsonBody<T>(request);
  } catch {
    throw new AdventureError('INVALID_REQUEST', 'Invalid JSON body.', 400);
  }
}

export function withAdventureGuestCookie<T extends NextResponse>(response: T, me: MeIdentity): T {
  if (me.setGuestCookie) setGuestIdCookie(response, me.guestId);
  return response;
}

export function adventureErrorResponse(error: unknown, me?: MeIdentity): NextResponse {
  if (error instanceof AdventureError) {
    const response = jsonError(error.status, error.code, error.message);
    return me ? withAdventureGuestCookie(response, me) : response;
  }
  console.error('[ADVENTURE_API]', error);
  const response = jsonError(500, 'ADVENTURE_FAILED', 'Adventure could not be updated. Please try again.');
  return me ? withAdventureGuestCookie(response, me) : response;
}
