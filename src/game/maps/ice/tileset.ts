import { TileType, COLORS } from '../../types';
import { TilesetDefinition } from '../registry';

/**
 * Tileset definition for ice-type maps.
 * Uses the classic Pokémon ice gym aesthetic.
 */
export const iceTileset: TilesetDefinition = {
  tileColors: new Map([
    [TileType.GROUND, COLORS.GROUND],
    [TileType.WALL, COLORS.WALL],
    [TileType.START, COLORS.START],
    [TileType.GOAL, COLORS.GOAL],
    [TileType.ICE, COLORS.ICE],
    [TileType.LEDGE_UP, COLORS.LEDGE],
    [TileType.LEDGE_DOWN, COLORS.LEDGE],
    [TileType.LEDGE_LEFT, COLORS.LEDGE],
    [TileType.LEDGE_RIGHT, COLORS.LEDGE],
  ]),
  tileColorsAlt: new Map([
    [TileType.GROUND, COLORS.GROUND_ALT],
  ]),
  backgroundColor: COLORS.BACKGROUND,
};


