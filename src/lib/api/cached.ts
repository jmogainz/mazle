import { getActiveApi, getApiMode } from './index';
import type {
  ArchiveDaysResponse,
  LeaderboardAroundResponse,
  LeaderboardMeResponse,
  LeaderboardTopResponse,
  MeResponse,
} from './types';

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const CACHE = new Map<string, CacheEntry<unknown>>();
const INFLIGHT = new Map<string, { promise: Promise<unknown>; epoch: number }>();
const EPOCH = new Map<string, number>();

const ME_TTL_MS = 10 * 60 * 1000; // 10 minutes
const LEADERBOARD_TTL_MS = 5 * 60 * 1000; // 5 minutes (longer for better navigation UX)
const ARCHIVE_DAYS_TTL_MS = 5 * 60 * 1000; // 5 minutes

function nowMs(): number {
  return Date.now();
}

function cacheScope(): string {
  const mode = getApiMode();
  if (mode !== 'mock') return 'real';
  if (typeof window === 'undefined') return 'mock';
  try {
    const key = localStorage.getItem('mazle_mock_me_v1') ? 'user' : 'guest';
    return `mock:${key}`;
  } catch {
    return 'mock';
  }
}

function scopedKey(key: string): string {
  return `${cacheScope()}:${key}`;
}

function getEpoch(key: string): number {
  return EPOCH.get(key) ?? 0;
}

function bumpEpoch(key: string): number {
  const next = getEpoch(key) + 1;
  EPOCH.set(key, next);
  return next;
}

function readCache<T>(key: string): T | null {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= nowMs()) {
    CACHE.delete(key);
    return null;
  }
  return entry.value as T;
}

function writeCache<T>(key: string, value: T, ttlMs: number): void {
  CACHE.set(key, { value, expiresAt: nowMs() + ttlMs });
}

async function fetchCached<T>(key: string, fetcher: () => Promise<T>, ttlMs: number): Promise<T> {
  const cached = readCache<T>(key);
  if (cached !== null) return cached;

  const epoch = getEpoch(key);
  const existing = INFLIGHT.get(key);
  if (existing && existing.epoch === epoch) {
    return existing.promise as Promise<T>;
  }

  const promise = fetcher()
    .then((value) => {
      if (getEpoch(key) === epoch) {
        writeCache(key, value, ttlMs);
      }
      INFLIGHT.delete(key);
      return value;
    })
    .catch((err) => {
      INFLIGHT.delete(key);
      throw err;
    });

  INFLIGHT.set(key, { promise, epoch });
  return promise;
}

async function fetchFresh<T>(key: string, fetcher: () => Promise<T>, ttlMs: number): Promise<T> {
  const epoch = bumpEpoch(key);
  INFLIGHT.delete(key);
  const value = await fetcher();
  if (getEpoch(key) === epoch) {
    writeCache(key, value, ttlMs);
  }
  return value;
}

function primeCache<T>(key: string, fetcher: () => Promise<T>, ttlMs: number): void {
  void fetchCached(key, fetcher, ttlMs).catch(() => null);
}

function leaderboardTopKey(date: string, limit: number, offset: number): string {
  return scopedKey(`lb:top:${date}:${limit}:${offset}`);
}

function leaderboardMeKey(date: string): string {
  return scopedKey(`lb:me:${date}`);
}

function leaderboardAroundKey(date: string, rank: number, window: number): string {
  return scopedKey(`lb:around:${date}:${rank}:${window}`);
}

function archiveDaysKey(from: string, to: string): string {
  return scopedKey(`archive:days:${from}:${to}`);
}

