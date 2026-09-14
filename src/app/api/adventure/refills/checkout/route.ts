import { NextResponse } from 'next/server';
import type { AdventureRefillCheckoutRequest } from '@/lib/adventureApi';
import { isValidAdventureIdempotencyKey } from '@/lib/server/adventure';
import { stripeAdventureRefillPackById } from '@/lib/server/adventurePurchases';
import { adventureMutationRequestError } from '@/lib/server/adventureResponses';
import { getSessionUserId } from '@/lib/server/identity';
import { jsonError, readJsonBody } from '@/lib/server/responses';
import { getStripe } from '@/lib/server/stripe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isSameOriginReturnUrl(request: Request, value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const requested = new URL(value);
    const origin = new URL(request.url);
    return (requested.protocol === 'http:' || requested.protocol === 'https:') && requested.origin === origin.origin;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const requestError = adventureMutationRequestError(request);
  if (requestError) return requestError;

  const userId = await getSessionUserId(request);
  if (!userId) return jsonError(401, 'AUTH_REQUIRED', 'Sign in before purchasing refill tickets.');

  let body: AdventureRefillCheckoutRequest;
  try {
    body = await readJsonBody<AdventureRefillCheckoutRequest>(request);
  } catch {
    return jsonError(400, 'INVALID_REQUEST', 'Invalid JSON body.');
  }
  const pack = stripeAdventureRefillPackById(body.packId);
  if (!pack) return jsonError(400, 'INVALID_REFILL_PACK', 'This refill pack is not available.');
  if (!isValidAdventureIdempotencyKey(body.idempotencyKey)) {
    return jsonError(400, 'INVALID_IDEMPOTENCY_KEY', 'A valid idempotency key is required.');
  }
  if (!isSameOriginReturnUrl(request, body.successUrl) || !isSameOriginReturnUrl(request, body.cancelUrl)) {
    return jsonError(400, 'INVALID_RETURN_URL', 'Checkout return URLs must use this site.');
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        client_reference_id: userId,
        line_items: [{ price: pack.priceId, quantity: 1 }],
        success_url: body.successUrl,
        cancel_url: body.cancelUrl,
        allow_promotion_codes: true,
        metadata: {
          purchase_type: 'adventure_refill',
          user_id: userId,
          pack_id: pack.id,
          price_id: pack.priceId,
        },
        payment_intent_data: {
          metadata: {
            purchase_type: 'adventure_refill',
            user_id: userId,
            pack_id: pack.id,
            price_id: pack.priceId,
          },
        },
      },
      { idempotencyKey: `adventure-refill:${userId}:${body.idempotencyKey}` }
    );
    if (!session.url) return jsonError(500, 'CHECKOUT_FAILED', 'Stripe did not return a checkout URL.');
    return NextResponse.json({ url: session.url }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[ADVENTURE_REFILL_CHECKOUT]', error);
    return jsonError(500, 'CHECKOUT_FAILED', 'Adventure refill checkout could not be created.');
  }
}
