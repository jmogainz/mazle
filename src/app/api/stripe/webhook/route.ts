import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { ensureDbSchema, getDbPool } from '@/lib/server/db';
import { jsonError } from '@/lib/server/responses';
import { getStripe, stripeWebhookSecret } from '@/lib/server/stripe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
    if (inserted.rowCount === 0) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.user_id;
      if (!userId) {
        return jsonError(400, 'MISSING_USER', 'Missing user_id in checkout session metadata.');
      }

      await pool.query(
        `insert into purchases (user_id, stripe_customer_id, stripe_checkout_session_id, stripe_payment_intent_id, stripe_price_id)
         values ($1, $2, $3, $4, $5)
         on conflict do nothing`,
        [
          userId,
          typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
          session.id,
          typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null,
          session.metadata?.price_id ?? null,
        ]
      );

      // Grant entitlements: archive access + no ads.
      await pool.query(
        `insert into entitlements (user_id, key, source)
         values ($1, 'archive_access', 'stripe'),
                ($1, 'ads_removed', 'stripe')
         on conflict do nothing`,
        [userId]
      );
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook handler failed';
    return jsonError(500, 'WEBHOOK_FAILED', message);
  }
}
