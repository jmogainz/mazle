// Events
export { onGameEvent, emitGameEvent } from './events';

// Puzzle generation
export {
  getTodaysPuzzle,
  getPuzzleNumber,
  getPuzzleForDate,
  getDailySeed,
  generatePuzzle,
  MAP_REGISTRY,
} from './puzzleGenerator';
export type { MapTypeDefinition, PsychologyMetrics, PartialGenerationResult } from './puzzleGenerator';

// Worker pool
export { generatePuzzleParallel, getWorkerPool } from './puzzleWorkerPool';
export type { GenerationProgress } from './puzzleWorkerPool';

// Movement system
export {
  simulateMove,
  getMovementConfig,
  iceMovementConfig,
  groundMovementConfig,
} from './movement';
export type { MovementConfig, MoveResult } from './movement';

// Rendering
export { getTileset, getTileColor, getTileRenderInfo } from './rendering';
export type { TilesetDefinition, TileRenderInfo } from './rendering';

// Types
export * from './types';
