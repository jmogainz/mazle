/**
 * Ground Map Generator - Step-Based Puzzle with Sokoban Elements
 * 
 * Creates challenging puzzles using:
 * - Step-based movement on ground tiles
 * - Strategic ice patches (local sliding zones)
 * - One-way ledges (commitment points)
 * - Pushable boulders (1-2 max for performance)
 * 
 * Boulder mechanics are Sokoban-style:
 * - Player pushes boulders in movement direction
 * - Boulders slide on ice
 * - Pushing boulder into wall/corner can create dead states
 * 
 * PERFORMANCE: Limited to 1-2 boulders to keep state space manageable
 * (~10,000 states with 2 boulders vs millions with 5+)
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
// OBSTACLE PLACEMENT - BOULDERS (LIMITED TO 1-2 FOR PERFORMANCE)
// ============================================================================

/**
 * Place boulders strategically - blocking the direct path
 * Limited to 1-2 boulders to keep state space manageable
 */
function placeBoulders(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  config: MovementConfig,
  maxBoulders: number = 2
): void {
  // Find the optimal path without boulders
  const optimalPath = findOptimalPath(tiles, start, goal, width, height, config);
  if (!optimalPath || optimalPath.length < 8) return;
  
  let placed = 0;
  let attempts = 0;
  
  // Strategy: Place boulders on or near the optimal path
  // This forces the player to push them to progress
  while (placed < maxBoulders && attempts < maxBoulders * 30) {
    attempts++;
    
    // Choose a position along the path (not too early, not at goal)
    const pathIndex = rng.randomInt(Math.floor(optimalPath.length * 0.3), optimalPath.length - 2);
    const pathPos = optimalPath[pathIndex];
    
    // Offset slightly from path sometimes
    const offsetX = rng.randomInt(-1, 2);
    const offsetY = rng.randomInt(-1, 2);
    const bx = pathPos.x + offsetX;
    const by = pathPos.y + offsetY;
    
    if (!isInner(bx, by, width, height)) continue;
    if (tiles[by][bx] !== TileType.GROUND) continue;
    if (posEq({ x: bx, y: by }, start) || posEq({ x: bx, y: by }, goal)) continue;
    
    // Don't place adjacent to start
    if (manhattanDist({ x: bx, y: by }, start) < 2) continue;
    
    // Check that boulder is pushable (has open space on opposite side)
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
          tiles[aheadY][aheadX] !== TileType.WALL) {
        pushable = true;
        break;
      }
    }
    
    if (!pushable) continue;
    
    // Place boulder
    tiles[by][bx] = TileType.BOULDER;
    
    // Verify solvability with depth-limited search
    if (!isBoulderSolvable(tiles, start, goal, width, height, 50)) {
      tiles[by][bx] = TileType.GROUND;
      continue;
    }
    
    placed++;
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
  
  // Psychology score formula with boulder bonus
  const psychologyScore =
    (counterIntuitiveMoves * 50) +
    (ice * 15) +
    (ledges * 40) +
    (boulders * 80) +  // Boulders add significant complexity!
    (attractiveDecoys * 30) +
    (falseProgressPaths * 20) +
    (optimalMoves * 3);
  
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
// MAIN PUZZLE GENERATION
// ============================================================================

/**
 * Generate a ground-type puzzle
 */
