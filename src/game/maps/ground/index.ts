/**
 * Ground Map Type
 * 
 * Step-based movement puzzles without ice sliding mechanics.
 * Currently disabled (weight: 0) pending full implementation.
 */

import { MapType } from '../../types';
import { registerMapType, MapTypeDefinition } from '../registry';
import { groundMovementConfig } from '../../movement';
import { generatePuzzle, generatePuzzlePartial } from './generator';
import { groundTileset } from './tileset';
import { scoreGroundPuzzle } from './psychology';

/**
 * Ground map type definition.
 * Step-based puzzles without sliding mechanics.
 */
export const groundMapDefinition: MapTypeDefinition = {
  type: MapType.GROUND,
  displayName: 'Ground',
  generate: generatePuzzle,
  generatePartial: generatePuzzlePartial,
  movementConfig: groundMovementConfig,
  tileset: groundTileset,
  weight: 0, // DISABLED - Enable when ground generation is ready
  psychologyScorer: scoreGroundPuzzle,
};

// Register the ground map type
registerMapType(groundMapDefinition);

// Re-export for direct access
export { generatePuzzle, generatePuzzlePartial } from './generator';
export { groundTileset } from './tileset';
export { scoreGroundPuzzle } from './psychology';

