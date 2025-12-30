import { NextResponse } from 'next/server';
import { isDevMode } from '@/lib/server/env';
import { jsonError } from '@/lib/server/responses';
import { getStripe, isStripeConfigured, stripePriceId } from '@/lib/server/stripe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function formatPrice(currency: string, unitAmount: number): string {
  const amount = unitAmount / 100;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export async function GET() {
  if (isDevMode()) {
    return NextResponse.json(
      {
        priceId: 'dev_price_archive',
        formattedPrice: '$4.99',
        currency: 'usd',
        purchaseType: 'one_time',
        grants: ['archive_access', 'ads_removed'],
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (!isStripeConfigured()) {
    return jsonError(500, 'STRIPE_NOT_CONFIGURED', 'Stripe is not configured.');
  }

  try {
    const stripe = getStripe();
    const priceId = stripePriceId();
    const price = await stripe.prices.retrieve(priceId);
    const unitAmount = price.unit_amount ?? 0;
    const currency = price.currency ?? 'usd';

    return NextResponse.json(
      {
        priceId,
        formattedPrice: formatPrice(currency, unitAmount),
        currency,
        purchaseType: 'one_time',
        grants: ['archive_access', 'ads_removed'],
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load offer';
    return jsonError(500, 'STRIPE_OFFER_FAILED', message);
  }
}

