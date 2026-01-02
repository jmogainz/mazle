import { NextResponse } from 'next/server';
import { getEntitlementsForUser, getSessionUserId } from '@/lib/server/identity';
import { jsonError, readJsonBody } from '@/lib/server/responses';
import { getStripe, stripeLifetimePriceId, stripeMonthlyPriceId } from '@/lib/server/stripe';

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

    const lifetimePriceId = stripeLifetimePriceId();
    const monthlyPriceId = stripeMonthlyPriceId();
    const allowed = new Set([lifetimePriceId, monthlyPriceId].filter((v): v is string => !!v));
    if (!allowed.has(body.priceId)) {
      return jsonError(400, 'INVALID_PRICE', 'Unknown priceId.');
    }
    const plan: 'monthly' | 'lifetime' = body.priceId === monthlyPriceId ? 'monthly' : 'lifetime';
    const mode: 'subscription' | 'payment' = plan === 'monthly' ? 'subscription' : 'payment';

    const entitlements = await getEntitlementsForUser(userId);
    if (entitlements.archiveAccess || entitlements.adsRemoved) {
      return NextResponse.json({ alreadyOwned: true }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const stripe = getStripe();
    const checkout = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: body.priceId, quantity: 1 }],
      success_url: body.successUrl,
      cancel_url: body.cancelUrl,
      allow_promotion_codes: true,
      ...(mode === 'subscription'
        ? {
            subscription_data: {
              metadata: {
                user_id: userId,
                plan,
                price_id: body.priceId,
              },
            },
          }
        : {}),
      metadata: {
        user_id: userId,
        plan,
        price_id: body.priceId,
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
