// Feature flags
export const HINTS_ENABLED = true;

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
  BOULDER = 9,     // Pushable boulder - blocks movement but can be pushed
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
  solutionPath?: Position[];
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
  currentAttemptMoves: number;
  currentAttemptCorrectMoves: number;
  lives: number;
  penaltyTimeMs: number;
  attempts: {
    moveCount: number;
    correctMoves: number;
    path: Position[];
    failedAt?: Position;
    deviationIndex?: number;
  }[];
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
  failed?: boolean;  // Track if player ran out of lives
  attempts?: {
    moveCount: number;
    correctMoves?: number;
    path: Position[];
    failedAt?: Position;
    deviationIndex?: number;
  }[];
}

export interface PlayerStats {
  currentStreak: number;
  maxStreak: number;
  totalGamesPlayed: number;
  totalGamesWon: number;
  lastPlayedDate: string | null;
  history: DailyStats[];
}

// Colors for the Waffle/Wordle aesthetic
export const COLORS = {
  // Page Background
  BACKGROUND: 0xffffff,
  TEXT: 0x1a1a1a,

  // Tile Styles (Face + Edge for 3D effect)
  // Ground (Empty Tile - Light Brown/Beige)
  GROUND_FACE: 0xbfa46b,
  GROUND_EDGE: 0x9f8451,
  GROUND_ALT: 0xb59a61,

  // Wall (Blocker)
  WALL_FACE: 0x202124,
  WALL_EDGE: 0x0a0a0a,
  
  // Start (Yellow - "Wrong Pos")
  START_FACE: 0xd7b74a,
  START_EDGE: 0xbd9e3c,

  // Goal (Green - "Correct Pos")
  GOAL_FACE: 0x6aaa64,
  GOAL_EDGE: 0x538d4e,
  GOAL_GLOW: 0x86c080,

  // Ice (Pale Blue)
  ICE_FACE: 0xa6d8ff,
  ICE_EDGE: 0x7eb5ed,

  // Ledge (Gray)
  LEDGE_FACE: 0xe8e8e8,
  LEDGE_EDGE: 0xc0c0c0,
  LEDGE_ARROW: 0x3a3d41, // Lighter than wall to keep contrast while matching theme

  // Legacy flat colors (compatibility with tileset maps)
  GROUND: 0xbfa46b,          // Alias to GROUND_FACE
  WALL: 0x202124,            // Alias to WALL_FACE
  START: 0xd7b74a,           // Alias to START_FACE
  GOAL: 0x6aaa64,            // Alias to GOAL_FACE
  ICE: 0xa6d8ff,             // Alias to ICE_FACE
  LEDGE: 0xe8e8e8,           // Alias to LEDGE_FACE
  WALL_HIGHLIGHT: 0x2d2f33,  // Subtle lighter tone for wall shine
  ICE_SHINE: 0xb8e0f0,       // Light reflection for ice tiles

  // Player (Red "Active" Tile)
  PLAYER_FACE: 0xff4d4d,
  PLAYER_EDGE: 0xcc0000,
  PLAYER_OUTLINE: 0x000000,

  // UI
  UI_PRIMARY: 0x000000,
  UI_SECONDARY: 0x787c7e,
  
  // Boulders
  BOULDER: 0x787c7e,
  BOULDER_SHADOW: 0x5e6163,
  BOULDER_HIGHLIGHT: 0x9aa0a3,
  BOULDER_FACE: 0x787c7e,
  BOULDER_EDGE: 0x5e6163,

  // Hints - stopping points match goal green + glow, intermediate tiles lighter version
  HINT_GLOW: 0x6aaa64,        // Match goal green for glow
  HINT_TILE_FACE: 0x6aaa64,   // Match GOAL_FACE - stopping points
  HINT_TILE_EDGE: 0x538d4e,   // Match GOAL_EDGE - stopping points
  HINT_PATH_FACE: 0xa8d8a8,   // Lighter tint of goal green - intermediate path
  HINT_PATH_EDGE: 0x8fc98a,   // Light green edge - intermediate path
};

export const TILE_SIZE = 64;
