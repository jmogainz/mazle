/**
 * Ground Map Generator - GENIUS-LEVEL DECEPTION ENGINE
 * 
 * Creates PERPLEXING puzzles that exploit human intuition flaws:
 * - Step-based movement with strategic ice patches
 * - MANDATORY boulders (2-3) that block obvious paths
 * - One-way ledges creating commitment traps
 * - 10 psychological deception algorithms
 * - Constraint-based backwards puzzle design
 * 
 * Design Philosophy:
 * - Every intuitive move should be WRONG
 * - Boulders must be pushed in non-obvious ways
 * - False progress paths everywhere
 * - 2+ minute solve times for experienced players
 * 
 * Boulder mechanics (Sokoban-style):
 * - Player pushes boulders in movement direction
 * - Boulders slide on ice until hitting obstacle
 * - Strategic placement blocks obvious routes
 */

import seedrandom from 'seedrandom';
import { TileType, Position, PuzzleData, Direction, MapType } from '../../types';
import {
  simulateMove,
  getDelta,
  getAllDirections,
  isValidPosition,
  isInnerPosition,
  positionKey,
  positionsEqual,
  MovementConfig,
} from '../../movement';
import { groundMovementConfig } from '../../movement/configs/ground';
import {
  simulateGroundMove,
  createGroundState,
  findGroundPath,
  isGroundPuzzleSolvable,
  GroundPuzzleState,
} from '../../movement/groundMovement';

// ============================================================================
// SEEDED RANDOM NUMBER GENERATOR
// ============================================================================

class SeededRandom {
  private rng: seedrandom.PRNG;

  constructor(seed: string) {
    this.rng = seedrandom(seed);
  }

  random(): number {
    return this.rng();
  }

  randomInt(min: number, max: number): number {
    return Math.floor(this.random() * (max - min)) + min;
  }

  randomChoice<T>(arr: T[]): T {
    return arr[this.randomInt(0, arr.length)];
  }

  shuffle<T>(arr: T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.randomInt(0, i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

// ============================================================================
// POSITION UTILITIES
// ============================================================================

function isInner(x: number, y: number, width: number, height: number): boolean {
  return isInnerPosition(x, y, width, height);
}

function posKey(p: Position): string {
  return positionKey(p);
}

function posEq(a: Position, b: Position): boolean {
  return positionsEqual(a, b);
}

function getAllDirs(): Direction[] {
  return getAllDirections();
}

function manhattanDist(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function getIntuitiveDirection(from: Position, to: Position): Direction[] {
  const dirs: Direction[] = [];
  if (to.x > from.x) dirs.push(Direction.RIGHT);
  if (to.x < from.x) dirs.push(Direction.LEFT);
  if (to.y > from.y) dirs.push(Direction.DOWN);
  if (to.y < from.y) dirs.push(Direction.UP);
  return dirs;
}

function getOppositeDir(dir: Direction): Direction {
  switch (dir) {
    case Direction.UP: return Direction.DOWN;
    case Direction.DOWN: return Direction.UP;
    case Direction.LEFT: return Direction.RIGHT;
    case Direction.RIGHT: return Direction.LEFT;
  }
}

function isValid(x: number, y: number, width: number, height: number): boolean {
  return isValidPosition(x, y, width, height);
}

// ============================================================================
// SIMPLE PATHFINDING (No boulder state - for initial generation)
// ============================================================================

/**
 * Simple BFS pathfinding ignoring boulders - for base map validation
 */
function findSimplePath(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  config: MovementConfig,
  ignoreBoulders: boolean = false
): number | null {
  const queue: { pos: Position; moves: number }[] = [{ pos: start, moves: 0 }];
  const visited = new Set<string>();
  visited.add(posKey(start));

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (posEq(current.pos, goal)) {
      return current.moves;
    }

    for (const dir of getAllDirs()) {
      const result = simulateMove(tiles, current.pos, dir, width, height, config);
      if (result.valid) {
        const key = posKey(result.pos);
        if (!visited.has(key)) {
          visited.add(key);
          queue.push({ pos: result.pos, moves: current.moves + 1 });
        }
      }
    }
  }

  return null;
}

/**
 * Find optimal path with reconstruction (simple, no boulders)
 */
function findOptimalPath(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  config: MovementConfig
): Position[] | null {
  const queue: { pos: Position; path: Position[] }[] = [{ pos: start, path: [start] }];
  const visited = new Set<string>();
  visited.add(posKey(start));

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (posEq(current.pos, goal)) {
      return current.path;
    }

    for (const dir of getAllDirs()) {
      const result = simulateMove(tiles, current.pos, dir, width, height, config);
      if (result.valid) {
        const key = posKey(result.pos);
        if (!visited.has(key)) {
          visited.add(key);
          queue.push({ pos: result.pos, path: [...current.path, result.pos] });
        }
      }
    }
  }

  return null;
}

/**
 * Check solvability (simple, no boulder state)
 */
function isSimplySolvable(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  config: MovementConfig
): boolean {
  return findSimplePath(tiles, start, goal, width, height, config) !== null;
}

/**
 * Get all reachable positions (simple, no boulder state)
 */
function getReachable(
  tiles: TileType[][],
  start: Position,
  width: number,
  height: number,
  config: MovementConfig
): Set<string> {
  const reachable = new Set<string>();
  const queue: Position[] = [start];
  reachable.add(posKey(start));

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const dir of getAllDirs()) {
      const result = simulateMove(tiles, current, dir, width, height, config);
      if (result.valid) {
        const key = posKey(result.pos);
        if (!reachable.has(key)) {
          reachable.add(key);
          queue.push(result.pos);
        }
      }
    }
  }

  return reachable;
}

/**
 * Check for stuck states (simple, no boulder state)
 */
function hasNoSimpleStuckStates(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  config: MovementConfig
): boolean {
  const reachable = getReachable(tiles, start, width, height, config);
  
  const reachableArray = Array.from(reachable);
  const checkCount = Math.min(reachableArray.length, 30);
  const step = Math.max(1, Math.floor(reachableArray.length / checkCount));
  
  for (let i = 0; i < reachableArray.length; i += step) {
    const key = reachableArray[i];
    const [x, y] = key.split(',').map(Number);
    if (!isSimplySolvable(tiles, { x, y }, goal, width, height, config)) {
      return false;
    }
  }
  
  return true;
}

// ============================================================================
// BOULDER-AWARE PATHFINDING (with depth limit for performance)
// ============================================================================

/**
 * Check solvability with boulder state tracking.
 * Uses depth limit to prevent explosion.
 */
function isBoulderSolvable(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  maxDepth: number = 60
): boolean {
  // Quick check: are there any boulders?
  let hasBoulders = false;
  for (let y = 0; y < height && !hasBoulders; y++) {
    for (let x = 0; x < width && !hasBoulders; x++) {
      if (tiles[y][x] === TileType.BOULDER) hasBoulders = true;
    }
  }
  
  // No boulders - use simple pathfinding
  if (!hasBoulders) {
    return isSimplySolvable(tiles, start, goal, width, height, groundMovementConfig);
  }
  
  // Use full boulder state tracking with depth limit
  const result = findGroundPath(tiles, start, goal, width, height);
  return result !== null && result <= maxDepth;
}

/**
 * Count boulders on the map
 */
function countBoulders(tiles: TileType[][], width: number, height: number): number {
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (tiles[y][x] === TileType.BOULDER) count++;
    }
  }
  return count;
}

// ============================================================================
// BASE TILE GENERATION
// ============================================================================

/**
 * Create a maze-like structure using recursive backtracking
 */
function createMazeRoom(width: number, height: number, rng: SeededRandom): TileType[][] {
  const tiles: TileType[][] = Array(height).fill(null).map(() => 
    Array(width).fill(TileType.WALL)
  );
  
  const visited = new Set<string>();
  
  function carve(x: number, y: number) {
    visited.add(posKey({ x, y }));
    tiles[y][x] = TileType.GROUND;
    
    const dirs = rng.shuffle([
      { dx: 0, dy: -2 },
      { dx: 0, dy: 2 },
      { dx: -2, dy: 0 },
      { dx: 2, dy: 0 },
    ]);
    
    for (const { dx, dy } of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      
      if (isInner(nx, ny, width, height) && !visited.has(posKey({ x: nx, y: ny }))) {
        tiles[y + dy / 2][x + dx / 2] = TileType.GROUND;
        carve(nx, ny);
      }
    }
  }
  
  const startX = 2 + rng.randomInt(0, Math.floor((width - 4) / 2)) * 2;
  const startY = 2 + rng.randomInt(0, Math.floor((height - 4) / 2)) * 2;
  carve(startX, startY);
  
  return tiles;
}

/**
 * Create an open room with scattered walls
 */
function createOpenRoom(width: number, height: number, rng: SeededRandom): TileType[][] {
  const tiles: TileType[][] = Array(height).fill(null).map(() => 
    Array(width).fill(TileType.WALL)
  );
  
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      tiles[y][x] = TileType.GROUND;
    }
  }
  
  const clusters = rng.randomInt(8, 15);
  for (let c = 0; c < clusters; c++) {
    const cx = rng.randomInt(4, width - 4);
    const cy = rng.randomInt(4, height - 4);
    const size = rng.randomInt(1, 3);
    
    for (let dy = -size; dy <= size; dy++) {
      for (let dx = -size; dx <= size; dx++) {
        if (Math.abs(dx) + Math.abs(dy) <= size) {
          const x = cx + dx;
          const y = cy + dy;
          if (isInner(x, y, width, height)) {
            tiles[y][x] = TileType.WALL;
          }
        }
      }
    }
  }
  
  return tiles;
}

/**
 * Widen passages by removing walls adjacent to ground
 */
function widenPassages(
  tiles: TileType[][],
  width: number,
  height: number,
  rng: SeededRandom,
  intensity: number
): void {
  const count = Math.floor(width * height * intensity);
  
  for (let i = 0; i < count; i++) {
    const x = rng.randomInt(2, width - 2);
    const y = rng.randomInt(2, height - 2);
    
    if (tiles[y][x] === TileType.WALL) {
      let groundCount = 0;
      for (const dir of getAllDirs()) {
        const d = getDelta(dir);
        if (tiles[y + d.y]?.[x + d.x] === TileType.GROUND) {
          groundCount++;
        }
      }
      
      if (groundCount >= 2 && rng.random() < 0.6) {
        tiles[y][x] = TileType.GROUND;
      }
    }
  }
}

// ============================================================================
// OBSTACLE PLACEMENT - BOULDERS (AGGRESSIVE - 2-3 MANDATORY)
// ============================================================================

/**
 * Place boulders strategically - BLOCKING the obvious intuitive paths
 * Boulders are REQUIRED for ground puzzles to be challenging
 */
