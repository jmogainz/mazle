import { NextResponse } from 'next/server';
import type { AdventureRefillOfferResponse } from '@/lib/adventureApi';
import { configuredStripeAdventureRefillPacks } from '@/lib/server/adventurePurchases';
import { jsonError } from '@/lib/server/responses';
import { getStripe } from '@/lib/server/stripe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function formatPrice(currency: string, unitAmount: number): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(unitAmount / 100);
  } catch {
    return `${(unitAmount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export async function GET() {
  const configured = configuredStripeAdventureRefillPacks();
  if (configured.length === 0) {
    return jsonError(503, 'REFILLS_NOT_CONFIGURED', 'Adventure refill purchases are not configured.');
  }

  try {
    const stripe = getStripe();
    const packs: AdventureRefillOfferResponse['packs'] = [];
    for (const pack of configured) {
      const price = await stripe.prices.retrieve(pack.priceId);
      if (!price.active || price.type !== 'one_time' || price.unit_amount == null) continue;
      packs.push({
        id: pack.id,
        ticketCount: pack.ticketCount,
        priceId: pack.priceId,
        formattedPrice: formatPrice(price.currency, price.unit_amount),
        currency: price.currency,
        purchaseType: 'one_time',
      });
    }
    if (packs.length === 0) {
      return jsonError(503, 'REFILLS_NOT_AVAILABLE', 'Adventure refill purchases are temporarily unavailable.');
    }
    return NextResponse.json({ packs } satisfies AdventureRefillOfferResponse, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[ADVENTURE_REFILL_OFFER]', error);
    return jsonError(500, 'REFILL_OFFER_FAILED', 'Adventure refill prices could not be loaded.');
  }
}
