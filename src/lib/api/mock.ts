'use client';

import type {
  ArchiveDaysResponse,
  ArchiveOfferResponse,
  ArchivePuzzleResponse,
  CheckoutRequest,
  CheckoutResponse,
  ClaimRequest,
  ClaimResponse,
  GuestResponse,
  HallOfFamePodiumResponse,
  LeaderboardAroundResponse,
  LeaderboardMeResponse,
  LeaderboardSubmitRequest,
  LeaderboardSubmitResponse,
  LeaderboardTopResponse,
  MeResponse,
  ProfileUpdateRequest,
  ProfileUpdateResponse,
  ResultsDayResponse,
  ResultsImportRequest,
  ResultsImportResponse,
  ResultsRecordRequest,
  ResultsRecordResponse,
  SettingsUpdateRequest,
  SettingsUpdateResponse,
} from './types';
import { addDays } from '@/lib/date';
import { getNewYorkDateString, getPuzzleNumberFromNyDateString, LAUNCH_DATE_NY } from '@/game/puzzleGenerator';
import { MapType, TileType, type PuzzleData } from '@/game/types';

const MOCK_ME_KEY = 'mazle_mock_me_v1';
const MOCK_GUEST_KEY = 'mazle_mock_guest_v1';
const MOCK_RESULTS_KEY = 'mazle_mock_results_v1';
const MOCK_LB_SUBMISSION_KEY = 'mazle_mock_lb_submission_v1';

type StoredMockMe = {
  userId: string;
  displayName: string;
  entitlements: { archiveAccess: boolean; adsRemoved: boolean };
  profile: { characterId: string; skinId: string };
  settings: { theme: 'system' | 'light' | 'dark'; leaderboardAutoSubmit: boolean };
};

type StoredResultRow = {
  completed: boolean;
  timeMs: number | null;
  attemptsUsed: number | null;
};

type StoredResults = Record<string, StoredResultRow>;

