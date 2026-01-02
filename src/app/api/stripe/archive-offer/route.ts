import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/server/responses';
import { getStripe, isStripeConfigured, stripeLifetimePriceId, stripeMonthlyPriceId } from '@/lib/server/stripe';

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
  if (!isStripeConfigured()) {
    return jsonError(500, 'STRIPE_NOT_CONFIGURED', 'Stripe is not configured.');
  }

  try {
    const stripe = getStripe();
    const monthlyPriceId = stripeMonthlyPriceId();
    const lifetimePriceId = stripeLifetimePriceId();

    const plans: Array<{
      id: 'monthly' | 'lifetime';
      priceId: string;
      formattedPrice: string;
      currency: string;
      purchaseType: 'subscription' | 'one_time';
      interval?: 'month';
    }> = [];

    if (monthlyPriceId) {
      const price = await stripe.prices.retrieve(monthlyPriceId);
      const unitAmount = price.unit_amount ?? 0;
      const currency = price.currency ?? 'usd';
      plans.push({
        id: 'monthly',
        priceId: monthlyPriceId,
        formattedPrice: formatPrice(currency, unitAmount),
        currency,
        purchaseType: 'subscription',
        interval: 'month',
      });
    }

    if (lifetimePriceId) {
      const price = await stripe.prices.retrieve(lifetimePriceId);
      const unitAmount = price.unit_amount ?? 0;
      const currency = price.currency ?? 'usd';
      plans.push({
        id: 'lifetime',
        priceId: lifetimePriceId,
        formattedPrice: formatPrice(currency, unitAmount),
        currency,
        purchaseType: 'one_time',
      });
    }

    if (plans.length === 0) {
      return jsonError(500, 'STRIPE_NOT_CONFIGURED', 'Stripe is not configured.');
    }

    return NextResponse.json(
      {
        plans,
        defaultPlanId: plans.some((p) => p.id === 'monthly') ? 'monthly' : plans[0]!.id,
        grants: ['archive_access', 'ads_removed'],
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load offer';
    return jsonError(500, 'STRIPE_OFFER_FAILED', message);
  }
}
