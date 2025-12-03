import { TileType, Direction, Position } from '../types';
import { MovementConfig, MoveResult } from './types';

/**
 * Get the delta (x, y offset) for a given direction
 */
export function getDelta(dir: Direction): Position {
  switch (dir) {
    case Direction.UP: return { x: 0, y: -1 };
    case Direction.DOWN: return { x: 0, y: 1 };
    case Direction.LEFT: return { x: -1, y: 0 };
    case Direction.RIGHT: return { x: 1, y: 0 };
  }
}

/**
 * Get all four cardinal directions
 */
export function getAllDirections(): Direction[] {
  return [Direction.UP, Direction.DOWN, Direction.LEFT, Direction.RIGHT];
}

/**
 * Check if a position is within grid bounds
 */
export function isValidPosition(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x < width && y >= 0 && y < height;
}

/**
 * Check if a position is in the inner area (not on edges)
 */
export function isInnerPosition(x: number, y: number, width: number, height: number): boolean {
  return x > 0 && x < width - 1 && y > 0 && y < height - 1;
}

/**
 * Create a unique string key for a position
 */
export function positionKey(p: Position): string {
  return `${p.x},${p.y}`;
}

/**
 * Check if two positions are equal
 */
export function positionsEqual(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Check if movement can enter a tile based on ledge rules
 */
function canEnterLedge(tile: TileType, dir: Direction, config: MovementConfig): boolean {
  const allowedDir = config.ledgeEntryRules.get(tile);
  if (allowedDir === undefined) {
    return true; // Not a ledge tile, allow entry
  }
  return dir === allowedDir;
}

/**
 * Simulate a move from a starting position in a given direction.
 * Handles ice sliding, ledge rules, and wall blocking based on the movement config.
 * 
 * @param tiles - The 2D tile grid
 * @param start - Starting position
 * @param dir - Direction to move
 * @param width - Grid width
 * @param height - Grid height
 * @param config - Movement configuration for the map type
 * @returns MoveResult with final position, validity, and optional path
 */
export function simulateMove(
  tiles: TileType[][],
  start: Position,
  dir: Direction,
  width: number,
  height: number,
  config: MovementConfig
): MoveResult {
  const delta = getDelta(dir);
  let x = start.x + delta.x;
  let y = start.y + delta.y;

  // Check bounds
  if (!isValidPosition(x, y, width, height)) {
    return { pos: start, valid: false };
  }

  const targetTile = tiles[y][x];
  
  // Check blocking tiles (walls)
  if (config.blockingTiles.has(targetTile)) {
    return { pos: start, valid: false };
  }

  // Check ledge entry rules
  if (!canEnterLedge(targetTile, dir, config)) {
    return { pos: start, valid: false };
  }

  const path: Position[] = [{ x, y }];

  // Handle sliding tiles (like ice)
  if (config.slidingTiles.has(targetTile)) {
    let steps = 0;
    while (steps < config.maxSlideDistance) {
      steps++;
      const nextX = x + delta.x;
      const nextY = y + delta.y;

      // Stop at grid edge
      if (!isValidPosition(nextX, nextY, width, height)) break;

      const nextTile = tiles[nextY][nextX];
      
      // Stop at blocking tiles
      if (config.blockingTiles.has(nextTile)) break;

      // Check ledge - can enter if allowed, then stop
      if (config.ledgeEntryRules.has(nextTile)) {
        if (!canEnterLedge(nextTile, dir, config)) break;
        x = nextX;
        y = nextY;
        path.push({ x, y });
        break;
      }

      x = nextX;
      y = nextY;
      path.push({ x, y });

      // Stop if we're no longer on a sliding tile
      if (!config.slidingTiles.has(nextTile)) break;
    }
  }

  return { pos: { x, y }, valid: true, path };
}

/**
 * Legacy-compatible simulateMove that returns the simpler format used by puzzleGenerator.
 * This maintains exact behavior compatibility with the existing ice generator.
 */
export function simulateMoveLegacy(
  tiles: TileType[][],
  start: Position,
  dir: Direction,
  width: number,
  height: number,
  config: MovementConfig
): { pos: Position; valid: boolean } {
  const result = simulateMove(tiles, start, dir, width, height, config);
  return { pos: result.pos, valid: result.valid };
}

