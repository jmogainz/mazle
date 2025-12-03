import { TileType, COLORS } from '../../types';
import { TilesetDefinition } from '../registry';

/**
 * Tileset definition for ground-type maps.
 * Uses earth tones and natural colors.
 * 
 * TODO: Design distinct visual style for ground maps
 */
export const groundTileset: TilesetDefinition = {
  tileColors: new Map([
    [TileType.GROUND, 0x5d4e37],      // Earthy brown
    [TileType.WALL, 0x2c2416],        // Dark brown
    [TileType.START, COLORS.START],
    [TileType.GOAL, COLORS.GOAL],
    [TileType.ICE, COLORS.ICE],       // May not be used in ground maps
    [TileType.LEDGE_UP, 0x8b6914],    // Golden brown ledge
    [TileType.LEDGE_DOWN, 0x8b6914],
    [TileType.LEDGE_LEFT, 0x8b6914],
    [TileType.LEDGE_RIGHT, 0x8b6914],
  ]),
  tileColorsAlt: new Map([
    [TileType.GROUND, 0x6d5e47],      // Lighter earthy brown
  ]),
  tileHighlights: new Map([
    [TileType.WALL, 0x4c3e26],        // Wall highlight
    [TileType.GOAL, COLORS.GOAL_GLOW],
    [TileType.LEDGE_UP, 0xdaa520],    // Goldenrod arrow
    [TileType.LEDGE_DOWN, 0xdaa520],
    [TileType.LEDGE_LEFT, 0xdaa520],
    [TileType.LEDGE_RIGHT, 0xdaa520],
  ]),
  backgroundColor: 0x1a1510,           // Dark earthy background
};

