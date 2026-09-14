import type { PoolClient } from 'pg';
import {
  ADVENTURE_CATALOG_VERSION,
  ADVENTURE_LEVEL_COUNT,
  getAdventureLevel,
  starsForMoves,
} from '@/adventure';
import type {
  AdventureActiveAttempt,
  AdventureEnergy,
  AdventureLevelProgress,
  AdventureProgress,
  AdventureStateResponse,
} from '@/lib/adventureApi';
import { ensureDbSchema, getDbPool } from './db';
import type { MeIdentity } from './identity';
import {
  ADVENTURE_ATTEMPT_STALE_MS,
  ADVENTURE_BASE_MAX_HEARTS,
  ADVENTURE_FREE_LEVEL_MAX,
  ADVENTURE_HEART_REGEN_MS,
  ADVENTURE_PLUS_MAX_HEARTS,
  regenerateAdventureEnergy,
} from './adventureEnergy';
import {
  isValidAdventureAttemptId,
  isValidAdventureIdempotencyKey,
} from './adventureRequest';

export {
  ADVENTURE_ATTEMPT_STALE_MS,
  ADVENTURE_BASE_MAX_HEARTS,
  ADVENTURE_FREE_LEVEL_MAX,
  ADVENTURE_HEART_REGEN_MS,
  ADVENTURE_PLUS_MAX_HEARTS,
} from './adventureEnergy';
export { isValidAdventureAttemptId, isValidAdventureIdempotencyKey } from './adventureRequest';

type AdventurePlayerRow = {
  id: string;
  user_id: string | null;
  guest_id: string | null;
  claimed_by_user_id: string | null;
  hearts: number;
  max_hearts: number;
  next_heart_at: Date | string | null;
  refill_tickets: number;
  last_daily_refill_on: Date | string | null;
};

type AdventureAttemptRow = {
  id: string;
  player_id: string;
  level_id: number;
  catalog_version: string;
  start_idempotency_key: string;
  finish_idempotency_key: string | null;
  outcome: 'active' | 'won' | 'failed' | 'abandoned';
  energy_reserved: boolean;
  moves: number | null;
  time_ms: number | null;
  stars: 1 | 2 | 3 | null;
  started_at: Date | string;
  finished_at: Date | string | null;
};

type ProgressRow = {
  level_id: number;
  stars: 1 | 2 | 3;
  best_moves: number;
  best_time_ms: number;
  completed_at: Date | string;
};

export class AdventureError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    message: string,
    status = 400
  ) {
    super(message);
    this.name = 'AdventureError';
    this.code = code;
    this.status = status;
  }
}

function asDate(value: Date | string | null): Date | null {
  if (value == null) return null;
  const result = value instanceof Date ? value : new Date(value);
  return Number.isNaN(result.getTime()) ? null : result;
}

function iso(value: Date | string): string {
  return (asDate(value) ?? new Date(0)).toISOString();
}