function placeBoulders(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  config: MovementConfig,
  maxBoulders: number = 3
): void {
  // Find the optimal path without boulders
  const optimalPath = findOptimalPath(tiles, start, goal, width, height, config);
  if (!optimalPath || optimalPath.length < 6) return;
  
  let placed = 0;
  let attempts = 0;
  
  // STRATEGY 1: Place boulders DIRECTLY on the optimal path
  // This FORCES the player to push them to progress
  while (placed < maxBoulders && attempts < maxBoulders * 80) {
    attempts++;
    
    // PREFER positions directly on the path (forces interaction)
    const preferDirect = rng.random() < 0.7;
    
    let bx: number, by: number;
    
    if (preferDirect && optimalPath.length > 4) {
      // Place DIRECTLY on optimal path
      const pathIndex = rng.randomInt(Math.floor(optimalPath.length * 0.2), optimalPath.length - 2);
      const pathPos = optimalPath[pathIndex];
      bx = pathPos.x;
      by = pathPos.y;
    } else {
      // Place near path with small offset
      const pathIndex = rng.randomInt(Math.floor(optimalPath.length * 0.2), optimalPath.length - 2);
      const pathPos = optimalPath[pathIndex];
      const offsetX = rng.randomInt(-2, 3);
      const offsetY = rng.randomInt(-2, 3);
      bx = pathPos.x + offsetX;
      by = pathPos.y + offsetY;
    }
    
    if (!isInner(bx, by, width, height)) continue;
    if (tiles[by][bx] !== TileType.GROUND) continue;
    if (posEq({ x: bx, y: by }, start) || posEq({ x: bx, y: by }, goal)) continue;
    
    // Don't place TOO close to start (need room to maneuver)
    if (manhattanDist({ x: bx, y: by }, start) < 3) continue;
    
    // Don't place TOO close to goal (anti-pattern)
    if (manhattanDist({ x: bx, y: by }, goal) < 2) continue;
    
    // Check that boulder is pushable in at least one direction
    let pushable = false;
    for (const dir of getAllDirs()) {
      const d = getDelta(dir);
      const behindX = bx - d.x;
      const behindY = by - d.y;
      const aheadX = bx + d.x;
      const aheadY = by + d.y;
      
      if (isInner(behindX, behindY, width, height) &&
          isInner(aheadX, aheadY, width, height) &&
          tiles[behindY][behindX] !== TileType.WALL &&
          tiles[behindY][behindX] !== TileType.BOULDER &&
          tiles[aheadY][aheadX] !== TileType.WALL &&
          tiles[aheadY][aheadX] !== TileType.BOULDER) {
        pushable = true;
        break;
      }
    }
    
    if (!pushable) continue;
    
    // Place boulder
    tiles[by][bx] = TileType.BOULDER;
    
    // Verify solvability with GENEROUS depth limit (boulders make paths longer)
    if (!isBoulderSolvable(tiles, start, goal, width, height, 80)) {
      tiles[by][bx] = TileType.GROUND;
      continue;
    }
    
    // Also verify no permanent stuck states
    if (!hasNoBoulderStuckStates(tiles, start, goal, width, height)) {
      tiles[by][bx] = TileType.GROUND;
      continue;
    }
    
    placed++;
  }
  
  // STRATEGY 2: If we haven't placed enough, try blocking intuitive approaches
  if (placed < Math.min(2, maxBoulders)) {
    const intuitiveDirs = getIntuitiveDirection(start, goal);
    
    for (const dir of intuitiveDirs) {
      if (placed >= maxBoulders) break;
      
      const delta = getDelta(dir);
      
      // Try placing boulder along the intuitive path from start
      for (let dist = 4; dist <= 12; dist++) {
        const bx = start.x + delta.x * dist;
        const by = start.y + delta.y * dist;
        
        if (!isInner(bx, by, width, height)) continue;
        if (tiles[by][bx] !== TileType.GROUND) continue;
        if (posEq({ x: bx, y: by }, goal)) continue;
        
        // Check pushability
        let pushable = false;
        for (const d of getAllDirs()) {
          const dd = getDelta(d);
          if (isInner(bx - dd.x, by - dd.y, width, height) &&
              isInner(bx + dd.x, by + dd.y, width, height) &&
              tiles[by - dd.y][bx - dd.x] !== TileType.WALL &&
              tiles[by + dd.y][bx + dd.x] !== TileType.WALL) {
            pushable = true;
            break;
          }
        }
        
        if (!pushable) continue;
        
        tiles[by][bx] = TileType.BOULDER;
        
        if (!isBoulderSolvable(tiles, start, goal, width, height, 80) ||
            !hasNoBoulderStuckStates(tiles, start, goal, width, height)) {
          tiles[by][bx] = TileType.GROUND;
          continue;
        }
        
        placed++;
        break;
      }
    }
  }
}

// ============================================================================
// OBSTACLE PLACEMENT - ICE PATCHES
// ============================================================================

/**
 * Place ice patches that create local sliding zones
 */
function placeIcePatches(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  config: MovementConfig,
  count: number
): void {
  let placed = 0;
  let attempts = 0;
  
  while (placed < count && attempts < count * 15) {
    attempts++;
    
    const cx = rng.randomInt(4, width - 4);
    const cy = rng.randomInt(4, height - 4);
    
    if (tiles[cy][cx] !== TileType.GROUND) continue;
    
    const patchDir = rng.randomChoice(getAllDirs());
    const delta = getDelta(patchDir);
    const patchLength = rng.randomInt(2, 6);
    
    const backup: { pos: Position; tile: TileType }[] = [];
    let valid = true;
    
    for (let i = 0; i < patchLength; i++) {
      const px = cx + delta.x * i;
      const py = cy + delta.y * i;
      
      if (!isInner(px, py, width, height)) break;
      if (tiles[py][px] !== TileType.GROUND) break;
      if (posEq({ x: px, y: py }, start) || posEq({ x: px, y: py }, goal)) {
        valid = false;
        break;
      }
      
      backup.push({ pos: { x: px, y: py }, tile: tiles[py][px] });
      tiles[py][px] = TileType.ICE;
    }
    
    if (!valid || backup.length < 2) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
      continue;
    }
    
    // Use simple solvability for ice (boulders already placed)
    if (!isBoulderSolvable(tiles, start, goal, width, height, 50)) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
      continue;
    }
    
    placed++;
  }
}

/**
 * Place longer ice runways for momentum traps
 */
function placeIceRunways(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  config: MovementConfig,
  count: number
): void {
  let placed = 0;
  let attempts = 0;
  
  while (placed < count && attempts < count * 20) {
    attempts++;
    
    const cx = rng.randomInt(5, width - 5);
    const cy = rng.randomInt(5, height - 5);
    
    if (tiles[cy][cx] !== TileType.GROUND) continue;
    
    const runwayDir = rng.randomChoice(getAllDirs());
    const delta = getDelta(runwayDir);
    const runwayLength = rng.randomInt(5, 10);
    
    const backup: { pos: Position; tile: TileType }[] = [];
    let actualLength = 0;
    
    for (let i = 0; i < runwayLength; i++) {
      const rx = cx + delta.x * i;
      const ry = cy + delta.y * i;
      
      if (!isInner(rx, ry, width, height)) break;
      if (posEq({ x: rx, y: ry }, start) || posEq({ x: rx, y: ry }, goal)) break;
      
      if (tiles[ry][rx] === TileType.GROUND) {
        backup.push({ pos: { x: rx, y: ry }, tile: tiles[ry][rx] });
        tiles[ry][rx] = TileType.ICE;
        actualLength++;
      } else if (tiles[ry][rx] === TileType.WALL || tiles[ry][rx] === TileType.BOULDER) {
        break;
      }
    }
    
    if (actualLength < 4) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
      continue;
    }
    
    if (!isBoulderSolvable(tiles, start, goal, width, height, 50)) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
      continue;
    }
    
    placed++;
  }
}

// ============================================================================
// OBSTACLE PLACEMENT - LEDGES
// ============================================================================

/**
 * Place ledges that create commitment points
 */
function placeLedges(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  config: MovementConfig,
  count: number
): void {
  const ledgeOptions: { dir: Direction; type: TileType }[] = [
    { dir: Direction.DOWN, type: TileType.LEDGE_UP },
    { dir: Direction.UP, type: TileType.LEDGE_DOWN },
    { dir: Direction.RIGHT, type: TileType.LEDGE_LEFT },
    { dir: Direction.LEFT, type: TileType.LEDGE_RIGHT },
  ];
  
  let placed = 0;
  let attempts = 0;
  
  while (placed < count && attempts < count * 25) {
    attempts++;
    
    const x = rng.randomInt(3, width - 3);
    const y = rng.randomInt(3, height - 3);
    
    if (tiles[y][x] !== TileType.GROUND && tiles[y][x] !== TileType.ICE) continue;
    if (posEq({ x, y }, start) || posEq({ x, y }, goal)) continue;
    
    const option = rng.randomChoice(ledgeOptions);
    const delta = getDelta(option.dir);
    
    const entryX = x - delta.x;
    const entryY = y - delta.y;
    const exitX = x + delta.x;
    const exitY = y + delta.y;
    
    if (!isInner(entryX, entryY, width, height)) continue;
    if (!isInner(exitX, exitY, width, height)) continue;
    
    const entryTile = tiles[entryY][entryX];
    const exitTile = tiles[exitY][exitX];
    
    if (entryTile === TileType.WALL || entryTile === TileType.BOULDER) continue;
    if (exitTile === TileType.WALL || exitTile === TileType.BOULDER) continue;
    
    const oldTile = tiles[y][x];
    tiles[y][x] = option.type;
    
    // Check solvability with full boulder awareness
    if (!isBoulderSolvable(tiles, start, goal, width, height, 50)) {
      tiles[y][x] = oldTile;
      continue;
    }
    
    placed++;
  }
}

// ============================================================================
// WALL MANIPULATION FOR COMPLEXITY
// ============================================================================

/**
 * Add walls to create winding paths
 */
function addWindingWalls(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  config: MovementConfig,
  count: number
): void {
  let added = 0;
  let attempts = 0;
  
  while (added < count && attempts < count * 8) {
    attempts++;
    
    const isHorizontal = rng.random() < 0.5;
    const backup: { pos: Position; tile: TileType }[] = [];
    
    if (isHorizontal) {
      const y = rng.randomInt(4, height - 4);
      const startX = rng.randomInt(3, Math.floor(width * 0.5));
      const length = rng.randomInt(5, 14);
      const gapPos = rng.randomInt(1, length - 1);
      const gapSize = rng.randomInt(2, 4);
      
      for (let i = 0; i < length; i++) {
        const x = startX + i;
        if (i >= gapPos && i < gapPos + gapSize) continue;
        if (!isInner(x, y, width, height)) continue;
        if (tiles[y][x] !== TileType.GROUND) continue;
        if (posEq({ x, y }, start) || posEq({ x, y }, goal)) continue;
        
        backup.push({ pos: { x, y }, tile: tiles[y][x] });
        tiles[y][x] = TileType.WALL;
      }
    } else {
      const x = rng.randomInt(4, width - 4);
      const startY = rng.randomInt(3, Math.floor(height * 0.5));
      const length = rng.randomInt(5, 12);
      const gapPos = rng.randomInt(1, length - 1);
      const gapSize = rng.randomInt(2, 4);
      
      for (let i = 0; i < length; i++) {
        const y = startY + i;
        if (i >= gapPos && i < gapPos + gapSize) continue;
        if (!isInner(x, y, width, height)) continue;
        if (tiles[y][x] !== TileType.GROUND) continue;
        if (posEq({ x, y }, start) || posEq({ x, y }, goal)) continue;
        
        backup.push({ pos: { x, y }, tile: tiles[y][x] });
        tiles[y][x] = TileType.WALL;
      }
    }
    
    if (backup.length < 3) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
      continue;
    }
    
    if (!isSimplySolvable(tiles, start, goal, width, height, config)) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
      continue;
    }
    
    added++;
  }
}

/**
 * Block intuitive approaches to goal
 */
