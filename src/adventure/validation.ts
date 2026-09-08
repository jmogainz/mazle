import { Direction, TileType, type Position } from '../game/types';
import { positionsEqual } from '../game/movement';
import { expectedAdventureStarThresholds } from './catalog';
import { playAdventureSolution, solveAdventureLevel } from './solver';
import type {
  AdventureCatalog,
  AdventureCatalogValidation,
  AdventureLevelDefinition,
  AdventureLevelValidation,
} from './types';

function samePositions(left: readonly Position[], right: readonly Position[]): boolean {
  return left.length === right.length && left.every((position, index) => positionsEqual(position, right[index]));
}

function tileCount(level: AdventureLevelDefinition, tile: TileType): number {
  return level.tiles.reduce(
    (total, row) => total + row.reduce((rowTotal, candidate) => rowTotal + Number(candidate === tile), 0),
    0,
  );
}

function solutionTraverses(level: AdventureLevelDefinition, tiles: ReadonlySet<TileType>): boolean {
  const played = playAdventureSolution(level, level.solution);
  return played.steps.some((step) => step.path.some((position) => tiles.has(level.tiles[position.y][position.x])));
}

function validateLevel(level: AdventureLevelDefinition): AdventureLevelValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const label = `Level ${level.id}`;

  if (level.width < 3 || level.height < 3 || level.tiles.length !== level.height) {
    errors.push(`${label} has invalid dimensions.`);
  }
  if (level.tiles.some((row) => row.length !== level.width)) {
    errors.push(`${label} has non-rectangular tile rows.`);
  }
  for (let x = 0; x < level.width; x += 1) {
    if (level.tiles[0]?.[x] !== TileType.WALL || level.tiles[level.height - 1]?.[x] !== TileType.WALL) {
      errors.push(`${label} must have a wall border.`);
      break;
    }
  }
  for (let y = 0; y < level.height; y += 1) {
    if (level.tiles[y]?.[0] !== TileType.WALL || level.tiles[y]?.[level.width - 1] !== TileType.WALL) {
      errors.push(`${label} must have a wall border.`);
      break;
    }
  }
  if (tileCount(level, TileType.START) !== 1 || tileCount(level, TileType.GOAL) !== 1) {
    errors.push(`${label} must contain exactly one start and one goal tile.`);
  }
  if (level.tiles[level.start.y]?.[level.start.x] !== TileType.START) {
    errors.push(`${label} start metadata does not point to the start tile.`);
  }
  if (level.tiles[level.goal.y]?.[level.goal.x] !== TileType.GOAL) {
    errors.push(`${label} goal metadata does not point to the goal tile.`);
  }

  const expectedThresholds = expectedAdventureStarThresholds(level.optimalMoves);
  if (
    level.starThresholds.three !== expectedThresholds.three ||
    level.starThresholds.two !== expectedThresholds.two ||
    level.starThresholds.one !== expectedThresholds.one ||
    level.moveLimit !== level.starThresholds.one
  ) {
    errors.push(`${label} star thresholds do not match the version 1 move-efficiency formula.`);
  }

  const played = playAdventureSolution(level, level.solution);
  if (!played.valid || !positionsEqual(played.finalPosition, level.goal)) {
    errors.push(`${label} canonical solution does not reach the goal.`);
  }
  if (level.solution.length !== level.optimalMoves) {
    errors.push(`${label} canonical solution length does not equal declared optimal moves.`);
  }
  if (!samePositions(played.stops, level.solutionStops)) {
    errors.push(`${label} canonical solution stops do not match the movement engine.`);
  }

  const solved = solveAdventureLevel(level);
  if (!solved.solvable) {
    errors.push(`${label} is mechanically unsolvable.`);
  } else {
    if (solved.optimalMoves !== level.optimalMoves) {
      errors.push(`${label} declares ${level.optimalMoves} optimal moves; solver proved ${solved.optimalMoves}.`);
    }
    if (solved.shortestSolutionCount !== 1) {
      errors.push(`${label} must have one unambiguous shortest solution, found ${solved.shortestSolutionCount}.`);
    }
    if (solved.deadStateCount > 0) {
      warnings.push(`${label} has ${solved.deadStateCount} reachable failure state(s).`);
    }
  }

  const hasIce = tileCount(level, TileType.ICE) > 0;
  const ledgeTiles = new Set([
    TileType.LEDGE_UP,
    TileType.LEDGE_DOWN,
    TileType.LEDGE_LEFT,
    TileType.LEDGE_RIGHT,
  ]);
  const hasLedge = [...ledgeTiles].some((tile) => tileCount(level, tile) > 0);
  if (level.mechanics.includes('ice') !== hasIce) {
    errors.push(`${label} ice mechanic metadata does not match its board.`);
  }
  if (level.mechanics.includes('ledge') !== hasLedge) {
    errors.push(`${label} ledge mechanic metadata does not match its board.`);
  }
  if (hasIce && !solutionTraverses(level, new Set([TileType.ICE]))) {
    errors.push(`${label} declares ice but its optimal solution never uses ice.`);
  }
  if (hasLedge && !solutionTraverses(level, ledgeTiles)) {
    errors.push(`${label} declares ledges but its optimal solution never uses a ledge.`);
  }
  if (level.id <= 3 && (hasIce || hasLedge)) {
    errors.push(`${label} introduces advanced mechanics before the ground tutorial is complete.`);
  }
  if (level.id < 21 && hasLedge) {
    errors.push(`${label} introduces ledges before chapter 3.`);
  }
  if (level.id >= 21 && !hasLedge) {
    errors.push(`${label} must exercise ledges from chapter 3 onward.`);
  }
  if (level.mapPosition.x < 0 || level.mapPosition.x > 1 || level.mapPosition.y < 0 || level.mapPosition.y > 1) {
    errors.push(`${label} has an out-of-range journey map position.`);
  }
  if (level.solution.some((direction) => !Object.values(Direction).includes(direction))) {
    errors.push(`${label} contains an unknown solution direction.`);
  }

  return {
    levelId: level.id,
    valid: errors.length === 0,
    optimalMoves: solved.optimalMoves,
    shortestSolutionCount: solved.shortestSolutionCount,
    reachableStateCount: solved.reachableStateCount,
    deadStateCount: solved.deadStateCount,
    errors,
    warnings,
  };
}

