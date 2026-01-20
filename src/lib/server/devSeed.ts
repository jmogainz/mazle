import { createHash } from 'crypto';
import { addDays } from '@/lib/date';
import { getNewYorkDateString, LAUNCH_DATE_NY } from '@/game/puzzleGenerator';
import { getAllCharacters } from '@/lib/characters';
import { getAllSkins } from '@/lib/skins';
import {
  DISPLAY_NAME_ADJECTIVES,
  DISPLAY_NAME_NOUNS,
  formatDisplayName,
} from './displayNames';
import { ensureDbSchema, getDbPool } from './db';
import { getLeaderboardRedis } from './redis';
import {
  encodeLeaderboardScore,
  leaderboardMemberIndexKey,
  leaderboardZsetKey,
  LB_NAMES_KEY,
  makeLeaderboardMember,
} from './leaderboard';

type SeedUser = {
  id: string;
  displayName: string;
  characterId: string;
  skinId: string;
};

type DailyResultRow = {
  userId: string;
  date: string;
  completed: boolean;
  timeMs: number | null;
  attemptsUsed: number | null;
};

type LeaderboardEntry = {
  user: SeedUser;
  timeMs: number;
  attemptsUsed: number;
  submittedAtMs: number;
  subjectKey: string;
  member: string;
  score: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __mazleDevSeeded: boolean | undefined;
  // eslint-disable-next-line no-var
  var __mazleDevSeeding: Promise<boolean> | undefined;
}

const DEFAULT_SEED_USERS = 1000;
const DEFAULT_SEED_DAYS = 30;
const DEFAULT_PLAY_RATE = 0.75;
const DEFAULT_COMPLETE_RATE = 0.85;

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

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function uuidFromSeed(seed: string): string {
  const hash = createHash('sha256').update(seed).digest();
  const bytes = Array.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = (value: number) => value.toString(16).padStart(2, '0');
  return [
    hex(bytes[0]!), hex(bytes[1]!), hex(bytes[2]!), hex(bytes[3]!),
    '-',
    hex(bytes[4]!), hex(bytes[5]!),
    '-',
    hex(bytes[6]!), hex(bytes[7]!),
    '-',
    hex(bytes[8]!), hex(bytes[9]!),
    '-',
    hex(bytes[10]!), hex(bytes[11]!), hex(bytes[12]!), hex(bytes[13]!), hex(bytes[14]!), hex(bytes[15]!),
  ].join('');
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list;
}

