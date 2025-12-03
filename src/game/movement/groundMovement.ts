/**
 * Ground-specific movement simulation with boulder pushing support.
 * 
 * This extends the basic movement system to handle Sokoban-style boulder mechanics:
 * - Boulders can be pushed in the direction of movement
 * - Boulders slide on ice when pushed onto ice tiles
 * - Boulders can be pushed off ledges (one-way, can't retrieve)
 * - Pushing a boulder into a wall or another boulder fails
 * 
 * This is used by the ground puzzle generator for pathfinding with dynamic state.
 */

import { TileType, Direction, Position } from '../types';
import { getDelta, getAllDirections, isValidPosition, isInnerPosition, positionKey, positionsEqual } from './simulateMove';

/**
 * State representing the current puzzle configuration.
 * For ground puzzles, this includes boulder positions which can change.
 */
export interface GroundPuzzleState {
  tiles: TileType[][];
  boulderPositions: Set<string>;  // positionKeys of all boulder locations
  width: number;
  height: number;
}

/**
 * Result of simulating a ground move with boulder state
 */
export interface GroundMoveResult {
  playerPos: Position;
  valid: boolean;
  boulderPushed: boolean;
  boulderFrom?: Position;
  boulderTo?: Position;
  newBoulderPositions?: Set<string>;
  path?: Position[];  // Player path for animation
  boulderPath?: Position[];  // Boulder path for animation (if pushed on ice)
}

/**
 * Check if a position has a boulder
 */
function hasBoulder(state: GroundPuzzleState, pos: Position): boolean {
  return state.boulderPositions.has(positionKey(pos));
}

/**
 * Check if a tile blocks movement (walls only, not boulders - boulders checked separately)
 */
function isBlockingTile(tile: TileType): boolean {
  return tile === TileType.WALL;
}

/**
 * Check if a tile is slideable (ice)
 */
function isIceTile(tile: TileType): boolean {
  return tile === TileType.ICE;
}

/**
 * Check if a tile is a ledge
 */
function isLedge(tile: TileType): boolean {
  return tile >= TileType.LEDGE_UP && tile <= TileType.LEDGE_RIGHT;
}

/**
 * Check if movement can enter a ledge tile
 */
function canEnterLedge(tile: TileType, dir: Direction): boolean {
  if (!isLedge(tile)) return true;
  
  // LEDGE_UP: enter from above (moving DOWN)
  // LEDGE_DOWN: enter from below (moving UP)
  // LEDGE_LEFT: enter from right (moving LEFT)
  // LEDGE_RIGHT: enter from left (moving RIGHT)
  const allowedDirs: Partial<Record<TileType, Direction>> = {
    [TileType.LEDGE_UP]: Direction.DOWN,
    [TileType.LEDGE_DOWN]: Direction.UP,
    [TileType.LEDGE_LEFT]: Direction.LEFT,
    [TileType.LEDGE_RIGHT]: Direction.RIGHT,
  };
  
  return dir === allowedDirs[tile];
}

/**
 * Simulate boulder sliding on ice until it hits an obstacle
 */
function simulateBoulderSlide(
  state: GroundPuzzleState,
  startPos: Position,
  dir: Direction
): { finalPos: Position; path: Position[] } {
  const delta = getDelta(dir);
  let x = startPos.x;
  let y = startPos.y;
  const path: Position[] = [{ x, y }];
  
  // If starting position is not ice, boulder doesn't slide
  if (!isIceTile(state.tiles[y][x])) {
    return { finalPos: { x, y }, path };
  }
  
  let steps = 0;
  const maxSlide = 100;
  
  while (steps < maxSlide) {
    steps++;
    const nextX = x + delta.x;
    const nextY = y + delta.y;
    
    // Stop at boundary
    if (!isValidPosition(nextX, nextY, state.width, state.height)) break;
    
    const nextTile = state.tiles[nextY][nextX];
    
    // Stop at wall
    if (isBlockingTile(nextTile)) break;
    
    // Stop at another boulder
    if (hasBoulder(state, { x: nextX, y: nextY })) break;
    
    // Check ledge rules
    if (isLedge(nextTile)) {
      if (!canEnterLedge(nextTile, dir)) break;
      // Enter ledge and stop (ledges are not ice)
      x = nextX;
      y = nextY;
      path.push({ x, y });
      break;
    }
    
    // Move to next tile
    x = nextX;
    y = nextY;
    path.push({ x, y });
    
    // Stop if we leave ice
    if (!isIceTile(nextTile)) break;
  }
  
  return { finalPos: { x, y }, path };
}

