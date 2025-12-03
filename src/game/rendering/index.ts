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

// Re-export tilesets for easy access
export { iceTileset } from './tilesets/ice';
export { groundTileset } from './tilesets/ground';

// Re-export TilesetDefinition from registry
export type { TilesetDefinition } from '../maps/registry';

// Helper to get tileset by map type
import { MapType } from '../types';
import { MAP_REGISTRY, TilesetDefinition } from '../maps/registry';

/**
 * Get the tileset for a given map type.
 * Falls back to ice tileset if map type is not found.
 */
export function getTileset(mapType: MapType): TilesetDefinition {
  const mapDef = MAP_REGISTRY.get(mapType);
  if (mapDef) {
    return mapDef.tileset;
  }
  // Fallback to ice tileset
  const iceDef = MAP_REGISTRY.get(MapType.ICE);
  return iceDef?.tileset ?? {
    tileColors: new Map(),
    backgroundColor: 0x0f0f1a,
  };
}