function blockIntuitiveApproaches(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  config: MovementConfig
): void {
  const intuitiveDirs = getIntuitiveDirection(start, goal);
  
  for (const dir of intuitiveDirs) {
    const delta = getDelta(dir);
    
    for (let dist = 2; dist <= 6; dist++) {
      const bx = goal.x - delta.x * dist;
      const by = goal.y - delta.y * dist;
      
      if (!isInner(bx, by, width, height)) continue;
      if (tiles[by][bx] !== TileType.GROUND) continue;
      if (posEq({ x: bx, y: by }, start)) continue;
      
      tiles[by][bx] = TileType.WALL;
      
      if (!isSimplySolvable(tiles, start, goal, width, height, config)) {
        tiles[by][bx] = TileType.GROUND;
      }
    }
  }
}

/**
 * Add extra connections to create alternate routes
 */
function addExtraConnections(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  config: MovementConfig,
  count: number
): void {
  let added = 0;
  let attempts = 0;
  
  while (added < count && attempts < count * 5) {
    attempts++;
    
    const x = rng.randomInt(2, width - 2);
    const y = rng.randomInt(2, height - 2);
    
    if (tiles[y][x] !== TileType.WALL) continue;
    
    let groundNeighbors = 0;
    for (const dir of getAllDirs()) {
      const d = getDelta(dir);
      if (isValidPosition(x + d.x, y + d.y, width, height) &&
          (tiles[y + d.y][x + d.x] === TileType.GROUND ||
           tiles[y + d.y][x + d.x] === TileType.ICE)) {
        groundNeighbors++;
      }
    }
    
    if (groundNeighbors >= 2) {
      const beforePath = findSimplePath(tiles, start, goal, width, height, config);
      tiles[y][x] = TileType.GROUND;
      const afterPath = findSimplePath(tiles, start, goal, width, height, config);
      
      if (afterPath !== null && beforePath !== null && afterPath >= beforePath - 1) {
        added++;
      } else {
        tiles[y][x] = TileType.WALL;
      }
    }
  }
}

// ============================================================================
// GENIUS-LEVEL DECEPTION ENGINE - 10 Psychological Misdirection Algorithms
// ============================================================================

/**
 * ALGORITHM 1: Engineer Counter-Intuitive Paths
 * Block the obvious approaches to force non-intuitive routing
 */
function engineerCounterIntuitivePath(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom
): void {
  const intuitiveDirs = getIntuitiveDirection(start, goal);
  
  // Block direct path segments aggressively
  for (const dir of intuitiveDirs) {
    const delta = getDelta(dir);
    
    // Create wall barriers along the intuitive path
    for (let dist = 3; dist <= 15; dist++) {
      const perpDir = dir === Direction.UP || dir === Direction.DOWN
        ? rng.randomChoice([Direction.LEFT, Direction.RIGHT])
        : rng.randomChoice([Direction.UP, Direction.DOWN]);
      const perpDelta = getDelta(perpDir);
      
      // Create a perpendicular wall barrier
      const barrierCenterX = start.x + delta.x * dist;
      const barrierCenterY = start.y + delta.y * dist;
      
      if (!isInner(barrierCenterX, barrierCenterY, width, height)) continue;
      
      const backup: { pos: Position; tile: TileType }[] = [];
      
      for (let i = -3; i <= 3; i++) {
        const wx = barrierCenterX + perpDelta.x * i;
        const wy = barrierCenterY + perpDelta.y * i;
        
        if (!isInner(wx, wy, width, height)) continue;
        if (tiles[wy][wx] !== TileType.GROUND) continue;
        if (posEq({ x: wx, y: wy }, start) || posEq({ x: wx, y: wy }, goal)) continue;
        
        backup.push({ pos: { x: wx, y: wy }, tile: tiles[wy][wx] });
        tiles[wy][wx] = TileType.WALL;
      }
      
      // Leave a small gap but NOT in the intuitive direction
      if (backup.length >= 4 && rng.random() < 0.7) {
        const gapIndex = rng.randomInt(0, Math.min(2, backup.length));
        tiles[backup[gapIndex].pos.y][backup[gapIndex].pos.x] = TileType.GROUND;
      }
      
      // Verify solvability
      if (!isBoulderSolvable(tiles, start, goal, width, height, 80)) {
        for (const { pos, tile } of backup) {
          tiles[pos.y][pos.x] = tile;
        }
      }
    }
  }
}

/**
 * ALGORITHM 2: Create "Almost There" Traps
 * Paths that get tantalizingly close to goal then dead-end
 */
function createAlmostThereTraps(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  for (let t = 0; t < count; t++) {
    // Find a position near the goal
    const nearGoalDist = rng.randomInt(2, 5);
    const approachDir = rng.randomChoice(getAllDirs());
    const delta = getDelta(approachDir);
    
    const nearPos = {
      x: goal.x + delta.x * nearGoalDist,
      y: goal.y + delta.y * nearGoalDist
    };
    
    if (!isInner(nearPos.x, nearPos.y, width, height)) continue;
    if (tiles[nearPos.y][nearPos.x] !== TileType.GROUND) continue;
    
    // Create a path leading TO this near position but block progress TO goal
    const backup: { pos: Position; tile: TileType }[] = [];
    
    // Block the direct approach from near position to goal
    const blockX = nearPos.x - delta.x;
    const blockY = nearPos.y - delta.y;
    
    if (isInner(blockX, blockY, width, height) && 
        tiles[blockY][blockX] === TileType.GROUND &&
        !posEq({ x: blockX, y: blockY }, start) && 
        !posEq({ x: blockX, y: blockY }, goal)) {
      backup.push({ pos: { x: blockX, y: blockY }, tile: tiles[blockY][blockX] });
      tiles[blockY][blockX] = TileType.WALL;
    }
    
    // Also block adjacent approaches
    const perpDir = approachDir === Direction.UP || approachDir === Direction.DOWN
      ? [Direction.LEFT, Direction.RIGHT]
      : [Direction.UP, Direction.DOWN];
    
    for (const pd of perpDir) {
      const pdelta = getDelta(pd);
      const adjX = blockX + pdelta.x;
      const adjY = blockY + pdelta.y;
      
      if (isInner(adjX, adjY, width, height) && 
          tiles[adjY][adjX] === TileType.GROUND &&
          !posEq({ x: adjX, y: adjY }, start) && 
          !posEq({ x: adjX, y: adjY }, goal)) {
        backup.push({ pos: { x: adjX, y: adjY }, tile: tiles[adjY][adjX] });
        tiles[adjY][adjX] = TileType.WALL;
      }
    }
    
    if (!isBoulderSolvable(tiles, start, goal, width, height, 80)) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
  }
}

/**
 * ALGORITHM 3: Create Decoy Open Areas
 * Attractive open spaces that waste moves
 */
function createDecoyOpenAreas(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  for (let d = 0; d < count; d++) {
    // Place decoy area in the direction of goal (looks like progress)
    const intuitiveDirs = getIntuitiveDirection(start, goal);
    const dir = rng.randomChoice(intuitiveDirs.length > 0 ? intuitiveDirs : getAllDirs());
    const delta = getDelta(dir);
    
    // Position slightly off the direct path
    const dist = rng.randomInt(5, 15);
    const perpDir = dir === Direction.UP || dir === Direction.DOWN
      ? rng.randomChoice([Direction.LEFT, Direction.RIGHT])
      : rng.randomChoice([Direction.UP, Direction.DOWN]);
    const perpDelta = getDelta(perpDir);
    
    const centerX = start.x + delta.x * dist + perpDelta.x * rng.randomInt(2, 6);
    const centerY = start.y + delta.y * dist + perpDelta.y * rng.randomInt(2, 6);
    
    if (!isInner(centerX, centerY, width, height)) continue;
    
    // Create a small open area (looks inviting)
    const backup: { pos: Position; tile: TileType }[] = [];
    const size = rng.randomInt(2, 4);
    
    for (let dy = -size; dy <= size; dy++) {
      for (let dx = -size; dx <= size; dx++) {
        const x = centerX + dx;
        const y = centerY + dy;
        
        if (!isInner(x, y, width, height)) continue;
        if (tiles[y][x] !== TileType.WALL) continue;
        if (posEq({ x, y }, start) || posEq({ x, y }, goal)) continue;
        
        backup.push({ pos: { x, y }, tile: tiles[y][x] });
        tiles[y][x] = TileType.GROUND;
      }
    }
    
    // Make sure this area doesn't create a shortcut
    const beforePath = findGroundPath(tiles, start, goal, width, height);
    if (beforePath === null) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
  }
}

/**
 * ALGORITHM 4: Create Hidden Choke Points
 * Critical narrow passages that are easy to miss
 */
function createHiddenChokePoints(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  for (let c = 0; c < count; c++) {
    // Find the optimal path and narrow it at a critical point
    const path = findOptimalPath(tiles, start, goal, width, height, groundMovementConfig);
    if (!path || path.length < 10) continue;
    
    // Pick a point along the path to narrow
    const pathIndex = rng.randomInt(Math.floor(path.length * 0.3), Math.floor(path.length * 0.7));
    const pathPos = path[pathIndex];
    
    // Add walls around this position to create a narrow passage
    const backup: { pos: Position; tile: TileType }[] = [];
    
    for (const dir of getAllDirs()) {
      const delta = getDelta(dir);
      const adjX = pathPos.x + delta.x;
      const adjY = pathPos.y + delta.y;
      
      // Only wall off if not on the path
      const isOnPath = path.some(p => posEq(p, { x: adjX, y: adjY }));
      if (isOnPath) continue;
      
      if (isInner(adjX, adjY, width, height) && 
          tiles[adjY][adjX] === TileType.GROUND &&
          !posEq({ x: adjX, y: adjY }, start) && 
          !posEq({ x: adjX, y: adjY }, goal) &&
          rng.random() < 0.6) {
        backup.push({ pos: { x: adjX, y: adjY }, tile: tiles[adjY][adjX] });
        tiles[adjY][adjX] = TileType.WALL;
      }
    }
    
    if (!isBoulderSolvable(tiles, start, goal, width, height, 80)) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
  }
}

/**
 * ALGORITHM 5: Create Momentum Traps (Ice Overshot)
 * Ice patches that cause overshooting into bad positions
 */
function createMomentumTraps(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  for (let m = 0; m < count; m++) {
    // Place ice runway that overshoots the optimal path
    const x = rng.randomInt(5, width - 5);
    const y = rng.randomInt(5, height - 5);
    
    if (tiles[y][x] !== TileType.GROUND) continue;
    
    const runwayDir = rng.randomChoice(getAllDirs());
    const delta = getDelta(runwayDir);
    const runwayLength = rng.randomInt(6, 12);
    
    const backup: { pos: Position; tile: TileType }[] = [];
    
    for (let i = 0; i < runwayLength; i++) {
      const rx = x + delta.x * i;
      const ry = y + delta.y * i;
      
      if (!isInner(rx, ry, width, height)) break;
      if (posEq({ x: rx, y: ry }, start) || posEq({ x: rx, y: ry }, goal)) break;
      
      if (tiles[ry][rx] === TileType.GROUND) {
        backup.push({ pos: { x: rx, y: ry }, tile: tiles[ry][rx] });
        tiles[ry][rx] = TileType.ICE;
      } else if (tiles[ry][rx] === TileType.WALL) {
        break;
      }
    }
    
    if (backup.length < 5) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
      continue;
    }
    
    // Make sure the end of the runway doesn't help
    if (!isBoulderSolvable(tiles, start, goal, width, height, 80)) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
  }
}

/**
 * ALGORITHM 6: Create Anti-Gradient Zones
 * Areas where moving toward goal actually increases path cost
 */
