import { MapType, TileType, type PuzzleData } from '@/game/types';
import { getPuzzleNumber, LAUNCH_DATE_NY } from '@/game/puzzleGenerator';
import type {
  ArchiveDaysResponse,
  ArchiveOfferResponse,
  ArchivePuzzleResponse,
  CheckoutRequest,
  CheckoutResponse,
  ClaimRequest,
  ClaimResponse,
  GuestResponse,
  LeaderboardAroundResponse,
  LeaderboardEntry,
  LeaderboardMeResponse,
  LeaderboardSubmitRequest,
  LeaderboardSubmitResponse,
  LeaderboardTopResponse,
  MeResponse,
} from './types';

type MockMeState = MeResponse & {
  // Used to simulate async webhook fulfillment in mock checkout.
  pendingArchiveGrantAtMs?: number;
};

type MockLeaderboardEntry = {
  displayName: string;
  timeMs: number;
  attemptsUsed: number;
  submittedAtMs: number;
};

type MockLeaderboardByDate = Record<string, MockLeaderboardEntry[]>;

const STORAGE_KEYS = {
  me: 'mazle_mock_me_v1',
  lb: 'mazle_mock_leaderboard_v1',
};

function getNyDateString(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function parseNyDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`);
}

function addDaysNy(dateStr: string, days: number): string {
  const date = parseNyDate(dateStr);
  return getNyDateString(new Date(date.getTime() + days * 24 * 60 * 60 * 1000));
}

function clampDateToYesterdayNy(dateStr: string): string {
  const today = parseNyDate(getNyDateString());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const target = parseNyDate(dateStr);
  return target.getTime() > yesterday.getTime() ? getNyDateString(yesterday) : dateStr;
}

function loadJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function saveJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function hashStringToUint(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function generateDisplayName(seed: string): string {
  const rng = mulberry32(hashStringToUint(seed));
  const adjectives = [
    'Frosty',
    'Swift',
    'Misty',
    'Brave',
    'Calm',
    'Clever',
    'Bold',
    'Chill',
    'Sunny',
    'Glowy',
    'Sly',
    'Nimble',
  ];
  const nouns = [
    'Zubat',
    'Pikachu',
    'Eevee',
    'Snorlax',
    'Psyduck',
    'Cubone',
    'Lapras',
    'Abra',
    'Onix',
    'Jigglypuff',
    'Vulpix',
    'Magikarp',
  ];
  const num = Math.floor(rng() * 90) + 10;
  return `${pick(rng, adjectives)}${pick(rng, nouns)}${num}`;
}

function getOrInitMe(): MockMeState {
  const existing = loadJson<MockMeState>(STORAGE_KEYS.me);
  if (existing) return existing;

  const displayName = generateDisplayName(`guest:${Date.now()}`);
  const init: MockMeState = {
    mode: 'guest',
    displayName,
    entitlements: { archiveAccess: false, adsRemoved: false },
  };
  saveJson(STORAGE_KEYS.me, init);
  return init;
}

function setMe(next: MockMeState): void {
  saveJson(STORAGE_KEYS.me, next);
}

function normalizeDateRange(from: string, to: string): { from: string; to: string } {
  const start = from < LAUNCH_DATE_NY ? LAUNCH_DATE_NY : from;
  const end = clampDateToYesterdayNy(to);
  return start <= end ? { from: start, to: end } : { from: end, to: end };
}

function buildDays(from: string, to: string): string[] {
  const result: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    result.push(cursor);
    cursor = addDaysNy(cursor, 1);
    if (result.length > 5000) break;
  }
  return result;
}

function demoPuzzle(date: string): PuzzleData {
  // Deterministic but simple: a ground puzzle with a clear path.
  // This exists only so UI dev isn't blocked by slow WASM generation.
  const width = 10;
  const height = 10;
  const tiles: TileType[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => TileType.GROUND)
  );

  // Border walls.
  for (let x = 0; x < width; x++) {
    tiles[0][x] = TileType.WALL;
    tiles[height - 1][x] = TileType.WALL;
  }
  for (let y = 0; y < height; y++) {
    tiles[y][0] = TileType.WALL;
    tiles[y][width - 1] = TileType.WALL;
  }

  // A small internal wall chunk.
  for (let x = 3; x <= 6; x++) tiles[4][x] = TileType.WALL;
  tiles[4][5] = TileType.GROUND; // gap

  const start = { x: 1, y: 1 };
  const goal = { x: 8, y: 8 };
  tiles[start.y][start.x] = TileType.START;
  tiles[goal.y][goal.x] = TileType.GOAL;

  return {
    width,
    height,
    tiles,
    start,
    goal,
    optimalMoves: 14,
    mapType: MapType.GROUND,
    // No solutionPath needed for UI development.
  };
}

function loadLb(): MockLeaderboardByDate {
  return loadJson<MockLeaderboardByDate>(STORAGE_KEYS.lb) ?? {};
}

function saveLb(next: MockLeaderboardByDate): void {
  saveJson(STORAGE_KEYS.lb, next);
}

function ensureLeaderboardForDate(date: string): MockLeaderboardEntry[] {
  const all = loadLb();
  if (all[date]?.length) return all[date];

  const rng = mulberry32(hashStringToUint(`lb:${date}`));
  const entries: MockLeaderboardEntry[] = [];
  const count = 75;
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const displayName = generateDisplayName(`lb:${date}:${i}`);
    const timeMs = Math.floor(35_000 + rng() * 180_000);
    const attemptsUsed = 1 + Math.floor(rng() * 3);
    const submittedAtMs = now - Math.floor(rng() * 86_400_000);
    entries.push({ displayName, timeMs, attemptsUsed, submittedAtMs });
  }

  all[date] = entries;
  saveLb(all);
  return entries;
}

function rankEntries(date: string, meDisplayName: string): LeaderboardEntry[] {
  const entries = ensureLeaderboardForDate(date);
  const sorted = [...entries].sort((a, b) => {
    if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
    if (a.attemptsUsed !== b.attemptsUsed) return a.attemptsUsed - b.attemptsUsed;
    return a.submittedAtMs - b.submittedAtMs;
  });
  return sorted.map((e, idx) => ({
    rank: idx + 1,
    displayName: e.displayName,
    timeMs: e.timeMs,
    attemptsUsed: e.attemptsUsed,
    isMe: e.displayName.toLowerCase() === meDisplayName.toLowerCase(),
  }));
}

function upsertMeEntry(date: string, body: LeaderboardSubmitRequest, meDisplayName: string): { rank: number; updated: boolean } {
  const all = loadLb();
  const entries = ensureLeaderboardForDate(date);

  const meIndex = entries.findIndex((e) => e.displayName.toLowerCase() === meDisplayName.toLowerCase());
  const next: MockLeaderboardEntry = {
    displayName: meDisplayName,
    timeMs: body.timeMs,
    attemptsUsed: body.attemptsUsed,
    submittedAtMs: Date.now(),
  };

  let updated = false;
  if (meIndex === -1) {
    entries.push(next);
    updated = true;
  } else {
    const existing = entries[meIndex];
    const better =
      body.timeMs < existing.timeMs ||
      (body.timeMs === existing.timeMs && body.attemptsUsed < existing.attemptsUsed);
    if (better) {
      entries[meIndex] = next;
      updated = true;
    }
  }

  all[date] = entries;
  saveLb(all);

  const ranked = rankEntries(date, meDisplayName);
  const me = ranked.find((r) => r.isMe);
  return { rank: me?.rank ?? ranked.length, updated };
}

export const mockApi = {
  me: async (): Promise<MeResponse> => {
    const state = getOrInitMe();
    if (state.pendingArchiveGrantAtMs && Date.now() >= state.pendingArchiveGrantAtMs) {
      const next: MockMeState = {
        ...state,
        pendingArchiveGrantAtMs: undefined,
        entitlements: { ...state.entitlements, archiveAccess: true, adsRemoved: true },
      };
      setMe(next);
      return next;
    }
    return state;
  },

  guest: async (): Promise<GuestResponse> => {
    const current = getOrInitMe();
    if (current.mode === 'guest') return { displayName: current.displayName };
    // If already signed in (mock), still allow returning a "guest" display name,
    // but don't override the signed-in state.
    return { displayName: current.displayName };
  },

  claim: async (body: ClaimRequest): Promise<ClaimResponse> => {
    const current = getOrInitMe();
    const next: MockMeState = {
      ...current,
      mode: 'user',
      displayName: body.displayName ?? current.displayName,
    };
    setMe(next);
    return { displayName: next.displayName };
  },

  leaderboardTop: async (date: string, limit = 50): Promise<LeaderboardTopResponse> => {
    const me = await mockApi.me();
    const ranked = rankEntries(date, me.displayName);
    return { date, entries: ranked.slice(0, limit) };
  },

  leaderboardMe: async (date: string): Promise<LeaderboardMeResponse> => {
    const me = await mockApi.me();
    const ranked = rankEntries(date, me.displayName);
    const mine = ranked.find((r) => r.isMe);
    if (!mine) return null;
    return {
      date,
      rank: mine.rank,
      displayName: mine.displayName,
      timeMs: mine.timeMs,
      attemptsUsed: mine.attemptsUsed,
    };
  },

  leaderboardAround: async (date: string, rank: number, window = 5): Promise<LeaderboardAroundResponse> => {
    const me = await mockApi.me();
    const ranked = rankEntries(date, me.displayName);
    const start = Math.max(0, rank - 1 - window);
    const end = Math.min(ranked.length, rank + window);
    return { date, entries: ranked.slice(start, end) };
  },

  leaderboardSubmit: async (body: LeaderboardSubmitRequest): Promise<LeaderboardSubmitResponse> => {
    const me = await mockApi.me();
    const { rank, updated } = upsertMeEntry(body.date, body, me.displayName);
    return { ok: true, rank, updated };
  },

  archiveOffer: async (): Promise<ArchiveOfferResponse> => ({
    priceId: 'price_mock_archive',
    formattedPrice: '$4.99',
    currency: 'usd',
    purchaseType: 'one_time',
    grants: ['archive_access', 'ads_removed'],
  }),

  createCheckout: async (body: CheckoutRequest): Promise<CheckoutResponse> => {
    const state = getOrInitMe();
    // Simulate webhook granting entitlement shortly after returning.
    setMe({ ...state, pendingArchiveGrantAtMs: Date.now() + 1500 });

    // Try to keep the UX close to real: return a "success" URL so the
    // archive page performs the polling logic.
    const dMatch = /[?&]d=([0-9]{4}-[0-9]{2}-[0-9]{2})/.exec(body.successUrl);
    const d = dMatch?.[1];
    const url = d ? `/archive?checkout=success&d=${encodeURIComponent(d)}` : '/archive?checkout=success';
    return { url };
  },

  archiveDays: async (from: string, to: string): Promise<ArchiveDaysResponse> => {
    const me = await mockApi.me();
    const range = normalizeDateRange(from, to);
    const days = buildDays(range.from, range.to).map((date) => ({
      date,
      locked: !me.entitlements.archiveAccess,
    }));
    return { entitled: me.entitlements.archiveAccess, days };
  },

  archivePuzzle: async (date: string): Promise<ArchivePuzzleResponse> => {
    const me = await mockApi.me();
    if (!me.entitlements.archiveAccess) {
      const error = new Error('Archive access required') as Error & { errorCode?: string; status?: number };
      error.errorCode = 'ENTITLEMENT_REQUIRED';
      error.status = 403;
      throw error;
    }

    const clamped = date < LAUNCH_DATE_NY ? LAUNCH_DATE_NY : clampDateToYesterdayNy(date);
    return {
      date: clamped,
      seed: clamped,
      puzzleNumber: getPuzzleNumber(parseNyDate(clamped)),
      puzzle: demoPuzzle(clamped),
    };
  },
};
