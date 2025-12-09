import { TileType, COLORS } from '../../types';
import { TilesetDefinition } from '../registry';

/**
 * Tileset definition for ground-type maps.
 * 
 * Updated to match the Waffle/Wordle clean aesthetic.
 * All maps now share the same consistent clean look.
 */
export const groundTileset: TilesetDefinition = {
  tileColors: new Map([
    // Ground
    [TileType.GROUND, COLORS.GROUND],
    // Walls
    [TileType.WALL, COLORS.WALL],
    // Start
    [TileType.START, COLORS.START],
    // Goal
    [TileType.GOAL, COLORS.GOAL],
    // Ice patches
    [TileType.ICE, COLORS.ICE],
    // Ledges
    [TileType.LEDGE_UP, COLORS.LEDGE],
    [TileType.LEDGE_DOWN, COLORS.LEDGE],
    [TileType.LEDGE_LEFT, COLORS.LEDGE],
    [TileType.LEDGE_RIGHT, COLORS.LEDGE],
    // Boulders
    [TileType.BOULDER, COLORS.BOULDER],
  ]),
  tileColorsAlt: new Map([
    // Ground alternate
    [TileType.GROUND, COLORS.GROUND_ALT],
  ]),
  tileHighlights: new Map([
    // Wall highlight
    [TileType.WALL, COLORS.WALL_HIGHLIGHT],
    // Goal glow
    [TileType.GOAL, COLORS.GOAL_GLOW],
    // Ice shine
    [TileType.ICE, COLORS.ICE_SHINE],
    // Ledge arrows
    [TileType.LEDGE_UP, COLORS.LEDGE_ARROW],
    [TileType.LEDGE_DOWN, COLORS.LEDGE_ARROW],
    [TileType.LEDGE_LEFT, COLORS.LEDGE_ARROW],
    [TileType.LEDGE_RIGHT, COLORS.LEDGE_ARROW],
    // Boulder highlight
    [TileType.BOULDER, COLORS.BOULDER_HIGHLIGHT],
  ]),
  // Standard background
  backgroundColor: COLORS.BACKGROUND,
};


