// Map types for different puzzle variants
export enum MapType {
  ICE = 'ice',
  GROUND = 'ground',
}

// Tile types for the puzzle
export enum TileType {
  GROUND = 0,  // Renamed from FLOOR - normal walkable tile
  WALL = 1,
  START = 2,
  GOAL = 3,
  ICE = 4,
  LEDGE_UP = 5,    // Can only enter from above, exits down
  LEDGE_DOWN = 6,  // Can only enter from below, exits up
  LEDGE_LEFT = 7,  // Can only enter from right, exits left
  LEDGE_RIGHT = 8, // Can only enter from left, exits right
}

export enum Direction {
  UP = 'up',
  DOWN = 'down',
  LEFT = 'left',
  RIGHT = 'right',
}

export interface Position {
  x: number;
  y: number;
}

export interface PuzzleData {
  width: number;
  height: number;
  tiles: TileType[][];
  start: Position;
  goal: Position;
  optimalMoves: number;
  mapType: MapType;  // Type of map/puzzle variant
  // Psychology-based difficulty metrics (for dev mode display)
  difficultyScore?: number;           // Overall psychology score
  counterIntuitiveMoves?: number;     // Moves that go away from goal
  attractiveDecoys?: number;          // Wrong moves that look better than optimal
  commitmentGates?: number;           // Points where wrong choice is very costly
  falseProgressPaths?: number;        // Paths that look good but waste moves
}

export interface GameState {
  playerPos: Position;
  moveCount: number;
  startTime: number;
  endTime: number | null;
  isComplete: boolean;
  isSliding: boolean;
  moveHistory: Position[];
}

export interface DailyStats {
  date: string;
  completed: boolean;
  moveCount: number;
  timeMs: number;
  puzzleNumber: number;
  mapType?: MapType;  // Optional for legacy compatibility
}

export interface PlayerStats {
  currentStreak: number;
  maxStreak: number;
  totalGamesPlayed: number;
  totalGamesWon: number;
  lastPlayedDate: string | null;
  history: DailyStats[];
}

// Colors for the pixel art theme
export const COLORS = {
  // Deep blue-green Pokemon gym aesthetic
  GROUND: 0x2d5a4f,      // Renamed from FLOOR
  GROUND_ALT: 0x3d6a5f,  // Renamed from FLOOR_ALT
  WALL: 0x1a1a2e,
  WALL_HIGHLIGHT: 0x2a2a4e,
  ICE: 0x8ecae6,
  ICE_SHINE: 0xb8e0f0,
  LEDGE: 0x6b4423,
  LEDGE_ARROW: 0xffd166,
  START: 0x06d6a0,
  GOAL: 0xffd166,
  GOAL_GLOW: 0xffed4a,
  PLAYER: 0xef476f,
  PLAYER_OUTLINE: 0xc73e5c,
  BACKGROUND: 0x0f0f1a,
  UI_PRIMARY: 0xffffff,
  UI_SECONDARY: 0x888888,
};

export const TILE_SIZE = 32;