function createAntiGradientZones(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  for (let z = 0; z < count; z++) {
    // Find a point that's between start and goal
    const midX = Math.floor((start.x + goal.x) / 2) + rng.randomInt(-5, 6);
    const midY = Math.floor((start.y + goal.y) / 2) + rng.randomInt(-5, 6);
    
    if (!isInner(midX, midY, width, height)) continue;
    if (tiles[midY][midX] !== TileType.GROUND) continue;
    
    // Block the "toward goal" direction from this point
    const towardGoalDirs = getIntuitiveDirection({ x: midX, y: midY }, goal);
    
    for (const dir of towardGoalDirs) {
      const delta = getDelta(dir);
      const backup: { pos: Position; tile: TileType }[] = [];
      
      // Create a wall barrier in the toward-goal direction
      for (let dist = 1; dist <= 4; dist++) {
        const wx = midX + delta.x * dist;
        const wy = midY + delta.y * dist;
        
        if (!isInner(wx, wy, width, height)) break;
        if (tiles[wy][wx] !== TileType.GROUND) continue;
        if (posEq({ x: wx, y: wy }, start) || posEq({ x: wx, y: wy }, goal)) continue;
        
        backup.push({ pos: { x: wx, y: wy }, tile: tiles[wy][wx] });
        tiles[wy][wx] = TileType.WALL;
      }
      
      if (!isBoulderSolvable(tiles, start, goal, width, height, 80)) {
        for (const { pos, tile } of backup) {
          tiles[pos.y][pos.x] = tile;
        }
      }
    }
  }
}

/**
 * ALGORITHM 7: Create Parallel Path Illusion
 * Multiple paths that look equal but have vastly different costs
 */
function createParallelPathIllusion(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  for (let p = 0; p < count; p++) {
    // Find a wall between two ground areas
    const x = rng.randomInt(4, width - 4);
    const y = rng.randomInt(4, height - 4);
    
    if (tiles[y][x] !== TileType.WALL) continue;
    
    // Check if opening this wall creates a parallel path
    let hasGroundOnBothSides = false;
    const horizontal = tiles[y][x - 1] === TileType.GROUND && tiles[y][x + 1] === TileType.GROUND;
    const vertical = tiles[y - 1]?.[x] === TileType.GROUND && tiles[y + 1]?.[x] === TileType.GROUND;
    
    if (horizontal || vertical) {
      hasGroundOnBothSides = true;
    }
    
    if (!hasGroundOnBothSides) continue;
    
    // Open this wall to create alternate path
    tiles[y][x] = TileType.GROUND;
    
    const newPath = findGroundPath(tiles, start, goal, width, height);
    if (newPath === null) {
      tiles[y][x] = TileType.WALL;
      continue;
    }
    
    // This creates decision paralysis - keep it!
  }
}

/**
 * ALGORITHM 8: Create Ledge Misdirection
 * One-way ledges that look helpful but lead wrong
 */
function createLedgeMisdirection(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  const ledgeTypes: { dir: Direction; type: TileType }[] = [
    { dir: Direction.DOWN, type: TileType.LEDGE_UP },
    { dir: Direction.UP, type: TileType.LEDGE_DOWN },
    { dir: Direction.RIGHT, type: TileType.LEDGE_LEFT },
    { dir: Direction.LEFT, type: TileType.LEDGE_RIGHT },
  ];
  
  for (let l = 0; l < count; l++) {
    const x = rng.randomInt(4, width - 4);
    const y = rng.randomInt(4, height - 4);
    
    if (tiles[y][x] !== TileType.GROUND) continue;
    if (posEq({ x, y }, start) || posEq({ x, y }, goal)) continue;
    
    // Prefer ledges that point TOWARD goal (deceptive)
    const intuitiveDirs = getIntuitiveDirection({ x, y }, goal);
    const availableLedges = ledgeTypes.filter(lt => intuitiveDirs.includes(lt.dir));
    
    if (availableLedges.length === 0) continue;
    
    const ledge = rng.randomChoice(availableLedges);
    const delta = getDelta(ledge.dir);
    
    // Verify entry and exit points
    const entryX = x - delta.x;
    const entryY = y - delta.y;
    const exitX = x + delta.x;
    const exitY = y + delta.y;
    
    if (!isInner(entryX, entryY, width, height)) continue;
    if (!isInner(exitX, exitY, width, height)) continue;
    if (tiles[entryY][entryX] === TileType.WALL) continue;
    if (tiles[exitY][exitX] === TileType.WALL) continue;
    
    const oldTile = tiles[y][x];
    tiles[y][x] = ledge.type;
    
    if (!isBoulderSolvable(tiles, start, goal, width, height, 80) ||
        !hasNoBoulderStuckStates(tiles, start, goal, width, height)) {
      tiles[y][x] = oldTile;
    }
  }
}

/**
 * ALGORITHM 9: Create Goal Proximity Dead Ends
 * Paths that get very close to goal then dead-end
 */
function createGoalProximityDeadEnds(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  for (let g = 0; g < count; g++) {
    // Create a path toward goal that dead-ends 1-3 tiles away
    const deadEndDist = rng.randomInt(1, 4);
    const approachDir = rng.randomChoice(getAllDirs());
    const delta = getDelta(approachDir);
    
    const deadEndX = goal.x + delta.x * deadEndDist;
    const deadEndY = goal.y + delta.y * deadEndDist;
    
    if (!isInner(deadEndX, deadEndY, width, height)) continue;
    
    // Open a path to this dead end position
    const backup: { pos: Position; tile: TileType }[] = [];
    
    for (let i = deadEndDist + 1; i <= deadEndDist + 5; i++) {
      const px = goal.x + delta.x * i;
      const py = goal.y + delta.y * i;
      
      if (!isInner(px, py, width, height)) break;
      if (tiles[py][px] === TileType.WALL) {
        backup.push({ pos: { x: px, y: py }, tile: tiles[py][px] });
        tiles[py][px] = TileType.GROUND;
      }
    }
    
    // Now block progress from dead end to goal
    const blockX = goal.x + delta.x * (deadEndDist - 1);
    const blockY = goal.y + delta.y * (deadEndDist - 1);
    
    if (isInner(blockX, blockY, width, height) && 
        tiles[blockY][blockX] === TileType.GROUND &&
        !posEq({ x: blockX, y: blockY }, goal)) {
      backup.push({ pos: { x: blockX, y: blockY }, tile: tiles[blockY][blockX] });
      tiles[blockY][blockX] = TileType.WALL;
    }
    
    if (!isBoulderSolvable(tiles, start, goal, width, height, 80)) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
  }
}

/**
 * ALGORITHM 10: Create Commitment Traps
 * Areas easy to enter but hard/costly to escape
 */
function createCommitmentTraps(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  for (let c = 0; c < count; c++) {
    // Create a small area with one-way entry (ledge in, no ledge out)
    const cx = rng.randomInt(5, width - 5);
    const cy = rng.randomInt(5, height - 5);
    
    if (tiles[cy][cx] !== TileType.GROUND) continue;
    if (posEq({ x: cx, y: cy }, start) || posEq({ x: cx, y: cy }, goal)) continue;
    
    // Pick entry direction (from intuitive direction toward goal)
    const intuitiveDirs = getIntuitiveDirection(start, goal);
    const entryDir = rng.randomChoice(intuitiveDirs.length > 0 ? intuitiveDirs : getAllDirs());
    const entryDelta = getDelta(entryDir);
    
    // Create one-way entry ledge
    const ledgeX = cx - entryDelta.x;
    const ledgeY = cy - entryDelta.y;
    
    if (!isInner(ledgeX, ledgeY, width, height)) continue;
    if (tiles[ledgeY][ledgeX] !== TileType.GROUND) continue;
    if (posEq({ x: ledgeX, y: ledgeY }, start) || posEq({ x: ledgeX, y: ledgeY }, goal)) continue;
    
    // Determine ledge type based on entry direction
    let ledgeType: TileType;
    switch (entryDir) {
      case Direction.DOWN: ledgeType = TileType.LEDGE_UP; break;
      case Direction.UP: ledgeType = TileType.LEDGE_DOWN; break;
      case Direction.RIGHT: ledgeType = TileType.LEDGE_LEFT; break;
      case Direction.LEFT: ledgeType = TileType.LEDGE_RIGHT; break;
    }
    
    const oldTile = tiles[ledgeY][ledgeX];
    tiles[ledgeY][ledgeX] = ledgeType;
    
    if (!isBoulderSolvable(tiles, start, goal, width, height, 80) ||
        !hasNoBoulderStuckStates(tiles, start, goal, width, height)) {
      tiles[ledgeY][ledgeX] = oldTile;
    }
  }
}

// ============================================================================
// ADDITIONAL COMPLEXITY LAYERS
// ============================================================================

/**
 * Add funnel patterns that force specific approaches
 */
function addFunnelPatterns(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  for (let f = 0; f < count; f++) {
    const cx = rng.randomInt(6, width - 6);
    const cy = rng.randomInt(6, height - 6);
    
    if (tiles[cy][cx] !== TileType.GROUND) continue;
    
    // Create V-shaped funnel
    const funnelDir = rng.randomChoice(getAllDirs());
    const delta = getDelta(funnelDir);
    const perpDir = funnelDir === Direction.UP || funnelDir === Direction.DOWN
      ? [Direction.LEFT, Direction.RIGHT]
      : [Direction.UP, Direction.DOWN];
    
    const backup: { pos: Position; tile: TileType }[] = [];
    
    for (let depth = 1; depth <= 4; depth++) {
      const baseX = cx + delta.x * depth;
      const baseY = cy + delta.y * depth;
      
      for (const pd of perpDir) {
        const pDelta = getDelta(pd);
        const wallX = baseX + pDelta.x * depth;
        const wallY = baseY + pDelta.y * depth;
        
        if (isInner(wallX, wallY, width, height) &&
            tiles[wallY][wallX] === TileType.GROUND &&
            !posEq({ x: wallX, y: wallY }, start) &&
            !posEq({ x: wallX, y: wallY }, goal)) {
          backup.push({ pos: { x: wallX, y: wallY }, tile: tiles[wallY][wallX] });
          tiles[wallY][wallX] = TileType.WALL;
        }
      }
    }
    
    if (!isBoulderSolvable(tiles, start, goal, width, height, 80)) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
  }
}

/**
 * Add trap alcoves - easy to enter, costly to escape
 */