export function generatePuzzle(seed: string): PuzzleData {
  const rng = new SeededRandom(seed);
  const config = groundMovementConfig;
  
  const sizeOptions = [
    { width: 18, height: 14 },
    { width: 20, height: 14 },
    { width: 20, height: 16 },
    { width: 22, height: 16 },
    { width: 22, height: 18 },
    { width: 24, height: 18 },
  ];
  
  const { width, height } = rng.randomChoice(sizeOptions);
  
  let bestPuzzle: PuzzleData | null = null;
  let bestScore = 0;
  
  for (let attempt = 0; attempt < 80; attempt++) {
    const attemptRng = new SeededRandom(seed + '-attempt-' + attempt);
    
    const tiles = attemptRng.random() < 0.6
      ? createMazeRoom(width, height, attemptRng)
      : createOpenRoom(width, height, attemptRng);
    
    widenPassages(tiles, width, height, attemptRng, 0.12);
    
    const groundTiles: Position[] = [];
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        if (tiles[y][x] === TileType.GROUND) {
          groundTiles.push({ x, y });
        }
      }
    }
    
    if (groundTiles.length < 40) continue;
    
    const leftTiles = groundTiles.filter(p => p.x < width / 4);
    const rightTiles = groundTiles.filter(p => p.x > (3 * width) / 4);
    const topLeftTiles = groundTiles.filter(p => p.x < width / 3 && p.y < height / 3);
    const bottomRightTiles = groundTiles.filter(p => p.x > (2 * width) / 3 && p.y > (2 * height) / 3);
    
    let start: Position, goal: Position;
    
    if (topLeftTiles.length > 0 && bottomRightTiles.length > 0 && attemptRng.random() < 0.6) {
      start = attemptRng.randomChoice(topLeftTiles);
      goal = attemptRng.randomChoice(bottomRightTiles);
    } else if (leftTiles.length > 0 && rightTiles.length > 0) {
      start = attemptRng.randomChoice(leftTiles);
      goal = attemptRng.randomChoice(rightTiles);
    } else {
      continue;
    }
    
    if (!isSimplySolvable(tiles, start, goal, width, height, config)) continue;
    
    // Add complexity BEFORE boulders
    addWindingWalls(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(4, 10));
    blockIntuitiveApproaches(tiles, start, goal, width, height, attemptRng, config);
    addExtraConnections(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(5, 12));
    
    // Place boulders (1-2 max for performance)
    const wantBoulders = attemptRng.random() < 0.7; // 70% chance for boulders
    if (wantBoulders) {
      placeBoulders(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(1, 3));
    }
    
    // Place ice patches
    placeIcePatches(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(3, 7));
    placeIceRunways(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(2, 5));
    
    // Place ledges
    placeLedges(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(4, 10));
    
    tiles[start.y][start.x] = TileType.START;
    tiles[goal.y][goal.x] = TileType.GOAL;
    
    // Final solvability check with boulder state
    const optimalMoves = findGroundPath(tiles, start, goal, width, height);
    if (optimalMoves === null) continue;
    if (optimalMoves < 12) continue;
    
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
    
    // Early exit if good enough
    if (psychMetrics.counterIntuitiveMoves >= 4 &&
        (psychMetrics.ledgeCount >= 3 || psychMetrics.boulderCount >= 1) &&
        psychMetrics.attractiveDecoys >= 5) {
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
  
  const sizeOptions = [
    { width: 18, height: 14 },
    { width: 20, height: 14 },
    { width: 20, height: 16 },
    { width: 22, height: 16 },
    { width: 22, height: 18 },
    { width: 24, height: 18 },
  ];
  
  const { width, height } = rng.randomChoice(sizeOptions);
  
  let bestPuzzle: PuzzleData | null = null;
  let bestScore = 0;
  
  const totalAttempts = Math.min(
    (constraintEnd - constraintStart) + (traditionalEnd - traditionalStart),
    30 // Reduced for faster worker completion
  );
  
  for (let i = 0; i < totalAttempts; i++) {
    const attemptNum = i < (constraintEnd - constraintStart)
      ? constraintStart + i
      : traditionalStart + (i - (constraintEnd - constraintStart));
    
    const attemptRng = new SeededRandom(seed + '-partial-' + attemptNum);
    
    const tiles = attemptRng.random() < 0.6
      ? createMazeRoom(width, height, attemptRng)
      : createOpenRoom(width, height, attemptRng);
    
    widenPassages(tiles, width, height, attemptRng, 0.12);
    
    const groundTiles: Position[] = [];
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        if (tiles[y][x] === TileType.GROUND) {
          groundTiles.push({ x, y });
        }
      }
    }
    
    if (groundTiles.length < 40) continue;
    
    const leftTiles = groundTiles.filter(p => p.x < width / 4);
    const rightTiles = groundTiles.filter(p => p.x > (3 * width) / 4);
    const topLeftTiles = groundTiles.filter(p => p.x < width / 3 && p.y < height / 3);
    const bottomRightTiles = groundTiles.filter(p => p.x > (2 * width) / 3 && p.y > (2 * height) / 3);
    
    let start: Position, goal: Position;
    
    if (topLeftTiles.length > 0 && bottomRightTiles.length > 0 && attemptRng.random() < 0.6) {
      start = attemptRng.randomChoice(topLeftTiles);
      goal = attemptRng.randomChoice(bottomRightTiles);
    } else if (leftTiles.length > 0 && rightTiles.length > 0) {
      start = attemptRng.randomChoice(leftTiles);
      goal = attemptRng.randomChoice(rightTiles);
    } else {
      continue;
    }
    
    if (!isSimplySolvable(tiles, start, goal, width, height, config)) continue;
    
    addWindingWalls(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(4, 10));
    blockIntuitiveApproaches(tiles, start, goal, width, height, attemptRng, config);
    addExtraConnections(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(5, 12));
    
    // Boulders with lower probability in worker (faster)
    if (attemptRng.random() < 0.5) {
      placeBoulders(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(1, 3));
    }
    
    placeIcePatches(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(3, 7));
    placeIceRunways(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(2, 5));
    placeLedges(tiles, start, goal, width, height, attemptRng, config, attemptRng.randomInt(4, 10));
    
    tiles[start.y][start.x] = TileType.START;
    tiles[goal.y][goal.x] = TileType.GOAL;
    
    const optimalMoves = findGroundPath(tiles, start, goal, width, height);
    if (optimalMoves === null) continue;
    if (optimalMoves < 12) continue;
    
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
    
    if (psychMetrics.counterIntuitiveMoves >= 4 &&
        (psychMetrics.ledgeCount >= 3 || psychMetrics.boulderCount >= 1) &&
        psychMetrics.attractiveDecoys >= 5) {
      return { puzzle: bestPuzzle, score: bestScore };
    }
  }
  
  return { puzzle: bestPuzzle, score: bestScore };
}

