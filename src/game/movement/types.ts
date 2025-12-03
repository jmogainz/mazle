import { TileType, Direction, Position } from '../types';

/**
 * Result of simulating a move
 */
export interface MoveResult {
  pos: Position;
  valid: boolean;
  path?: Position[];  // Optional: all positions traversed (for animation)
}

/**
 * Configuration for how movement works on a given map type.
 * Defines which tiles cause sliding, which stop movement, and ledge rules.
 */
export interface MovementConfig {
  /** Tiles that cause continuous sliding in the direction of movement */
  slidingTiles: Set<TileType>;
  
  /** Tiles that always block entry */
  blockingTiles: Set<TileType>;
  
  /** 
   * Ledge entry rules: maps ledge tile types to allowed entry directions.
   * If a tile is in this map, movement onto it is only allowed from the specified direction.
   */
  ledgeEntryRules: Map<TileType, Direction>;
  
  /** Maximum slide distance (safety limit) */
  maxSlideDistance: number;
}

/**
 * Future extensibility: per-tile behavior definition.
 * Maps can opt into subsets of globally defined tile behaviors.
 */
export interface TileBehavior {
  /** Whether this tile blocks entry entirely */
  blocking: boolean;
  
  /** Whether stepping onto this tile causes sliding */
  sliding: boolean;
  
  /** If defined, only this direction can enter the tile */
  restrictedEntry?: Direction;
  
  /** Custom behavior on entry (for future mechanics like teleports) */
  onEnter?: (from: Position, dir: Direction) => MoveResult | null;
}

/**
 * Helper to create ledge entry rules mapping
 */
export function createLedgeRules(): Map<TileType, Direction> {
  const rules = new Map<TileType, Direction>();
  // LEDGE_UP: enter from above (moving DOWN)
  rules.set(TileType.LEDGE_UP, Direction.DOWN);
  // LEDGE_DOWN: enter from below (moving UP)  
  rules.set(TileType.LEDGE_DOWN, Direction.UP);
  // LEDGE_LEFT: enter from right (moving LEFT)
  rules.set(TileType.LEDGE_LEFT, Direction.LEFT);
  // LEDGE_RIGHT: enter from left (moving RIGHT)
  rules.set(TileType.LEDGE_RIGHT, Direction.RIGHT);
  return rules;
}