function addTrapAlcoves(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  for (let t = 0; t < count; t++) {
    const cx = rng.randomInt(5, width - 5);
    const cy = rng.randomInt(5, height - 5);
    
    const openDir = rng.randomChoice(getAllDirs());
    const delta = getDelta(openDir);
    
    const backup: { pos: Position; tile: TileType }[] = [];
    const alcovePositions: Position[] = [];
    
    // Create U-shaped alcove
    if (openDir === Direction.UP || openDir === Direction.DOWN) {
      for (let d = 1; d <= 3; d++) {
        const dy = -delta.y * d;
        const leftPos = { x: cx - 1, y: cy + dy };
        const rightPos = { x: cx + 1, y: cy + dy };
        
        if (isInner(leftPos.x, leftPos.y, width, height) &&
            tiles[leftPos.y][leftPos.x] === TileType.GROUND &&
            !posEq(leftPos, start) && !posEq(leftPos, goal)) {
          alcovePositions.push(leftPos);
        }
        if (isInner(rightPos.x, rightPos.y, width, height) &&
            tiles[rightPos.y][rightPos.x] === TileType.GROUND &&
            !posEq(rightPos, start) && !posEq(rightPos, goal)) {
          alcovePositions.push(rightPos);
        }
      }
    } else {
      for (let d = 1; d <= 3; d++) {
        const dx = -delta.x * d;
        const topPos = { x: cx + dx, y: cy - 1 };
        const bottomPos = { x: cx + dx, y: cy + 1 };
        
        if (isInner(topPos.x, topPos.y, width, height) &&
            tiles[topPos.y][topPos.x] === TileType.GROUND &&
            !posEq(topPos, start) && !posEq(topPos, goal)) {
          alcovePositions.push(topPos);
        }
        if (isInner(bottomPos.x, bottomPos.y, width, height) &&
            tiles[bottomPos.y][bottomPos.x] === TileType.GROUND &&
            !posEq(bottomPos, start) && !posEq(bottomPos, goal)) {
          alcovePositions.push(bottomPos);
        }
      }
    }
    
    for (const pos of alcovePositions) {
      backup.push({ pos, tile: tiles[pos.y][pos.x] });
      tiles[pos.y][pos.x] = TileType.WALL;
    }
    
    if (!isBoulderSolvable(tiles, start, goal, width, height, 80) ||
        !hasNoBoulderStuckStates(tiles, start, goal, width, height)) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
  }
}

/**
 * Add precision gates - narrow passages requiring exact positioning
 */
function addPrecisionGates(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  for (let g = 0; g < count; g++) {
    const isHorizontal = rng.random() < 0.5;
    const backup: { pos: Position; tile: TileType }[] = [];
    
    if (isHorizontal) {
      const gateY = rng.randomInt(4, height - 4);
      const gateX = rng.randomInt(6, width - 6);
      const gateWidth = rng.randomInt(5, 10);
      const gapPos = rng.randomInt(1, gateWidth - 2);
      
      for (let i = 0; i < gateWidth; i++) {
        const x = gateX + i;
        if (i === gapPos || i === gapPos + 1) continue; // 2-wide gap
        if (!isInner(x, gateY, width, height)) continue;
        if (tiles[gateY][x] !== TileType.GROUND) continue;
        if (posEq({ x, y: gateY }, start) || posEq({ x, y: gateY }, goal)) continue;
        
        backup.push({ pos: { x, y: gateY }, tile: tiles[gateY][x] });
        tiles[gateY][x] = TileType.WALL;
      }
    } else {
      const gateX = rng.randomInt(4, width - 4);
      const gateY = rng.randomInt(6, height - 6);
      const gateHeight = rng.randomInt(5, 10);
      const gapPos = rng.randomInt(1, gateHeight - 2);
      
      for (let i = 0; i < gateHeight; i++) {
        const y = gateY + i;
        if (i === gapPos || i === gapPos + 1) continue;
        if (!isInner(gateX, y, width, height)) continue;
        if (tiles[y][gateX] !== TileType.GROUND) continue;
        if (posEq({ x: gateX, y }, start) || posEq({ x: gateX, y }, goal)) continue;
        
        backup.push({ pos: { x: gateX, y }, tile: tiles[y][gateX] });
        tiles[y][gateX] = TileType.WALL;
      }
    }
    
    if (!isBoulderSolvable(tiles, start, goal, width, height, 80)) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
  }
}

/**
 * Add deceptive paths - routes that look good but waste moves
 */
function addDeceptivePaths(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  const initialPath = findGroundPath(tiles, start, goal, width, height);
  if (initialPath === null) return;
  
  let added = 0;
  let attempts = 0;
  
  while (added < count && attempts < count * 10) {
    attempts++;
    
    const x = rng.randomInt(4, width - 4);
    const y = rng.randomInt(4, height - 4);
    
    if (tiles[y][x] !== TileType.WALL) continue;
    
    // Count adjacent ground tiles
    let groundNeighbors = 0;
    for (const d of getAllDirs()) {
      const delta = getDelta(d);
      const nx = x + delta.x;
      const ny = y + delta.y;
      if (isValid(nx, ny, width, height) && 
          (tiles[ny][nx] === TileType.GROUND || tiles[ny][nx] === TileType.ICE)) {
        groundNeighbors++;
      }
    }
    
    if (groundNeighbors < 2) continue;
    
    tiles[y][x] = TileType.GROUND;
    
    const newPath = findGroundPath(tiles, start, goal, width, height);
    
    // Keep if it doesn't shorten path (creates deceptive routes)
    if (newPath !== null && newPath >= initialPath - 2) {
      added++;
    } else {
      tiles[y][x] = TileType.WALL;
    }
  }
}

/**
 * Add dead-end magnets - attractive looking areas that are dead ends
 */
function addDeadEndMagnets(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  const goalDir = { 
    x: goal.x > start.x ? 1 : -1, 
    y: goal.y > start.y ? 1 : -1 
  };
  
  for (let m = 0; m < count; m++) {
    const midX = Math.floor((start.x + goal.x) / 2);
    const midY = Math.floor((start.y + goal.y) / 2);
    
    const cx = rng.randomInt(
      Math.max(3, midX - 8),
      Math.min(width - 3, midX + 8)
    );
    const cy = rng.randomInt(
      Math.max(3, midY - 6),
      Math.min(height - 3, midY + 6)
    );
    
    if (!isInner(cx, cy, width, height)) continue;
    if (tiles[cy][cx] !== TileType.GROUND) continue;
    
    const backup: { pos: Position; tile: TileType }[] = [];
    const magnetPositions: Position[] = [];
    
    // Open space toward goal (looks inviting)
    for (let dy = 0; dy <= 3; dy++) {
      for (let dx = 0; dx <= 3; dx++) {
        const x = cx + dx * goalDir.x;
        const y = cy + dy * goalDir.y;
        
        if (isInner(x, y, width, height) && 
            tiles[y][x] === TileType.WALL &&
            !posEq({ x, y }, start) && !posEq({ x, y }, goal)) {
          magnetPositions.push({ x, y });
        }
      }
    }
    
    for (const pos of magnetPositions) {
      backup.push({ pos, tile: tiles[pos.y][pos.x] });
      tiles[pos.y][pos.x] = TileType.GROUND;
    }
    
    // Block far end to make it dead end
    const farX = cx + 4 * goalDir.x;
    const farY = cy + 4 * goalDir.y;
    const deadEndWalls: Position[] = [];
    
    for (let i = -2; i <= 2; i++) {
      for (const pos of [
        { x: farX, y: farY + i },
        { x: farX + i, y: farY }
      ]) {
        if (isInner(pos.x, pos.y, width, height) && 
            tiles[pos.y][pos.x] === TileType.GROUND &&
            !posEq(pos, start) && !posEq(pos, goal)) {
          deadEndWalls.push(pos);
        }
      }
    }
    
    for (const pos of deadEndWalls) {
      backup.push({ pos, tile: tiles[pos.y][pos.x] });
      tiles[pos.y][pos.x] = TileType.WALL;
    }
    
    if (!isBoulderSolvable(tiles, start, goal, width, height, 80)) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
  }
}

/**
 * Check for stuck states with boulder awareness
 */
function hasNoBoulderStuckStates(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
): boolean {
  // Sample some reachable positions and verify they can all reach goal
  const reachable = getReachable(tiles, start, width, height, groundMovementConfig);
  
  const reachableArray = Array.from(reachable);
  const checkCount = Math.min(reachableArray.length, 20);
  const step = Math.max(1, Math.floor(reachableArray.length / checkCount));
  
  for (let i = 0; i < reachableArray.length; i += step) {
    const key = reachableArray[i];
    const [x, y] = key.split(',').map(Number);
    if (!isBoulderSolvable(tiles, { x, y }, goal, width, height, 80)) {
      return false;
    }
  }
  
  return true;
}

// ============================================================================
// CONSTRAINT-BASED BACKWARDS PUZZLE GENERATION
// ============================================================================

interface GroundWaypointConstraint {
  pos: Position;
  requiredApproachDir: Direction;
  hasBoulder: boolean;
}

/**
 * Generate puzzle by designing backwards from goal
 */
function generateConstraintBasedGroundPuzzle(
  width: number,
  height: number,
  rng: SeededRandom,
  chainLength: number = 12
): { tiles: TileType[][], start: Position, goal: Position, boulderPositions: Position[] } | null {
  const tiles: TileType[][] = Array(height).fill(null).map(() => 
    Array(width).fill(TileType.WALL)
  );
  
  // Place goal near a corner
  const corners = [
    { x: width - 5, y: height - 5 },
    { x: 5, y: height - 5 },
    { x: width - 5, y: 5 },
    { x: 5, y: 5 },
  ];
  const goal = rng.randomChoice(corners);
  
  const waypoints: GroundWaypointConstraint[] = [];
  const solutionPath = new Set<string>();
  let currentPos = { ...goal };
  solutionPath.add(posKey(goal));
  
  const boulderPositions: Position[] = [];
  
  for (let i = 0; i < chainLength; i++) {
    // Determine intuitive direction (where start likely is)
    const intuitiveDir = getOppositeCornerDirection(currentPos, goal, width, height);
    
    // Choose approach - AVOID intuitive direction
    const possibleApproachDirs = getAllDirs().filter(d => {
      if (d === intuitiveDir) return false;
      if (d === getOppositeDir(intuitiveDir) && rng.random() < 0.5) return false;
      return true;
    });
    
    if (possibleApproachDirs.length === 0) break;
    
    const approachDir = rng.randomChoice(possibleApproachDirs);
    const oppDir = getOppositeDir(approachDir);
    const delta = getDelta(oppDir);
    
    // Path length for this segment
    const pathLength = rng.randomInt(2, 6);
    
    // Find source position
    const sourcePos = {
      x: currentPos.x + delta.x * pathLength,
      y: currentPos.y + delta.y * pathLength
    };
    
    if (!isInner(sourcePos.x, sourcePos.y, width, height)) {
      // Try shorter distance
      let found = false;
      for (let dist = pathLength - 1; dist >= 2; dist--) {
        const tryPos = {
          x: currentPos.x + delta.x * dist,
          y: currentPos.y + delta.y * dist
        };
        if (isInner(tryPos.x, tryPos.y, width, height)) {
          sourcePos.x = tryPos.x;
          sourcePos.y = tryPos.y;
          found = true;
          break;
        }
      }
      if (!found) continue;
    }
    
    // Carve path from source to current
    const pathDelta = getDelta(approachDir);
    let carveX = sourcePos.x;
    let carveY = sourcePos.y;
    
    while (!posEq({ x: carveX, y: carveY }, currentPos)) {
      if (!isInner(carveX, carveY, width, height)) break;
      tiles[carveY][carveX] = TileType.GROUND;
      solutionPath.add(posKey({ x: carveX, y: carveY }));
      carveX += pathDelta.x;
      carveY += pathDelta.y;
    }
    tiles[currentPos.y][currentPos.x] = TileType.GROUND;
    
    // Consider placing a boulder to block the intuitive path
    if (boulderPositions.length < 3 && rng.random() < 0.4 && i > 2) {
      const boulderDir = intuitiveDir;
      const bDelta = getDelta(boulderDir);
      const boulderX = currentPos.x + bDelta.x * 2;
      const boulderY = currentPos.y + bDelta.y * 2;
      
      if (isInner(boulderX, boulderY, width, height) &&
          tiles[boulderY][boulderX] !== TileType.BOULDER &&
          !posEq({ x: boulderX, y: boulderY }, goal)) {
        // First create ground for boulder
        tiles[boulderY][boulderX] = TileType.GROUND;
        
        // Also create space around boulder for pushing
        for (const d of getAllDirs()) {
          const delta = getDelta(d);
          const px = boulderX + delta.x;
          const py = boulderY + delta.y;
          if (isInner(px, py, width, height) && tiles[py][px] === TileType.WALL) {
            tiles[py][px] = TileType.GROUND;
          }
        }
        
        boulderPositions.push({ x: boulderX, y: boulderY });
      }
    }
    
    waypoints.push({
      pos: { ...currentPos },
      requiredApproachDir: approachDir,
      hasBoulder: false
    });
    
    currentPos = sourcePos;
  }
  
  if (waypoints.length < 4) {
    return null;
  }
  
  const start = { ...currentPos };
  tiles[start.y][start.x] = TileType.GROUND;
  
  // Add decoy branches
  addConstraintDecoyBranches(tiles, waypoints, goal, width, height, rng);
  
  // Fill with additional ground to make map less obviously linear
  fillWithDecoyGround(tiles, solutionPath, start, goal, width, height, rng);
  
  return { tiles, start, goal, boulderPositions };
}

