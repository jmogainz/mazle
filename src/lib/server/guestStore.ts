import { getKvRedis } from './redis';

const GUEST_TTL_SECONDS = 10 * 24 * 60 * 60; // 10 days

type GuestDailyResult = {
  date: string;
  completed: boolean;
  timeMs: number | null;
  attemptsUsed: number | null;
  attemptScores?: number[] | null;
  attempts?: Array<{
    moveCount: number;
    correctMoves?: number;
    deviationIndex?: number;
    failedAt?: { x: number; y: number } | null;
    path?: Array<{ x: number; y: number }>;
  }> | null;
  playedAt: number; // timestamp ms
};

type GuestData = {
  displayName: string;
  dailyResults: GuestDailyResult[];
};

function guestKey(guestId: string): string {
  return `guest:${guestId}`;
}

function guestNameKey(nameLower: string): string {
  return `guest:name:${nameLower}`;
}

function requireRedis() {
  const redis = getKvRedis();
  if (!redis) {
    throw new Error('KV Redis is not configured for guest profiles.');
  }
  return redis;
}

export async function getGuestData(guestId: string): Promise<GuestData | null> {
  const redis = requireRedis();
  const data = await redis.get<GuestData>(guestKey(guestId));
  if (!data?.displayName) return null;

  // Refresh TTL on access
  const nameKey = guestNameKey(data.displayName.toLowerCase());
  await Promise.allSettled([
    redis.expire(guestKey(guestId), GUEST_TTL_SECONDS),
    redis.expire(nameKey, GUEST_TTL_SECONDS),
  ]);

  return data;
}

export async function getGuestProfile(guestId: string): Promise<{ guestId: string; displayName: string } | null> {
  const data = await getGuestData(guestId);
  if (!data) return null;
  return { guestId, displayName: data.displayName };
}

export async function getGuestDailyResults(guestId: string): Promise<GuestDailyResult[]> {
  const data = await getGuestData(guestId);
  return data?.dailyResults ?? [];
}

export async function getGuestDailyResult(guestId: string, date: string): Promise<GuestDailyResult | null> {
  const results = await getGuestDailyResults(guestId);
  return results.find(r => r.date === date) ?? null;
}

export async function guestDisplayNameExists(name: string): Promise<boolean> {
  const redis = requireRedis();
  const key = guestNameKey(name.toLowerCase());
  const existing = await redis.get<string>(key);
  return !!existing;
}

export async function reserveGuestDisplayName(name: string, guestId: string): Promise<boolean> {
  const redis = requireRedis();
  const key = guestNameKey(name.toLowerCase());
  const result = await redis.set(key, guestId, { nx: true, ex: GUEST_TTL_SECONDS });
  return result === 'OK';
}

export async function saveGuestProfile(guestId: string, displayName: string): Promise<void> {
  const redis = requireRedis();
  const existing = await redis.get<GuestData>(guestKey(guestId));
  const data: GuestData = {
    displayName,
    dailyResults: existing?.dailyResults ?? [],
  };
  const ok = await redis.set(guestKey(guestId), data, { ex: GUEST_TTL_SECONDS });
  if (!ok) {
    throw new Error('Failed to persist guest profile.');
  }
}

export async function recordGuestDailyResult(
  guestId: string,
  result: {
    date: string;
    completed: boolean;
    timeMs: number | null;
    attemptsUsed: number | null;
    attemptScores?: number[] | null;
    attempts?: GuestDailyResult['attempts'];
  }
): Promise<{ created: boolean; result: GuestDailyResult }> {
  const redis = requireRedis();
  const existing = await redis.get<GuestData>(guestKey(guestId));
  
  if (!existing?.displayName) {
    throw new Error('Guest profile not found. Cannot record result.');
  }

  const dailyResults = existing.dailyResults ?? [];
  const existingResult = dailyResults.find(r => r.date === result.date);
  
  if (existingResult) {
    // Already recorded for this date, return existing
    return { created: false, result: existingResult };
  }

  const newResult: GuestDailyResult = {
    date: result.date,
    completed: result.completed,
    timeMs: result.timeMs,
    attemptsUsed: result.attemptsUsed,
    attemptScores: result.attemptScores ?? null,
    attempts: result.attempts ?? null,
    playedAt: Date.now(),
  };

  dailyResults.push(newResult);

  const data: GuestData = {
    displayName: existing.displayName,
    dailyResults,
  };

  await redis.set(guestKey(guestId), data, { ex: GUEST_TTL_SECONDS });

  // Also refresh the name reservation
  const nameKey = guestNameKey(existing.displayName.toLowerCase());
  await redis.expire(nameKey, GUEST_TTL_SECONDS);

  return { created: true, result: newResult };
}

export async function deleteGuestData(guestId: string): Promise<void> {
  const redis = requireRedis();
  const data = await redis.get<GuestData>(guestKey(guestId));
  
  await redis.del(guestKey(guestId));
  
  // Also delete the name reservation
  if (data?.displayName) {
    const nameKey = guestNameKey(data.displayName.toLowerCase());
    await redis.del(nameKey);
  }
}