type StoredSubmission = {
  date: string;
  timeMs: number;
  attemptsUsed: number;
  submittedAtMs: number;
};

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readLocal<T>(key: string): T | null {
  if (!isBrowser()) return null;
  try {
    return safeJsonParse<T>(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeLocal<T>(key: string, value: T): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function ensureMockMe(): StoredMockMe {
  const existing = readLocal<StoredMockMe>(MOCK_ME_KEY);
  if (existing?.userId && existing.displayName) return existing;

  const created: StoredMockMe = {
    userId: 'c0ffee00-0000-4000-8000-000000000001',
    displayName: 'You',
    entitlements: { archiveAccess: true, adsRemoved: true },
    profile: { characterId: 'default', skinId: 'default' },
    settings: { theme: 'system', leaderboardAutoSubmit: true },
  };
  writeLocal(MOCK_ME_KEY, created);
  return created;
}

function ensureMockGuest(): { displayName: string } {
  const existing = readLocal<{ displayName: string }>(MOCK_GUEST_KEY);
  if (existing?.displayName) return existing;
  const created = { displayName: 'Guest' };
  writeLocal(MOCK_GUEST_KEY, created);
  return created;
}

function readStoredResults(): StoredResults {
  return readLocal<StoredResults>(MOCK_RESULTS_KEY) ?? {};
}

function writeStoredResults(next: StoredResults): void {
  writeLocal(MOCK_RESULTS_KEY, next);
}

function readLeaderboardSubmission(): StoredSubmission | null {
  return readLocal<StoredSubmission>(MOCK_LB_SUBMISSION_KEY);
}

function writeLeaderboardSubmission(submission: StoredSubmission): void {
  writeLocal(MOCK_LB_SUBMISSION_KEY, submission);
}

function buildDummyArchivePuzzle(date: string): PuzzleData {
  const width = 10;
  const height = 10;

  const tiles: TileType[][] = [];
  for (let y = 0; y < height; y += 1) {
    const row: TileType[] = [];
    for (let x = 0; x < width; x += 1) {
      const isBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      row.push(isBorder ? TileType.WALL : TileType.GROUND);
    }
    tiles.push(row);
  }

  const start = { x: 1, y: 1 };
  const goal = { x: width - 2, y: height - 2 };
  tiles[start.y][start.x] = TileType.START;
  tiles[goal.y][goal.x] = TileType.GOAL;

  const solutionPath: Array<{ x: number; y: number }> = [{ ...start }];
  for (let x = start.x + 1; x <= goal.x; x += 1) solutionPath.push({ x, y: start.y });
  for (let y = start.y + 1; y <= goal.y; y += 1) solutionPath.push({ x: goal.x, y });

  const optimalMoves = (goal.x - start.x) + (goal.y - start.y);

  return {
    width,
    height,
    tiles,
    start,
    goal,
    optimalMoves,
    solutionPath,
    mapType: MapType.GROUND,
    // A few lightweight metrics so the dev tools don’t look empty.
    difficultyScore: 420,
    nearOptimalPaths: 7,
    pathOverlap: 0.62,
    earlyDivergence: 0.38,
    directionChanges: 1,
    decisionAmbiguity: 2.4,
  };
}

function buildLeaderboardNames(date: string, count: number): string[] {
  const adjectives = [
    'Frosty', 'Swift', 'Misty', 'Brave', 'Calm', 'Clever', 'Bold', 'Chill', 'Sunny', 'Glowy', 'Sly', 'Nimble',
    'Icy', 'Shiny', 'Sleepy', 'Spicy', 'Cozy', 'Quiet', 'Loud', 'Lucky', 'Witty', 'Salty', 'Zany', 'Snappy',
    'Gleaming', 'Neon', 'Crimson', 'Azure', 'Emerald', 'Golden', 'Silver', 'Shadow', 'Pixel', 'Turbo',
  ];
  const nouns = [
    'Lapras', 'Eevee', 'Pikachu', 'Snorlax', 'Psyduck', 'Cubone', 'Zubat', 'Abra', 'Onix', 'Jigglypuff', 'Vulpix', 'Magikarp',
    'Gengar', 'Dragonite', 'Mew', 'Mewtwo', 'Articuno', 'Zapdos', 'Moltres', 'Gyarados', 'Ditto', 'Bulbasaur', 'Charmander', 'Squirtle',
    'Glaceon', 'Froslass', 'Sneasel', 'Weavile', 'Delibird', 'Spheal', 'Seel', 'Cloyster', 'Swinub', 'Piloswine',
  ];

  const rand = seededRandom(hashString(`lb:${date}`) || 1);
  const names = new Set<string>();
  while (names.size < count) {
    const adj = adjectives[Math.floor(rand() * adjectives.length)];
    const noun = nouns[Math.floor(rand() * nouns.length)];
    const num = 10 + Math.floor(rand() * 90);
    names.add(`${adj}${noun}${num}`);
  }
  return Array.from(names);
}

const MOCK_LEADERBOARD_TOTAL = 1000;

function buildMockLeaderboardEntries(date: string): Array<{ displayName: string; timeMs: number; attemptsUsed: number; isMe: boolean }> {
  const names = buildLeaderboardNames(date, MOCK_LEADERBOARD_TOTAL);
  const seed = hashString(`lbTimes:${date}`) || 1;
  const rand = seededRandom(seed);
  const base = 38_000 + Math.floor(rand() * 9_000);

  const baseEntries = names.map((name, idx) => {
    const jitter = Math.floor(rand() * 900);
    const millis = Math.floor(rand() * 1000); // Add millisecond granularity
    const timeMs = base + idx * 1_250 + jitter + millis;
    const attemptsUsed = 1 + Math.floor(rand() * 3);
    return { displayName: name, timeMs, attemptsUsed, isMe: false } as const;
  });

  const me = readLocal<StoredMockMe>(MOCK_ME_KEY);
  const submission = readLeaderboardSubmission();

  const candidate =
    me && submission && submission.date === date
      ? { displayName: me.displayName || 'You', timeMs: submission.timeMs, attemptsUsed: submission.attemptsUsed, isMe: true }
      : null;

  const merged: Array<{ displayName: string; timeMs: number; attemptsUsed: number; isMe: boolean }> = [...baseEntries];
  if (candidate) merged.push(candidate);

  merged.sort((a, b) => (a.timeMs !== b.timeMs ? a.timeMs - b.timeMs : a.attemptsUsed - b.attemptsUsed));
  return merged;
}

function buildMockLeaderboardTop(date: string, limit: number, offset: number): LeaderboardTopResponse {
  const merged = buildMockLeaderboardEntries(date);
  const total = merged.length;
  const slice = merged.slice(offset, offset + limit);

  const entries = slice.map((entry, idx) => ({
    rank: offset + idx + 1,
    displayName: entry.displayName,
    timeMs: entry.timeMs,
    attemptsUsed: entry.attemptsUsed,
    isMe: entry.isMe || undefined,
  }));

  const podium =
    offset === 0
      ? merged.slice(0, 3).map((entry, idx) => ({
          rank: (idx + 1) as 1 | 2 | 3,
          displayName: entry.displayName,
          timeMs: entry.timeMs,
          attemptsUsed: entry.attemptsUsed,
          characterId: 'default',
          skinId: 'default',
          isMe: entry.isMe,
        }))
      : undefined;

  const nextOffset = offset + entries.length < total ? offset + entries.length : null;

  return { date, entries, podium, total, nextOffset };
}

function buildMockHallOfFame(date: string): HallOfFamePodiumResponse {
  const me = readLocal<StoredMockMe>(MOCK_ME_KEY);
  const guest = ensureMockGuest();

  const seed = hashString(`hof:${date}:${me?.displayName ?? guest.displayName}`) || 1;
  const rand = seededRandom(seed);
  const myRank = (1 + Math.floor(rand() * 3)) as 1 | 2 | 3;

  const names = buildLeaderboardNames(date, 12);
  const base = 34_000 + Math.floor(rand() * 10_000);

  const podium = ([1, 2, 3] as const).map((rank, idx) => {
    const isMe = rank === myRank;
    const displayName = isMe ? (me?.displayName ?? 'You') : names[idx] ?? 'Player';
    const timeMs = base + idx * 900 + Math.floor(rand() * 500);
    const attemptsUsed = 1 + Math.floor(rand() * 2);
    return {
      rank,
      displayName,
      timeMs,
      attemptsUsed,
      characterId: 'default',
      skinId: isMe ? (me?.profile?.skinId ?? 'default') : 'default',
      isMe: isMe || undefined,
    };
  });

  return { date, podium };
}

export const mockApi = {
  me: async (): Promise<MeResponse> => {
    const me = readLocal<StoredMockMe>(MOCK_ME_KEY);
    if (me) {
      return {
        mode: 'user',
        userId: me.userId,
        displayName: me.displayName,
        entitlements: me.entitlements,
        profile: me.profile,
        settings: me.settings,
      };
    }
    const guest = ensureMockGuest();
    return {
      mode: 'guest',
      displayName: guest.displayName,
      entitlements: { archiveAccess: true, adsRemoved: true },
      userId: null,
    };
  },

  guest: async (): Promise<GuestResponse> => {
    const guest = ensureMockGuest();
    try {
      localStorage.removeItem(MOCK_ME_KEY);
    } catch {
      // ignore
    }
    return { displayName: guest.displayName };
  },

  claim: async (body: ClaimRequest): Promise<ClaimResponse> => {
    const me = ensureMockMe();
    const requested = body.displayName?.trim();
    const nextName = requested && requested.length > 0 ? requested.slice(0, 24) : me.displayName;
    const updated: StoredMockMe = { ...me, displayName: nextName };
    writeLocal(MOCK_ME_KEY, updated);
    return { displayName: updated.displayName };
  },

  leaderboardTop: async (date: string, limit = 50, offset = 0): Promise<LeaderboardTopResponse> => {
    const today = getNewYorkDateString();
    if (date !== today) {
      return Promise.reject(new Error('Only today’s leaderboard is available.'));
    }
    const capped = Math.max(1, Math.min(200, limit || 50));
    const safeOffset = Math.max(0, Math.floor(offset || 0));
    return buildMockLeaderboardTop(date, capped, safeOffset);
  },

  leaderboardMe: async (date: string): Promise<LeaderboardMeResponse> => {
    const today = getNewYorkDateString();
    if (date !== today) return null;

    const me = readLocal<StoredMockMe>(MOCK_ME_KEY);
    if (!me) return null;

    const merged = buildMockLeaderboardEntries(date);
    const idx = merged.findIndex((e) => e.isMe);
    if (idx < 0) return null;
    const entry = merged[idx];
    return {
      date,
      rank: idx + 1,
      displayName: entry.displayName,
      timeMs: entry.timeMs,
      attemptsUsed: entry.attemptsUsed,
    };
  },

  leaderboardAround: async (date: string, rank: number, window = 5): Promise<LeaderboardAroundResponse> => {
    const today = getNewYorkDateString();
    if (date !== today) return { date, entries: [] };

    const merged = buildMockLeaderboardEntries(date);
    const idx = Math.max(0, Math.min(merged.length - 1, Math.floor(rank) - 1));
    const start = Math.max(0, idx - Math.max(1, Math.floor(window)));
    const end = Math.min(merged.length, idx + Math.max(1, Math.floor(window)) + 1);
    const entries = merged.slice(start, end).map((entry, entryIdx) => ({
      rank: start + entryIdx + 1,
      displayName: entry.displayName,
      timeMs: entry.timeMs,
      attemptsUsed: entry.attemptsUsed,
      isMe: entry.isMe || undefined,
    }));
    return { date, entries };
  },

  leaderboardSubmit: async (body: LeaderboardSubmitRequest): Promise<LeaderboardSubmitResponse> => {
    const today = getNewYorkDateString();
    if (body.date !== today) {
      return Promise.reject(new Error('Only today can be submitted.'));
    }

    const me = readLocal<StoredMockMe>(MOCK_ME_KEY);
    if (!me) {
      return Promise.reject(new Error('Sign in to submit.'));
    }

    const stored = readStoredResults();
    const recorded = stored[body.date];
    if (!recorded?.completed || recorded.timeMs == null || recorded.attemptsUsed == null) {
      return Promise.reject(new Error('No recorded win found for that day.'));
    }

    const existing = readLeaderboardSubmission();
    const updated = !existing || existing.date !== body.date || existing.timeMs !== recorded.timeMs || existing.attemptsUsed !== recorded.attemptsUsed;
    const submission: StoredSubmission = {
      date: body.date,
      timeMs: recorded.timeMs,
      attemptsUsed: recorded.attemptsUsed,
      submittedAtMs: Date.now(),
    };
    writeLeaderboardSubmission(submission);

    const top = buildMockLeaderboardTop(body.date, 200, 0);
    const meEntry = top.entries.find((e) => e.isMe);
    return { ok: true, rank: meEntry?.rank, updated };
  },

  resultsRecord: async (body: ResultsRecordRequest): Promise<ResultsRecordResponse> => {
    const normalized: StoredResultRow = {
      completed: !!body.completed,
      timeMs:
        body.completed && typeof body.timeMs === 'number' && Number.isFinite(body.timeMs) && body.timeMs > 0
          ? Math.round(body.timeMs)
          : null,
      attemptsUsed:
        body.completed && typeof body.attemptsUsed === 'number' && Number.isFinite(body.attemptsUsed) && body.attemptsUsed >= 1 && body.attemptsUsed <= 3
          ? Math.floor(body.attemptsUsed)
          : null,
    };

    const stored = readStoredResults();
    const existed = stored[body.date] != null;
    const next = { ...stored, [body.date]: normalized };
    writeStoredResults(next);
    return { ok: true, created: !existed, result: { date: body.date, completed: normalized.completed, timeMs: normalized.timeMs, attemptsUsed: normalized.attemptsUsed } };
  },

  resultsDay: async (date?: string): Promise<ResultsDayResponse> => {
    const target = date ?? getNewYorkDateString();
    const stored = readStoredResults();
    const row = stored[target];
    return {
      ok: true,
      result: row
        ? { date: target, completed: row.completed, timeMs: row.timeMs, attemptsUsed: row.attemptsUsed }
        : null,
    };
  },

  resultsImport: async (body: ResultsImportRequest): Promise<ResultsImportResponse> => {
    const stored = readStoredResults();
    let imported = 0;
    let skipped = 0;
    const next: StoredResults = { ...stored };

    body.history.forEach((row) => {
      if (!row?.date) return;
      if (next[row.date]) {
        skipped += 1;
        return;
      }
      imported += 1;
      next[row.date] = {
        completed: !!row.completed,
        timeMs: row.completed && typeof row.timeMs === 'number' && row.timeMs > 0 ? Math.round(row.timeMs) : null,
        attemptsUsed:
          row.completed && typeof row.attemptsUsed === 'number' && row.attemptsUsed >= 1 && row.attemptsUsed <= 3
            ? Math.floor(row.attemptsUsed)
            : null,
      };
    });

    writeStoredResults(next);
    return { ok: true, imported, skipped };
  },

  hallOfFamePodium: async (date: string): Promise<HallOfFamePodiumResponse> => {
    return buildMockHallOfFame(date);
  },

  settingsUpdate: async (body: SettingsUpdateRequest): Promise<SettingsUpdateResponse> => {
    const me = readLocal<StoredMockMe>(MOCK_ME_KEY);
    if (!me) {
      // Guest: noop, but behave like success so UI stays responsive.
      return { ok: true, settings: { theme: body.theme ?? 'system', leaderboardAutoSubmit: body.leaderboardAutoSubmit ?? true } };
    }

    const next: StoredMockMe = {
      ...me,
      settings: {
        theme: body.theme ?? me.settings.theme,
        leaderboardAutoSubmit: body.leaderboardAutoSubmit ?? me.settings.leaderboardAutoSubmit,
      },
    };
    writeLocal(MOCK_ME_KEY, next);
    return { ok: true, settings: next.settings };
  },

  profileUpdate: async (body: ProfileUpdateRequest): Promise<ProfileUpdateResponse> => {
    const me = readLocal<StoredMockMe>(MOCK_ME_KEY);
    if (!me) {
      // Guest: noop for now
      return { ok: true, profile: { characterId: 'default', skinId: 'default' } };
    }

    const next: StoredMockMe = {
      ...me,
      profile: {
        characterId: body.characterId ?? me.profile.characterId,
        skinId: body.skinId ?? me.profile.skinId,
      },
    };
    writeLocal(MOCK_ME_KEY, next);
    return { ok: true, profile: next.profile };
  },

  archiveOffer: async (): Promise<ArchiveOfferResponse> => {
    const plans: ArchiveOfferResponse['plans'] = [
      { id: 'monthly', priceId: 'dev_monthly', formattedPrice: '$2.99', currency: 'USD', purchaseType: 'subscription', interval: 'month' },
      { id: 'lifetime', priceId: 'dev_lifetime', formattedPrice: '$19.99', currency: 'USD', purchaseType: 'one_time' },
    ];
    return { plans, defaultPlanId: 'lifetime', grants: ['archive_access', 'ads_removed'] };
  },

  createCheckout: async (_body: CheckoutRequest): Promise<CheckoutResponse> => {
    return { alreadyOwned: true };
  },

  archiveDays: async (from: string, to: string): Promise<ArchiveDaysResponse> => {
    const today = getNewYorkDateString();
    const start = from < LAUNCH_DATE_NY ? LAUNCH_DATE_NY : from;
    const end = to;
    const days: ArchiveDaysResponse['days'] = [];

    let cursor = start <= end ? start : end;
    const max = start <= end ? end : start;

    while (cursor <= max) {
      days.push({ date: cursor, locked: cursor > today ? true : false });
      cursor = addDays(cursor, 1);
      if (days.length > 5000) break;
    }

    return { entitled: true, days };
  },

  archivePuzzle: async (date: string): Promise<ArchivePuzzleResponse> => {
    const today = getNewYorkDateString();
    if (date < LAUNCH_DATE_NY) {
      return Promise.reject(Object.assign(new Error('Out of range.'), { status: 404 }));
    }
    if (date > today) {
      return Promise.reject(Object.assign(new Error('Out of range.'), { status: 404 }));
    }

    const puzzleNumber = getPuzzleNumberFromNyDateString(date);
    return {
      date,
      puzzleNumber,
      seed: date,
      puzzle: buildDummyArchivePuzzle(date),
    };
  },
};