function getOppositeCornerDirection(pos: Position, goal: Position, width: number, height: number): Direction {
  const centerX = width / 2;
  const centerY = height / 2;
  
  if (goal.x > centerX && goal.y > centerY) {
    return pos.y > centerY ? Direction.UP : Direction.LEFT;
  } else if (goal.x < centerX && goal.y > centerY) {
    return pos.y > centerY ? Direction.UP : Direction.RIGHT;
  } else if (goal.x > centerX && goal.y < centerY) {
    return pos.y < centerY ? Direction.DOWN : Direction.LEFT;
  } else {
    return pos.y < centerY ? Direction.DOWN : Direction.RIGHT;
  }
}

function addConstraintDecoyBranches(
  tiles: TileType[][],
  waypoints: GroundWaypointConstraint[],
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom
): void {
  for (const wp of waypoints) {
    const intuitiveDirs = getIntuitiveDirection(wp.pos, goal);
    
    for (const decoyDir of intuitiveDirs) {
      if (decoyDir === wp.requiredApproachDir) continue;
      
      const decoyLength = rng.randomInt(3, 8);
      const delta = getDelta(decoyDir);
      
      let x = wp.pos.x + delta.x;
      let y = wp.pos.y + delta.y;
      
      for (let i = 0; i < decoyLength; i++) {
        if (!isInner(x, y, width, height)) break;
        if (tiles[y][x] === TileType.WALL) {
          tiles[y][x] = TileType.GROUND;
        }
        x += delta.x;
        y += delta.y;
      }
      
      // Dead-end wall
      if (isValid(x, y, width, height)) {
        tiles[y][x] = TileType.WALL;
      }
    }
  }
}

function fillWithDecoyGround(
  tiles: TileType[][],
  solutionPath: Set<string>,
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom
): void {
  const fillAttempts = Math.floor(width * height * 0.12);
  
  for (let i = 0; i < fillAttempts; i++) {
    const x = rng.randomInt(2, width - 2);
    const y = rng.randomInt(2, height - 2);
    
    if (tiles[y][x] !== TileType.WALL) continue;
    if (posEq({ x, y }, start) || posEq({ x, y }, goal)) continue;
    
    // Only fill if adjacent to existing ground
    let hasAdjacentGround = false;
    for (const dir of getAllDirs()) {
      const d = getDelta(dir);
      const nx = x + d.x;
      const ny = y + d.y;
      if (isValid(nx, ny, width, height) && 
          (tiles[ny][nx] === TileType.GROUND || tiles[ny][nx] === TileType.ICE)) {
        hasAdjacentGround = true;
        break;
      }
    }
    
    if (hasAdjacentGround && rng.random() < 0.35) {
      tiles[y][x] = TileType.GROUND;
    }
  }
}

// ============================================================================
// PSYCHOLOGY-BASED DIFFICULTY SCORING
// ============================================================================

export interface GroundPsychologyMetrics {
  counterIntuitiveMoves: number;
  icePatchCount: number;
  ledgeCount: number;
  boulderCount: number;
  attractiveDecoys: number;
  falseProgressPaths: number;
  optimalMoves: number;
  psychologyScore: number;
}

/**
 * Count moves on optimal path that go away from goal
 */
function countCounterIntuitiveMoves(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  config: MovementConfig
): number {
  const path = findOptimalPath(tiles, start, goal, width, height, config);
  if (!path || path.length < 2) return 0;
  
  let count = 0;
  
  for (let i = 0; i < path.length - 1; i++) {
    const current = path[i];
    const next = path[i + 1];
    
    const dx = Math.sign(next.x - current.x);
    const dy = Math.sign(next.y - current.y);
    
    let moveDir: Direction | null = null;
    if (dx > 0) moveDir = Direction.RIGHT;
    else if (dx < 0) moveDir = Direction.LEFT;
    else if (dy > 0) moveDir = Direction.DOWN;
    else if (dy < 0) moveDir = Direction.UP;
    
    if (!moveDir) continue;
    
    const intuitiveDirs = getIntuitiveDirection(current, goal);
    if (!intuitiveDirs.includes(moveDir)) {
      count++;
    }
  }
  
  return count;
}

/**
 * Count obstacles
 */
function countObstacles(tiles: TileType[][], width: number, height: number): { ice: number; ledges: number; boulders: number } {
  let ice = 0;
  let ledges = 0;
  let boulders = 0;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (tiles[y][x] === TileType.ICE) ice++;
      if (tiles[y][x] >= TileType.LEDGE_UP && tiles[y][x] <= TileType.LEDGE_RIGHT) ledges++;
      if (tiles[y][x] === TileType.BOULDER) boulders++;
    }
  }
  
  return { ice, ledges, boulders };
}

/**
 * Count attractive decoys
 */
function countAttractiveDecoys(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  config: MovementConfig
): number {
  const path = findOptimalPath(tiles, start, goal, width, height, config);
  if (!path || path.length < 2) return 0;
  
  let decoyCount = 0;
  
  for (let i = 0; i < path.length - 1; i++) {
    const current = path[i];
    const optimalNext = path[i + 1];
    
    for (const dir of getAllDirs()) {
      const result = simulateMove(tiles, current, dir, width, height, config);
      if (!result.valid || posEq(result.pos, current) || posEq(result.pos, optimalNext)) continue;
      
      const altDist = manhattanDist(result.pos, goal);
      const optDist = manhattanDist(optimalNext, goal);
      
      if (altDist < optDist) {
        decoyCount++;
      }
    }
  }
  
  return decoyCount;
}

/**
 * Count false progress paths
 */
function countFalseProgressPaths(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  config: MovementConfig
): number {
  const optimalMoves = findSimplePath(tiles, start, goal, width, height, config);
  if (optimalMoves === null) return 0;
  
  let falsePathCount = 0;
  const checked = new Set<string>();
  
  const queue: {
    pos: Position;
    distFromStart: number;
    minDistToGoal: number;
  }[] = [{
    pos: start,
    distFromStart: 0,
    minDistToGoal: manhattanDist(start, goal),
  }];
  
  checked.add(posKey(start));
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.distFromStart > optimalMoves + 6) continue;
    
    for (const dir of getAllDirs()) {
      const result = simulateMove(tiles, current.pos, dir, width, height, config);
      if (!result.valid || posEq(result.pos, current.pos)) continue;
      
      const key = posKey(result.pos);
      if (checked.has(key)) continue;
      checked.add(key);
      
      const newDistToGoal = manhattanDist(result.pos, goal);
      const isProgress = newDistToGoal < current.minDistToGoal;
      
      if (isProgress) {
        const pathFromHere = findSimplePath(tiles, result.pos, goal, width, height, config);
        if (pathFromHere !== null) {
          const totalPath = current.distFromStart + 1 + pathFromHere;
          if (totalPath > optimalMoves + 3) {
            falsePathCount++;
          }
        }
      }
      
      queue.push({
        pos: result.pos,
        distFromStart: current.distFromStart + 1,
        minDistToGoal: Math.min(current.minDistToGoal, newDistToGoal),
      });
    }
  }
  
  return falsePathCount;
}

/**
 * Calculate overall psychology score for ground puzzle
 * AGGRESSIVE scoring that heavily weights complexity factors
 */
export function calculateGroundPsychologyScore(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
): GroundPsychologyMetrics {
  const config = groundMovementConfig;
  
  // Use boulder-aware pathfinding for optimal moves
  const optimalMoves = findGroundPath(tiles, start, goal, width, height) ?? 
                       findSimplePath(tiles, start, goal, width, height, config) ?? 0;
  const { ice, ledges, boulders } = countObstacles(tiles, width, height);
  
  const counterIntuitiveMoves = countCounterIntuitiveMoves(tiles, start, goal, width, height, config);
  const attractiveDecoys = countAttractiveDecoys(tiles, start, goal, width, height, config);
  const falseProgressPaths = countFalseProgressPaths(tiles, start, goal, width, height, config);
  
  // AGGRESSIVE psychology score formula
  // Boulders are CRITICAL - heavily weighted
  // Counter-intuitive moves are the PRIMARY difficulty driver
  const psychologyScore =
    (counterIntuitiveMoves * 75) +  // INCREASED: Primary difficulty factor
    (ice * 20) +
    (ledges * 50) +                  // INCREASED: Commitment points
    (boulders * 150) +               // MASSIVELY INCREASED: Boulders are key!
    (attractiveDecoys * 40) +        // INCREASED: Decision paralysis
    (falseProgressPaths * 30) +      // INCREASED: Wasted moves
    (optimalMoves * 5);              // INCREASED: Longer paths = harder
  
  return {
    counterIntuitiveMoves,
    icePatchCount: ice,
    ledgeCount: ledges,
    boulderCount: boulders,
    attractiveDecoys,
    falseProgressPaths,
    optimalMoves,
    psychologyScore,
  };
}

// ============================================================================
// MAIN PUZZLE GENERATION - GENIUS DIFFICULTY ENGINE
// ============================================================================

/**
 * Generate a PERPLEXING ground-type puzzle
 * Uses constraint-based backwards generation + 10 deception algorithms
 */
