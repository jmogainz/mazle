import { getKvRedis } from './redis';

const GUEST_TTL_SECONDS = 30 * 24 * 60 * 60;

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

export async function getGuestProfile(guestId: string): Promise<{ guestId: string; displayName: string } | null> {
  const redis = requireRedis();
  const data = await redis.get<{ displayName?: string }>(guestKey(guestId));
  const displayName = data?.displayName;
  if (!displayName) return null;

  const nameKey = guestNameKey(displayName.toLowerCase());
  await Promise.allSettled([
    redis.expire(guestKey(guestId), GUEST_TTL_SECONDS),
    redis.expire(nameKey, GUEST_TTL_SECONDS),
  ]);

  return { guestId, displayName };
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
  const ok = await redis.set(guestKey(guestId), { displayName }, { ex: GUEST_TTL_SECONDS });
  if (!ok) {
    throw new Error('Failed to persist guest profile.');
  }
}