export const cachedApi = {
  me: async (): Promise<MeResponse> => fetchCached(scopedKey('me'), () => getActiveApi().me(), ME_TTL_MS),

  leaderboardTop: async (date: string, limit = 50, offset = 0): Promise<LeaderboardTopResponse> =>
    fetchCached(
      leaderboardTopKey(date, limit, offset),
      () => getActiveApi().leaderboardTop(date, limit, offset),
      LEADERBOARD_TTL_MS
    ),

  leaderboardMe: async (date: string): Promise<LeaderboardMeResponse> =>
    fetchCached(leaderboardMeKey(date), () => getActiveApi().leaderboardMe(date), LEADERBOARD_TTL_MS),

  leaderboardAround: async (date: string, rank: number, window = 5): Promise<LeaderboardAroundResponse> =>
    fetchCached(
      leaderboardAroundKey(date, rank, window),
      () => getActiveApi().leaderboardAround(date, rank, window),
      LEADERBOARD_TTL_MS
    ),
};

export async function fetchMeFresh(): Promise<MeResponse> {
  return fetchFresh(scopedKey('me'), () => getActiveApi().me(), ME_TTL_MS);
}

export async function fetchLeaderboardTopFresh(date: string, limit = 50, offset = 0): Promise<LeaderboardTopResponse> {
  return fetchFresh(
    leaderboardTopKey(date, limit, offset),
    () => getActiveApi().leaderboardTop(date, limit, offset),
    LEADERBOARD_TTL_MS
  );
}

export async function fetchLeaderboardMeFresh(date: string): Promise<LeaderboardMeResponse> {
  return fetchFresh(leaderboardMeKey(date), () => getActiveApi().leaderboardMe(date), LEADERBOARD_TTL_MS);
}

export async function fetchLeaderboardAroundFresh(date: string, rank: number, window = 5): Promise<LeaderboardAroundResponse> {
  return fetchFresh(
    leaderboardAroundKey(date, rank, window),
    () => getActiveApi().leaderboardAround(date, rank, window),
    LEADERBOARD_TTL_MS
  );
}

export function readCachedMe(): MeResponse | null {
  return readCache<MeResponse>(scopedKey('me'));
}

export function readCachedLeaderboardTop(date: string, limit = 50, offset = 0): LeaderboardTopResponse | null {
  return readCache<LeaderboardTopResponse>(leaderboardTopKey(date, limit, offset));
}

export function readCachedLeaderboardMe(date: string): LeaderboardMeResponse | null {
  return readCache<LeaderboardMeResponse>(leaderboardMeKey(date));
}

export function readCachedLeaderboardAround(date: string, rank: number, window = 5): LeaderboardAroundResponse | null {
  return readCache<LeaderboardAroundResponse>(leaderboardAroundKey(date, rank, window));
}

export function prefetchAccount(): void {
  primeCache(scopedKey('me'), () => getActiveApi().me(), ME_TTL_MS);
}

export function prefetchLeaderboard(date: string, limit = 50): void {
  primeCache(leaderboardTopKey(date, limit, 0), () => getActiveApi().leaderboardTop(date, limit, 0), LEADERBOARD_TTL_MS);
  primeCache(
    leaderboardMeKey(date),
    async () => {
      const me = await getActiveApi().leaderboardMe(date);
      if (me?.rank) {
        primeCache(
          leaderboardAroundKey(date, me.rank, 5),
          () => getActiveApi().leaderboardAround(date, me.rank, 5),
          LEADERBOARD_TTL_MS
        );
      }
      return me;
    },
    LEADERBOARD_TTL_MS
  );
}

export function prefetchArchiveDays(from: string, to: string): void {
  primeCache(archiveDaysKey(from, to), () => getActiveApi().archiveDays(from, to), ARCHIVE_DAYS_TTL_MS);
}

export function readCachedArchiveDays(from: string, to: string): ArchiveDaysResponse | null {
  return readCache<ArchiveDaysResponse>(archiveDaysKey(from, to));
}

export async function getCachedArchiveDays(from: string, to: string): Promise<ArchiveDaysResponse> {
  return fetchCached(archiveDaysKey(from, to), () => getActiveApi().archiveDays(from, to), ARCHIVE_DAYS_TTL_MS);
}
