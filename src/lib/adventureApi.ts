import { fetchJson } from '@/lib/api/http';

export type AdventureLevelProgress = {
  levelId: number;
  stars: 1 | 2 | 3;
  bestMoves: number;
  bestTimeMs: number;
  completedAt: string;
};

export type AdventureProgress = {
  catalogVersion: string;
  currentLevel: number;
  unlockedLevel: number;
  completedLevels: number;
  totalStars: number;
  completedAll: boolean;
  levels: AdventureLevelProgress[];
};

export type AdventureEnergy = {
  hearts: number;
  maxHearts: number;
  nextHeartAt: string | null;
  refillTickets: number;
  dailyRefillAvailable: boolean;
  serverNow: string;
};

export type AdventureActiveAttempt = {
  attemptId: string;
  levelId: number;
  startedAt: string;
  energyReserved: boolean;
};

export type AdventureStateResponse = {
  ok: true;
  storageScope: string;
  guestImportAllowed: boolean;
  progress: AdventureProgress;
  energy: AdventureEnergy;
  activeAttempt: AdventureActiveAttempt | null;
  accountRequiredForPurchases: true;
};

export type AdventureStartRequest = {
  levelId: number;
  catalogVersion: string;
  idempotencyKey: string;
};

export type AdventureStartResponse = {
  ok: true;
  attempt: AdventureActiveAttempt;
  energy: AdventureEnergy;
};

export type AdventureCompleteRequest = {
  attemptId: string;
  moves: number;
  timeMs: number;
  catalogVersion: string;
  idempotencyKey: string;
};

export type AdventureCompleteResponse = {
  ok: true;
  level: AdventureLevelProgress;
  progress: AdventureProgress;
  energy: AdventureEnergy;
};

export type AdventureFailRequest = {
  attemptId: string;
  moves: number;
  timeMs: number;
  outcome: 'failed' | 'abandoned';
  idempotencyKey: string;
};

export type AdventureFailResponse = {
  ok: true;
  energy: AdventureEnergy;
};

export type AdventureSyncRequest = {
  catalogVersion: string;
  idempotencyKey: string;
  levels: Array<{
    levelId: number;
    bestMoves: number;
    bestTimeMs: number;
    completedAt?: string;
  }>;
};

export type AdventureSyncResponse = AdventureStateResponse;

export type AdventureUseRefillRequest = {
  source: 'daily' | 'ticket';
  idempotencyKey: string;
};

export type AdventureUseRefillResponse = {
  ok: true;
  energy: AdventureEnergy;
};

export type AdventureRefillPackId = 'single' | 'five' | 'twelve';

export type AdventureRefillOfferResponse = {
  packs: Array<{
    id: AdventureRefillPackId;
    ticketCount: number;
    priceId: string;
    formattedPrice: string;
    currency: string;
    purchaseType: 'one_time';
  }>;
};

export type AdventureRefillCheckoutRequest = {
  packId: AdventureRefillPackId;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
};

export type AdventureRefillCheckoutResponse = {
  url: string;
};

export type AdventureAppleRefillRequest = {
  signedTransaction: string;
};

export type AdventureAppleRefillResponse = {
  ok: true;
  energy: AdventureEnergy;
  granted: boolean;
  refillTickets: number;
  productId: string;
  transactionId: string;
};

function postJson<TResponse>(path: string, body: unknown): Promise<TResponse> {
  return fetchJson<TResponse>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export const adventureApi = {
  state: (): Promise<AdventureStateResponse> =>
    fetchJson('/api/adventure/state', { method: 'GET' }),

  start: (body: AdventureStartRequest): Promise<AdventureStartResponse> =>
    postJson('/api/adventure/start', body),

  complete: (body: AdventureCompleteRequest): Promise<AdventureCompleteResponse> =>
    postJson('/api/adventure/complete', body),

  fail: (body: AdventureFailRequest): Promise<AdventureFailResponse> =>
    postJson('/api/adventure/fail', body),

  sync: (body: AdventureSyncRequest): Promise<AdventureSyncResponse> =>
    postJson('/api/adventure/sync', body),

  useRefill: (body: AdventureUseRefillRequest): Promise<AdventureUseRefillResponse> =>
    postJson('/api/adventure/refills/use', body),

  offer: (): Promise<AdventureRefillOfferResponse> =>
    fetchJson('/api/adventure/refills/offer', { method: 'GET' }),

  checkout: (body: AdventureRefillCheckoutRequest): Promise<AdventureRefillCheckoutResponse> =>
    postJson('/api/adventure/refills/checkout', body),
};
