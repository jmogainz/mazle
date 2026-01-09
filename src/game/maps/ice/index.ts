import { setGameConfig, GameConfig } from '../registry';
import { iceMovementConfig } from '../../movement';
import { iceTileset } from './tileset';
import { scoreIcePuzzle } from './psychology';

/**
 * Ice map configuration.
 * Classic Pokémon ice gym style puzzles with sliding mechanics.
 */
export const iceConfig: GameConfig = {
  displayName: 'Mazle',
  movementConfig: iceMovementConfig,
  tileset: iceTileset,
  psychologyScorer: scoreIcePuzzle,
};

// Set as the game configuration
setGameConfig(iceConfig);

// Re-export tileset and psychology for direct access
export { iceTileset } from './tileset';
export { scoreIcePuzzle } from './psychology';
export type { PsychologyMetrics } from './psychology';
