// Movement module - shared movement simulation across map types

export { createLedgeRules } from './types';
export type { MovementConfig, MoveResult, TileBehavior } from './types';

export {
  simulateMove,
  simulateMoveLegacy,
  getDelta,
  getAllDirections,
  isValidPosition,
  isInnerPosition,
  positionKey,
  positionsEqual,
} from './simulateMove';

export { iceMovementConfig } from './configs/ice';
export { groundMovementConfig } from './configs/ground';

// Re-export a helper to get config by map type
import { MapType } from '../types';
import { iceMovementConfig } from './configs/ice';
import { groundMovementConfig } from './configs/ground';
import { MovementConfig } from './types';

/**
 * Get the movement configuration for a given map type
 */
export function getMovementConfig(mapType: MapType): MovementConfig {
  switch (mapType) {
    case MapType.ICE:
      return iceMovementConfig;
    case MapType.GROUND:
      return groundMovementConfig;
    default:
      // Default to ice for legacy compatibility
      return iceMovementConfig;
  }
}

