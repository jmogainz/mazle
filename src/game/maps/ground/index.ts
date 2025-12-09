/**
 * Ground Map Type
 * 
 * Sokoban-inspired puzzle mechanics featuring:
 * - Step-based movement on ground tiles
 * - Pushable boulders (Sokoban mechanics)
 * - Strategic ice patches (local sliding zones)
 * - One-way ledges (commitment points)
 * 
 * Note: Puzzle generation is handled by WASM/Rust backend.
 * This definition provides movement, rendering, and scoring config.
 */

import { MapType } from '../../types';
import { registerMapType, MapTypeDefinition } from '../registry';
import { groundMovementConfig } from '../../movement';
import { groundTileset } from './tileset';
import { scoreGroundPuzzle } from './psychology';

/**
 * Ground map type definition.
 * Sokoban-style puzzles with boulders, ice patches, and ledges.
 */
export const groundMapDefinition: MapTypeDefinition = {
  type: MapType.GROUND,
  displayName: 'Ground',
  movementConfig: groundMovementConfig,
  tileset: groundTileset,
  weight: 1, // Enabled
  psychologyScorer: scoreGroundPuzzle,
};

// Register the ground map type
registerMapType(groundMapDefinition);

// Re-export for direct access
export { groundTileset } from './tileset';
export { scoreGroundPuzzle } from './psychology';
export type { GroundPsychologyMetrics } from './psychology';
