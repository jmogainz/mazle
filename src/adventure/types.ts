import type { Direction, Position, PuzzleData, TileType } from '../game/types';

export type AdventureDifficulty = 'tutorial' | 'easy' | 'normal' | 'hard' | 'super-hard';

export type AdventureMechanic = 'ground' | 'ice' | 'ledge';

export type AdventureStars = 0 | 1 | 2 | 3;

export interface AdventureStarThresholds {
  /** Maximum completed moves that awards three stars. */
  three: number;
  /** Maximum completed moves that awards two stars. */
  two: number;
  /** Maximum completed moves that awards one star and also acts as the move limit. */
  one: number;
}

export interface AdventureMapPosition {
  /** Normalized horizontal position within a chapter's journey map. */
  x: number;
  /** Normalized vertical position within a chapter's journey map. */
  y: number;
}

export interface AdventureEnergyPolicy {
  maximumHearts: number;
  regenerationIntervalSeconds: number;
  failureCost: number;
  protectedThroughLevel: number;
  abandonAfterMoveCostsHeart: boolean;
  successfulAttemptCostsHeart: boolean;
}

export interface AdventureChapterColors {
  primary: string;
  accent: string;
  background: string;
}

export interface AdventureChapterDefinition {
  id: string;
  index: number;
  title: string;
  subtitle: string;
  /** Compatibility alias for consumers that present a generic collection name. */
  name: string;
  /** Compatibility alias for consumers that present a generic collection description. */
  description: string;
  theme: string;
  colors: AdventureChapterColors;
  levelIds: readonly number[];
  unlockAfterLevelId: number | null;
}

export interface AdventureLevelDefinition {
  id: number;
  key: string;
  catalogVersion: string;
  chapterId: string;
  chapterIndex: number;
  levelInChapter: number;
  title: string;
  difficulty: AdventureDifficulty;
  seed: string;
  mechanics: readonly AdventureMechanic[];
  prerequisiteLevelId: number | null;
  mapPosition: AdventureMapPosition;
  width: number;
  height: number;
  tiles: TileType[][];
  start: Position;
  goal: Position;
  optimalMoves: number;
  solution: readonly Direction[];
  /** Player stopping points, including start and goal, for the canonical solution. */
  solutionStops: readonly Position[];
  moveLimit: number;
  starThresholds: AdventureStarThresholds;
}

export interface AdventureCatalog {
  schemaVersion: number;
  contentVersion: string;
  campaignId: string;
  energyPolicy: AdventureEnergyPolicy;
  chapters: readonly AdventureChapterDefinition[];
  levels: readonly AdventureLevelDefinition[];
}

export interface AdventureSolveStep {
  direction: Direction;
  from: Position;
  to: Position;
  /** Every tile crossed by this input, excluding `from` and including `to`. */
  path: readonly Position[];
}

export interface AdventureSolveResult {
  solvable: true;
  optimalMoves: number;
  directions: readonly Direction[];
  stops: readonly Position[];
  steps: readonly AdventureSolveStep[];
  shortestSolutionCount: number;
  reachableStateCount: number;
  /** Reachable stopping states from which no sequence can reach the goal. */
  deadStateCount: number;
}

export interface UnsolvableAdventureResult {
  solvable: false;
  optimalMoves: null;
  directions: readonly [];
  stops: readonly [Position];
  steps: readonly [];
  shortestSolutionCount: 0;
  reachableStateCount: number;
  deadStateCount: number;
}

export type AdventureSolverResult = AdventureSolveResult | UnsolvableAdventureResult;

export interface AdventureLevelValidation {
  levelId: number;
  valid: boolean;
  optimalMoves: number | null;
  shortestSolutionCount: number;
  reachableStateCount: number;
  deadStateCount: number;
  errors: readonly string[];
  warnings: readonly string[];
}

export interface AdventureCatalogValidation {
  valid: boolean;
  errors: readonly string[];
  warnings: readonly string[];
  levels: readonly AdventureLevelValidation[];
  chapterAverageOptimalMoves: Readonly<Record<string, number>>;
}

export interface RawAdventureChapter {
  id: string;
  index: number;
  title: string;
  subtitle: string;
  theme: string;
  colors: AdventureChapterColors;
  levelIds: number[];
  unlockAfterLevelId: number | null;
}

export interface RawAdventureLevel {
  id: number;
  key: string;
  chapterId: string;
  chapterIndex: number;
  levelInChapter: number;
  title: string;
  difficulty: AdventureDifficulty;
  seed: string;
  mechanics: AdventureMechanic[];
  prerequisiteLevelId: number | null;
  mapPosition: AdventureMapPosition;
  rows: string[];
  optimalMoves: number;
  /** Canonical solution encoded with U/R/D/L tokens. */
  solution: string;
  moveLimit: number;
  starThresholds: AdventureStarThresholds;
}

export interface RawAdventureCatalog {
  schemaVersion: number;
  contentVersion: string;
  campaignId: string;
  tileLegend: Readonly<Record<string, string>>;
  energyPolicy: AdventureEnergyPolicy;
  chapters: RawAdventureChapter[];
  levels: RawAdventureLevel[];
}

/** The Phaser-facing projection kept here to make the adapter's contract explicit. */
export type AdventurePuzzleData = Pick<
  PuzzleData,
  | 'width'
  | 'height'
  | 'tiles'
  | 'start'
  | 'goal'
  | 'optimalMoves'
  | 'moveLimit'
  | 'solutionPath'
  | 'mapType'
  | 'variant'
>;