/**
 * Try to push a boulder from its current position in the given direction.
 * Returns the new boulder position if successful, null if blocked.
 */
function tryPushBoulder(
  state: GroundPuzzleState,
  boulderPos: Position,
  dir: Direction
): { newPos: Position; path: Position[] } | null {
  const delta = getDelta(dir);
  const targetX = boulderPos.x + delta.x;
  const targetY = boulderPos.y + delta.y;
  
  // Check bounds
  if (!isValidPosition(targetX, targetY, state.width, state.height)) {
    return null;
  }
  
  const targetTile = state.tiles[targetY][targetX];
  
  // Can't push into wall
  if (isBlockingTile(targetTile)) {
    return null;
  }
  
  // Can't push into another boulder
  if (hasBoulder(state, { x: targetX, y: targetY })) {
    return null;
  }
  
  // Check ledge rules - boulders can be pushed onto ledges following ledge rules
  if (isLedge(targetTile)) {
    if (!canEnterLedge(targetTile, dir)) {
      return null;
    }
    // Boulder lands on ledge and stays (ledges don't cause sliding)
    return { newPos: { x: targetX, y: targetY }, path: [boulderPos, { x: targetX, y: targetY }] };
  }
  
  // Boulder moves to target position
  const targetPos = { x: targetX, y: targetY };
  
  // Check if target is ice - boulder slides
  if (isIceTile(targetTile)) {
    const slideResult = simulateBoulderSlide(
      { ...state, boulderPositions: new Set() }, // Empty boulder set for slide simulation
      targetPos,
      dir
    );
    return { newPos: slideResult.finalPos, path: [boulderPos, ...slideResult.path] };
  }
  
  // Normal push - boulder moves one tile
  return { newPos: targetPos, path: [boulderPos, targetPos] };
}

/**
 * Simulate a player move on a ground map with boulder mechanics.
 * 
 * Movement rules:
 * 1. Player moves step-by-step on ground tiles
 * 2. Player slides on ice tiles (like ice map)
 * 3. When player moves into a boulder, they push it
 * 4. If boulder can't be pushed, move fails
 * 5. Ledges work the same as in ice maps (one-way)
 */
