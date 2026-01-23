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
  const value = env('STRIPE_ARCHIVE_PRICE_ID_LIFETIME') || env('STRIPE_ARCHIVE_PRICE_ID');
  if (!value) {
    throw new Error('Missing required env var: STRIPE_ARCHIVE_PRICE_ID_LIFETIME (or STRIPE_ARCHIVE_PRICE_ID legacy)');
  }
  return value;
}

export function stripeWebhookSecret(): string {
  return requireEnv('STRIPE_WEBHOOK_SECRET');
}

function normalizeHost(value: string): string {
  return value.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase();
}

export function stripeWebhookSecretForHost(host?: string | null): string {
  const primary = requireEnv('STRIPE_WEBHOOK_SECRET');
  const staging = env('STRIPE_WEBHOOK_SECRET_STAGING');
  const hostname = host ? normalizeHost(host.split(',')[0].trim()) : '';
  if (!staging || !hostname) {
    console.log(`[Stripe Webhook] Host=${hostname || 'unknown'} secret=primary`);
    return primary;
  }

  const stagingDomain = env('VERCEL_STAGING_DOMAIN');
  const isStagingHost =
    (stagingDomain && hostname === normalizeHost(stagingDomain)) || hostname.startsWith('staging.');
  if (isStagingHost) {
    console.log(`[Stripe Webhook] Host=${hostname} secret=staging`);
    return staging;
  }

  console.log(`[Stripe Webhook] Host=${hostname} secret=primary`);
  return primary;
}

export function isStripeConfigured(): boolean {
  const hasKey = !!env('STRIPE_SECRET_KEY');
  const hasLifetime = !!(env('STRIPE_ARCHIVE_PRICE_ID_LIFETIME') || env('STRIPE_ARCHIVE_PRICE_ID'));
  const hasMonthly = !!env('STRIPE_ARCHIVE_PRICE_ID_MONTHLY');
  return hasKey && (hasLifetime || hasMonthly);
}

export function stripeLifetimePriceId(): string | undefined {
  return env('STRIPE_ARCHIVE_PRICE_ID_LIFETIME') || env('STRIPE_ARCHIVE_PRICE_ID');
}

export function stripeMonthlyPriceId(): string | undefined {
  return env('STRIPE_ARCHIVE_PRICE_ID_MONTHLY');
}
