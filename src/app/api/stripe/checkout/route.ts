import { NextResponse } from 'next/server';
import { isDevMode } from '@/lib/server/env';
import { getSessionUserId } from '@/lib/server/identity';
import { jsonError, readJsonBody } from '@/lib/server/responses';
import { getStripe, stripePriceId } from '@/lib/server/stripe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
};

function isAbsoluteUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return jsonError(401, 'AUTH_REQUIRED', 'Sign in to purchase the archive.');
  }

  try {
    const body = await readJsonBody<Body>(request);
    if (!body.priceId || !body.successUrl || !body.cancelUrl) {
      return jsonError(400, 'INVALID_REQUEST', 'Missing priceId/successUrl/cancelUrl.');
    }
    if (!isAbsoluteUrl(body.successUrl) || !isAbsoluteUrl(body.cancelUrl)) {
      return jsonError(400, 'INVALID_REQUEST', 'successUrl/cancelUrl must be absolute URLs.');
    }

    if (isDevMode()) {
      return NextResponse.json({ url: body.successUrl }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const expected = stripePriceId();
    if (body.priceId !== expected) {
      return jsonError(400, 'INVALID_PRICE', 'Unknown priceId.');
    }

    const stripe = getStripe();
    const checkout = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: expected, quantity: 1 }],
      success_url: body.successUrl,
      cancel_url: body.cancelUrl,
      allow_promotion_codes: true,
      metadata: {
        user_id: userId,
        price_id: expected,
      },
    });

    if (!checkout.url) {
      return jsonError(500, 'CHECKOUT_FAILED', 'Stripe did not return a checkout URL.');
    }

    return NextResponse.json({ url: checkout.url }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create checkout';
    return jsonError(500, 'CHECKOUT_FAILED', message);
  }
}
