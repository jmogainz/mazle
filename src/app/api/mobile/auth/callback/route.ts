import { encode, getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import { env } from '@/lib/server/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MOBILE_CALLBACK = 'mazle://auth/callback';
const MOBILE_TOKEN_MAX_AGE = 10 * 24 * 60 * 60;

export async function GET(request: Request) {
  const secret = env('AUTH_SECRET') || env('NEXTAUTH_SECRET');
  const callback = new URL(MOBILE_CALLBACK);

  if (!secret) {
    callback.searchParams.set('error', 'AUTH_NOT_CONFIGURED');
    return NextResponse.redirect(callback);
  }

  const browserToken = await getToken({ req: request as any, secret }).catch(() => null);
  const userId = typeof (browserToken as any)?.userId === 'string' ? (browserToken as any).userId : null;
  if (!userId) {
    callback.searchParams.set('error', 'AUTH_REQUIRED');
    return NextResponse.redirect(callback);
  }

  const mobileToken = await encode({
    token: {
      userId,
      provider: typeof (browserToken as any)?.provider === 'string' ? (browserToken as any).provider : null,
    },
    secret,
    maxAge: MOBILE_TOKEN_MAX_AGE,
  });

  callback.searchParams.set('token', mobileToken);
  return NextResponse.redirect(callback);
}
