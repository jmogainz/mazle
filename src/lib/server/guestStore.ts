import { getKvRedis } from './redis';

const GUEST_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

type GuestData = {
  displayName: string;
};

function guestKey(guestId: string): string {
  return `guest:${guestId}`;
}

function guestNameKey(nameLower: string): string {
  return `guest:name:${nameLower}`;
}

function guestMigrationKey(guestId: string): string {
  return `guest:migrated:${guestId}`;
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

export async function guestDisplayNameExists(name: string): Promise<boolean> {
  const existing = await getGuestDisplayNameOwner(name);
  return !!existing;
}

export async function getGuestDisplayNameOwner(name: string): Promise<string | null> {
  const redis = requireRedis();
  const key = guestNameKey(name.toLowerCase());
  const existing = await redis.get<string>(key);
  return existing ?? null;
}

export async function reserveGuestDisplayName(name: string, guestId: string): Promise<boolean> {
  const redis = requireRedis();
  const key = guestNameKey(name.toLowerCase());
  const result = await redis.set(key, guestId, { nx: true, ex: GUEST_TTL_SECONDS });
  return result === 'OK';
}

export async function refreshGuestDisplayNameReservation(name: string): Promise<void> {
  const redis = requireRedis();
  await redis.expire(guestNameKey(name.toLowerCase()), GUEST_TTL_SECONDS);
}

export async function saveGuestProfile(guestId: string, displayName: string): Promise<void> {
  const redis = requireRedis();
  const data: GuestData = { displayName };
  const ok = await redis.set(guestKey(guestId), data, { ex: GUEST_TTL_SECONDS });
  if (!ok) {
    throw new Error('Failed to persist guest profile.');
  }
  await refreshGuestDisplayNameReservation(displayName);
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

export async function getGuestMigrationOwner(guestId: string): Promise<string | null> {
  const redis = requireRedis();
  const existing = await redis.get<string>(guestMigrationKey(guestId));
  return existing ?? null;
}

export async function markGuestMigrated(guestId: string, userId: string): Promise<void> {
  const redis = requireRedis();
  await redis.set(guestMigrationKey(guestId), userId, { ex: GUEST_TTL_SECONDS });
}
