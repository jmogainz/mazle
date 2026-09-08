import rawAdventureCatalog from './content/adventure-levels-v1.json';
import { MapType, type PuzzleData } from '../game/types';
import { parseAdventureRows, parseAdventureSolution } from './parser';
import { playAdventureSolution } from './solver';
import type {
  AdventureCatalog,
  AdventureChapterDefinition,
  AdventureLevelDefinition,
  AdventureStarThresholds,
  AdventureStars,
  RawAdventureCatalog,
  RawAdventureLevel,
} from './types';

const source = rawAdventureCatalog as unknown as RawAdventureCatalog;

function materializeLevel(raw: RawAdventureLevel): AdventureLevelDefinition {
  const board = parseAdventureRows(raw.rows);
  const solution = parseAdventureSolution(raw.solution);
  const partial: AdventureLevelDefinition = {
    id: raw.id,
    key: raw.key,
    catalogVersion: source.contentVersion,
    chapterId: raw.chapterId,
    chapterIndex: raw.chapterIndex,
    levelInChapter: raw.levelInChapter,
    title: raw.title,
    difficulty: raw.difficulty,
    seed: raw.seed,
    mechanics: [...raw.mechanics],
    prerequisiteLevelId: raw.prerequisiteLevelId,
    mapPosition: { ...raw.mapPosition },
    ...board,
    optimalMoves: raw.optimalMoves,
    solution,
    solutionStops: [],
    moveLimit: raw.moveLimit,
    starThresholds: { ...raw.starThresholds },
  };
  const played = playAdventureSolution(partial, solution);
  return { ...partial, solutionStops: played.stops };
}

function materializeChapter(index: number): AdventureChapterDefinition {
  const raw = source.chapters[index];
  return {
    ...raw,
    colors: { ...raw.colors },
    levelIds: [...raw.levelIds],
    name: raw.title,
    description: raw.subtitle,
  };
}

const levels = source.levels.map(materializeLevel);
const chapters = source.chapters.map((_, index) => materializeChapter(index));

export const ADVENTURE_CATALOG_VERSION: string = source.contentVersion;
export const ADVENTURE_LEVEL_COUNT = 50 as const;

export const ADVENTURE_CATALOG: AdventureCatalog = {
  schemaVersion: source.schemaVersion,
  contentVersion: source.contentVersion,
  campaignId: source.campaignId,
  energyPolicy: { ...source.energyPolicy },
  chapters,
  levels,
};

export const ADVENTURE_ENERGY_POLICY = ADVENTURE_CATALOG.energyPolicy;

const levelsById = new Map(ADVENTURE_CATALOG.levels.map((level) => [level.id, level]));
const chaptersById = new Map(ADVENTURE_CATALOG.chapters.map((chapter) => [chapter.id, chapter]));

export function getAdventureLevel(levelId: number): AdventureLevelDefinition | undefined {
  if (!Number.isInteger(levelId)) return undefined;
  return levelsById.get(levelId);
}

export function requireAdventureLevel(levelId: number): AdventureLevelDefinition {
  const level = getAdventureLevel(levelId);
  if (!level) throw new RangeError(`Unknown Adventure level ${levelId}.`);
  return level;
}

export function getAdventureChapter(
  chapterIdOrIndex: string | number,
): AdventureChapterDefinition | undefined {
  if (typeof chapterIdOrIndex === 'string') return chaptersById.get(chapterIdOrIndex);
  if (!Number.isInteger(chapterIdOrIndex)) return undefined;
  return ADVENTURE_CATALOG.chapters.find((chapter) => chapter.index === chapterIdOrIndex);
}

export function expectedAdventureStarThresholds(optimalMoves: number): AdventureStarThresholds {
  if (!Number.isInteger(optimalMoves) || optimalMoves < 1) {
    throw new RangeError('Adventure optimal moves must be a positive integer.');
  }
  return {
    three: optimalMoves,
    two: optimalMoves + Math.max(1, Math.ceil(optimalMoves * 0.25)),
    one: optimalMoves + Math.max(3, Math.ceil(optimalMoves * 0.6)),
  };
}

/**
 * Calculates campaign stars from the server-verifiable move count.
 * Reaching the goal is required; an over-limit or incomplete run awards zero.
 */
export function starsForMoves(
  levelOrId: AdventureLevelDefinition | number,
  moves: number,
  completed = true,
): AdventureStars {
  const level = typeof levelOrId === 'number' ? getAdventureLevel(levelOrId) : levelOrId;
  if (!level || !completed || !Number.isInteger(moves) || moves < 1 || moves > level.moveLimit) return 0;
  if (moves <= level.starThresholds.three) return 3;
  if (moves <= level.starThresholds.two) return 2;
  return 1;
}

export function toPuzzleData(levelOrId: AdventureLevelDefinition | number): PuzzleData {
  const level = typeof levelOrId === 'number' ? requireAdventureLevel(levelOrId) : levelOrId;
  return {
    width: level.width,
    height: level.height,
    tiles: level.tiles.map((row) => [...row]),
    start: { ...level.start },
    goal: { ...level.goal },
    optimalMoves: level.optimalMoves,
    moveLimit: level.moveLimit,
    solutionPath: level.solutionStops.map((position) => ({ ...position })),
    mapType: MapType.ICE,
    variant: 'adventure',
  };
}

function hasCompleted(completedLevelIds: ReadonlySet<number> | Iterable<number>, levelId: number): boolean {
  if (completedLevelIds instanceof Set) return completedLevelIds.has(levelId);
  for (const completedLevelId of completedLevelIds) {
    if (completedLevelId === levelId) return true;
  }
  return false;
}

export function isAdventureLevelUnlocked(
  levelId: number,
  completedLevelIds: ReadonlySet<number> | Iterable<number>,
): boolean {
  const level = getAdventureLevel(levelId);
  if (!level) return false;
  return level.prerequisiteLevelId === null || hasCompleted(completedLevelIds, level.prerequisiteLevelId);
}

/** Alias kept concise for route/UI consumers. */
export const isLevelUnlocked = isAdventureLevelUnlocked;

export function getNextAdventureLevel(levelId: number): AdventureLevelDefinition | undefined {
  return getAdventureLevel(levelId + 1);
}
