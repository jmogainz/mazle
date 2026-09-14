'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdventureCatalog, AdventureLevelDefinition } from '@/adventure';
import { getAdventureLevel, starsForMoves } from '@/adventure';
import type { AdventureGameResult } from './AdventureGame';
import type { AdventureProgressSummary } from './AdventureMap';
import type { AdventureSheetError, EnergyOffer } from './AdventureSheets';
import { getStorageScope, onStorageScopeChanged, setStorageScope } from '@/utils/storage';

const STORAGE_KEY = 'mazle_adventure_progress_v1';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_SUPPORTED_HEARTS = 5;

type ActiveAttempt = {
  attemptId: string;
  levelId: number;
  startedAt: string;
  energyReserved: boolean;
};

type EnergyState = {
  hearts: number;
  maxHearts: number;
  nextHeartAt: string | null;
  refillTickets: number;
  dailyRefillAvailable: boolean;
};

type LocalState = {
  catalogVersion: string;
  progress: AdventureProgressSummary;
  energy: EnergyState;
  activeAttempt: ActiveAttempt | null;
};

type RemoteState = {
  storageScope?: string;
  guestImportAllowed?: boolean;
  progress?: {
    catalogVersion?: string;
    levels?: Array<{ levelId: number; stars: number; bestMoves: number | null; bestTimeMs: number | null }>;
  };
  energy?: EnergyState & { serverNow?: string };
  activeAttempt?: ActiveAttempt | null;
};

