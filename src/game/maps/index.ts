// Map registry and types
export { setGameConfig, getGameConfig } from './registry';
export type {
  GameConfig,
  PsychologyMetrics,
  TilesetDefinition,
} from './registry';

// Import ice map module to trigger initialization
import './ice';
