export const TILE_SIZE = 32;
export const GRID_WIDTH = 12;
export const GRID_HEIGHT = 12;

export enum TileType {
  FLOOR = 0,
  WALL = 1,
  ICE = 2,
  LEDGE_DOWN = 3,
  LEDGE_LEFT = 4,
  LEDGE_RIGHT = 5,
  LEDGE_UP = 6,
  START = 7,
  GOAL = 8,
}

export const COLORS = {
  FLOOR: 0xe0e0e0, // Light gray
  WALL: 0x2d2d2d,  // Dark gray
  ICE: 0xa5f2f3,   // Light blue
  LEDGE: 0x8b4513, // Brown
  START: 0x90ee90, // Light green
  GOAL: 0xffd700,  // Gold
  PLAYER: 0xff0000, // Red
};

export const DIRECTIONS = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 },
};