function isValidStorageScope(value: unknown): value is string {
  return value === 'guest'
    || (typeof value === 'string'
      && /^user:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function mayMergeLocalScope(localScope: string, serverScope: string): boolean {
  return localScope === serverScope
    || (localScope === 'guest' && serverScope.startsWith('user:'));
}

function nowIso() { return new Date().toISOString(); }
function requestId(prefix: string) {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function initialState(catalog: AdventureCatalog): LocalState {
  const maximumHearts = catalog.energyPolicy.maximumHearts;
  return {
    catalogVersion: catalog.contentVersion,
    progress: {},
    energy: { hearts: maximumHearts, maxHearts: maximumHearts, nextHeartAt: null, refillTickets: 0, dailyRefillAvailable: false },
    activeAttempt: null,
  };
}

function scopedStorageKey(scope: string): string {
  return `${STORAGE_KEY}:${scope || 'guest'}`;
}

function readLocal(catalog: AdventureCatalog, scope: string): LocalState {
  const fallback = initialState(catalog);
  if (typeof window === 'undefined') return fallback;
  try {
    const key = scopedStorageKey(scope);
    let raw = localStorage.getItem(key);
    // Only the guest cache may adopt the pre-scope key. This avoids ever
    // importing one signed-in account's cache into another account.
    if (!raw && scope === 'guest') {
      raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        localStorage.setItem(key, raw);
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    const parsed = JSON.parse(raw ?? 'null') as Partial<LocalState> | null;
    if (!parsed || typeof parsed !== 'object') return fallback;
    const progress: AdventureProgressSummary = {};
    Object.entries(parsed.progress ?? {}).forEach(([rawId, entry]) => {
      const id = Number(rawId);
      if (!Number.isInteger(id) || !getAdventureLevel(id)) return;
      const value = entry as AdventureProgressSummary[number];
      const stars = Number(value?.stars);
      if (!value || !Number.isFinite(stars) || stars < 1) return;
      const bestMoves = Number(value.bestMoves);
      const bestTimeMs = Number(value.bestTimeMs);
      progress[id] = {
        stars: Math.min(3, Math.max(1, Math.floor(stars))),
        bestMoves: Number.isFinite(bestMoves) && bestMoves > 0 ? Math.floor(bestMoves) : null,
        bestTimeMs: Number.isFinite(bestTimeMs) && bestTimeMs > 0 ? Math.floor(bestTimeMs) : null,
      };
    });
    const persistedMaxHearts = Number(parsed.energy?.maxHearts);
    const maxHearts = Math.min(
      MAX_SUPPORTED_HEARTS,
      Math.max(
        catalog.energyPolicy.maximumHearts,
        Number.isFinite(persistedMaxHearts) ? Math.floor(persistedMaxHearts) : catalog.energyPolicy.maximumHearts,
      ),
    );
    const persistedHearts = Number(parsed.energy?.hearts);
    const persistedTickets = Number(parsed.energy?.refillTickets);
    return {
      catalogVersion: catalog.contentVersion,
      progress,
      energy: {
        hearts: Math.min(maxHearts, Math.max(0, Number.isFinite(persistedHearts) ? Math.floor(persistedHearts) : maxHearts)),
        maxHearts,
        nextHeartAt: typeof parsed.energy?.nextHeartAt === 'string' && Number.isFinite(Date.parse(parsed.energy.nextHeartAt))
          ? parsed.energy.nextHeartAt
          : null,
        refillTickets: Math.max(0, Number.isFinite(persistedTickets) ? Math.floor(persistedTickets) : 0),
        dailyRefillAvailable: !!parsed.energy?.dailyRefillAvailable,
      },
      activeAttempt: parsed.activeAttempt ?? null,
    };
  } catch {
    return fallback;
  }
}

function saveLocal(state: LocalState, scope: string) {
  try { localStorage.setItem(scopedStorageKey(scope), JSON.stringify(state)); } catch { /* storage can be unavailable */ }
}

function mergeProgress(local: AdventureProgressSummary, remoteLevels: RemoteState['progress'] extends infer _ ? Array<{ levelId: number; stars: number; bestMoves: number | null; bestTimeMs: number | null }> : never): AdventureProgressSummary {
  const next = { ...local };
  remoteLevels.forEach((item) => {
    const current = next[item.levelId];
    next[item.levelId] = {
      stars: Math.max(current?.stars ?? 0, item.stars ?? 0),
      bestMoves: current?.bestMoves == null ? item.bestMoves : item.bestMoves == null ? current.bestMoves : Math.min(current.bestMoves, item.bestMoves),
      bestTimeMs: current?.bestTimeMs == null ? item.bestTimeMs : item.bestTimeMs == null ? current.bestTimeMs : Math.min(current.bestTimeMs, item.bestTimeMs),
    };
  });
  return next;
}

class AdventureRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'AdventureRequestError';
  }
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    throw new AdventureRequestError(
      timedOut ? 'Mazle took too long to respond. Your local progress is safe.' : 'Mazle is offline. Your local progress is safe.',
      0,
      timedOut ? 'REQUEST_TIMEOUT' : 'NETWORK_UNAVAILABLE',
    );
  } finally {
    window.clearTimeout(timeout);
  }
  const payload = await response.json().catch(() => ({})) as { message?: string; error?: string; code?: string; errorCode?: string };
  if (!response.ok) {
    throw new AdventureRequestError(
      payload.message || payload.error || `Request failed (${response.status})`,
      response.status,
      typeof payload.errorCode === 'string' ? payload.errorCode : typeof payload.code === 'string' ? payload.code : null,
    );
  }
  return payload as T;
}

function withRegeneratedEnergy(energy: EnergyState, regenerationMs: number, now = Date.now()): EnergyState {
  if (energy.hearts >= energy.maxHearts) return { ...energy, hearts: energy.maxHearts, nextHeartAt: null };
  const parsedNextAt = energy.nextHeartAt ? Date.parse(energy.nextHeartAt) : Number.NaN;
  const nextAt = Number.isFinite(parsedNextAt) ? parsedNextAt : now + regenerationMs;
  if (now < nextAt) return { ...energy, nextHeartAt: new Date(nextAt).toISOString() };
  const recovered = 1 + Math.floor((now - nextAt) / regenerationMs);
  const hearts = Math.min(energy.maxHearts, energy.hearts + recovered);
  return {
    ...energy,
    hearts,
    nextHeartAt: hearts >= energy.maxHearts ? null : new Date(nextAt + recovered * regenerationMs).toISOString(),
  };
}

export function useAdventureProgress(catalog: AdventureCatalog) {
  const regenerationMs = catalog.energyPolicy.regenerationIntervalSeconds * 1000;
  const [state, setState] = useState<LocalState>(() => initialState(catalog));
  const stateRef = useRef(state);
  const scopeRef = useRef('guest');
  const pendingAttemptOperationRef = useRef<Promise<void>>(Promise.resolve());
  const purchasingRef = useRef(false);
  const refillingRef = useRef(false);
  const [storageScopeEpoch, setStorageScopeEpoch] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [offers, setOffers] = useState<EnergyOffer[]>([]);
  const [purchasing, setPurchasing] = useState(false);
  const [refilling, setRefilling] = useState(false);
  const [actionError, setActionError] = useState<AdventureSheetError | null>(null);
  const [clock, setClock] = useState(Date.now());

  const commit = useCallback((update: LocalState | ((current: LocalState) => LocalState)) => {
    const current = stateRef.current;
    const next = typeof update === 'function' ? update(current) : update;
    stateRef.current = next;
    if (typeof window !== 'undefined') saveLocal(next, scopeRef.current);
    setState(next);
  }, []);

  const applyRemote = useCallback((
    payload: RemoteState,
    preserveAttemptsStartedAfter?: number,
    expectedScope = scopeRef.current,
  ) => {
    // An account switch can happen while a request is in flight. Never let a
    // response for the previous identity mutate the newly selected cache.
    if (scopeRef.current !== expectedScope) return;
    commit((current) => {
      const activeStartedAt = current.activeAttempt ? Date.parse(current.activeAttempt.startedAt) : Number.NaN;
      const preserveNewerAttempt = preserveAttemptsStartedAfter !== undefined
        && current.activeAttempt !== null
        && Number.isFinite(activeStartedAt)
        && activeStartedAt >= preserveAttemptsStartedAfter;
      return {
        catalogVersion: catalog.contentVersion,
        progress: mergeProgress(current.progress, payload.progress?.levels ?? []),
        energy: payload.energy && !preserveNewerAttempt ? {
          hearts: payload.energy.hearts,
          maxHearts: payload.energy.maxHearts,
          nextHeartAt: payload.energy.nextHeartAt,
          refillTickets: payload.energy.refillTickets,
          dailyRefillAvailable: payload.energy.dailyRefillAvailable,
        } : current.energy,
        activeAttempt: preserveNewerAttempt || payload.activeAttempt === undefined
          ? current.activeAttempt
          : payload.activeAttempt,
      };
    });
  }, [catalog.contentVersion, commit]);

  useEffect(() => onStorageScopeChanged(() => {
    const nextScope = getStorageScope();
    if (nextScope === scopeRef.current) return;

    // Swap the in-memory state synchronously with the scope. This prevents a
    // timer or a late user action from writing the previous account's state
    // into the next account before React runs the sync effect below.
    scopeRef.current = nextScope;
    const local = readLocal(catalog, nextScope);
    stateRef.current = local;
    setState(local);
    setOffers([]);
    setActionError(null);
    // Keep the transition covered until the new scope's bootstrap finishes.
    // Otherwise the local cache can flash for one render, disappear behind the
    // loading state, and briefly accept input while identity is still changing.
    setHydrated(false);
    setStorageScopeEpoch((epoch) => epoch + 1);
  }), [catalog]);

  useEffect(() => {
    let cancelled = false;
    const scope = getStorageScope();
    scopeRef.current = scope;
    const local = readLocal(catalog, scope);
    stateRef.current = local;
    setState(local);
    // Keep account-scoped progress behind the loading screen until the server
    // confirms which identity owns this request. If the backend is offline,
    // the last confirmed scope remains available as the local-first fallback.
    setHydrated(false);

    const sync = async () => {
      const syncStartedAt = Date.now();
      setSyncing(true);
      try {
        const levels: Array<{ levelId: number; bestMoves: number; bestTimeMs: number }> = [];
        for (let levelId = 1; levelId <= catalog.levels.length; levelId += 1) {
          const progress = local.progress[levelId];
          if (!progress) break;
          if (
            !Number.isInteger(progress.bestMoves) || (progress.bestMoves ?? 0) <= 0
            || !Number.isInteger(progress.bestTimeMs) || (progress.bestTimeMs ?? 0) <= 0
          ) break;
          levels.push({
            levelId,
            bestMoves: progress.bestMoves as number,
            bestTimeMs: progress.bestTimeMs as number,
          });
        }
        // Resolve identity before uploading any local rows. This prevents a
        // stale user:A cache from ever being synchronized into user:B (or a
        // guest) after an account switch. Guest progress may intentionally be
        // claimed by a newly signed-in account.
        const initialRemote = await jsonRequest<RemoteState>('/api/adventure/state');
        const confirmedServerScope = isValidStorageScope(initialRemote.storageScope)
          ? initialRemote.storageScope
          : null;
        const scopeConfirmed = confirmedServerScope !== null;
        const serverScope = confirmedServerScope ?? scope;
        const guestClaim = scope === 'guest' && serverScope.startsWith('user:');
        const canUpload = scopeConfirmed
          && mayMergeLocalScope(scope, serverScope)
          && (!guestClaim || initialRemote.guestImportAllowed === true);
        const remote = canUpload && levels.length > 0
          ? await jsonRequest<RemoteState>('/api/adventure/sync', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ catalogVersion: catalog.contentVersion, idempotencyKey: requestId('sync'), levels }),
            })
          : initialRemote;
        if (!cancelled) {
          if (serverScope !== scopeRef.current) setStorageScope(serverScope);
          applyRemote(remote, syncStartedAt, serverScope);
        }
      } catch {
        // Local-first play remains available when the account backend is offline.
      } finally {
        if (!cancelled) {
          setHydrated(true);
          setSyncing(false);
        }
      }
    };
    void sync();

    jsonRequest<{ packs?: Array<{ id: string; ticketCount: number; formattedPrice: string; priceId?: string }> }>('/api/adventure/refills/offer')
      .then((payload) => {
        if (!cancelled) setOffers((payload.packs ?? []).map((pack) => ({
          id: pack.id,
          quantity: pack.ticketCount,
          formattedPrice: pack.formattedPrice,
          priceId: pack.priceId,
        })));
      })
      .catch(() => { if (!cancelled) setOffers([]); });

    return () => { cancelled = true; };
  }, [applyRemote, catalog, storageScopeEpoch]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      const regenerated = withRegeneratedEnergy(stateRef.current.energy, regenerationMs, now);
      if (regenerated.hearts !== stateRef.current.energy.hearts || regenerated.nextHeartAt !== stateRef.current.energy.nextHeartAt) {
        commit((current) => ({ ...current, energy: regenerated }));
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [commit, regenerationMs]);

  const beginLevel = useCallback(async (level: AdventureLevelDefinition): Promise<boolean> => {
    await pendingAttemptOperationRef.current;
    const operationScope = scopeRef.current;
    setActionError(null);
    const current = stateRef.current;
    const free = level.id <= catalog.energyPolicy.protectedThroughLevel;
    const energy = withRegeneratedEnergy(current.energy, regenerationMs);
    if (!free && energy.hearts < catalog.energyPolicy.failureCost) return false;
    const localAttempt: ActiveAttempt = { attemptId: requestId('local-attempt'), levelId: level.id, startedAt: nowIso(), energyReserved: !free };
    commit({
      ...current,
      // The server reserves a heart internally but deliberately reports the
      // visible balance unchanged until the attempt fails.
      energy,
      activeAttempt: localAttempt,
    });
    try {
      const remote = await jsonRequest<{ attempt: ActiveAttempt; energy: EnergyState }>('/api/adventure/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ levelId: level.id, catalogVersion: catalog.contentVersion, idempotencyKey: requestId('start') }),
      });
      if (scopeRef.current !== operationScope) return false;
      commit((latest) => latest.activeAttempt?.attemptId === localAttempt.attemptId
        ? { ...latest, activeAttempt: remote.attempt, energy: remote.energy }
        : latest);
    } catch (error) {
      if (scopeRef.current !== operationScope) return false;
      // Explicit client errors are authoritative (locked level, no energy,
      // stale catalog). Network and server failures retain local-first play.
      if (error instanceof AdventureRequestError && error.status >= 400 && error.status < 500) {
        commit((latest) => latest.activeAttempt?.attemptId === localAttempt.attemptId
          ? { ...latest, energy, activeAttempt: current.activeAttempt }
          : latest);
        setActionError({ code: error.code, message: error.message });
        return false;
      }
      // Keep the local attempt. It can be reconciled with best progress later.
    }
    return true;
  }, [catalog.contentVersion, catalog.energyPolicy.failureCost, catalog.energyPolicy.protectedThroughLevel, commit, regenerationMs]);

  const finishLevel = useCallback(async (level: AdventureLevelDefinition, result: AdventureGameResult) => {
    const operationScope = scopeRef.current;
    const current = stateRef.current;
    const attempt = current.activeAttempt;
    const previous = current.progress[level.id];
    const stars = starsForMoves(level, result.moves, result.completed);
    const progress = result.completed ? {
      ...current.progress,
      [level.id]: {
        stars: Math.max(previous?.stars ?? 0, stars),
        bestMoves: previous?.bestMoves == null ? result.moves : Math.min(previous.bestMoves, result.moves),
        bestTimeMs: previous?.bestTimeMs == null ? result.timeMs : Math.min(previous.bestTimeMs, result.timeMs),
      },
    } : current.progress;
    const shouldConsume = !!attempt?.energyReserved
      && (!result.completed || catalog.energyPolicy.successfulAttemptCostsHeart);
    const energy = shouldConsume ? {
      ...current.energy,
      hearts: Math.max(0, current.energy.hearts - catalog.energyPolicy.failureCost),
      nextHeartAt: current.energy.nextHeartAt ?? new Date(Date.now() + regenerationMs).toISOString(),
    } : current.energy;
    commit({ ...current, progress, energy, activeAttempt: null });

    if (!attempt) return;
    const operation = (async () => {
      try {
        const remote = result.completed
          ? await jsonRequest<RemoteState>('/api/adventure/complete', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ attemptId: attempt.attemptId, moves: result.moves, timeMs: Math.max(1, result.timeMs), catalogVersion: catalog.contentVersion, idempotencyKey: requestId('complete') }),
            })
          : await jsonRequest<RemoteState>('/api/adventure/fail', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ attemptId: attempt.attemptId, moves: result.moves, timeMs: Math.max(1, result.timeMs), outcome: 'failed', idempotencyKey: requestId('fail') }),
            });
        applyRemote(remote, undefined, operationScope);
      } catch {
        // Completion is retained locally and included in the next merge sync.
      }
    })();
    pendingAttemptOperationRef.current = operation;
    await operation;
  }, [applyRemote, catalog.contentVersion, catalog.energyPolicy.failureCost, catalog.energyPolicy.successfulAttemptCostsHeart, commit, regenerationMs]);

  const abandonLevel = useCallback(async (moves: number, timeMs: number) => {
    const operationScope = scopeRef.current;
    const current = stateRef.current;
    const attempt = current.activeAttempt;
    const shouldConsume = !!attempt?.energyReserved
      && moves > 0
      && catalog.energyPolicy.abandonAfterMoveCostsHeart;
    commit({
      ...current,
      energy: shouldConsume ? {
        ...current.energy,
        hearts: Math.max(0, current.energy.hearts - catalog.energyPolicy.failureCost),
        nextHeartAt: current.energy.nextHeartAt ?? new Date(Date.now() + regenerationMs).toISOString(),
      } : current.energy,
      activeAttempt: null,
    });
    if (!attempt) return;
    const operation = (async () => {
      try {
        const remote = await jsonRequest<RemoteState>('/api/adventure/fail', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
          body: JSON.stringify({ attemptId: attempt.attemptId, moves, timeMs: Math.max(1, Math.round(timeMs)), outcome: 'abandoned', idempotencyKey: requestId('abandon') }),
        });
        applyRemote(remote, undefined, operationScope);
      } catch { /* local state remains usable */ }
    })();
    pendingAttemptOperationRef.current = operation;
    await operation;
  }, [applyRemote, catalog.energyPolicy.abandonAfterMoveCostsHeart, catalog.energyPolicy.failureCost, commit, regenerationMs]);

  const useRefill = useCallback(async (source: 'daily' | 'ticket') => {
    if (refillingRef.current) return;
    const current = stateRef.current;
    if (current.energy.hearts >= current.energy.maxHearts) return;
    if (source === 'ticket' && current.energy.refillTickets <= 0) return;
    if (source === 'daily' && !current.energy.dailyRefillAvailable) return;
    refillingRef.current = true;
    const operationScope = scopeRef.current;
    setRefilling(true);
    setActionError(null);
    try {
      const remote = await jsonRequest<RemoteState>('/api/adventure/refills/use', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, idempotencyKey: requestId('refill') }),
      });
      applyRemote(remote, undefined, operationScope);
    } catch (error) {
      if (scopeRef.current !== operationScope) return;
      setActionError({
        code: error instanceof AdventureRequestError ? error.code : null,
        message: error instanceof Error ? error.message : 'The refill could not be used. Please try again.',
      });
    } finally {
      refillingRef.current = false;
      setRefilling(false);
    }
  }, [applyRemote]);

  const purchaseOffer = useCallback(async (offer: EnergyOffer) => {
    if (purchasingRef.current) return;
    purchasingRef.current = true;
    const operationScope = scopeRef.current;
    setPurchasing(true);
    setActionError(null);
    try {
      const payload = await jsonRequest<{ url?: string }>('/api/adventure/refills/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId: offer.id, idempotencyKey: requestId('checkout'), successUrl: `${window.location.origin}/adventure?purchase=success`, cancelUrl: `${window.location.origin}/adventure` }),
      });
      if (scopeRef.current !== operationScope) return;
      if (!payload.url) throw new AdventureRequestError('Checkout did not return a payment link.', 500, 'CHECKOUT_FAILED');
      window.location.assign(payload.url);
    } catch (error) {
      if (scopeRef.current !== operationScope) return;
      setActionError({
        code: error instanceof AdventureRequestError ? error.code : null,
        message: error instanceof Error ? error.message : 'Checkout could not be opened. Please try again.',
      });
    } finally {
      purchasingRef.current = false;
      setPurchasing(false);
    }
  }, []);

  const clearActionError = useCallback(() => setActionError(null), []);

  const nextHeartLabel = useMemo(() => {
    if (!state.energy.nextHeartAt || state.energy.hearts >= state.energy.maxHearts) return null;
    const remaining = Math.max(0, Date.parse(state.energy.nextHeartAt) - clock);
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return `in ${minutes}:${String(seconds).padStart(2, '0')}`;
  }, [clock, state.energy.hearts, state.energy.maxHearts, state.energy.nextHeartAt]);

  return {
    ...state,
    hydrated,
    syncing,
    offers,
    purchasing,
    refilling,
    actionError,
    energyPolicy: catalog.energyPolicy,
    nextHeartLabel,
    beginLevel,
    finishLevel,
    abandonLevel,
    useRefill,
    purchaseOffer,
    clearActionError,
  };
}