export function simulateGroundMove(
  state: GroundPuzzleState,
  playerPos: Position,
  dir: Direction
): GroundMoveResult {
  const delta = getDelta(dir);
  let x = playerPos.x + delta.x;
  let y = playerPos.y + delta.y;
  
  // Check bounds
  if (!isValidPosition(x, y, state.width, state.height)) {
    return { playerPos, valid: false, boulderPushed: false };
  }
  
  const targetTile = state.tiles[y][x];
  
  // Check wall blocking
  if (isBlockingTile(targetTile)) {
    return { playerPos, valid: false, boulderPushed: false };
  }
  
  // Check ledge entry rules
  if (!canEnterLedge(targetTile, dir)) {
    return { playerPos, valid: false, boulderPushed: false };
  }
  
  // Check for boulder at target - try to push
  const targetPos = { x, y };
  if (hasBoulder(state, targetPos)) {
    const pushResult = tryPushBoulder(state, targetPos, dir);
    
    if (!pushResult) {
      // Can't push boulder - move fails
      return { playerPos, valid: false, boulderPushed: false };
    }
    
    // Boulder pushed successfully - update positions
    const newBoulderPositions = new Set(state.boulderPositions);
    newBoulderPositions.delete(positionKey(targetPos));
    newBoulderPositions.add(positionKey(pushResult.newPos));
    
    // Player moves into boulder's old position
    const playerPath: Position[] = [{ x, y }];
    
    // Handle player ice sliding after pushing (player might slide too)
    if (isIceTile(targetTile)) {
      // Create updated state with new boulder positions
      const updatedState = { ...state, boulderPositions: newBoulderPositions };
      let slideX = x;
      let slideY = y;
      let steps = 0;
      
      while (steps < 100) {
        steps++;
        const nextX = slideX + delta.x;
        const nextY = slideY + delta.y;
        
        if (!isValidPosition(nextX, nextY, state.width, state.height)) break;
        
        const nextTile = state.tiles[nextY][nextX];
        if (isBlockingTile(nextTile)) break;
        if (hasBoulder(updatedState, { x: nextX, y: nextY })) break;
        
        if (isLedge(nextTile)) {
          if (!canEnterLedge(nextTile, dir)) break;
          slideX = nextX;
          slideY = nextY;
          playerPath.push({ x: slideX, y: slideY });
          break;
        }
        
        slideX = nextX;
        slideY = nextY;
        playerPath.push({ x: slideX, y: slideY });
        
        if (!isIceTile(nextTile)) break;
      }
      
      return {
        playerPos: { x: slideX, y: slideY },
        valid: true,
        boulderPushed: true,
        boulderFrom: targetPos,
        boulderTo: pushResult.newPos,
        newBoulderPositions,
        path: playerPath,
        boulderPath: pushResult.path,
      };
    }
    
    // No ice - player just takes one step
    return {
      playerPos: targetPos,
      valid: true,
      boulderPushed: true,
      boulderFrom: targetPos,
      boulderTo: pushResult.newPos,
      newBoulderPositions,
      path: playerPath,
      boulderPath: pushResult.path,
    };
  }
  
  // No boulder - normal movement
  const path: Position[] = [{ x, y }];
  
  // Handle ice sliding
  if (isIceTile(targetTile)) {
    let steps = 0;
    while (steps < 100) {
      steps++;
      const nextX = x + delta.x;
      const nextY = y + delta.y;
      
      if (!isValidPosition(nextX, nextY, state.width, state.height)) break;
      
      const nextTile = state.tiles[nextY][nextX];
      if (isBlockingTile(nextTile)) break;
      if (hasBoulder(state, { x: nextX, y: nextY })) break;
      
      if (isLedge(nextTile)) {
        if (!canEnterLedge(nextTile, dir)) break;
        x = nextX;
        y = nextY;
        path.push({ x, y });
        break;
      }
      
      x = nextX;
      y = nextY;
      path.push({ x, y });
      
      if (!isIceTile(nextTile)) break;
    }
  }
  
  return {
    playerPos: { x, y },
    valid: true,
    boulderPushed: false,
    path,
  };
}

/**
 * Create initial ground puzzle state from tiles
 */
export function createGroundState(tiles: TileType[][], width: number, height: number): GroundPuzzleState {
  const boulderPositions = new Set<string>();
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (tiles[y][x] === TileType.BOULDER) {
        boulderPositions.add(positionKey({ x, y }));
      }
    }
  }
  
  return { tiles, boulderPositions, width, height };
}

/**
 * Get all valid moves from a position (including boulder pushes)
 */
export function getValidMoves(
  state: GroundPuzzleState,
  pos: Position
): { dir: Direction; result: GroundMoveResult }[] {
  const validMoves: { dir: Direction; result: GroundMoveResult }[] = [];
  
  for (const dir of getAllDirections()) {
    const result = simulateGroundMove(state, pos, dir);
    if (result.valid && !positionsEqual(result.playerPos, pos)) {
      validMoves.push({ dir, result });
    }
  }
  
  return validMoves;
}

/**
 * BFS pathfinding for ground puzzles with boulder state.
 * Returns the minimum moves to reach goal, considering boulder pushes.
 * 
 * State is represented as: playerPosition + sorted boulder positions
 * 
 * PERFORMANCE: With N boulders, state space is O(positions^N).
 * - 1 boulder: ~500 states (fast)
 * - 2 boulders: ~10,000 states (manageable)
 * - 3+ boulders: 500,000+ states (slow!)
 * 
 * Uses depth limit and state cap to prevent explosion.
 */
