import { TileType } from '../../types';
import { MovementConfig, createLedgeRules } from '../types';

/**
 * Movement configuration for ground-type maps.
 * - No sliding tiles - all movement is step-based
 * - WALL tiles block movement
 * - Ledges have directional entry restrictions (same as ice)
 */
export const groundMovementConfig: MovementConfig = {
  slidingTiles: new Set(), // No sliding in ground maps
  blockingTiles: new Set([TileType.WALL]),
  ledgeEntryRules: createLedgeRules(),
  maxSlideDistance: 100, // Not used since no sliding tiles, but kept for consistency
};