function utcDateString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function dateOnlyString(value: Date | string | null): string | null {
  const date = asDate(value);
  if (date) return date.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

export function assertAdventureCatalogVersion(value: unknown): asserts value is string {
  if (value !== ADVENTURE_CATALOG_VERSION) {
    throw new AdventureError('CATALOG_OUTDATED', 'Adventure content has changed. Refresh the level catalog and try again.', 409);
  }
}

function desiredMaxHearts(hasPlus: boolean): number {
  return hasPlus ? ADVENTURE_PLUS_MAX_HEARTS : ADVENTURE_BASE_MAX_HEARTS;
}

async function userHasPlus(client: PoolClient, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const result = await client.query(
    `select 1
       from entitlements
      where user_id=$1
        and key in ('archive_access', 'ads_removed', 'adventure_plus')
        and (expires_at is null or expires_at > now())
      limit 1`,
    [userId]
  );
  return (result.rowCount ?? 0) > 0;
}

async function mergeGuestProgress(
  client: PoolClient,
  userPlayerId: string,
  guestId: string,
  userId: string
): Promise<boolean> {
  await client.query(
    `insert into adventure_players (guest_id)
     values ($1)
     on conflict (guest_id) do nothing`,
    [guestId]
  );
  const guest = await client.query<{ id: string; claimed_by_user_id: string | null }>(
    'select id, claimed_by_user_id from adventure_players where guest_id=$1 for update',
    [guestId]
  );
  const guestPlayer = guest.rows[0];
  if (!guestPlayer) return false;
  if (guestPlayer.claimed_by_user_id && guestPlayer.claimed_by_user_id !== userId) return false;
  if (!guestPlayer.claimed_by_user_id) {
    await client.query(
      `update adventure_players
          set claimed_by_user_id=$2, updated_at=now()
        where id=$1 and claimed_by_user_id is null`,
      [guestPlayer.id, userId]
    );
  }

  await client.query(
    `insert into adventure_level_progress
       (player_id, level_id, stars, best_moves, best_time_ms, catalog_version, completed_at, updated_at)
     select $1, level_id, stars, best_moves, best_time_ms, catalog_version, completed_at, now()
       from adventure_level_progress
      where player_id=$2
     on conflict (player_id, level_id) do update
       set stars=greatest(adventure_level_progress.stars, excluded.stars),
           best_moves=least(adventure_level_progress.best_moves, excluded.best_moves),
           best_time_ms=least(adventure_level_progress.best_time_ms, excluded.best_time_ms),
           completed_at=least(adventure_level_progress.completed_at, excluded.completed_at),
           updated_at=now()`,
    [userPlayerId, guestPlayer.id]
  );
  return true;
}

async function ensureAndLockPlayer(
  client: PoolClient,
  me: MeIdentity,
  now: Date
): Promise<{ player: AdventurePlayerRow; hasPlus: boolean; guestImportAllowed: boolean }> {
  if (me.userId) {
    await client.query(
      `insert into adventure_players (user_id)
       values ($1)
       on conflict (user_id) do nothing`,
      [me.userId]
    );
  } else {
    await client.query(
      `insert into adventure_players (guest_id)
       values ($1)
       on conflict (guest_id) do nothing`,
      [me.guestId]
    );
  }

  const result = await client.query<AdventurePlayerRow>(
    me.userId
      ? 'select * from adventure_players where user_id=$1 for update'
      : 'select * from adventure_players where guest_id=$1 for update',
    [me.userId ?? me.guestId]
  );
  const player = result.rows[0];
  if (!player) throw new AdventureError('PLAYER_NOT_FOUND', 'Adventure player could not be created.', 500);

  const guestImportAllowed = me.userId
    ? await mergeGuestProgress(client, player.id, me.guestId, me.userId)
    : true;

  const hasPlus = await userHasPlus(client, me.userId);
  const nextMax = desiredMaxHearts(hasPlus);
  const previousMax = Math.max(1, Number(player.max_hearts));
  let hearts = Number(player.hearts);
  if (nextMax > previousMax) hearts = Math.min(nextMax, hearts + (nextMax - previousMax));
  if (nextMax < previousMax) hearts = Math.min(nextMax, hearts);

  const regenerated = regenerateAdventureEnergy(hearts, nextMax, asDate(player.next_heart_at), now);
  player.hearts = regenerated.hearts;
  player.max_hearts = nextMax;
  player.next_heart_at = regenerated.nextHeartAt;

  await client.query(
    `update adventure_players
        set hearts=$2,
            max_hearts=$3,
            next_heart_at=$4,
            updated_at=now()
      where id=$1`,
    [player.id, player.hearts, player.max_hearts, player.next_heart_at]
  );
  return { player, hasPlus, guestImportAllowed };
}

async function refundAdventureReservation(client: PoolClient, player: AdventurePlayerRow): Promise<void> {
  player.hearts = Math.min(Number(player.max_hearts), Number(player.hearts) + 1);
  if (player.hearts >= Number(player.max_hearts)) player.next_heart_at = null;
  await client.query(
    `update adventure_players
        set hearts=$2, next_heart_at=$3, updated_at=now()
      where id=$1`,
    [player.id, player.hearts, player.next_heart_at]
  );
}

async function finalizeStaleAttempt(client: PoolClient, player: AdventurePlayerRow, now: Date): Promise<void> {
  const staleBefore = new Date(now.getTime() - ADVENTURE_ATTEMPT_STALE_MS);
  const finalized = await client.query<{ energy_reserved: boolean }>(
    `update adventure_attempts
        set outcome='abandoned', finished_at=$3
      where player_id=$1 and outcome='active' and started_at <= $2
      returning energy_reserved`,
    [player.id, staleBefore, now]
  );
  if (finalized.rows.some((row) => row.energy_reserved)) {
    await refundAdventureReservation(client, player);
  }
}

async function getActiveAttempt(client: PoolClient, playerId: string): Promise<AdventureAttemptRow | null> {
  const result = await client.query<AdventureAttemptRow>(
    `select * from adventure_attempts
      where player_id=$1 and outcome='active'
      limit 1
      for update`,
    [playerId]
  );
  return result.rows[0] ?? null;
}

function serializeAttempt(row: AdventureAttemptRow): AdventureActiveAttempt {
  return {
    attemptId: row.id,
    levelId: Number(row.level_id),
    startedAt: iso(row.started_at),
    energyReserved: row.energy_reserved,
  };
}

function serializeEnergy(
  player: AdventurePlayerRow,
  hasPlus: boolean,
  activeAttempt: AdventureAttemptRow | null,
  now: Date
): AdventureEnergy {
  const activeReservation = activeAttempt?.energy_reserved ? 1 : 0;
  const hearts = Math.min(Number(player.max_hearts), Number(player.hearts) + activeReservation);
  return {
    hearts,
    maxHearts: Number(player.max_hearts),
    nextHeartAt: hearts >= Number(player.max_hearts) ? null : asDate(player.next_heart_at)?.toISOString() ?? null,
    refillTickets: Number(player.refill_tickets),
    dailyRefillAvailable: hasPlus && dateOnlyString(player.last_daily_refill_on) !== utcDateString(now),
    serverNow: now.toISOString(),
  };
}

function serializeLevel(row: ProgressRow): AdventureLevelProgress {
  return {
    levelId: Number(row.level_id),
    stars: Number(row.stars) as 1 | 2 | 3,
    bestMoves: Number(row.best_moves),
    bestTimeMs: Number(row.best_time_ms),
    completedAt: iso(row.completed_at),
  };
}

async function loadProgress(client: PoolClient, playerId: string): Promise<AdventureProgress> {
  const result = await client.query<ProgressRow>(
    `select level_id, stars, best_moves, best_time_ms, completed_at
       from adventure_level_progress
      where player_id=$1
      order by level_id`,
    [playerId]
  );
  const levels = result.rows.map(serializeLevel);
  const completeIds = new Set(levels.map((level) => level.levelId));
  let firstIncomplete = 1;
  while (firstIncomplete <= ADVENTURE_LEVEL_COUNT && completeIds.has(firstIncomplete)) firstIncomplete += 1;
  const completedAll = firstIncomplete > ADVENTURE_LEVEL_COUNT;
  const currentLevel = completedAll ? ADVENTURE_LEVEL_COUNT : firstIncomplete;
  return {
    catalogVersion: ADVENTURE_CATALOG_VERSION,
    currentLevel,
    unlockedLevel: currentLevel,
    completedLevels: levels.length,
    totalStars: levels.reduce((sum, level) => sum + level.stars, 0),
    completedAll,
    levels,
  };
}

async function stateWithinTransaction(
  client: PoolClient,
  me: MeIdentity,
  now: Date
): Promise<AdventureStateResponse> {
  const { player, hasPlus, guestImportAllowed } = await ensureAndLockPlayer(client, me, now);
  await finalizeStaleAttempt(client, player, now);
  const activeAttempt = await getActiveAttempt(client, player.id);
  const progress = await loadProgress(client, player.id);
  return {
    ok: true,
    storageScope: me.userId ? `user:${me.userId}` : 'guest',
    guestImportAllowed,
    progress,
    energy: serializeEnergy(player, hasPlus, activeAttempt, now),
    activeAttempt: activeAttempt ? serializeAttempt(activeAttempt) : null,
    accountRequiredForPurchases: true,
  };
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureDbSchema();
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getAdventureState(me: MeIdentity): Promise<AdventureStateResponse> {
  return inTransaction((client) => stateWithinTransaction(client, me, new Date()));
}

export async function startAdventureAttempt(
  me: MeIdentity,
  input: { levelId: number; catalogVersion: string; idempotencyKey: string }
): Promise<{ ok: true; attempt: AdventureActiveAttempt; energy: AdventureEnergy }> {
  assertAdventureCatalogVersion(input.catalogVersion);
  if (!Number.isInteger(input.levelId) || !getAdventureLevel(input.levelId)) {
    throw new AdventureError('LEVEL_NOT_FOUND', 'Adventure level not found.', 404);
  }
  if (!isValidAdventureIdempotencyKey(input.idempotencyKey)) {
    throw new AdventureError('INVALID_IDEMPOTENCY_KEY', 'A valid idempotency key is required.');
  }

  return inTransaction(async (client) => {
    const now = new Date();
    const { player, hasPlus } = await ensureAndLockPlayer(client, me, now);
    await finalizeStaleAttempt(client, player, now);

    const duplicate = await client.query<AdventureAttemptRow>(
      'select * from adventure_attempts where player_id=$1 and start_idempotency_key=$2 limit 1',
      [player.id, input.idempotencyKey]
    );
    if (duplicate.rows[0]) {
      if (duplicate.rows[0].outcome !== 'active') {
        throw new AdventureError('ATTEMPT_ALREADY_FINISHED', 'This attempt has already finished.', 409);
      }
      return {
        ok: true as const,
        attempt: serializeAttempt(duplicate.rows[0]),
        energy: serializeEnergy(player, hasPlus, duplicate.rows[0], now),
      };
    }

    const progress = await loadProgress(client, player.id);
    if (input.levelId > progress.unlockedLevel) {
      throw new AdventureError('LEVEL_LOCKED', 'Complete the previous level first.', 409);
    }

    const active = await getActiveAttempt(client, player.id);
    if (active?.level_id === input.levelId) {
      return {
        ok: true as const,
        attempt: serializeAttempt(active),
        energy: serializeEnergy(player, hasPlus, active, now),
      };
    }
    if (active) {
      const finalized = await client.query<{ energy_reserved: boolean }>(
        `update adventure_attempts
            set outcome='abandoned', finished_at=$2
          where id=$1 and outcome='active'
          returning energy_reserved`,
        [active.id, now]
      );
      if (finalized.rows[0]?.energy_reserved) await refundAdventureReservation(client, player);
    }

    const energyReserved = input.levelId > ADVENTURE_FREE_LEVEL_MAX;
    if (energyReserved) {
      if (Number(player.hearts) <= 0) {
        throw new AdventureError('OUT_OF_ENERGY', 'No hearts available. Wait for one to recharge or use a refill.', 429);
      }
      player.hearts = Number(player.hearts) - 1;
      if (!asDate(player.next_heart_at)) {
        player.next_heart_at = new Date(now.getTime() + ADVENTURE_HEART_REGEN_MS);
      }
      await client.query(
        `update adventure_players
            set hearts=$2, next_heart_at=$3, updated_at=now()
          where id=$1`,
        [player.id, player.hearts, player.next_heart_at]
      );
    }

    const inserted = await client.query<AdventureAttemptRow>(
      `insert into adventure_attempts
         (player_id, level_id, catalog_version, start_idempotency_key, energy_reserved)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [player.id, input.levelId, input.catalogVersion, input.idempotencyKey, energyReserved]
    );
    const attempt = inserted.rows[0];
    return {
      ok: true as const,
      attempt: serializeAttempt(attempt),
      energy: serializeEnergy(player, hasPlus, attempt, now),
    };
  });
}

async function upsertLevelProgress(
  client: PoolClient,
  input: {
    playerId: string;
    levelId: number;
    stars: 1 | 2 | 3;
    moves: number;
    timeMs: number;
    catalogVersion: string;
    completedAt: Date;
  }
): Promise<AdventureLevelProgress> {
  const result = await client.query<ProgressRow>(
    `insert into adventure_level_progress
       (player_id, level_id, stars, best_moves, best_time_ms, catalog_version, completed_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (player_id, level_id) do update
       set stars=greatest(adventure_level_progress.stars, excluded.stars),
           best_moves=least(adventure_level_progress.best_moves, excluded.best_moves),
           best_time_ms=least(adventure_level_progress.best_time_ms, excluded.best_time_ms),
           completed_at=least(adventure_level_progress.completed_at, excluded.completed_at),
           catalog_version=case
             when excluded.stars > adventure_level_progress.stars then excluded.catalog_version
             else adventure_level_progress.catalog_version
           end,
           updated_at=now()
     returning level_id, stars, best_moves, best_time_ms, completed_at`,
    [input.playerId, input.levelId, input.stars, input.moves, input.timeMs, input.catalogVersion, input.completedAt]
  );
  return serializeLevel(result.rows[0]);
}

export async function completeAdventureAttempt(
  me: MeIdentity,
  input: { attemptId: string; moves: number; timeMs: number; catalogVersion: string; idempotencyKey: string }
): Promise<{ ok: true; level: AdventureLevelProgress; progress: AdventureProgress; energy: AdventureEnergy }> {
  assertAdventureCatalogVersion(input.catalogVersion);
  if (!isValidAdventureAttemptId(input.attemptId)) {
    throw new AdventureError('INVALID_ATTEMPT', 'A valid attempt ID is required.');
  }
  if (!isValidAdventureIdempotencyKey(input.idempotencyKey)) {
    throw new AdventureError('INVALID_IDEMPOTENCY_KEY', 'A valid idempotency key is required.');
  }
  if (!Number.isInteger(input.moves) || input.moves <= 0 || input.moves > 10_000) {
    throw new AdventureError('INVALID_MOVES', 'moves must be a positive integer.');
  }
  if (!Number.isInteger(input.timeMs) || input.timeMs <= 0 || input.timeMs > 24 * 60 * 60 * 1000) {
    throw new AdventureError('INVALID_TIME', 'timeMs must be a positive integer.');
  }

  return inTransaction(async (client) => {
    const now = new Date();
    const { player, hasPlus } = await ensureAndLockPlayer(client, me, now);
    const result = await client.query<AdventureAttemptRow>(
      'select * from adventure_attempts where id=$1 and player_id=$2 for update',
      [input.attemptId, player.id]
    );
    const attempt = result.rows[0];
    if (!attempt) throw new AdventureError('ATTEMPT_NOT_FOUND', 'Adventure attempt not found.', 404);
    if (attempt.catalog_version !== input.catalogVersion) {
      throw new AdventureError('ATTEMPT_CATALOG_MISMATCH', 'This attempt belongs to a different catalog version.', 409);
    }

    if (attempt.outcome !== 'active' && attempt.outcome !== 'won') {
      throw new AdventureError('ATTEMPT_ALREADY_FINISHED', 'This attempt has already failed.', 409);
    }

    const levelDefinition = getAdventureLevel(Number(attempt.level_id));
    if (!levelDefinition) throw new AdventureError('LEVEL_NOT_FOUND', 'Adventure level not found.', 404);
    const resultMoves = attempt.outcome === 'won' ? attempt.moves : input.moves;
    const resultTimeMs = attempt.outcome === 'won' ? attempt.time_ms : input.timeMs;
    const computedStars = attempt.outcome === 'won'
      ? attempt.stars ?? 0
      : starsForMoves(levelDefinition, input.moves, true);
    if (attempt.outcome === 'won' && attempt.finish_idempotency_key !== input.idempotencyKey) {
      throw new AdventureError('ATTEMPT_ALREADY_FINISHED', 'This attempt has already been completed.', 409);
    }
    if (resultMoves == null || resultTimeMs == null) {
      throw new AdventureError('ATTEMPT_RESULT_INCOMPLETE', 'The stored attempt result is incomplete.', 500);
    }
    if (computedStars < 1) {
      throw new AdventureError('LEVEL_NOT_COMPLETED', 'The reported move count does not complete this level.', 422);
    }
    const stars = computedStars as 1 | 2 | 3;

    if (attempt.outcome === 'active') {
      const keyOwner = await client.query<{ id: string }>(
        `select id from adventure_attempts
          where player_id=$1 and finish_idempotency_key=$2 and id<>$3
          limit 1`,
        [player.id, input.idempotencyKey, attempt.id]
      );
      if (keyOwner.rowCount) {
        throw new AdventureError('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used.', 409);
      }

      await client.query(
        `update adventure_attempts
            set outcome='won', finish_idempotency_key=$2, moves=$3, time_ms=$4, stars=$5, finished_at=$6
          where id=$1 and outcome='active'`,
        [attempt.id, input.idempotencyKey, input.moves, input.timeMs, stars, now]
      );

      if (attempt.energy_reserved) {
        player.hearts = Math.min(Number(player.max_hearts), Number(player.hearts) + 1);
        if (player.hearts >= Number(player.max_hearts)) player.next_heart_at = null;
        await client.query(
          `update adventure_players
              set hearts=$2, next_heart_at=$3, updated_at=now()
            where id=$1`,
          [player.id, player.hearts, player.next_heart_at]
        );
      }
    }

    const level = await upsertLevelProgress(client, {
      playerId: player.id,
      levelId: Number(attempt.level_id),
      stars,
      moves: resultMoves,
      timeMs: resultTimeMs,
      catalogVersion: input.catalogVersion,
      completedAt: attempt.outcome === 'won' ? asDate(attempt.finished_at) ?? now : now,
    });
    const progress = await loadProgress(client, player.id);
    return {
      ok: true as const,
      level,
      progress,
      energy: serializeEnergy(player, hasPlus, null, now),
    };
  });
}

export async function failAdventureAttempt(
  me: MeIdentity,
  input: {
    attemptId: string;
    moves: number;
    timeMs: number;
    outcome: 'failed' | 'abandoned';
    idempotencyKey: string;
  }
): Promise<{ ok: true; energy: AdventureEnergy }> {
  if (!isValidAdventureAttemptId(input.attemptId)) {
    throw new AdventureError('INVALID_ATTEMPT', 'A valid attempt ID is required.');
  }
  if (!isValidAdventureIdempotencyKey(input.idempotencyKey)) {
    throw new AdventureError('INVALID_IDEMPOTENCY_KEY', 'A valid idempotency key is required.');
  }
  if (!Number.isInteger(input.moves) || input.moves < 0 || input.moves > 10_000) {
    throw new AdventureError('INVALID_MOVES', 'moves must be a non-negative integer.');
  }
  if (!Number.isInteger(input.timeMs) || input.timeMs <= 0 || input.timeMs > 24 * 60 * 60 * 1000) {
    throw new AdventureError('INVALID_TIME', 'timeMs must be a positive integer.');
  }
  if (input.outcome !== 'failed' && input.outcome !== 'abandoned') {
    throw new AdventureError('INVALID_OUTCOME', 'outcome must be failed or abandoned.');
  }

  return inTransaction(async (client) => {
    const now = new Date();
    const { player, hasPlus } = await ensureAndLockPlayer(client, me, now);
    const result = await client.query<AdventureAttemptRow>(
      'select * from adventure_attempts where id=$1 and player_id=$2 for update',
      [input.attemptId, player.id]
    );
    const attempt = result.rows[0];
    if (!attempt) throw new AdventureError('ATTEMPT_NOT_FOUND', 'Adventure attempt not found.', 404);
    if (attempt.outcome === 'won') {
      throw new AdventureError('ATTEMPT_ALREADY_COMPLETED', 'This attempt already completed the level.', 409);
    }
    if (attempt.outcome !== 'active') {
      return { ok: true as const, energy: serializeEnergy(player, hasPlus, null, now) };
    }

    const keyOwner = await client.query<{ id: string }>(
      `select id from adventure_attempts
        where player_id=$1 and finish_idempotency_key=$2 and id<>$3
        limit 1`,
      [player.id, input.idempotencyKey, attempt.id]
    );
    if (keyOwner.rowCount) {
      throw new AdventureError('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used.', 409);
    }

    await client.query(
      `update adventure_attempts
          set outcome=$2, finish_idempotency_key=$3, moves=$4, time_ms=$5, finished_at=$6
        where id=$1 and outcome='active'`,
      [attempt.id, input.outcome, input.idempotencyKey, input.moves, input.timeMs, now]
    );

    // Leaving before the first move is free; all real failures consume the reservation.
    if (attempt.energy_reserved && input.outcome === 'abandoned' && input.moves === 0) {
      player.hearts = Math.min(Number(player.max_hearts), Number(player.hearts) + 1);
      if (player.hearts >= Number(player.max_hearts)) player.next_heart_at = null;
      await client.query(
        `update adventure_players
            set hearts=$2, next_heart_at=$3, updated_at=now()
          where id=$1`,
        [player.id, player.hearts, player.next_heart_at]
      );
    }

    return { ok: true as const, energy: serializeEnergy(player, hasPlus, null, now) };
  });
}

function coerceCompletionDate(value: string | undefined, now: Date): Date {
  if (!value) return now;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return now;
  if (parsed.getTime() > now.getTime() + 5 * 60 * 1000) return now;
  return parsed;
}

export async function syncAdventureProgress(
  me: MeIdentity,
  input: {
    catalogVersion: string;
    idempotencyKey: string;
    levels: Array<{ levelId: number; bestMoves: number; bestTimeMs: number; completedAt?: string }>;
  }
): Promise<AdventureStateResponse> {
  assertAdventureCatalogVersion(input.catalogVersion);
  if (!isValidAdventureIdempotencyKey(input.idempotencyKey)) {
    throw new AdventureError('INVALID_IDEMPOTENCY_KEY', 'A valid idempotency key is required.');
  }
  if (!Array.isArray(input.levels) || input.levels.length > ADVENTURE_LEVEL_COUNT) {
    throw new AdventureError('INVALID_PROGRESS', `At most ${ADVENTURE_LEVEL_COUNT} progress rows may be synchronized.`);
  }
  const uniqueIds = new Set<number>();
  for (const row of input.levels) {
    if (!Number.isInteger(row?.levelId) || !getAdventureLevel(row.levelId) || uniqueIds.has(row.levelId)) {
      throw new AdventureError('INVALID_PROGRESS', 'Progress contains an invalid or duplicate level.');
    }
    if (!Number.isInteger(row.bestMoves) || row.bestMoves <= 0 || row.bestMoves > 10_000) {
      throw new AdventureError('INVALID_PROGRESS', 'Progress contains an invalid move count.');
    }
    if (!Number.isInteger(row.bestTimeMs) || row.bestTimeMs <= 0 || row.bestTimeMs > 24 * 60 * 60 * 1000) {
      throw new AdventureError('INVALID_PROGRESS', 'Progress contains an invalid solve time.');
    }
    const level = getAdventureLevel(row.levelId)!;
    if (starsForMoves(level, row.bestMoves, true) < 1) {
      throw new AdventureError('INVALID_PROGRESS', `Level ${row.levelId} exceeds its move limit.`);
    }
    uniqueIds.add(row.levelId);
  }

  return inTransaction(async (client) => {
    const now = new Date();
    const { player } = await ensureAndLockPlayer(client, me, now);
    const existing = await client.query<{ level_id: number }>(
      'select level_id from adventure_level_progress where player_id=$1',
      [player.id]
    );
    const completedIds = new Set(existing.rows.map((row) => Number(row.level_id)));
    for (const levelId of uniqueIds) completedIds.add(levelId);
    for (const levelId of uniqueIds) {
      for (let prerequisite = 1; prerequisite < levelId; prerequisite += 1) {
        if (!completedIds.has(prerequisite)) {
          throw new AdventureError('LEVEL_LOCKED', `Level ${levelId} cannot be imported before level ${prerequisite}.`, 409);
        }
      }
    }

    for (const row of [...input.levels].sort((a, b) => a.levelId - b.levelId)) {
      const level = getAdventureLevel(row.levelId)!;
      const stars = starsForMoves(level, row.bestMoves, true) as 1 | 2 | 3;
      await upsertLevelProgress(client, {
        playerId: player.id,
        levelId: row.levelId,
        stars,
        moves: row.bestMoves,
        timeMs: row.bestTimeMs,
        catalogVersion: input.catalogVersion,
        completedAt: coerceCompletionDate(row.completedAt, now),
      });
    }

    return stateWithinTransaction(client, me, now);
  });
}

export async function consumeAdventureRefill(
  me: MeIdentity,
  input: { source: 'daily' | 'ticket'; idempotencyKey: string }
): Promise<{ ok: true; energy: AdventureEnergy }> {
  if (!isValidAdventureIdempotencyKey(input.idempotencyKey)) {
    throw new AdventureError('INVALID_IDEMPOTENCY_KEY', 'A valid idempotency key is required.');
  }
  if (input.source !== 'daily' && input.source !== 'ticket') {
    throw new AdventureError('INVALID_REFILL_SOURCE', 'Refill source must be daily or ticket.');
  }

  return inTransaction(async (client) => {
    const now = new Date();
    const { player, hasPlus } = await ensureAndLockPlayer(client, me, now);
    await finalizeStaleAttempt(client, player, now);
    const active = await getActiveAttempt(client, player.id);
    const duplicate = await client.query(
      'select 1 from adventure_energy_operations where player_id=$1 and idempotency_key=$2',
      [player.id, input.idempotencyKey]
    );
    if (duplicate.rowCount) {
      return { ok: true as const, energy: serializeEnergy(player, hasPlus, active, now) };
    }

    const visibleHearts = Math.min(Number(player.max_hearts), Number(player.hearts) + (active?.energy_reserved ? 1 : 0));
    if (visibleHearts >= Number(player.max_hearts)) {
      throw new AdventureError('ENERGY_FULL', 'Hearts are already full.', 409);
    }

    if (input.source === 'daily') {
      if (!me.userId || !hasPlus) {
        throw new AdventureError('PLUS_REQUIRED', 'A Mazle Plus entitlement is required for the daily refill.', 403);
      }
      if (dateOnlyString(player.last_daily_refill_on) === utcDateString(now)) {
        throw new AdventureError('DAILY_REFILL_USED', 'Today\'s complimentary refill has already been used.', 409);
      }
      player.last_daily_refill_on = utcDateString(now);
    } else {
      if (!me.userId) {
        throw new AdventureError('AUTH_REQUIRED', 'Sign in to use purchased refill tickets.', 401);
      }
      if (Number(player.refill_tickets) <= 0) {
        throw new AdventureError('NO_REFILL_TICKETS', 'No refill tickets are available.', 409);
      }
      const allocation = await client.query<{ id: string }>(
        `select id
           from adventure_purchase_ledger
          where user_id=$1 and status='granted' and remaining_tickets > 0
          order by created_at, id
          limit 1
          for update`,
        [me.userId]
      );
      if (!allocation.rows[0]) {
        throw new AdventureError('REFILL_LEDGER_INCONSISTENT', 'Refill balance could not be reconciled.', 500);
      }
      await client.query(
        `update adventure_purchase_ledger
            set remaining_tickets=remaining_tickets - 1, updated_at=now()
          where id=$1`,
        [allocation.rows[0].id]
      );
      player.refill_tickets = Number(player.refill_tickets) - 1;
    }

    // Preserve an active reservation. The displayed heart count still reaches max.
    player.hearts = Math.max(0, Number(player.max_hearts) - (active?.energy_reserved ? 1 : 0));
    player.next_heart_at = null;
    await client.query(
      `update adventure_players
          set hearts=$2,
              next_heart_at=null,
              refill_tickets=$3,
              last_daily_refill_on=$4,
              updated_at=now()
        where id=$1`,
      [player.id, player.hearts, player.refill_tickets, player.last_daily_refill_on]
    );
    await client.query(
      `insert into adventure_energy_operations (player_id, idempotency_key, kind)
       values ($1, $2, $3)`,
      [player.id, input.idempotencyKey, input.source === 'daily' ? 'daily_refill' : 'ticket_refill']
    );

    return { ok: true as const, energy: serializeEnergy(player, hasPlus, active, now) };
  });
}

async function lockAdventurePurchaseIdentifiers(
  client: PoolClient,
  input: { provider: 'stripe' | 'apple'; externalTransactionId?: string | null; providerPaymentId?: string | null }
): Promise<void> {
  const keys = [
    input.externalTransactionId ? `${input.provider}:transaction:${input.externalTransactionId}` : null,
    input.providerPaymentId ? `${input.provider}:payment:${input.providerPaymentId}` : null,
  ].filter((key): key is string => !!key).sort();
  for (const key of keys) {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
  }
}

export async function grantAdventureRefillPurchase(
  client: PoolClient,
  input: {
    userId: string;
    provider: 'stripe' | 'apple';
    externalTransactionId: string;
    providerPaymentId?: string | null;
    productId: string;
    ticketCount: number;
    providerEventId?: string | null;
    metadata?: unknown;
  }
): Promise<{ granted: boolean; refillTickets: number }> {
  if (!Number.isInteger(input.ticketCount) || input.ticketCount <= 0 || input.ticketCount > 100) {
    throw new AdventureError('INVALID_PURCHASE_QUANTITY', 'Invalid refill ticket quantity.', 500);
  }
  await lockAdventurePurchaseIdentifiers(client, input);
  await client.query(
    `insert into adventure_players (user_id)
     values ($1)
     on conflict (user_id) do nothing`,
    [input.userId]
  );
  const playerResult = await client.query<AdventurePlayerRow>(
    'select * from adventure_players where user_id=$1 for update',
    [input.userId]
  );
  const player = playerResult.rows[0];
  if (!player) throw new AdventureError('PLAYER_NOT_FOUND', 'Adventure player could not be created.', 500);

  const revokedBeforeGrant = await client.query(
    `select 1
       from adventure_purchase_revocations
      where provider=$1
        and (($2::text is not null and external_transaction_id=$2)
          or ($3::text is not null and provider_payment_id=$3))
      limit 1
      for update`,
    [input.provider, input.externalTransactionId, input.providerPaymentId ?? null]
  );
  const initialStatus = revokedBeforeGrant.rowCount ? 'revoked' : 'granted';
  const initialRemaining = revokedBeforeGrant.rowCount ? 0 : input.ticketCount;

  const inserted = await client.query<{ id: string }>(
    `insert into adventure_purchase_ledger
       (user_id, provider, external_transaction_id, provider_payment_id, product_id, ticket_count, remaining_tickets, status, provider_event_id, metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     on conflict (provider, external_transaction_id) do nothing
     returning id`,
    [
      input.userId,
      input.provider,
      input.externalTransactionId,
      input.providerPaymentId ?? null,
      input.productId,
      input.ticketCount,
      initialRemaining,
      initialStatus,
      input.providerEventId ?? null,
      input.metadata == null ? null : JSON.stringify(input.metadata),
    ]
  );

  if (!inserted.rowCount) {
    const existing = await client.query<{ user_id: string }>(
      `select user_id
         from adventure_purchase_ledger
        where provider=$1 and external_transaction_id=$2`,
      [input.provider, input.externalTransactionId]
    );
    if (existing.rows[0]?.user_id !== input.userId) {
      throw new AdventureError('PURCHASE_ALREADY_CLAIMED', 'This purchase is linked to another account.', 409);
    }
    return { granted: false, refillTickets: Number(player.refill_tickets) };
  }

  if (initialStatus === 'revoked') {
    return { granted: false, refillTickets: Number(player.refill_tickets) };
  }

  const updated = await client.query<{ refill_tickets: number }>(
    `update adventure_players
        set refill_tickets=refill_tickets + $2, updated_at=now()
      where id=$1
      returning refill_tickets`,
    [player.id, input.ticketCount]
  );
  return { granted: true, refillTickets: Number(updated.rows[0].refill_tickets) };
}

export async function revokeAdventureRefillPurchase(
  client: PoolClient,
  input: {
    provider: 'stripe' | 'apple';
    providerPaymentId?: string | null;
    externalTransactionId?: string | null;
    providerEventId?: string | null;
  }
): Promise<{ revoked: boolean }> {
  if (!input.providerPaymentId && !input.externalTransactionId) {
    throw new AdventureError('REVOCATION_IDENTIFIER_REQUIRED', 'A provider transaction identifier is required.', 500);
  }
  await lockAdventurePurchaseIdentifiers(client, input);
  await client.query(
    `insert into adventure_purchase_revocations
       (provider, external_transaction_id, provider_payment_id, provider_event_id)
     values ($1, $2, $3, $4)
     on conflict do nothing`,
    [
      input.provider,
      input.externalTransactionId ?? null,
      input.providerPaymentId ?? null,
      input.providerEventId ?? null,
    ]
  );

  const ledgerLookup = await client.query<{
    id: string;
    user_id: string;
  }>(
    `select id, user_id
       from adventure_purchase_ledger
      where provider=$1
        and (($2::text is not null and external_transaction_id=$2)
          or ($3::text is not null and provider_payment_id=$3))
      order by created_at desc
      limit 1`,
    [input.provider, input.externalTransactionId ?? null, input.providerPaymentId ?? null]
  );
  const ledgerIdentity = ledgerLookup.rows[0];
  if (!ledgerIdentity) return { revoked: false };

  // Keep the same player -> ledger lock order as ticket consumption.
  await client.query('select id from adventure_players where user_id=$1 for update', [ledgerIdentity.user_id]);
  const ledger = await client.query<{
    id: string;
    user_id: string;
    remaining_tickets: number;
    status: 'granted' | 'revoked';
  }>(
    `select id, user_id, remaining_tickets, status
       from adventure_purchase_ledger
      where id=$1
      for update`,
    [ledgerIdentity.id]
  );
  const purchase = ledger.rows[0];
  if (!purchase || purchase.status === 'revoked') return { revoked: false };

  await client.query(
    `update adventure_purchase_ledger
        set status='revoked', remaining_tickets=0,
            provider_event_id=coalesce($2, provider_event_id), updated_at=now()
      where id=$1`,
    [purchase.id, input.providerEventId ?? null]
  );
  await client.query(
    `update adventure_players
        set refill_tickets=greatest(0, refill_tickets - $2), updated_at=now()
      where user_id=$1`,
    [purchase.user_id, Number(purchase.remaining_tickets)]
  );
  return { revoked: true };
}
