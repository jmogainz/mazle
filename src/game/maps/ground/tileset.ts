import { TileType, COLORS } from '../../types';
import { TilesetDefinition } from '../registry';

/**
 * Tileset definition for ground-type maps.
 * 
 * Design inspiration: Ancient stone cave / rock gym aesthetic
 * - Warm earth tones with amber accents
 * - Natural rock textures (implied through colors)
 * - Boulders are prominent gray-brown rocks
 * - Ice patches retain their icy blue (contrast with warm tones)
 * - Ledges are golden-brown cliff edges
 */
export const groundTileset: TilesetDefinition = {
  tileColors: new Map([
    // Ground - warm sandstone brown
    [TileType.GROUND, 0x8b7355],
    // Walls - deep dark stone
    [TileType.WALL, 0x2a2318],
    // Start - emerald green (consistent with ice)
    [TileType.START, COLORS.START],
    // Goal - golden yellow (consistent with ice)
    [TileType.GOAL, COLORS.GOAL],
    // Ice patches - cool blue contrast against warm tones
    [TileType.ICE, 0x7eb8d8],
    // Ledges - amber/golden cliff edges
    [TileType.LEDGE_UP, 0xa0784a],
    [TileType.LEDGE_DOWN, 0xa0784a],
    [TileType.LEDGE_LEFT, 0xa0784a],
    [TileType.LEDGE_RIGHT, 0xa0784a],
    // Boulders - gray-brown rocks (prominent feature)
    [TileType.BOULDER, COLORS.BOULDER],
  ]),
  tileColorsAlt: new Map([
    // Ground alternate for checkerboard pattern
    [TileType.GROUND, 0x9b8365],
    // Boulder can have slight variation too
    [TileType.BOULDER, 0x6a5845],
  ]),
  tileHighlights: new Map([
    // Wall highlight - subtle shine
    [TileType.WALL, 0x3a3328],
    // Goal glow
    [TileType.GOAL, COLORS.GOAL_GLOW],
    // Ice shine - bright reflection
    [TileType.ICE, 0x9ed8f8],
    // Ledge arrows - bright gold for visibility
    [TileType.LEDGE_UP, 0xdaa520],
    [TileType.LEDGE_DOWN, 0xdaa520],
    [TileType.LEDGE_LEFT, 0xdaa520],
    [TileType.LEDGE_RIGHT, 0xdaa520],
    // Boulder highlight - 3D effect
    [TileType.BOULDER, COLORS.BOULDER_HIGHLIGHT],
  ]),
  // Deep cave background
  backgroundColor: 0x1a1612,
};

