import { TileType } from '../../types';
import { MovementConfig, createLedgeRules } from '../types';

/**
 * Movement configuration for ground-type maps.
 * - ICE patches cause sliding (same mechanic as ice maps, but used sparingly)
 * - WALL and BOULDER tiles block movement (boulders handled specially in generator)
 * - Ledges have directional entry restrictions (same as ice)
 * 
 * Note: Boulder pushing is handled separately in the ground generator/game logic,
 * not in the basic movement simulation. This config treats boulders as blocking
 * for pathfinding purposes.
 */
export const groundMovementConfig: MovementConfig = {
  slidingTiles: new Set([TileType.ICE]), // Ice patches cause sliding
  blockingTiles: new Set([TileType.WALL, TileType.BOULDER]), // Boulders block until pushed
  ledgeEntryRules: createLedgeRules(),
  maxSlideDistance: 100, // For ice patches
};