/**
 * Create a guaranteed solvable fallback puzzle
 */
function createFallbackPuzzle(
  width: number, 
  height: number, 
  rng: SeededRandom,
  config: MovementConfig
): PuzzleData {
  const tiles: TileType[][] = Array(height).fill(null).map(() => Array(width).fill(TileType.WALL));
  
  const corridorY1 = Math.floor(height * 0.25);
  const corridorY2 = Math.floor(height * 0.5);
  const corridorY3 = Math.floor(height * 0.75);
  
  const corridorX1 = Math.floor(width * 0.2);
  const corridorX2 = Math.floor(width * 0.5);
  const corridorX3 = Math.floor(width * 0.8);
  
  for (const cy of [corridorY1, corridorY2, corridorY3]) {
    for (let x = 2; x < width - 2; x++) {
      if (isInner(x, cy, width, height)) {
        tiles[cy][x] = TileType.GROUND;
      }
    }
  }
  
  for (const cx of [corridorX1, corridorX2, corridorX3]) {
    for (let y = 2; y < height - 2; y++) {
      if (isInner(cx, y, width, height)) {
        tiles[y][cx] = TileType.GROUND;
      }
    }
  }
  
  const start = { x: corridorX1, y: corridorY1 };
  const goal = { x: corridorX3, y: corridorY3 };
  
  const icePositions = [
    { x: corridorX2, y: corridorY2 },
    { x: corridorX2 + 1, y: corridorY2 },
    { x: corridorX2 - 1, y: corridorY2 },
  ];
  
  for (const pos of icePositions) {
    if (isInner(pos.x, pos.y, width, height) &&
        tiles[pos.y][pos.x] === TileType.GROUND) {
      tiles[pos.y][pos.x] = TileType.ICE;
    }
  }
  
  tiles[start.y][start.x] = TileType.START;
  tiles[goal.y][goal.x] = TileType.GOAL;
  
  const optimalMoves = findSimplePath(tiles, start, goal, width, height, config) ?? 15;
  
  return {
    width,
    height,
    tiles,
    start,
    goal,
    optimalMoves,
    mapType: MapType.GROUND,
    difficultyScore: 100,
  };
}