export function validateAdventureCatalog(catalog: AdventureCatalog): AdventureCatalogValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (catalog.schemaVersion !== 1) errors.push(`Unsupported Adventure schema ${catalog.schemaVersion}.`);
  if (catalog.levels.length !== 50) errors.push(`Adventure catalog must contain 50 levels, found ${catalog.levels.length}.`);
  if (catalog.chapters.length !== 5) errors.push(`Adventure catalog must contain 5 chapters, found ${catalog.chapters.length}.`);

  const ids = new Set<number>();
  const keys = new Set<string>();
  const seeds = new Set<string>();
  const layouts = new Set<string>();
  const chapterIds = new Set(catalog.chapters.map((chapter) => chapter.id));
  catalog.levels.forEach((level, index) => {
    const expectedId = index + 1;
    if (level.id !== expectedId) errors.push(`Catalog position ${expectedId} contains level ${level.id}.`);
    if (ids.has(level.id)) errors.push(`Duplicate Adventure level id ${level.id}.`);
    if (keys.has(level.key)) errors.push(`Duplicate Adventure level key ${level.key}.`);
    if (seeds.has(level.seed)) errors.push(`Duplicate Adventure level seed ${level.seed}.`);
    const layout = level.tiles.map((row) => row.join(',')).join(';');
    if (layouts.has(layout)) errors.push(`Level ${level.id} duplicates an earlier board layout.`);
    ids.add(level.id);
    keys.add(level.key);
    seeds.add(level.seed);
    layouts.add(layout);
    if (!chapterIds.has(level.chapterId)) errors.push(`Level ${level.id} references missing chapter ${level.chapterId}.`);
    if (level.prerequisiteLevelId !== (level.id === 1 ? null : level.id - 1)) {
      errors.push(`Level ${level.id} does not follow sequential unlock progression.`);
    }
    if (level.catalogVersion !== catalog.contentVersion) {
      errors.push(`Level ${level.id} catalog version does not match its catalog.`);
    }
  });

  catalog.chapters.forEach((chapter, index) => {
    const expectedIndex = index + 1;
    const expectedLevelIds = Array.from({ length: 10 }, (_, offset) => index * 10 + offset + 1);
    if (chapter.index !== expectedIndex) errors.push(`Chapter ${chapter.id} has invalid index ${chapter.index}.`);
    if (chapter.levelIds.join(',') !== expectedLevelIds.join(',')) {
      errors.push(`Chapter ${chapter.id} must own exactly levels ${expectedLevelIds.join('–')}.`);
    }
    const expectedUnlock = index === 0 ? null : index * 10;
    if (chapter.unlockAfterLevelId !== expectedUnlock) {
      errors.push(`Chapter ${chapter.id} has invalid unlock metadata.`);
    }
    for (const levelId of chapter.levelIds) {
      const level = catalog.levels[levelId - 1];
      if (!level || level.chapterId !== chapter.id || level.chapterIndex !== chapter.index) {
        errors.push(`Chapter ${chapter.id} ownership disagrees with level ${levelId}.`);
      }
    }
  });

  const levelValidations = catalog.levels.map(validateLevel);
  for (const validation of levelValidations) {
    errors.push(...validation.errors);
    warnings.push(...validation.warnings);
  }

  const chapterAverageOptimalMoves: Record<string, number> = {};
  let previousAverage = 0;
  for (const chapter of catalog.chapters) {
    const chapterLevels = chapter.levelIds.map((id) => catalog.levels[id - 1]).filter(Boolean);
    const average = chapterLevels.reduce((sum, level) => sum + level.optimalMoves, 0) / chapterLevels.length;
    chapterAverageOptimalMoves[chapter.id] = Number(average.toFixed(2));
    if (average <= previousAverage) {
      errors.push(`Chapter ${chapter.id} does not increase the campaign's average optimal-move difficulty.`);
    }
    previousAverage = average;
  }

  const policy = catalog.energyPolicy;
  if (
    policy.maximumHearts !== 3 ||
    policy.regenerationIntervalSeconds !== 1800 ||
    policy.failureCost !== 1 ||
    policy.protectedThroughLevel !== 5 ||
    !policy.abandonAfterMoveCostsHeart ||
    policy.successfulAttemptCostsHeart
  ) {
    errors.push('Adventure energy policy no longer matches the version 1 campaign contract.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    levels: levelValidations,
    chapterAverageOptimalMoves,
  };
}

export function assertValidAdventureCatalog(catalog: AdventureCatalog): AdventureCatalogValidation {
  const validation = validateAdventureCatalog(catalog);
  if (!validation.valid) {
    throw new Error(`Invalid Adventure catalog:\n${validation.errors.map((error) => `- ${error}`).join('\n')}`);
  }
  return validation;
}
