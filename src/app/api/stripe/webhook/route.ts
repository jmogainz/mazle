import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { ensureDbSchema, getDbPool } from '@/lib/server/db';
import { jsonError } from '@/lib/server/responses';
import { getStripe, stripeWebhookSecret } from '@/lib/server/stripe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function asDateFromUnixSeconds(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Date(value * 1000);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function grantEntitlements(pool: ReturnType<typeof getDbPool>, userId: string, expiresAt: Date | null, source: string): Promise<void> {
  await pool.query(
    `insert into entitlements (user_id, key, source, expires_at)
     values ($1, 'archive_access', $2, $3),
            ($1, 'ads_removed', $2, $3)
     on conflict (user_id, key)
     do update set
       source = excluded.source,
       expires_at = excluded.expires_at`,
    [userId, source, expiresAt]
  );
}

async function upsertPurchaseForSession(pool: ReturnType<typeof getDbPool>, userId: string, session: Stripe.Checkout.Session): Promise<void> {
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null;
  await pool.query(
    `insert into purchases (user_id, stripe_customer_id, stripe_checkout_session_id, stripe_payment_intent_id, stripe_subscription_id, stripe_price_id)
     values ($1, $2, $3, $4, $5, $6)
     on conflict do nothing`,
    [
      userId,
      typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
      session.id,
      typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null,
      subscriptionId,
      session.metadata?.price_id ?? null,
    ]
  );
}

async function upsertPurchaseForSubscription(pool: ReturnType<typeof getDbPool>, userId: string, subscription: Stripe.Subscription): Promise<void> {
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id ?? null;
  const priceId = subscription.items.data[0]?.price?.id ?? null;

  await pool.query(
    `insert into purchases (user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id)
     values ($1, $2, $3, $4)
     on conflict (stripe_subscription_id)
     do update set
       user_id = excluded.user_id,
       stripe_customer_id = excluded.stripe_customer_id,
       stripe_price_id = excluded.stripe_price_id`,
    [userId, customerId, subscription.id, priceId]
  );
}

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return jsonError(400, 'MISSING_SIGNATURE', 'Missing stripe-signature header.');
  }

  let event: Stripe.Event;
  const rawBody = await request.text();
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret());
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook signature verification failed';
    return jsonError(400, 'INVALID_SIGNATURE', message);
  }

  try {
    await ensureDbSchema();
    const pool = getDbPool();

    // Idempotency guard
    const inserted = await pool.query('insert into stripe_events (id, type) values ($1, $2) on conflict do nothing', [
      event.id,
      event.type,
    ]);
    if ((inserted.rowCount ?? 0) === 0) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.user_id;
      if (!userId || !isUuid(userId)) {
        return jsonError(400, 'MISSING_USER', 'Missing user_id in checkout session metadata.');
      }

      await upsertPurchaseForSession(pool, userId, session);

      // Lifetime purchases grant permanent entitlements. Subscriptions are handled by subscription events.
      if (session.mode === 'payment') {
        await grantEntitlements(pool, userId, null, 'stripe');
      }
    }

    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.user_id;
      if (!userId || !isUuid(userId)) {
        // Fallback: try to resolve from purchases table if this subscription was previously recorded.
        const existing = await pool.query<{ user_id: string }>(
          'select user_id from purchases where stripe_subscription_id=$1 limit 1',
          [subscription.id]
        );
        const resolved = existing.rows[0]?.user_id ?? null;
        if (!resolved) {
          return jsonError(400, 'MISSING_USER', 'Missing user_id in subscription metadata.');
        }
        // eslint-disable-next-line no-param-reassign
        (subscription as any).metadata = { ...(subscription.metadata ?? {}), user_id: resolved };
      }

      const finalUserId = ((subscription as any).metadata?.user_id as string) ?? userId;
      await upsertPurchaseForSubscription(pool, finalUserId, subscription);

      const periodEnd = asDateFromUnixSeconds(subscription.current_period_end);
      const endedAt = asDateFromUnixSeconds(subscription.ended_at);

      // Access should end at end-of-period when canceled.
      // If the subscription is deleted/ended, set expiry to ended_at (or now as a fallback).
      const expiresAt =
        event.type === 'customer.subscription.deleted'
          ? endedAt ?? periodEnd ?? new Date()
          : periodEnd;

      await grantEntitlements(pool, finalUserId, expiresAt, 'stripe_subscription');
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook handler failed';
    return jsonError(500, 'WEBHOOK_FAILED', message);
  }
}
