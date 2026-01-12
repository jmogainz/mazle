// Events
export { onGameEvent, emitGameEvent } from './events';

// Puzzle seed utilities
export {
  getPuzzleNumber,
  getPuzzleNumberFromNyDateString,
  getDailySeed,
  getNewYorkDateString,
  getGameConfig,
} from './puzzleGenerator';
export type { GameConfig, PsychologyMetrics } from './puzzleGenerator';

// Puzzle generation (WASM/Rust)
export {
  generatePuzzleParallel,
  cancelRustRequest,
  fetchDailyPuzzle,
  isRustBackendConfigured,
  getRustBackendUrl,
  getGeneratorStatus,
  preloadWasm,
} from './wasmGenerator';
export type { GenerationProgress, GeneratorBackend, GeneratorStatus, DailyPuzzleResponse } from './wasmGenerator';

// Movement system
export {
  simulateMove,
  iceMovementConfig,
} from './movement';
export type { MovementConfig, MoveResult } from './movement';

// Rendering
export { getTileset, getTileColor, getTileRenderInfo } from './rendering';
export type { TilesetDefinition, TileRenderInfo } from './rendering';

// Types
export * from './types';
