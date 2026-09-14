import assert from 'node:assert/strict';
import crypto from 'node:crypto';

if (!process.env.DB_URL) throw new Error('DB_URL is required and must point to an isolated test database.');

const adventure = await import('../src/lib/server/adventure.ts');
const { ADVENTURE_CATALOG_VERSION, getAdventureLevel } = await import('../src/adventure/index.ts');
const { getDbPool } = await import('../src/lib/server/db.ts');
const pool = getDbPool();

const userId = crypto.randomUUID();
const secondUserId = crypto.randomUUID();
const guestId = crypto.randomUUID();
const me = {
  mode: 'user',
  userId,
  guestId,
  displayName: 'BackendTester',
  setGuestCookie: false,
  provider: 'test',
  entitlements: { archiveAccess: false, adsRemoved: false, unlockedSkins: [] },
};
const key = (name) => `${name}:${crypto.randomUUID()}`;
const guestMe = { ...me, mode: 'guest', userId: null, provider: null };
const secondMe = { ...me, userId: secondUserId, displayName: 'SecondBackendTester' };

async function purchase(input) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await adventure.grantAdventureRefillPurchase(client, input);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function revoke(input) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await adventure.revokeAdventureRefillPurchase(client, input);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

try {
  await pool.query('insert into users (id, display_name) values ($1, $2)', [userId, `Backend${userId.slice(0, 8)}`]);
  await pool.query('insert into users (id, display_name) values ($1, $2)', [secondUserId, `Backend${secondUserId.slice(0, 8)}`]);

  const firstLevel = getAdventureLevel(1);
  await adventure.syncAdventureProgress(guestMe, {
    catalogVersion: ADVENTURE_CATALOG_VERSION,
    idempotencyKey: key('guest-sync'),
    levels: [{
      levelId: 1,
      bestMoves: firstLevel.optimalMoves,
      bestTimeMs: 900,
      completedAt: new Date().toISOString(),
    }],
  });

  let state = await adventure.getAdventureState(me);
  assert.equal(state.energy.hearts, 3);
  assert.equal(state.progress.unlockedLevel, 2, 'first account claims guest progress');
  assert.equal(state.guestImportAllowed, true);
  const secondAccountState = await adventure.getAdventureState(secondMe);
  assert.equal(secondAccountState.guestImportAllowed, false, 'guest progress can be claimed by only one account');
  assert.equal(secondAccountState.progress.completedLevels, 0, 'second account cannot inherit first account guest progress');

  const tutorial = Array.from({ length: 5 }, (_, index) => {
    const level = getAdventureLevel(index + 1);
    return {
      levelId: level.id,
      bestMoves: level.optimalMoves,
      bestTimeMs: 1_000 + index,
      completedAt: new Date().toISOString(),
    };
  });
  state = await adventure.syncAdventureProgress(me, {
    catalogVersion: ADVENTURE_CATALOG_VERSION,
    idempotencyKey: key('sync'),
    levels: tutorial,
  });
  assert.equal(state.progress.unlockedLevel, 6);

  const firstStartKey = key('start');
  const first = await adventure.startAdventureAttempt(me, {
    levelId: 6,
    catalogVersion: ADVENTURE_CATALOG_VERSION,
    idempotencyKey: firstStartKey,
  });
  const duplicate = await adventure.startAdventureAttempt(me, {
    levelId: 6,
    catalogVersion: ADVENTURE_CATALOG_VERSION,
    idempotencyKey: firstStartKey,
  });
  assert.equal(duplicate.attempt.attemptId, first.attempt.attemptId);
  assert.equal(first.energy.hearts, 3, 'reservation stays visually hidden until failure');
  const failed = await adventure.failAdventureAttempt(me, {
    attemptId: first.attempt.attemptId,
    moves: 1,
    timeMs: 500,
    outcome: 'failed',
    idempotencyKey: key('fail'),
  });
  assert.equal(failed.energy.hearts, 2);

  const winning = await adventure.startAdventureAttempt(me, {
    levelId: 6,
    catalogVersion: ADVENTURE_CATALOG_VERSION,
    idempotencyKey: key('start'),
  });
  const level6 = getAdventureLevel(6);
  const won = await adventure.completeAdventureAttempt(me, {
    attemptId: winning.attempt.attemptId,
    moves: level6.optimalMoves,
    timeMs: 1_500,
    catalogVersion: ADVENTURE_CATALOG_VERSION,
    idempotencyKey: key('complete'),
  });
  assert.equal(won.energy.hearts, 2, 'winning returns the reserved heart');
  assert.equal(won.level.stars, 3);

  await purchase({
    userId,
    provider: 'stripe',
    externalTransactionId: 'cs_pack_one',
    providerPaymentId: 'pi_pack_one',
    productId: 'price_pack_one',
    ticketCount: 1,
  });
  await purchase({
    userId,
    provider: 'stripe',
    externalTransactionId: 'cs_pack_five',
    providerPaymentId: 'pi_pack_five',
    productId: 'price_pack_five',
    ticketCount: 5,
  });
  state = await adventure.getAdventureState(me);
  assert.equal(state.energy.refillTickets, 6);

  const refillKey = key('refill');
  const refill = await adventure.consumeAdventureRefill(me, { source: 'ticket', idempotencyKey: refillKey });
  assert.equal(refill.energy.hearts, 3);
  assert.equal(refill.energy.refillTickets, 5);
  const refillRetry = await adventure.consumeAdventureRefill(me, { source: 'ticket', idempotencyKey: refillKey });
  assert.equal(refillRetry.energy.refillTickets, 5, 'refill retry must not spend twice');

  const spendSecondPack = await adventure.startAdventureAttempt(me, {
    levelId: 6,
    catalogVersion: ADVENTURE_CATALOG_VERSION,
    idempotencyKey: key('start'),
  });
  await adventure.failAdventureAttempt(me, {
    attemptId: spendSecondPack.attempt.attemptId,
    moves: 1,
    timeMs: 500,
    outcome: 'failed',
    idempotencyKey: key('fail'),
  });
  await adventure.consumeAdventureRefill(me, { source: 'ticket', idempotencyKey: key('refill') });
  state = await adventure.getAdventureState(me);
  assert.equal(state.energy.refillTickets, 4);

  await revoke({ provider: 'stripe', providerPaymentId: 'pi_pack_one', providerEventId: 'evt_refund_one' });
  state = await adventure.getAdventureState(me);
  assert.equal(state.energy.refillTickets, 4, 'refunding a spent pack must not erase another pack');
  await revoke({ provider: 'stripe', providerPaymentId: 'pi_pack_five', providerEventId: 'evt_refund_five' });
  state = await adventure.getAdventureState(me);
  assert.equal(state.energy.refillTickets, 0);

  await revoke({ provider: 'stripe', providerPaymentId: 'pi_refunded_first', providerEventId: 'evt_refunded_first' });
  const lateGrant = await purchase({
    userId,
    provider: 'stripe',
    externalTransactionId: 'cs_refunded_first',
    providerPaymentId: 'pi_refunded_first',
    productId: 'price_pack_twelve',
    ticketCount: 12,
  });
  assert.equal(lateGrant.granted, false, 'refund tombstone must suppress out-of-order fulfillment');
  state = await adventure.getAdventureState(me);
  assert.equal(state.energy.refillTickets, 0);

  const switching = await adventure.startAdventureAttempt(me, {
    levelId: 6,
    catalogVersion: ADVENTURE_CATALOG_VERSION,
    idempotencyKey: key('start'),
  });
  assert.equal(switching.energy.hearts, 3);
  const switched = await adventure.startAdventureAttempt(me, {
    levelId: 5,
    catalogVersion: ADVENTURE_CATALOG_VERSION,
    idempotencyKey: key('start'),
  });
  assert.equal(switched.energy.hearts, 3, 'server abandonment without move evidence refunds its reservation');
  await adventure.failAdventureAttempt(me, {
    attemptId: switched.attempt.attemptId,
    moves: 0,
    timeMs: 1,
    outcome: 'abandoned',
    idempotencyKey: key('abandon'),
  });

  const stale = await adventure.startAdventureAttempt(me, {
    levelId: 6,
    catalogVersion: ADVENTURE_CATALOG_VERSION,
    idempotencyKey: key('start'),
  });
  await pool.query("update adventure_attempts set started_at=now() - interval '5 hours' where id=$1", [stale.attempt.attemptId]);
  state = await adventure.getAdventureState(me);
  assert.equal(state.activeAttempt, null);
  assert.equal(state.energy.hearts, 3, 'stale server abandonment refunds its unproven reservation');

  const ledger = await pool.query(
    `select external_transaction_id, ticket_count, remaining_tickets, status
       from adventure_purchase_ledger where user_id=$1 order by external_transaction_id`,
    [userId]
  );
  assert.deepEqual(ledger.rows, [
    { external_transaction_id: 'cs_pack_five', ticket_count: 5, remaining_tickets: 0, status: 'revoked' },
    { external_transaction_id: 'cs_pack_one', ticket_count: 1, remaining_tickets: 0, status: 'revoked' },
    { external_transaction_id: 'cs_refunded_first', ticket_count: 12, remaining_tickets: 0, status: 'revoked' },
  ]);

  console.log('Adventure backend integration passed: account isolation, progress, reservations, retries, FIFO tickets, refunds, and tombstones.');
} finally {
  await pool.end();
}