export function generatePuzzle(seed: string): PuzzleData {
  const rng = new SeededRandom(seed);
  const config = groundMovementConfig;
  
  // MUCH LARGER map sizes (matching ice generator)
  const sizeOptions = [
    { width: 28, height: 22 },
    { width: 30, height: 22 },
    { width: 30, height: 24 },
    { width: 32, height: 24 },
    { width: 32, height: 26 },
    { width: 34, height: 26 },
    { width: 34, height: 28 },
    { width: 36, height: 28 },
  ];
  
  const { width, height } = rng.randomChoice(sizeOptions);
  
  let bestPuzzle: PuzzleData | null = null;
  let bestScore = 0;
  
  // ============================================
  // PHASE 1: Constraint-Based Backwards Generation (Primary)
  // ============================================
  
  for (let cbAttempt = 0; cbAttempt < 100; cbAttempt++) {
    const cbRng = new SeededRandom(seed + '-cb-' + cbAttempt);
    const chainLength = cbRng.randomInt(10, 18);
    
    const result = generateConstraintBasedGroundPuzzle(width, height, cbRng, chainLength);
    if (!result) continue;
    
    const { tiles, start, goal, boulderPositions } = result;
    
    // Place boulders from constraint generation
    for (const bp of boulderPositions) {
      if (tiles[bp.y][bp.x] === TileType.GROUND) {
        tiles[bp.y][bp.x] = TileType.BOULDER;
      }
    }
    
    // Add MORE complexity with deception algorithms
    addWindingWalls(tiles, start, goal, width, height, cbRng, config, cbRng.randomInt(8, 16));
    blockIntuitiveApproaches(tiles, start, goal, width, height, cbRng, config);
    
    // MANDATORY additional boulders (ensure at least 2 total)
    const currentBoulders = countBoulders(tiles, width, height);
    if (currentBoulders < 2) {
      placeBoulders(tiles, start, goal, width, height, cbRng, config, 3 - currentBoulders);
    }
    
    // Ice patches for added complexity
    placeIcePatches(tiles, start, goal, width, height, cbRng, config, cbRng.randomInt(4, 8));
    placeIceRunways(tiles, start, goal, width, height, cbRng, config, cbRng.randomInt(3, 6));
    
    // Ledges for commitment points
    placeLedges(tiles, start, goal, width, height, cbRng, config, cbRng.randomInt(6, 14));
    
    tiles[start.y][start.x] = TileType.START;
    tiles[goal.y][goal.x] = TileType.GOAL;
    
    const optimalMoves = findGroundPath(tiles, start, goal, width, height);
    if (optimalMoves === null || optimalMoves < 18) continue;
    
    const psychMetrics = calculateGroundPsychologyScore(tiles, start, goal, width, height);
    const score = psychMetrics.psychologyScore;
    
    if (score > bestScore) {
      bestScore = score;
      bestPuzzle = {
        width,
        height,
        tiles,
        start,
        goal,
        optimalMoves,
        mapType: MapType.GROUND,
        difficultyScore: Math.round(score),
        counterIntuitiveMoves: psychMetrics.counterIntuitiveMoves,
        attractiveDecoys: psychMetrics.attractiveDecoys,
        commitmentGates: psychMetrics.ledgeCount + psychMetrics.boulderCount,
        falseProgressPaths: psychMetrics.falseProgressPaths,
      };
    }
    
    // Found EXCELLENT puzzle - STRICT thresholds
    if (psychMetrics.counterIntuitiveMoves >= 7 &&
        psychMetrics.boulderCount >= 2 &&
        psychMetrics.attractiveDecoys >= 8 &&
        psychMetrics.ledgeCount >= 4) {
      return bestPuzzle!;
    }
  }
  
  // If constraint-based found something good, use it
  if (bestPuzzle && bestPuzzle.counterIntuitiveMoves && bestPuzzle.counterIntuitiveMoves >= 5 &&
      bestPuzzle.commitmentGates && bestPuzzle.commitmentGates >= 4) {
    return bestPuzzle;
  }
  
  // ============================================
  // PHASE 2: Traditional Generation with ALL Deception Algorithms
  // ============================================
  
  for (let attempt = 0; attempt < 180; attempt++) {
    const attemptRng = new SeededRandom(seed + '-trad-' + attempt);
    
    const tiles = attemptRng.random() < 0.6
      ? createMazeRoom(width, height, attemptRng)
      : createOpenRoom(width, height, attemptRng);
    
    widenPassages(tiles, width, height, attemptRng, 0.15);
    
    const groundTiles: Position[] = [];
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        if (tiles[y][x] === TileType.GROUND) {
          groundTiles.push({ x, y });
        }
      }
    }
    
    if (groundTiles.length < 80) continue; // Need more ground for larger maps
    
    const leftTiles = groundTiles.filter(p => p.x < width / 5);
    const rightTiles = groundTiles.filter(p => p.x > (4 * width) / 5);
    const topLeftTiles = groundTiles.filter(p => p.x < width / 4 && p.y < height / 3);
    const bottomRightTiles = groundTiles.filter(p => p.x > (3 * width) / 4 && p.y > (2 * height) / 3);
    
    let start: Position, goal: Position;
    
    if (topLeftTiles.length > 0 && bottomRightTiles.length > 0 && attemptRng.random() < 0.7) {
      start = attemptRng.randomChoice(topLeftTiles);
      goal = attemptRng.randomChoice(bottomRightTiles);
    } else if (leftTiles.length > 0 && rightTiles.length > 0) {
      start = attemptRng.randomChoice(leftTiles);
      goal = attemptRng.randomChoice(rightTiles);
    } else {
      continue;
    }
    
    if (!isSimplySolvable(tiles, start, goal, width, height, config)) continue;
    
    // Base complexity - INCREASED
    addWindingWalls(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(10, 20));
    blockIntuitiveApproaches(tiles, start, goal, width, height, attemptRng, config);
    addExtraConnections(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(15, 30));
    
    // ============================================
    // GENIUS-LEVEL DECEPTION ENGINE - ALL 10 ALGORITHMS
    // ============================================
    
    // ALGORITHM 1: Force counter-intuitive paths
    engineerCounterIntuitivePath(tiles, start, goal, width, height, attemptRng);
    
    // ALGORITHM 2: Almost there traps
    createAlmostThereTraps(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(4, 8));
    
    // ALGORITHM 3: Decoy open areas
    createDecoyOpenAreas(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(5, 10));
    
    // ALGORITHM 4: Hidden choke points
    createHiddenChokePoints(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(4, 8));
    
    // ALGORITHM 5: Momentum traps (ice)
    createMomentumTraps(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(6, 12));
    
    // ALGORITHM 6: Anti-gradient zones
    createAntiGradientZones(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(4, 8));
    
    // ALGORITHM 7: Parallel path illusion
    createParallelPathIllusion(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(5, 10));
    
    // ALGORITHM 8: Ledge misdirection
    createLedgeMisdirection(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(8, 16));
    
    // ALGORITHM 9: Goal proximity dead ends
    createGoalProximityDeadEnds(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(4, 8));
    
    // ALGORITHM 10: Commitment traps
    createCommitmentTraps(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(5, 10));
    
    // ============================================
    // ADDITIONAL COMPLEXITY LAYERS
    // ============================================
    
    addFunnelPatterns(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(4, 8));
    addTrapAlcoves(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(6, 12));
    addPrecisionGates(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(6, 12));
    addDeceptivePaths(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(15, 30));
    addDeadEndMagnets(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(4, 8));
    
    // ============================================
    // MANDATORY BOULDERS (2-3) - ALWAYS PLACED
    // ============================================
    
    placeBoulders(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(2, 4));
    
    // Verify we have boulders - REQUIRED
    const boulderCount = countBoulders(tiles, width, height);
    if (boulderCount < 2) {
      // Force more boulder placement attempts
      for (let extraAttempt = 0; extraAttempt < 50 && countBoulders(tiles, width, height) < 2; extraAttempt++) {
        placeBoulders(tiles, start, goal, width, height, attemptRng, config, 1);
      }
    }
    
    // Ice patches AFTER boulders
    placeIcePatches(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(5, 10));
    placeIceRunways(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(4, 8));
    
    // Ledges for commitment points
    placeLedges(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(8, 16));
    
    tiles[start.y][start.x] = TileType.START;
    tiles[goal.y][goal.x] = TileType.GOAL;
    
    // Final solvability check
    const optimalMoves = findGroundPath(tiles, start, goal, width, height);
    if (optimalMoves === null) continue;
    if (optimalMoves < 18) continue; // STRICTER minimum
    
    // Verify no stuck states
    if (!hasNoBoulderStuckStates(tiles, start, goal, width, height)) continue;
    
    const psychMetrics = calculateGroundPsychologyScore(tiles, start, goal, width, height);
    const score = psychMetrics.psychologyScore;
    
    // REQUIRE boulders for a good puzzle
    if (psychMetrics.boulderCount < 1) continue;
    
    if (score > bestScore) {
      bestScore = score;
      bestPuzzle = {
        width,
        height,
        tiles,
        start,
        goal,
        optimalMoves,
        mapType: MapType.GROUND,
        difficultyScore: Math.round(score),
        counterIntuitiveMoves: psychMetrics.counterIntuitiveMoves,
        attractiveDecoys: psychMetrics.attractiveDecoys,
        commitmentGates: psychMetrics.ledgeCount + psychMetrics.boulderCount,
        falseProgressPaths: psychMetrics.falseProgressPaths,
      };
    }
    
    // STRICT early exit criteria (matching ice generator quality)
    if (psychMetrics.counterIntuitiveMoves >= 7 &&
        psychMetrics.boulderCount >= 2 &&
        psychMetrics.attractiveDecoys >= 8 &&
        psychMetrics.ledgeCount >= 4) {
      break;
    }
  }
  
  if (!bestPuzzle) {
    return createFallbackPuzzle(width, height, rng, config);
  }
  
  return bestPuzzle;
}

/**
 * Partial puzzle generation for parallel workers
 * Uses full deception engine with STRICT quality requirements
 */
