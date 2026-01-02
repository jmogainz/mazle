import type { NextResponse } from 'next/server';
import { GUEST_COOKIE } from './identity';

export function setGuestIdCookie(res: NextResponse, guestId: string): void {
  res.cookies.set(GUEST_COOKIE, guestId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365 * 5,
  });
}
