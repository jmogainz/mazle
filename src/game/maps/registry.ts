import { PuzzleData, TileType } from '../types';
import { MovementConfig } from '../movement';

/**
 * Psychology-based difficulty metrics for a puzzle
 */
export interface PsychologyMetrics {
  counterIntuitiveMoves: number;      // Moves that go away from goal
  attractiveDecoys: number;           // Wrong moves that look better than optimal
  commitmentGates: number;            // Points where wrong choice is very costly
  falseProgressPaths: number;         // Paths that look good but dead-end or add moves
  optimalMoves?: number;              // Optional - optimal path length
  psychologyScore?: number;           // Optional - computed difficulty score
  difficultyScore?: number;           // Alias for psychologyScore (for compatibility)
}

/**
 * Tileset definition for rendering
 */
export interface TilesetDefinition {
  /** Map of tile type to color (primary fill) */
  tileColors: Map<TileType, number>;
  /** Map of tile type to alternate color (for patterns) */
  tileColorsAlt?: Map<TileType, number>;
  /** Map of tile type to highlight color (for 3D effects) */
  tileHighlights?: Map<TileType, number>;
  /** Background color for the map */
  backgroundColor: number;
}

/**
 * Game configuration for Mazle.
 * Provides runtime config for movement and rendering.
 */
export interface GameConfig {
  /** Display name for UI */
  displayName: string;

  /** Movement configuration */
  movementConfig: MovementConfig;

  /** Tileset for rendering */
  tileset: TilesetDefinition;

  /** Calculate psychology-based difficulty metrics */
  psychologyScorer?: (puzzle: PuzzleData) => PsychologyMetrics;
}

// Game config singleton - will be set by ice map module
let gameConfig: GameConfig | null = null;

/**
 * Set the game configuration.
 * Called by the ice map module during initialization.
 */
export function setGameConfig(config: GameConfig): void {
  gameConfig = config;
}

/**
 * Get the game configuration.
 */
export function getGameConfig(): GameConfig {
  if (!gameConfig) {
    throw new Error('Game config not initialized. Import maps module first.');
  }
  return gameConfig;
}