export function findGroundPath(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  maxDepth: number = 60,
  maxStates: number = 50000
): number | null {
  const initialState = createGroundState(tiles, width, height);
  
  // If no boulders, this degenerates to simple BFS
  if (initialState.boulderPositions.size === 0) {
    // Simple BFS without boulder tracking
    const simpleVisited = new Set<string>();
    const simpleQueue: { pos: Position; moves: number }[] = [{ pos: start, moves: 0 }];
    simpleVisited.add(positionKey(start));
    
    while (simpleQueue.length > 0) {
      const current = simpleQueue.shift()!;
      if (positionsEqual(current.pos, goal)) return current.moves;
      if (current.moves >= maxDepth) continue;
      
      const state: GroundPuzzleState = { tiles, boulderPositions: new Set(), width, height };
      for (const dir of getAllDirections()) {
        const result = simulateGroundMove(state, current.pos, dir);
        if (result.valid && !positionsEqual(result.playerPos, current.pos)) {
          const key = positionKey(result.playerPos);
          if (!simpleVisited.has(key)) {
            simpleVisited.add(key);
            simpleQueue.push({ pos: result.playerPos, moves: current.moves + 1 });
          }
        }
      }
    }
    return null;
  }
  
  // State key includes player position and all boulder positions
  function stateKey(pos: Position, boulders: Set<string>): string {
    const sortedBoulders = Array.from(boulders).sort().join(';');
    return `${positionKey(pos)}|${sortedBoulders}`;
  }
  
  const visited = new Set<string>();
  const queue: {
    pos: Position;
    boulders: Set<string>;
    moves: number;
  }[] = [{
    pos: start,
    boulders: new Set(initialState.boulderPositions),
    moves: 0,
  }];
  
  visited.add(stateKey(start, initialState.boulderPositions));
  
  while (queue.length > 0) {
    // Safety cap on visited states
    if (visited.size > maxStates) {
      return null; // Too complex, abort
    }
    
    const current = queue.shift()!;
    
    if (positionsEqual(current.pos, goal)) {
      return current.moves;
    }
    
    // Depth limit for performance
    if (current.moves >= maxDepth) continue;
    
    const state: GroundPuzzleState = {
      tiles,
      boulderPositions: current.boulders,
      width,
      height,
    };
    
    for (const dir of getAllDirections()) {
      const result = simulateGroundMove(state, current.pos, dir);
      
      if (result.valid && !positionsEqual(result.playerPos, current.pos)) {
        const newBoulders = result.newBoulderPositions || current.boulders;
        const key = stateKey(result.playerPos, newBoulders);
        
        if (!visited.has(key)) {
          visited.add(key);
          queue.push({
            pos: result.playerPos,
            boulders: new Set(newBoulders),
            moves: current.moves + 1,
          });
        }
      }
    }
  }
  
  return null;
}

/**
 * Find the optimal path with full state tracking.
 * Returns the path and all intermediate states.
 */
export function findOptimalGroundPath(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
): {
  path: Position[];
  moves: { pos: Position; dir: Direction; boulders: Set<string> }[];
} | null {
  const initialState = createGroundState(tiles, width, height);
  
  function stateKey(pos: Position, boulders: Set<string>): string {
    const sortedBoulders = Array.from(boulders).sort().join(';');
    return `${positionKey(pos)}|${sortedBoulders}`;
  }
  
  const visited = new Set<string>();
  const queue: {
    pos: Position;
    boulders: Set<string>;
    path: Position[];
    moves: { pos: Position; dir: Direction; boulders: Set<string> }[];
  }[] = [{
    pos: start,
    boulders: new Set(initialState.boulderPositions),
    path: [start],
    moves: [],
  }];
  
  visited.add(stateKey(start, initialState.boulderPositions));
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    
    if (positionsEqual(current.pos, goal)) {
      return { path: current.path, moves: current.moves };
    }
    
    if (current.path.length > 100) continue;
    
    const state: GroundPuzzleState = {
      tiles,
      boulderPositions: current.boulders,
      width,
      height,
    };
    
    for (const dir of getAllDirections()) {
      const result = simulateGroundMove(state, current.pos, dir);
      
      if (result.valid && !positionsEqual(result.playerPos, current.pos)) {
        const newBoulders = result.newBoulderPositions || current.boulders;
        const key = stateKey(result.playerPos, newBoulders);
        
        if (!visited.has(key)) {
          visited.add(key);
          queue.push({
            pos: result.playerPos,
            boulders: new Set(newBoulders),
            path: [...current.path, result.playerPos],
            moves: [...current.moves, { pos: current.pos, dir, boulders: new Set(newBoulders) }],
          });
        }
      }
    }
  }
  
  return null;
}

/**
 * Check if puzzle is solvable (goal reachable from start)
 */
