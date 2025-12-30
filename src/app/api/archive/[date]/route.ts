import { NextRequest, NextResponse } from 'next/server';
import { LAUNCH_DATE_NY, getNewYorkDateString, getPuzzleNumberFromNyDateString } from '@/game/puzzleGenerator';
import { resolveMeIdentity } from '@/lib/server/identity';
import { jsonError } from '@/lib/server/responses';
import { setGuestIdCookie } from '@/lib/server/cookies';
import { generatePuzzleFromBackend, getPuzzleFromKv, persistPuzzle } from '@/lib/server/puzzles';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isValidNyDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(request: NextRequest, context: { params: Promise<{ date: string }> }) {
  const { date } = await context.params;
  if (!isValidNyDateString(date)) {
    return jsonError(400, 'INVALID_DATE', 'Invalid date.');
  }

  if (date < LAUNCH_DATE_NY) {
    return jsonError(404, 'OUT_OF_RANGE', 'Date is before launch.');
  }

  const today = getNewYorkDateString();
  if (date > today) {
    return jsonError(404, 'OUT_OF_RANGE', 'Date is in the future.');
  }

  try {
    const me = await resolveMeIdentity(request);

    const isPast = date < today;
    if (isPast && !me.entitlements.archiveAccess) {
      const res = jsonError(403, 'ENTITLEMENT_REQUIRED', 'Archive access required.');
      if (me.setGuestCookie) {
        setGuestIdCookie(res, me.guestId);
      }
      return res;
    }

    const seed = date;
    const puzzleNumber = getPuzzleNumberFromNyDateString(date);

    let puzzle = await getPuzzleFromKv(date);
    if (!puzzle) {
      puzzle = await generatePuzzleFromBackend(seed);
      await persistPuzzle(date, seed, puzzle);
    }

    const res = NextResponse.json(
      {
        date,
        puzzleNumber,
        seed,
        puzzle,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
    if (me.setGuestCookie) {
      setGuestIdCookie(res, me.guestId);
    }
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load puzzle';
    return jsonError(500, 'ARCHIVE_PUZZLE_FAILED', message);
  }
}
