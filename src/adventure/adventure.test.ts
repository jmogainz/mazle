import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TileType } from '../game/types';
import {
  ADVENTURE_CATALOG,
  ADVENTURE_CATALOG_VERSION,
  ADVENTURE_ENERGY_POLICY,
  ADVENTURE_LEVEL_COUNT,
  adventureRowsFromTiles,
  assertValidAdventureCatalog,
  encodeAdventureSolution,
  getAdventureLevel,
  isAdventureLevelUnlocked,
  solveAdventureLevel,
  starsForMoves,
  toPuzzleData,
} from './index';

test('the checked-in v1 campaign is complete, progressive, and solver-proven', () => {
  const validation = assertValidAdventureCatalog(ADVENTURE_CATALOG);

  assert.equal(ADVENTURE_CATALOG_VERSION, '1.0.0');
  assert.equal(ADVENTURE_LEVEL_COUNT, 50);
  assert.equal(ADVENTURE_CATALOG.levels.length, 50);
  assert.equal(ADVENTURE_CATALOG.chapters.length, 5);
  assert.deepEqual(validation.chapterAverageOptimalMoves, {
    'snowdrop-trail': 5,
    'glacier-gardens': 7.4,
    'arrowhead-pass': 7.8,
    'aurora-ascent': 10.3,
    'crown-of-winter': 12.5,
  });

  for (const level of ADVENTURE_CATALOG.levels) {
    const solved = solveAdventureLevel(level);
    assert.equal(solved.solvable, true, `level ${level.id} should solve`);
    assert.equal(solved.optimalMoves, level.optimalMoves, `level ${level.id} optimal moves`);
    assert.equal(solved.shortestSolutionCount, 1, `level ${level.id} unique shortest solution`);
    assert.equal(encodeAdventureSolution(solved.directions), encodeAdventureSolution(level.solution));
  }
});

test('catalog content remains deterministic and version-reviewable', () => {
  const stableContent = ADVENTURE_CATALOG.levels.map((level) => ({
    id: level.id,
    key: level.key,
    seed: level.seed,
    rows: adventureRowsFromTiles(level.tiles),
    optimalMoves: level.optimalMoves,
    solution: encodeAdventureSolution(level.solution),
    moveLimit: level.moveLimit,
    starThresholds: level.starThresholds,
  }));
  const digest = createHash('sha256').update(JSON.stringify(stableContent)).digest('hex');
  assert.equal(digest, 'e52eda46f6b4984b648adfa48a97a0a3610ab60d743ce21c52dc8b5a2de84df6');
});

test('move thresholds award deterministic stars at every boundary', () => {
  for (const level of ADVENTURE_CATALOG.levels) {
    assert.equal(starsForMoves(level, level.starThresholds.three), 3);
    assert.equal(starsForMoves(level.id, level.starThresholds.three + 1), 2);
    assert.equal(starsForMoves(level, level.starThresholds.two), 2);
    assert.equal(starsForMoves(level, level.starThresholds.two + 1), 1);
    assert.equal(starsForMoves(level, level.moveLimit), 1);
    assert.equal(starsForMoves(level, level.moveLimit + 1), 0);
    assert.equal(starsForMoves(level, level.optimalMoves, false), 0);
  }
  assert.equal(starsForMoves(999, 1), 0);
});

test('progression unlocks sequentially and preserves chapter gates', () => {
  const completed = new Set<number>();
  assert.equal(isAdventureLevelUnlocked(1, completed), true);
  assert.equal(isAdventureLevelUnlocked(2, completed), false);
  completed.add(1);
  assert.equal(isAdventureLevelUnlocked(2, completed), true);
  assert.equal(isAdventureLevelUnlocked(11, completed), false);
  for (let id = 2; id <= 10; id += 1) completed.add(id);
  assert.equal(isAdventureLevelUnlocked(11, completed), true);
  assert.equal(isAdventureLevelUnlocked(12, completed), false);
  assert.equal(isAdventureLevelUnlocked(51, completed), false);
});

test('campaign uses the shared Mazle tile and PuzzleData contracts', () => {
  const firstLedgeLevel = getAdventureLevel(21);
  assert.ok(firstLedgeLevel);
  assert.equal(firstLedgeLevel.mechanics.includes('ledge'), true);
  assert.equal(firstLedgeLevel.tiles.flat().some((tile) => (
    tile === TileType.LEDGE_UP ||
    tile === TileType.LEDGE_DOWN ||
    tile === TileType.LEDGE_LEFT ||
    tile === TileType.LEDGE_RIGHT
  )), true);

  const puzzle = toPuzzleData(firstLedgeLevel);
  assert.equal(puzzle.optimalMoves, firstLedgeLevel.optimalMoves);
  assert.equal(puzzle.moveLimit, firstLedgeLevel.moveLimit);
  assert.equal(puzzle.variant, 'adventure');
  assert.deepEqual(puzzle.solutionPath, firstLedgeLevel.solutionStops);
  assert.notEqual(puzzle.tiles, firstLedgeLevel.tiles);
  assert.notEqual(puzzle.tiles[0], firstLedgeLevel.tiles[0]);
});

test('energy policy matches the fair three-heart launch contract', () => {
  assert.deepEqual(ADVENTURE_ENERGY_POLICY, {
    maximumHearts: 3,
    regenerationIntervalSeconds: 1800,
    failureCost: 1,
    protectedThroughLevel: 5,
    abandonAfterMoveCostsHeart: true,
    successfulAttemptCostsHeart: false,
  });
});