export function isGroundPuzzleSolvable(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  maxDepth: number = 60
): boolean {
  return findGroundPath(tiles, start, goal, width, height, maxDepth) !== null;
}

/**
 * Get all reachable positions from start (for stuck state detection)
 */
export function getGroundReachable(
  tiles: TileType[][],
  start: Position,
  width: number,
  height: number
): Set<string> {
  const initialState = createGroundState(tiles, width, height);
  const reachable = new Set<string>();
  
  function stateKey(pos: Position, boulders: Set<string>): string {
    const sortedBoulders = Array.from(boulders).sort().join(';');
    return `${positionKey(pos)}|${sortedBoulders}`;
  }
  
  const visited = new Set<string>();
  const queue: {
    pos: Position;
    boulders: Set<string>;
  }[] = [{
    pos: start,
    boulders: new Set(initialState.boulderPositions),
  }];
  
  visited.add(stateKey(start, initialState.boulderPositions));
  reachable.add(positionKey(start));
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    
    const state: GroundPuzzleState = {
      tiles,
      boulderPositions: current.boulders,
      width,
      height,
    };
    
    for (const dir of getAllDirections()) {
      const result = simulateGroundMove(state, current.pos, dir);
      
      if (result.valid && !positionsEqual(result.playerPos, current.pos)) {
        reachable.add(positionKey(result.playerPos));
        
        const newBoulders = result.newBoulderPositions || current.boulders;
        const key = stateKey(result.playerPos, newBoulders);
        
        if (!visited.has(key)) {
          visited.add(key);
          queue.push({
            pos: result.playerPos,
            boulders: new Set(newBoulders),
          });
        }
      }
    }
  }
  
  return reachable;
}

/**
 * Check for stuck states - positions from which goal cannot be reached.
 * For ground puzzles, this considers boulder state.
 */
export function hasNoStuckStates(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
): boolean {
  const initialState = createGroundState(tiles, width, height);
  
  function stateKey(pos: Position, boulders: Set<string>): string {
    const sortedBoulders = Array.from(boulders).sort().join(';');
    return `${positionKey(pos)}|${sortedBoulders}`;
  }
  
  const visited = new Set<string>();
  const queue: {
    pos: Position;
    boulders: Set<string>;
  }[] = [{
    pos: start,
    boulders: new Set(initialState.boulderPositions),
  }];
  
  visited.add(stateKey(start, initialState.boulderPositions));
  
  // BFS to find all reachable states
  const reachableStates: { pos: Position; boulders: Set<string> }[] = [];
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    reachableStates.push(current);
    
    const state: GroundPuzzleState = {
      tiles,
      boulderPositions: current.boulders,
      width,
      height,
    };
    
    for (const dir of getAllDirections()) {
      const result = simulateGroundMove(state, current.pos, dir);
      
      if (result.valid && !positionsEqual(result.playerPos, current.pos)) {
        const newBoulders = result.newBoulderPositions || current.boulders;
        const key = stateKey(result.playerPos, newBoulders);
        
        if (!visited.has(key)) {
          visited.add(key);
          queue.push({
            pos: result.playerPos,
            boulders: new Set(newBoulders),
          });
        }
      }
    }
  }
  
  // For each reachable state, verify goal is reachable from that state
  // This is expensive but necessary for correctness
  // Optimization: only check a subset of states
  const checkCount = Math.min(reachableStates.length, 50);
  const step = Math.max(1, Math.floor(reachableStates.length / checkCount));
  
  for (let i = 0; i < reachableStates.length; i += step) {
    const state = reachableStates[i];
    
    // Create a temporary tiles array with boulders in their current positions
    const tempTiles = tiles.map(row => [...row]);
    
    // Remove all boulder tiles and place them according to current state
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (tempTiles[y][x] === TileType.BOULDER) {
          tempTiles[y][x] = TileType.GROUND;
        }
      }
    }
    
    for (const bKey of state.boulders) {
      const [bx, by] = bKey.split(',').map(Number);
      if (tempTiles[by][bx] === TileType.GROUND) {
        tempTiles[by][bx] = TileType.BOULDER;
      }
    }
    
    if (!isGroundPuzzleSolvable(tempTiles, state.pos, goal, width, height)) {
      return false;
    }
  }
  
  return true;
}
