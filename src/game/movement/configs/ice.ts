import { TileType } from '../../types';
import { MovementConfig, createLedgeRules } from '../types';

/**
 * Movement configuration for ice-type maps.
 * - ICE tiles cause sliding until hitting a wall or non-ice tile
 * - WALL tiles block movement
 * - Ledges have directional entry restrictions
 */
export const iceMovementConfig: MovementConfig = {
  slidingTiles: new Set([TileType.ICE]),
  blockingTiles: new Set([TileType.WALL]),
  ledgeEntryRules: createLedgeRules(),
  maxSlideDistance: 100,
};

