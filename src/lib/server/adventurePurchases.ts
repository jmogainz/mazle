import type { AdventureRefillPackId } from '@/lib/adventureApi';
import { env, type EnvName } from './env';

type RefillPackDefinition = {
  id: AdventureRefillPackId;
  ticketCount: number;
  stripeEnv: EnvName;
  appleEnv: EnvName;
  defaultAppleProductId: string;
};

const REFILL_PACKS: readonly RefillPackDefinition[] = [
  {
    id: 'single',
    ticketCount: 1,
    stripeEnv: 'STRIPE_ADVENTURE_REFILL_1_PRICE_ID',
    appleEnv: 'APPLE_APP_STORE_REFILL_1_PRODUCT_ID',
    defaultAppleProductId: 'com.mazle.adventure.refill.1',
  },
  {
    id: 'five',
    ticketCount: 5,
    stripeEnv: 'STRIPE_ADVENTURE_REFILL_5_PRICE_ID',
    appleEnv: 'APPLE_APP_STORE_REFILL_5_PRODUCT_ID',
    defaultAppleProductId: 'com.mazle.adventure.refill.5',
  },
  {
    id: 'twelve',
    ticketCount: 12,
    stripeEnv: 'STRIPE_ADVENTURE_REFILL_12_PRICE_ID',
    appleEnv: 'APPLE_APP_STORE_REFILL_12_PRODUCT_ID',
    defaultAppleProductId: 'com.mazle.adventure.refill.12',
  },
] as const;

export type ConfiguredAdventureRefillPack = {
  id: AdventureRefillPackId;
  ticketCount: number;
  priceId: string;
};

export function configuredStripeAdventureRefillPacks(): ConfiguredAdventureRefillPack[] {
  return REFILL_PACKS.flatMap((pack) => {
    const priceId = env(pack.stripeEnv);
    return priceId ? [{ id: pack.id, ticketCount: pack.ticketCount, priceId }] : [];
  });
}

export function stripeAdventureRefillPackById(id: unknown): ConfiguredAdventureRefillPack | null {
  if (typeof id !== 'string') return null;
  return configuredStripeAdventureRefillPacks().find((pack) => pack.id === id) ?? null;
}

export function stripeAdventureRefillPackByPriceId(priceId: unknown): ConfiguredAdventureRefillPack | null {
  if (typeof priceId !== 'string') return null;
  return configuredStripeAdventureRefillPacks().find((pack) => pack.priceId === priceId) ?? null;
}

export function appleAdventureRefillPacks(): ConfiguredAdventureRefillPack[] {
  return REFILL_PACKS.map((pack) => ({
    id: pack.id,
    ticketCount: pack.ticketCount,
    priceId: env(pack.appleEnv) ?? pack.defaultAppleProductId,
  }));
}

export function appleAdventureRefillPackByProductId(productId: unknown): ConfiguredAdventureRefillPack | null {
  if (typeof productId !== 'string') return null;
  return appleAdventureRefillPacks().find((pack) => pack.priceId === productId) ?? null;
}
