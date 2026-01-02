import type { PuzzleData } from '@/game/types';
import { ensureDbSchema, getDbPool } from './db';
import { env } from './env';
import { getKvRedis } from './redis';

const GENERATOR_URL = env('GENERATOR_URL') || env('NEXT_PUBLIC_GENERATOR_URL') || 'http://localhost:8080';

export async function getPuzzleFromKv(date: string): Promise<PuzzleData | null> {
  const redis = getKvRedis();
  if (!redis) return null;
  return (await redis.get<PuzzleData>(`puzzle:${date}`)) ?? null;
}

export async function persistPuzzle(date: string, seed: string, puzzle: PuzzleData): Promise<void> {
  const redis = getKvRedis();
  if (redis) {
    await redis.set(`puzzle:${date}`, puzzle, { nx: true });
  }

  await ensureDbSchema();
  const pool = getDbPool();
  await pool.query(
    `insert into daily_puzzles (date, seed, puzzle_blob)
     values ($1::date, $2, $3::jsonb)
     on conflict do nothing`,
    [date, seed, JSON.stringify(puzzle)]
  );
}

export async function generatePuzzleFromBackend(seed: string): Promise<PuzzleData> {
  const url = `${GENERATOR_URL}/api/generate/${encodeURIComponent(seed)}?parallel=true`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`Generator error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  if (!data?.puzzle) {
    throw new Error('Generator response missing puzzle');
  }
  return data.puzzle as PuzzleData;
}
