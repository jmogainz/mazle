import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ADVENTURE_HEART_REGEN_MS,
  regenerateAdventureEnergy,
} from './adventureEnergy.ts';

const now = new Date('2026-08-30T12:00:00.000Z');

test('full energy never carries a regeneration timer', () => {
  assert.deepEqual(regenerateAdventureEnergy(3, 3, new Date(now.getTime() + 1_000), now), {
    hearts: 3,
    nextHeartAt: null,
  });
});

test('spending from full energy starts a thirty-minute timer', () => {
  const result = regenerateAdventureEnergy(2, 3, null, now);
  assert.equal(result.hearts, 2);
  assert.equal(result.nextHeartAt?.toISOString(), new Date(now.getTime() + ADVENTURE_HEART_REGEN_MS).toISOString());
});

test('overdue regeneration catches up deterministically and stops at capacity', () => {
  const firstDue = new Date(now.getTime() - ADVENTURE_HEART_REGEN_MS * 2);
  assert.deepEqual(regenerateAdventureEnergy(0, 3, firstDue, now), {
    hearts: 3,
    nextHeartAt: null,
  });
});

test('partial catch-up preserves the original timer cadence', () => {
  const firstDue = new Date(now.getTime() - ADVENTURE_HEART_REGEN_MS - 1);
  const result = regenerateAdventureEnergy(0, 5, firstDue, now);
  assert.equal(result.hearts, 2);
  assert.equal(result.nextHeartAt?.toISOString(), new Date(firstDue.getTime() + ADVENTURE_HEART_REGEN_MS * 2).toISOString());
});
