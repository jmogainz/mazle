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
  lives: number;
  penaltyTimeMs: number;
  attempts: {
    moveCount: number;
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

// Colors for the pixel art theme
export const COLORS = {
  // Waffle/Wordle inspired light theme
  GROUND: 0xf3f3f3,      
  GROUND_ALT: 0xe5e5e5,  
  WALL: 0x2c2c2c,        
  WALL_HIGHLIGHT: 0x2c2c2c,
  ICE: 0xe0f7fa,
  ICE_SHINE: 0xb2ebf2,
  LEDGE: 0xdcdcdc,
  LEDGE_ARROW: 0x000000,
  START: 0xc9b458,       // Waffle Yellow
  GOAL: 0x6aaa64,        // Waffle Green
  GOAL_GLOW: 0x86c080,
  PLAYER: 0xff4d4d,      // Red Ball
  PLAYER_OUTLINE: 0x000000,
  BACKGROUND: 0xffffff,
  UI_PRIMARY: 0x000000,
  UI_SECONDARY: 0x787c7e,
  // Boulder colors
  BOULDER: 0x787c7e,     
  BOULDER_HIGHLIGHT: 0x787c7e, 
  BOULDER_SHADOW: 0x787c7e,    
};

export const TILE_SIZE = 32;