export function generatePuzzlePartial(
  seed: string,
  constraintStart: number,
  constraintEnd: number,
  traditionalStart: number,
  traditionalEnd: number
): { puzzle: PuzzleData | null; score: number } {
  const rng = new SeededRandom(seed);
  const config = groundMovementConfig;
  
  // LARGER map sizes (matching main generator)
  const sizeOptions = [
    { width: 28, height: 22 },
    { width: 30, height: 22 },
    { width: 30, height: 24 },
    { width: 32, height: 24 },
    { width: 32, height: 26 },
    { width: 34, height: 26 },
  ];
  
  const { width, height } = rng.randomChoice(sizeOptions);
  
  let bestPuzzle: PuzzleData | null = null;
  let bestScore = 0;
  
  // PHASE 1: Constraint-Based Generation
  for (let cbAttempt = constraintStart; cbAttempt < constraintEnd; cbAttempt++) {
    const cbRng = new SeededRandom(seed + '-cb-' + cbAttempt);
    const chainLength = cbRng.randomInt(10, 16);
    
    const result = generateConstraintBasedGroundPuzzle(width, height, cbRng, chainLength);
    if (!result) continue;
    
    const { tiles, start, goal, boulderPositions } = result;
    
    // Place boulders
    for (const bp of boulderPositions) {
      if (tiles[bp.y][bp.x] === TileType.GROUND) {
        tiles[bp.y][bp.x] = TileType.BOULDER;
      }
    }
    
    addWindingWalls(tiles, start, goal, width, height, cbRng, config, cbRng.randomInt(6, 12));
    blockIntuitiveApproaches(tiles, start, goal, width, height, cbRng, config);
    
    // MANDATORY boulders
    if (countBoulders(tiles, width, height) < 2) {
      placeBoulders(tiles, start, goal, width, height, cbRng, config, 2);
    }
    
    placeIcePatches(tiles, start, goal, width, height, cbRng, config, cbRng.randomInt(4, 8));
    placeIceRunways(tiles, start, goal, width, height, cbRng, config, cbRng.randomInt(3, 6));
    placeLedges(tiles, start, goal, width, height, cbRng, config, cbRng.randomInt(6, 12));
    
    tiles[start.y][start.x] = TileType.START;
    tiles[goal.y][goal.x] = TileType.GOAL;
    
    const optimalMoves = findGroundPath(tiles, start, goal, width, height);
    if (optimalMoves === null || optimalMoves < 16) continue;
    
    const psychMetrics = calculateGroundPsychologyScore(tiles, start, goal, width, height);
    const score = psychMetrics.psychologyScore;
    
    if (psychMetrics.boulderCount < 1) continue; // REQUIRE boulders
    
    if (score > bestScore) {
      bestScore = score;
      bestPuzzle = {
        width,
        height,
        tiles,
        start,
        goal,
        optimalMoves,
        mapType: MapType.GROUND,
        difficultyScore: Math.round(score),
        counterIntuitiveMoves: psychMetrics.counterIntuitiveMoves,
        attractiveDecoys: psychMetrics.attractiveDecoys,
        commitmentGates: psychMetrics.ledgeCount + psychMetrics.boulderCount,
        falseProgressPaths: psychMetrics.falseProgressPaths,
      };
    }
    
    // STRICT early exit
    if (psychMetrics.counterIntuitiveMoves >= 6 &&
        psychMetrics.boulderCount >= 2 &&
        psychMetrics.attractiveDecoys >= 7) {
      return { puzzle: bestPuzzle, score: bestScore };
    }
  }
  
  // Return if constraint-based found something good
  if (bestPuzzle && bestPuzzle.counterIntuitiveMoves && bestPuzzle.counterIntuitiveMoves >= 4 &&
      bestPuzzle.commitmentGates && bestPuzzle.commitmentGates >= 3) {
    return { puzzle: bestPuzzle, score: bestScore };
  }
  
  // PHASE 2: Traditional Generation with Deception Algorithms
  for (let attempt = traditionalStart; attempt < traditionalEnd; attempt++) {
    const attemptRng = new SeededRandom(seed + '-trad-' + attempt);
    
    const tiles = attemptRng.random() < 0.6
      ? createMazeRoom(width, height, attemptRng)
      : createOpenRoom(width, height, attemptRng);
    
    widenPassages(tiles, width, height, attemptRng, 0.14);
    
    const groundTiles: Position[] = [];
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        if (tiles[y][x] === TileType.GROUND) {
          groundTiles.push({ x, y });
        }
      }
    }
    
    if (groundTiles.length < 60) continue;
    
    const leftTiles = groundTiles.filter(p => p.x < width / 5);
    const rightTiles = groundTiles.filter(p => p.x > (4 * width) / 5);
    const topLeftTiles = groundTiles.filter(p => p.x < width / 4 && p.y < height / 3);
    const bottomRightTiles = groundTiles.filter(p => p.x > (3 * width) / 4 && p.y > (2 * height) / 3);
    
    let start: Position, goal: Position;
    
    if (topLeftTiles.length > 0 && bottomRightTiles.length > 0 && attemptRng.random() < 0.7) {
      start = attemptRng.randomChoice(topLeftTiles);
      goal = attemptRng.randomChoice(bottomRightTiles);
    } else if (leftTiles.length > 0 && rightTiles.length > 0) {
      start = attemptRng.randomChoice(leftTiles);
      goal = attemptRng.randomChoice(rightTiles);
    } else {
      continue;
    }
    
    if (!isSimplySolvable(tiles, start, goal, width, height, config)) continue;
    
    // Base complexity
    addWindingWalls(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(8, 16));
    blockIntuitiveApproaches(tiles, start, goal, width, height, attemptRng, config);
    addExtraConnections(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(12, 25));
    
    // Deception algorithms
    engineerCounterIntuitivePath(tiles, start, goal, width, height, attemptRng);
    createAlmostThereTraps(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(3, 6));
    createDecoyOpenAreas(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(4, 8));
    createMomentumTraps(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(4, 8));
    createAntiGradientZones(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(3, 6));
    createLedgeMisdirection(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(6, 12));
    createCommitmentTraps(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(4, 8));
    
    // MANDATORY boulders
    placeBoulders(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(2, 4));
    
    placeIcePatches(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(4, 8));
    placeIceRunways(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(3, 6));
    placeLedges(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(6, 12));
    
    tiles[start.y][start.x] = TileType.START;
    tiles[goal.y][goal.x] = TileType.GOAL;
    
    const optimalMoves = findGroundPath(tiles, start, goal, width, height);
    if (optimalMoves === null || optimalMoves < 16) continue;
    
    const psychMetrics = calculateGroundPsychologyScore(tiles, start, goal, width, height);
    const score = psychMetrics.psychologyScore;
    
    if (psychMetrics.boulderCount < 1) continue; // REQUIRE boulders
    
    if (score > bestScore) {
      bestScore = score;
      bestPuzzle = {
        width,
        height,
        tiles,
        start,
        goal,
        optimalMoves,
        mapType: MapType.GROUND,
        difficultyScore: Math.round(score),
        counterIntuitiveMoves: psychMetrics.counterIntuitiveMoves,
        attractiveDecoys: psychMetrics.attractiveDecoys,
        commitmentGates: psychMetrics.ledgeCount + psychMetrics.boulderCount,
        falseProgressPaths: psychMetrics.falseProgressPaths,
      };
    }
    
    // STRICT early exit
    if (psychMetrics.counterIntuitiveMoves >= 6 &&
        psychMetrics.boulderCount >= 2 &&
        psychMetrics.attractiveDecoys >= 7) {
      return { puzzle: bestPuzzle, score: bestScore };
    }
  }
  
  return { puzzle: bestPuzzle, score: bestScore };
}

/**
 * Create a CHALLENGING fallback puzzle with deliberate counter-intuitive design
 * This is the backup when random generation fails - still needs to be hard!
 */
function createFallbackPuzzle(
  width: number, 
  height: number, 
  rng: SeededRandom,
  config: MovementConfig
): PuzzleData {
  const tiles: TileType[][] = Array(height).fill(null).map(() => Array(width).fill(TileType.WALL));
  
  // Create a serpentine corridor structure
  const corridorY1 = Math.floor(height * 0.2);
  const corridorY2 = Math.floor(height * 0.5);
  const corridorY3 = Math.floor(height * 0.8);
  
  const corridorX1 = Math.floor(width * 0.15);
  const corridorX2 = Math.floor(width * 0.4);
  const corridorX3 = Math.floor(width * 0.6);
  const corridorX4 = Math.floor(width * 0.85);
  
  // Create horizontal corridors (2 tiles wide)
  for (const cy of [corridorY1, corridorY2, corridorY3]) {
    for (let x = 2; x < width - 2; x++) {
      for (let dy = -1; dy <= 1; dy++) {
        const y = cy + dy;
        if (isInner(x, y, width, height)) {
          tiles[y][x] = TileType.GROUND;
        }
      }
    }
  }
  
  // Create vertical corridors (2 tiles wide)
  for (const cx of [corridorX1, corridorX2, corridorX3, corridorX4]) {
    for (let y = 2; y < height - 2; y++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        if (isInner(x, y, width, height)) {
          tiles[y][x] = TileType.GROUND;
        }
      }
    }
  }
  
  // Start top-left, goal bottom-right (but block the direct path!)
  const start = { x: corridorX1, y: corridorY1 };
  const goal = { x: corridorX4, y: corridorY3 };
  
  // Block the intuitive right-then-down path with walls
  for (let x = corridorX3 + 2; x < corridorX4 - 2; x++) {
    for (let y = corridorY2 - 1; y <= corridorY2 + 1; y++) {
      if (isInner(x, y, width, height) && 
          !posEq({ x, y }, start) && !posEq({ x, y }, goal)) {
        tiles[y][x] = TileType.WALL;
      }
    }
  }
  
  // Block approach to goal from above
  for (let y = corridorY2 + 2; y < corridorY3 - 2; y++) {
    const x = corridorX4;
    if (isInner(x, y, width, height)) {
      tiles[y][x] = TileType.WALL;
      if (isInner(x - 1, y, width, height)) tiles[y][x - 1] = TileType.WALL;
    }
  }
  
  // Add MANDATORY boulders blocking obvious routes
  const boulderPositions = [
    { x: corridorX2 + 2, y: corridorY1 },
    { x: corridorX3, y: corridorY2 + 2 },
  ];
  
  for (const bp of boulderPositions) {
    if (isInner(bp.x, bp.y, width, height) &&
        tiles[bp.y][bp.x] === TileType.GROUND &&
        !posEq(bp, start) && !posEq(bp, goal)) {
      tiles[bp.y][bp.x] = TileType.BOULDER;
    }
  }
  
  // Add ice patches for sliding complexity
  const icePositions = [
    { x: corridorX2, y: corridorY2 },
    { x: corridorX2 + 1, y: corridorY2 },
    { x: corridorX2 - 1, y: corridorY2 },
    { x: corridorX2, y: corridorY2 + 1 },
    { x: corridorX2, y: corridorY2 - 1 },
    { x: corridorX3, y: corridorY3 },
    { x: corridorX3 + 1, y: corridorY3 },
    { x: corridorX3 - 1, y: corridorY3 },
  ];
  
  for (const pos of icePositions) {
    if (isInner(pos.x, pos.y, width, height) &&
        tiles[pos.y][pos.x] === TileType.GROUND &&
        !posEq(pos, start) && !posEq(pos, goal)) {
      tiles[pos.y][pos.x] = TileType.ICE;
    }
  }
  
  // Add ledges for commitment points
  const ledgePositions: { x: number; y: number; type: TileType }[] = [
    { x: corridorX2, y: corridorY1 + 2, type: TileType.LEDGE_DOWN },
    { x: corridorX3, y: corridorY2 - 2, type: TileType.LEDGE_UP },
    { x: corridorX2 + 2, y: corridorY2, type: TileType.LEDGE_RIGHT },
  ];
  
  for (const lp of ledgePositions) {
    if (isInner(lp.x, lp.y, width, height) &&
        tiles[lp.y][lp.x] === TileType.GROUND &&
        !posEq({ x: lp.x, y: lp.y }, start) &&
        !posEq({ x: lp.x, y: lp.y }, goal)) {
      tiles[lp.y][lp.x] = lp.type;
    }
  }
  
  // Add walls to create maze complexity
  for (let i = 0; i < 80; i++) {
    const x = rng.randomInt(3, width - 3);
    const y = rng.randomInt(3, height - 3);
    if (!posEq({ x, y }, start) && !posEq({ x, y }, goal) && 
        tiles[y][x] === TileType.GROUND) {
      tiles[y][x] = TileType.WALL;
      if (!isBoulderSolvable(tiles, start, goal, width, height, 80)) {
        tiles[y][x] = TileType.GROUND;
      }
    }
  }
  
  // Open an escape path that requires going LEFT first (counter-intuitive!)
  const escapeX = corridorX1 - 2;
  for (let y = corridorY1; y <= corridorY3; y++) {
    if (isInner(escapeX, y, width, height)) {
      tiles[y][escapeX] = TileType.GROUND;
    }
  }
  
  tiles[start.y][start.x] = TileType.START;
  tiles[goal.y][goal.x] = TileType.GOAL;
  
  // Ensure solvability
  if (!isBoulderSolvable(tiles, start, goal, width, height, 100)) {
    // Emergency: open more paths
    for (let y = corridorY2 - 1; y <= corridorY2 + 1; y++) {
      for (let x = corridorX1; x <= corridorX4; x++) {
        if (isInner(x, y, width, height)) {
          tiles[y][x] = TileType.GROUND;
        }
      }
    }
  }
  
  const optimalMoves = findGroundPath(tiles, start, goal, width, height) ?? 
                       findSimplePath(tiles, start, goal, width, height, config) ?? 25;
  
  return {
    width,
    height,
    tiles,
    start,
    goal,
    optimalMoves,
    mapType: MapType.GROUND,
    difficultyScore: 400,
    counterIntuitiveMoves: 4,
    attractiveDecoys: 3,
    commitmentGates: 5,
  };
}

