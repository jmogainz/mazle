import Stripe from 'stripe';
import { env, requireEnv } from './env';

declare global {
  // eslint-disable-next-line no-var
  var __mazleStripe: Stripe | undefined;
}

export function getStripe(): Stripe {
  if (global.__mazleStripe) return global.__mazleStripe;
  const key = requireEnv('STRIPE_SECRET_KEY');
  const stripe = new Stripe(key, {
    apiVersion: '2024-06-20',
    typescript: true,
  });
  global.__mazleStripe = stripe;
  return stripe;
}

export function stripePriceId(): string {
  return requireEnv('STRIPE_ARCHIVE_PRICE_ID');
}

export function stripeWebhookSecret(): string {
  return requireEnv('STRIPE_WEBHOOK_SECRET');
}

export function isStripeConfigured(): boolean {
  return !!(env('STRIPE_SECRET_KEY') && env('STRIPE_ARCHIVE_PRICE_ID'));
}

