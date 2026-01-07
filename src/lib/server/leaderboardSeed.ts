import type { Redis } from '@upstash/redis';
import { isDevMode } from './env';
import {
  encodeLeaderboardScore,
  leaderboardMemberIndexKey,
  leaderboardZsetKey,
  LB_NAMES_KEY,
  makeLeaderboardMember,
} from './leaderboard';

const DEV_SEED_NAMES = [
  'FrostyLapras',
  'SwiftEevee',
  'MistyPikachu',
  'BraveSnorlax',
  'CalmPsyduck',
  'CleverAbra',
  'BoldOnix',
  'ChillJigglypuff',
  'SunnyVulpix',
  'GlowyMagikarp',
  'SlyZubat',
  'NimbleCubone',
];

type DevSeedEntry = {
  subjectKey: string;
  displayName: string;
  timeMs: number;
  attemptsUsed: number;
};

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

function buildDevSeedEntries(date: string): DevSeedEntry[] {
  const seed = hashString(date);
  const rand = seededRandom(seed || 1);
  const names = [...DEV_SEED_NAMES];
  for (let i = names.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }

  const base = 42000 + Math.floor(rand() * 6000);
  const entries: DevSeedEntry[] = [];
  for (let i = 0; i < names.length; i += 1) {
    const jitter = Math.floor(rand() * 800);
    const timeMs = base + i * 2500 + jitter;
    const attemptsUsed = Math.max(1, Math.min(3, 1 + Math.floor(rand() * 3)));
    entries.push({
      subjectKey: `seed:${String(i + 1).padStart(2, '0')}`,
      displayName: names[i],
      timeMs,
      attemptsUsed,
    });
  }
  return entries;
}

export async function ensureDevLeaderboardSeed(redis: Redis, date: string): Promise<void> {
  if (!isDevMode()) return;

  const zkey = leaderboardZsetKey(date);
  const existing = await redis.zrange<string[]>(zkey, 0, 0);
  if (existing.length > 0) return;

  const markerKey = `lb:seeded:v1:${date}`;
  const locked = await redis.set(markerKey, '1', { nx: true, ex: 60 * 60 * 24 * 3 });
  if (!locked) return;

  const entries = buildDevSeedEntries(date);
  if (entries.length === 0) return;

  const indexKey = leaderboardMemberIndexKey(date);
  const names: Record<string, string> = {};
  const index: Record<string, string> = {};
  const pipeline = redis.multi();
  const now = Date.now();

  entries.forEach((entry, idx) => {
    const submittedAtMs = now - (entries.length - idx) * 1000;
    const member = makeLeaderboardMember(submittedAtMs, entry.subjectKey);
    const score = encodeLeaderboardScore(entry.timeMs, entry.attemptsUsed);
    names[entry.subjectKey] = entry.displayName;
    index[entry.subjectKey] = member;
    pipeline.zadd(zkey, { score, member });
  });

  pipeline.hset(indexKey, index);
  pipeline.hset(LB_NAMES_KEY, names);
  await pipeline.exec();
}