function buildUniqueDisplayNames(count: number, rand: () => number): string[] {
  const combosSet = new Set<string>();
  for (const adjective of DISPLAY_NAME_ADJECTIVES) {
    for (const noun of DISPLAY_NAME_NOUNS) {
      for (let num = 10; num <= 99; num += 1) {
        combosSet.add(formatDisplayName(adjective, noun, num));
      }
    }
  }

  const shuffled = shuffle([...combosSet], rand);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function readSeedConfig() {
  const users = clampInt(Number(process.env.DEV_SEED_USERS ?? DEFAULT_SEED_USERS), 10, 5000);
  const days = clampInt(Number(process.env.DEV_SEED_DAYS ?? DEFAULT_SEED_DAYS), 1, 120);
  const playRate = clampFloat(Number(process.env.DEV_SEED_PLAY_RATE ?? DEFAULT_PLAY_RATE), 0.1, 1);
  const completeRate = clampFloat(Number(process.env.DEV_SEED_COMPLETE_RATE ?? DEFAULT_COMPLETE_RATE), 0.1, 1);
  return { users, days, playRate, completeRate };
}

function buildSeedUsers(count: number): SeedUser[] {
  const characters = getAllCharacters();
  const skins = getAllSkins();
  const nameRand = seededRandom(hashString('dev-seed-names') || 1);
  const names = buildUniqueDisplayNames(count, nameRand);

  return Array.from({ length: count }, (_, idx) => {
    const index = idx + 1;
    const id = uuidFromSeed(`dev-seed-user-${index}`);
    const displayName = names[idx] ?? `Player${String(index).padStart(4, '0')}`;
    const rand = seededRandom(hashString(`dev-seed-profile:${id}`) || 1);
    const characterId = characters[Math.floor(rand() * characters.length)]?.id ?? 'default';
    const skinId = skins[Math.floor(rand() * skins.length)]?.id ?? 'default';
    return { id, displayName, characterId, skinId };
  });
}

function buildSeedDates(today: string, days: number): string[] {
  const dates: string[] = [];
  let cursor = today;
  for (let i = 0; i < days; i += 1) {
    if (cursor < LAUNCH_DATE_NY) break;
    dates.push(cursor);
    cursor = addDays(cursor, -1);
  }
  return dates;
}

function buildLeaderboardEntries(date: string, users: SeedUser[]): LeaderboardEntry[] {
  const rand = seededRandom(hashString(`lb:${date}`) || 1);
  const shuffled = shuffle(users, rand);
  const base = 35_000 + Math.floor(rand() * 15_000);
  // Full millisecond granularity for leaderboard times
  const times = shuffled.map(() => base + Math.floor(rand() * 180_000) + Math.floor(rand() * 1000));
  times.sort((a, b) => a - b);

  const submittedBase = Date.parse(`${date}T12:00:00.000Z`);

  return shuffled.map((user, idx) => {
    const attemptsUsed = 1 + Math.floor(rand() * 3);
    const timeMs = times[idx]!;
    const submittedAtMs = submittedBase + idx * 1000;
    const subjectKey = `user:${user.id}`;
    const member = makeLeaderboardMember(submittedAtMs, subjectKey);
    const score = encodeLeaderboardScore(timeMs, attemptsUsed);
    return { user, timeMs, attemptsUsed, submittedAtMs, subjectKey, member, score };
  });
}

function buildDailyResults(
  date: string,
  users: SeedUser[],
  playRate: number,
  completeRate: number,
  overrides?: Map<string, { timeMs: number; attemptsUsed: number }>
): DailyResultRow[] {
  const rows: DailyResultRow[] = [];
  for (const user of users) {
    const override = overrides?.get(user.id);
    if (override) {
      rows.push({
        userId: user.id,
        date,
        completed: true,
        timeMs: override.timeMs,
        attemptsUsed: override.attemptsUsed,
      });
      continue;
    }

    const rand = seededRandom(hashString(`result:${date}:${user.id}`) || 1);
    if (rand() > playRate) continue;
    const completed = rand() < completeRate;
    const attemptsUsed = completed ? 1 + Math.floor(rand() * 3) : null;
    // Full millisecond granularity: 30-210 seconds with ms precision
    const timeMs = completed ? 30_000 + Math.floor(rand() * 180_000) + Math.floor(rand() * 1000) : null;
    rows.push({ userId: user.id, date, completed, timeMs, attemptsUsed });
  }
  return rows;
}

function buildPodiumRows(date: string, results: DailyResultRow[], usersById: Map<string, SeedUser>) {
  const completed = results
    .filter((row) => row.completed && row.timeMs != null && row.attemptsUsed != null)
    .sort((a, b) => (a.timeMs! !== b.timeMs! ? a.timeMs! - b.timeMs! : (a.attemptsUsed! - b.attemptsUsed!)));

  return completed.slice(0, 3).map((row, idx) => {
    const user = usersById.get(row.userId);
    return {
      date,
      rank: idx + 1,
      user_id: row.userId,
      time_ms: row.timeMs,
      attempts_used: row.attemptsUsed,
      display_name_at_time: user?.displayName ?? 'Player',
      character_id_at_time: user?.characterId ?? 'default',
      skin_id_at_time: user?.skinId ?? 'default',
    };
  });
}

async function seedDatabase(
  users: SeedUser[],
  dates: string[],
  config: { playRate: number; completeRate: number },
  leaderboardEntries: LeaderboardEntry[]
): Promise<void> {
  await ensureDbSchema();
  const pool = getDbPool();

  const userPayload = JSON.stringify(users.map((u) => ({ id: u.id, display_name: u.displayName })));
  await pool.query(
    `insert into users (id, display_name)
     select r.id::uuid, r.display_name
     from jsonb_to_recordset($1::jsonb) as r(id text, display_name text)
     on conflict do nothing`,
    [userPayload]
  );

  const profilePayload = JSON.stringify(users.map((u) => ({ user_id: u.id, character_id: u.characterId, skin_id: u.skinId })));
  await pool.query(
    `insert into user_profiles (user_id, character_id, skin_id)
     select r.user_id::uuid, r.character_id, r.skin_id
     from jsonb_to_recordset($1::jsonb) as r(user_id text, character_id text, skin_id text)
     on conflict do nothing`,
    [profilePayload]
  );

  const settingsPayload = JSON.stringify(users.map((u) => ({
    user_id: u.id,
    theme: 'system',
    leaderboard_auto_submit: true,
  })));
  await pool.query(
    `insert into user_settings (user_id, theme, leaderboard_auto_submit)
     select r.user_id::uuid, r.theme, r.leaderboard_auto_submit
     from jsonb_to_recordset($1::jsonb) as r(user_id text, theme text, leaderboard_auto_submit boolean)
     on conflict do nothing`,
    [settingsPayload]
  );

  const usersById = new Map(users.map((u) => [u.id, u]));
  const today = dates[0];
  const todayOverrides = new Map(leaderboardEntries.map((entry) => [
    entry.user.id,
    { timeMs: entry.timeMs, attemptsUsed: entry.attemptsUsed },
  ]));

  const podiumRows: Array<{
    date: string;
    rank: number;
    user_id: string;
    time_ms: number | null;
    attempts_used: number | null;
    display_name_at_time: string;
    character_id_at_time: string;
    skin_id_at_time: string;
  }> = [];

  for (const date of dates) {
    const results = buildDailyResults(
      date,
      users,
      config.playRate,
      config.completeRate,
      date === today ? todayOverrides : undefined
    );

    if (results.length > 0) {
      const payload = JSON.stringify(results.map((row) => ({
        user_id: row.userId,
        date: row.date,
        completed: row.completed,
        time_ms: row.timeMs,
        attempts_used: row.attemptsUsed,
      })));
      await pool.query(
        `insert into daily_results (user_id, date, completed, time_ms, attempts_used)
         select r.user_id::uuid, r.date, r.completed, r.time_ms, r.attempts_used
         from jsonb_to_recordset($1::jsonb) as r(user_id text, date date, completed boolean, time_ms integer, attempts_used integer)
         on conflict do nothing`,
        [payload]
      );
    }

    podiumRows.push(...buildPodiumRows(date, results, usersById));
  }

  if (leaderboardEntries.length > 0) {
    const payload = JSON.stringify(leaderboardEntries.map((entry) => ({
      date: today,
      subject_type: 'user',
      subject_id: entry.user.id,
      time_ms: entry.timeMs,
      attempts_used: entry.attemptsUsed,
      submitted_at: new Date(entry.submittedAtMs).toISOString(),
    })));
    await pool.query(
      `insert into leaderboard_submissions (date, subject_type, subject_id, time_ms, attempts_used, submitted_at)
       select r.date, r.subject_type, r.subject_id::uuid, r.time_ms, r.attempts_used, r.submitted_at::timestamptz
       from jsonb_to_recordset($1::jsonb)
         as r(date date, subject_type text, subject_id text, time_ms integer, attempts_used integer, submitted_at timestamptz)
       on conflict do nothing`,
      [payload]
    );
  }

  if (podiumRows.length > 0) {
    const payload = JSON.stringify(podiumRows);
    await pool.query(
      `insert into leaderboard_podium
         (date, rank, user_id, time_ms, attempts_used, display_name_at_time, character_id_at_time, skin_id_at_time)
       select r.date, r.rank, r.user_id::uuid, r.time_ms, r.attempts_used, r.display_name_at_time, r.character_id_at_time, r.skin_id_at_time
       from jsonb_to_recordset($1::jsonb)
         as r(
           date date,
           rank integer,
           user_id text,
           time_ms integer,
           attempts_used integer,
           display_name_at_time text,
           character_id_at_time text,
           skin_id_at_time text
         )
       on conflict do nothing`,
      [payload]
    );
  }
}

async function seedLeaderboardRedis(date: string, entries: LeaderboardEntry[]): Promise<void> {
  const redis = getLeaderboardRedis();
  if (!redis || entries.length === 0) return;

  const zkey = leaderboardZsetKey(date);
  const indexKey = leaderboardMemberIndexKey(date);
  const names: Record<string, string> = {};
  const index: Record<string, string> = {};

  const pipeline = redis.multi();
  for (const entry of entries) {
    names[entry.subjectKey] = entry.user.displayName;
    index[entry.subjectKey] = entry.member;
    pipeline.zadd(zkey, { score: entry.score, member: entry.member });
  }

  pipeline.hset(indexKey, index);
  pipeline.hset(LB_NAMES_KEY, names);
  await pipeline.exec();
}

export async function ensureDevSystemSeeded(): Promise<boolean> {
  const env = process.env.NEXT_PUBLIC_ENV;
  if (!env || env === 'prod') return false;
  if (global.__mazleDevSeeded) return true;
  if (global.__mazleDevSeeding) return global.__mazleDevSeeding;

  const run = (async () => {
    const config = readSeedConfig();
    const today = getNewYorkDateString();
    const dates = buildSeedDates(today, config.days);
    const users = buildSeedUsers(config.users);
    const leaderboardEntries = buildLeaderboardEntries(today, users);

    const redis = getLeaderboardRedis();
    const lockKey = redis ? `dev:seeded:v2:${today}:${config.users}:${config.days}` : null;
    let locked = false;

    try {
      if (redis && lockKey) {
        const ok = await redis.set(lockKey, '1', { nx: true, ex: 60 * 60 * 12 });
        if (!ok) {
          global.__mazleDevSeeded = true;
          return true;
        }
        locked = true;
      }

      await seedDatabase(users, dates, { playRate: config.playRate, completeRate: config.completeRate }, leaderboardEntries);
      await seedLeaderboardRedis(today, leaderboardEntries);
      global.__mazleDevSeeded = true;
      return true;
    } catch (err) {
      if (locked && redis && lockKey) {
        try {
          await redis.del(lockKey);
        } catch {
          // ignore
        }
      }
      console.warn('[DevSeed] Failed to seed dev data', err);
      return false;
    }
  })();

  global.__mazleDevSeeding = run;
  const result = await run;
  global.__mazleDevSeeding = undefined;
  return result;
}
