/**
 * Rendering module - tile rendering utilities and tileset management.
 */

export {
  getTileColor,
  getTileColorAlt,
  getTileHighlight,
  shouldUseAltColor,
  getTileRenderInfo,
} from './tileset';
export type { TileRenderInfo } from './tileset';

// Re-export ice tileset
export { iceTileset } from './tilesets/ice';

// Re-export TilesetDefinition from registry
export type { TilesetDefinition } from '../maps/registry';

// Helper to get the tileset
import { getGameConfig, TilesetDefinition } from '../maps/registry';

/**
 * Get the game tileset.
 */
export function getTileset(): TilesetDefinition {
  return getGameConfig().tileset;
}
