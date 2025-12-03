/**
 * Ground Map Type
 * 
 * Sokoban-inspired puzzle mechanics featuring:
 * - Step-based movement on ground tiles
 * - Pushable boulders (Sokoban mechanics)
 * - Strategic ice patches (local sliding zones)
 * - One-way ledges (commitment points)
 * 
 * Psychology-based difficulty creates challenging puzzles through:
 * - Counter-intuitive boulder pushes
 * - Boulder commitment gates (wrong push blocks progress)
 * - Ice patch surprises (unexpected sliding)
 * - Ledge irreversibility
 */

import { MapType } from '../../types';
import { registerMapType, MapTypeDefinition } from '../registry';
import { groundMovementConfig } from '../../movement';
import { generatePuzzle, generatePuzzlePartial } from './generator';
import { groundTileset } from './tileset';
import { scoreGroundPuzzle } from './psychology';

/**
 * Ground map type definition.
 * Sokoban-style puzzles with boulders, ice patches, and ledges.
 */
export const groundMapDefinition: MapTypeDefinition = {
  type: MapType.GROUND,
  displayName: 'Ground',
  generate: generatePuzzle,
  generatePartial: generatePuzzlePartial,
  movementConfig: groundMovementConfig,
  tileset: groundTileset,
  weight: 1, // ENABLED - Equal weight with ice maps
  psychologyScorer: scoreGroundPuzzle,
};

// Register the ground map type
registerMapType(groundMapDefinition);

// Re-export for direct access
export { generatePuzzle, generatePuzzlePartial } from './generator';
export { groundTileset } from './tileset';
export { scoreGroundPuzzle } from './psychology';
export type { GroundPsychologyMetrics } from './psychology';


