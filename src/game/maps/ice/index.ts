import { MapType } from '../../types';
import { registerMapType, MapTypeDefinition } from '../registry';
import { iceMovementConfig } from '../../movement';
import { generatePuzzle, generatePuzzlePartial } from './generator';
import { iceTileset } from './tileset';
import { scoreIcePuzzle } from './psychology';

/**
 * Ice map type definition.
 * Classic Pokémon ice gym style puzzles with sliding mechanics.
 */
export const iceMapDefinition: MapTypeDefinition = {
  type: MapType.ICE,
  displayName: 'Ice',
  generate: generatePuzzle,
  generatePartial: generatePuzzlePartial,
  movementConfig: iceMovementConfig,
  tileset: iceTileset,
  weight: 1, // Currently the only enabled map type
  psychologyScorer: scoreIcePuzzle,
};

// Register the ice map type
registerMapType(iceMapDefinition);

// Re-export generator functions for direct access
export { generatePuzzle, generatePuzzlePartial } from './generator';
export { iceTileset } from './tileset';
export { scoreIcePuzzle } from './psychology';
export type { PsychologyMetrics } from './psychology';

