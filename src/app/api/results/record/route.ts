import { NextResponse } from 'next/server';
import { resolveMeIdentity } from '@/lib/server/identity';
import { setGuestIdCookie } from '@/lib/server/cookies';
import { jsonError, readJsonBody } from '@/lib/server/responses';
import { isTodayOrYesterdayNyDate, recordDailyResult, recordGuestDailyResult } from '@/lib/server/account';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = {
  date: string;
  completed: boolean;
  timeMs?: number;
  attemptsUsed?: number;
  attemptScores?: number[];
  attempts?: unknown;
};

function isValidNyDateString(value: string | null): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

type AttemptPayload = {
  moveCount: number;
  correctMoves?: number;
  deviationIndex?: number;
  failedAt?: { x: number; y: number } | null;
  path?: Array<{ x: number; y: number }>;
};

const MAX_ATTEMPTS = 3;
const MAX_PATH = 512;

function coerceNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function coercePosition(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { x?: unknown; y?: unknown };
  const x = coerceNumber(raw.x);
  const y = coerceNumber(raw.y);
  if (x == null || y == null) return null;
  return { x, y };
}

function resolveAttemptScore(attempt: AttemptPayload): number {
  if (typeof attempt.correctMoves === 'number' && Number.isFinite(attempt.correctMoves)) {
    return Math.max(0, Math.round(attempt.correctMoves));
  }
  if (typeof attempt.deviationIndex === 'number' && Number.isFinite(attempt.deviationIndex) && attempt.deviationIndex >= 0) {
    return Math.max(0, Math.round(attempt.deviationIndex - 1));
  }
  if (typeof attempt.moveCount === 'number' && Number.isFinite(attempt.moveCount)) {
    return Math.max(0, Math.round(attempt.moveCount));
  }
  return 0;
}

function coerceAttempts(value: unknown): AttemptPayload[] | null {
  if (!Array.isArray(value)) return null;
  const attempts: AttemptPayload[] = [];
  for (const raw of value.slice(0, MAX_ATTEMPTS)) {
    if (!raw || typeof raw !== 'object') continue;
    const attempt = raw as {
      moveCount?: unknown;
      correctMoves?: unknown;
      deviationIndex?: unknown;
      failedAt?: unknown;
      path?: unknown;
    };

    const moveCount = coerceNumber(attempt.moveCount) ?? 0;
    const correctMoves = coerceNumber(attempt.correctMoves);
    const deviationIndex = coerceNumber(attempt.deviationIndex);
    const failedAt = coercePosition(attempt.failedAt);

    let path: Array<{ x: number; y: number }> | undefined;
    if (Array.isArray(attempt.path)) {
      const cleaned: Array<{ x: number; y: number }> = [];
      for (const pos of attempt.path.slice(0, MAX_PATH)) {
        const coerced = coercePosition(pos);
        if (coerced) cleaned.push(coerced);
      }
      if (cleaned.length > 0) path = cleaned;
    }

    attempts.push({
      moveCount,
      correctMoves: correctMoves ?? undefined,
      deviationIndex: deviationIndex ?? undefined,
      failedAt: failedAt ?? undefined,
      path,
    });
  }
  return attempts.length > 0 ? attempts : null;
}

export async function POST(request: Request) {
  const me = await resolveMeIdentity(request);

  let body: Body;
  try {
    body = await readJsonBody<Body>(request);
  } catch {
    return jsonError(400, 'INVALID_REQUEST', 'Invalid JSON body.');
  }

  if (!isValidNyDateString(body.date)) {
    return jsonError(400, 'INVALID_DATE', 'Invalid date.');
  }
  if (typeof body.completed !== 'boolean') {
    return jsonError(400, 'INVALID_COMPLETED', 'completed must be a boolean.');
  }
  if (!isTodayOrYesterdayNyDate(body.date)) {
    return jsonError(400, 'DATE_NOT_ALLOWED', 'Only today or yesterday can be recorded.');
  }

  const completed = body.completed;
  const timeMs =
    typeof body.timeMs === 'number' && Number.isFinite(body.timeMs) && body.timeMs > 0
      ? Math.round(body.timeMs)
      : null;
  const attemptsUsed =
    typeof body.attemptsUsed === 'number' && Number.isFinite(body.attemptsUsed) && body.attemptsUsed >= 1 && body.attemptsUsed <= 3
      ? Math.round(body.attemptsUsed)
      : null;
  const attempts = coerceAttempts(body.attempts);
  const attemptScoresFromAttempts = attempts ? attempts.map(resolveAttemptScore) : null;
  const attemptScores = Array.isArray(body.attemptScores)
    ? body.attemptScores
        .map((score) => (typeof score === 'number' && Number.isFinite(score) ? Math.max(0, Math.round(score)) : null))
        .filter((score): score is number => score != null)
    : attemptScoresFromAttempts;

  if (completed && timeMs == null) {
    return jsonError(400, 'INVALID_TIME', 'timeMs is required for completed results.');
  }
  if (completed && attemptsUsed == null) {
    return jsonError(400, 'INVALID_ATTEMPTS', 'attemptsUsed must be 1..3 for completed results.');
  }
  if (!completed && body.attemptsUsed != null && attemptsUsed == null) {
    return jsonError(400, 'INVALID_ATTEMPTS', 'attemptsUsed must be 1..3 when provided.');
  }

  try {
    const recorded = me.userId
      ? await recordDailyResult(me.userId, { date: body.date, completed, timeMs, attemptsUsed, attemptScores, attempts })
      : await recordGuestDailyResult(me.guestId, { date: body.date, completed, timeMs, attemptsUsed, attemptScores, attempts });
    const res = NextResponse.json(
      {
        ok: true,
        created: recorded.created,
        result: recorded.result,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
    if (me.setGuestCookie) {
      setGuestIdCookie(res, me.guestId);
    }
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to record result';
    if (message === 'DATE_NOT_ALLOWED') {
      return jsonError(400, 'DATE_NOT_ALLOWED', 'Only today or yesterday can be recorded.');
    }
    return jsonError(500, 'RECORD_FAILED', message);
  }
}
