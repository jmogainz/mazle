import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import type { PoolClient } from 'pg';
import { grantAdventureRefillPurchase, revokeAdventureRefillPurchase } from '@/lib/server/adventure';
import { stripeAdventureRefillPackByPriceId } from '@/lib/server/adventurePurchases';
import { ensureDbSchema, getDbPool } from '@/lib/server/db';
import { jsonError } from '@/lib/server/responses';
import {
  getStripe,
  stripeLifetimePriceId,
  stripeMonthlyPriceId,
  stripeWebhookSecretForHost,
} from '@/lib/server/stripe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function asDateFromUnixSeconds(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Date(value * 1000);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

class WebhookValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

async function grantEntitlements(pool: PoolClient, userId: string, expiresAt: Date | null, source: string): Promise<void> {
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

async function upsertPurchaseForSession(pool: PoolClient, userId: string, session: Stripe.Checkout.Session): Promise<void> {
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

async function upsertPurchaseForSubscription(pool: PoolClient, userId: string, subscription: Stripe.Subscription): Promise<void> {
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
    const hostHeader = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    event = stripe.webhooks.constructEvent(rawBody, signature, stripeWebhookSecretForHost(hostHeader));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook signature verification failed';
    return jsonError(400, 'INVALID_SIGNATURE', message);
  }

  // Filter out events from other dev instances
  const generatedBy = (event.data.object as any).metadata?.generated_by;
  if (generatedBy) {
    const appName = process.env.APP_NAME;
    const runnerId = process.env.UNIQUE_RUNNER_ID;
    const runNumber = process.env.UNIQUE_RUN_NUMBER;
    const expected = `webhook_check-${appName}-${runnerId}-${runNumber}`;

    if (generatedBy !== expected) {
      console.log(`[Stripe Webhook] Skipping event ${event.id} from another instance (generated_by=${generatedBy}, expected=${expected})`);
      return NextResponse.json({ received: true, ignored: true });
    }
  }

  await ensureDbSchema();
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');

    // Keep event receipt and fulfillment atomic so Stripe can safely retry any
    // failure without the event being stranded as an already-processed row.
    const inserted = await client.query(
      'insert into stripe_events (id, type) values ($1, $2) on conflict do nothing',
      [event.id, event.type]
    );
    if ((inserted.rowCount ?? 0) === 0) {
      await client.query('COMMIT');
      return NextResponse.json({ received: true, duplicate: true });
    }

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object as Stripe.Checkout.Session;
      const isAdventureRefill = session.metadata?.purchase_type === 'adventure_refill';
      const archivePriceId = session.metadata?.price_id;
      const configuredLifetimePriceId = stripeLifetimePriceId();
      const configuredMonthlyPriceId = stripeMonthlyPriceId();
      const isArchiveCheckout =
        (session.mode === 'payment' && !!configuredLifetimePriceId && archivePriceId === configuredLifetimePriceId) ||
        (session.mode === 'subscription' && !!configuredMonthlyPriceId && archivePriceId === configuredMonthlyPriceId);
      // A Stripe account may emit unrelated Checkout events. Receipt-only is the
      // safe behavior unless the session matches a product configured by Mazle.
      if (!isAdventureRefill && !isArchiveCheckout) {
        console.log(`[Stripe Webhook] Ignoring unrelated checkout session ${session.id}`);
      } else {
        const userId = session.metadata?.user_id;
        if (!userId || !isUuid(userId)) {
          throw new WebhookValidationError('MISSING_USER', 'Missing user_id in checkout session metadata.');
        }

        if (isAdventureRefill) {
          if (session.mode !== 'payment') {
            throw new WebhookValidationError('INVALID_PURCHASE_MODE', 'Adventure refill checkout must be a payment.');
          }
          if (session.payment_status === 'paid') {
            const pack = stripeAdventureRefillPackByPriceId(session.metadata?.price_id);
            if (!pack || pack.id !== session.metadata?.pack_id) {
              throw new Error('Adventure refill checkout references an unconfigured Stripe price.');
            }
            const paymentIntentId = typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id ?? null;
            await grantAdventureRefillPurchase(client, {
              userId,
              provider: 'stripe',
              externalTransactionId: session.id,
              providerPaymentId: paymentIntentId,
              productId: pack.priceId,
              ticketCount: pack.ticketCount,
              providerEventId: event.id,
              metadata: { packId: pack.id, paymentStatus: session.payment_status },
            });
          }
        } else {
          await upsertPurchaseForSession(client, userId, session);
          // Lifetime purchases grant only after Stripe reports paid. Subscriptions
          // remain driven by their subscription lifecycle events below.
          if (session.mode === 'payment' && session.payment_status === 'paid') {
            await grantEntitlements(client, userId, null, 'stripe');
          }
        }
      }
    }

    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const subscription = event.data.object as Stripe.Subscription;
      const configuredMonthlyPriceId = stripeMonthlyPriceId();
      const subscriptionPriceId = subscription.items.data[0]?.price?.id ?? null;
      if (!configuredMonthlyPriceId || subscriptionPriceId !== configuredMonthlyPriceId) {
        console.log(`[Stripe Webhook] Ignoring unrelated subscription ${subscription.id}`);
      } else {
        let finalUserId = subscription.metadata?.user_id;
        if (!finalUserId || !isUuid(finalUserId)) {
          const existing = await client.query<{ user_id: string }>(
            'select user_id from purchases where stripe_subscription_id=$1 limit 1',
            [subscription.id]
          );
          finalUserId = existing.rows[0]?.user_id ?? '';
        }
        if (!finalUserId || !isUuid(finalUserId)) {
          throw new WebhookValidationError('MISSING_USER', 'Missing user_id in subscription metadata.');
        }

        await upsertPurchaseForSubscription(client, finalUserId, subscription);
        const periodEnd = asDateFromUnixSeconds(subscription.current_period_end);
        const endedAt = asDateFromUnixSeconds(subscription.ended_at);
        const expiresAt = event.type === 'customer.subscription.deleted'
          ? endedAt ?? periodEnd ?? new Date()
          : periodEnd;
        await grantEntitlements(client, finalUserId, expiresAt, 'stripe_subscription');
      }
    }

    if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId = typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id ?? null;
      if (paymentIntentId && charge.refunded && charge.amount_refunded >= charge.amount) {
        await revokeAdventureRefillPurchase(client, {
          provider: 'stripe',
          providerPaymentId: paymentIntentId,
          providerEventId: event.id,
        });
      }
    }

    await client.query('COMMIT');
    return NextResponse.json({ received: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (err instanceof WebhookValidationError) return jsonError(400, err.code, err.message);
    const message = err instanceof Error ? err.message : 'Webhook handler failed';
    console.error('[Stripe Webhook]', message);
    return jsonError(500, 'WEBHOOK_FAILED', 'Webhook fulfillment failed.');
  } finally {
    client.release();
  }
}
