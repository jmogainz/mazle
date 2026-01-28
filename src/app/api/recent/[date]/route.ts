import { NextRequest, NextResponse } from 'next/server';
import { LAUNCH_DATE_NY, getNewYorkDateString, getPuzzleNumberFromNyDateString } from '@/game/puzzleGenerator';
import { RECENT_PUZZLE_DAYS } from '@/constants';
import { addDays } from '@/lib/date';
import { jsonError } from '@/lib/server/responses';
import { getKvRedis } from '@/lib/server/redis';
import type { PuzzleData } from '@/game/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isValidNyDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(_request: NextRequest, context: { params: Promise<{ date: string }> }) {
  const { date } = await context.params;
  if (!isValidNyDateString(date)) {
    return jsonError(400, 'INVALID_DATE', 'Invalid date.');
  }

  if (date < LAUNCH_DATE_NY) {
    return jsonError(404, 'OUT_OF_RANGE', 'Date is before launch.');
  }

  const today = getNewYorkDateString();
  const recentStart = addDays(today, -RECENT_PUZZLE_DAYS);

  if (date >= today || date < recentStart) {
    return jsonError(404, 'OUT_OF_RANGE', 'Date is not in the recent window.');
  }

  const puzzleNumber = getPuzzleNumberFromNyDateString(date);
  const redis = getKvRedis();

  if (!redis) {
    return NextResponse.json(
      {
        puzzleNumber,
        date,
        seed: date,
        source: 'not_found',
        message: 'Cache not configured - use client-side generation',
      },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const cached = await redis.get<PuzzleData>(`puzzle:${date}`);
    if (cached) {
      return NextResponse.json(
        {
          puzzle: cached,
          puzzleNumber,
          date,
          seed: date,
          source: 'kv',
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    return NextResponse.json(
      {
        puzzleNumber,
        date,
        seed: date,
        source: 'not_found',
        message: 'Puzzle not in cache - use client-side generation',
      },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load puzzle';
    return jsonError(500, 'RECENT_PUZZLE_FAILED', message);
  }
}
