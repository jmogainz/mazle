import type { Redis } from '@upstash/redis';
import { ensureDevSystemSeeded } from './devSeed';

export async function ensureDevLeaderboardSeed(_redis: Redis, _date: string): Promise<void> {
  await ensureDevSystemSeeded();
}
