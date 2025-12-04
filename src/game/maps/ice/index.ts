import { MapType } from '../../types';
import { registerMapType, MapTypeDefinition } from '../registry';
import { iceMovementConfig } from '../../movement';
import { iceTileset } from './tileset';
import { scoreIcePuzzle } from './psychology';

/**
 * Ice map type definition.
 * Classic Pokémon ice gym style puzzles with sliding mechanics.
 * 
 * Note: Puzzle generation is handled by WASM/Rust backend.
 * This definition provides movement, rendering, and scoring config.
 */
export const iceMapDefinition: MapTypeDefinition = {
  type: MapType.ICE,
  displayName: 'Ice',
  movementConfig: iceMovementConfig,
  tileset: iceTileset,
  weight: 1, // Enabled
  psychologyScorer: scoreIcePuzzle,
};

// Register the ice map type
registerMapType(iceMapDefinition);

// Re-export tileset and psychology for direct access
export { iceTileset } from './tileset';
export { scoreIcePuzzle } from './psychology';
export type { PsychologyMetrics } from './psychology';
