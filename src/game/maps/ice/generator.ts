import seedrandom from 'seedrandom';
import { TileType, Position, PuzzleData, Direction, MapType } from '../../types';

// Tuning knobs for harder puzzles
const TARGET_PSYCHOLOGY_SCORE = 2000;
const CONSTRAINT_ATTEMPTS = 160;
const TRADITIONAL_ATTEMPTS = 400;

// Seeded random number generator
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

// Position utilities
function isValid(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x < width && y >= 0 && y < height;
}

function isInner(x: number, y: number, width: number, height: number): boolean {
  return x > 0 && x < width - 1 && y > 0 && y < height - 1;
}

function getDelta(dir: Direction): Position {
  switch (dir) {
    case Direction.UP: return { x: 0, y: -1 };
    case Direction.DOWN: return { x: 0, y: 1 };
    case Direction.LEFT: return { x: -1, y: 0 };
    case Direction.RIGHT: return { x: 1, y: 0 };
  }
}

function getAllDirs(): Direction[] {
  return [Direction.UP, Direction.DOWN, Direction.LEFT, Direction.RIGHT];
}

function posKey(p: Position): string {
  return `${p.x},${p.y}`;
}

function posEq(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

// Simulate a move with ice sliding
function simulateMove(
  tiles: TileType[][],
  start: Position,
  dir: Direction,
  width: number,
  height: number
): { pos: Position; valid: boolean } {
  const delta = getDelta(dir);
  let x = start.x + delta.x;
  let y = start.y + delta.y;

  if (!isValid(x, y, width, height)) {
    return { pos: start, valid: false };
  }

  const targetTile = tiles[y][x];
  if (targetTile === TileType.WALL) {
    return { pos: start, valid: false };
  }

  // Check ledge entry rules
  // LEDGE_UP: enter from above (moving DOWN), LEDGE_DOWN: enter from below (moving UP)
  // LEDGE_LEFT: enter from right (moving LEFT), LEDGE_RIGHT: enter from left (moving RIGHT)
  if (targetTile >= TileType.LEDGE_UP && targetTile <= TileType.LEDGE_RIGHT) {
    const ledgeDir = targetTile - TileType.LEDGE_UP;
    const allowedDirs = [Direction.DOWN, Direction.UP, Direction.LEFT, Direction.RIGHT];
    if (dir !== allowedDirs[ledgeDir]) {
      return { pos: start, valid: false };
    }
  }

  // Handle ice sliding
  if (targetTile === TileType.ICE) {
    let steps = 0;
    while (steps < 100) {
      steps++;
      const nextX = x + delta.x;
      const nextY = y + delta.y;

      if (!isValid(nextX, nextY, width, height)) break;

      const nextTile = tiles[nextY][nextX];
      if (nextTile === TileType.WALL) break;

      // Check ledge
      if (nextTile >= TileType.LEDGE_UP && nextTile <= TileType.LEDGE_RIGHT) {
        const ledgeDir = nextTile - TileType.LEDGE_UP;
        const allowedDirs = [Direction.DOWN, Direction.UP, Direction.LEFT, Direction.RIGHT];
        if (dir !== allowedDirs[ledgeDir]) break;
        x = nextX;
        y = nextY;
        break;
      }

      x = nextX;
      y = nextY;

      if (nextTile !== TileType.ICE) break;
    }
  }

  return { pos: { x, y }, valid: true };
}

// BFS pathfinding - optimized with index-based queue (avoids O(n) shift)
function findPath(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
): number | null {
  const queue: { pos: Position; moves: number }[] = [{ pos: start, moves: 0 }];
  const visited = new Set<string>();
  visited.add(posKey(start));
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];

    if (posEq(current.pos, goal)) {
      return current.moves;
    }

    for (const dir of getAllDirs()) {
      const result = simulateMove(tiles, current.pos, dir, width, height);
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

// Get all reachable positions - optimized with index-based queue
function getReachable(
  tiles: TileType[][],
  start: Position,
  width: number,
  height: number
): Set<string> {
  const reachable = new Set<string>();
  const queue: Position[] = [start];
  reachable.add(posKey(start));
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];

    for (const dir of getAllDirs()) {
      const result = simulateMove(tiles, current, dir, width, height);
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

// Check solvability
function isSolvable(tiles: TileType[][], start: Position, goal: Position, w: number, h: number): boolean {
  return findPath(tiles, start, goal, w, h) !== null;
}

// Build reverse graph: for each position, list all positions that can reach it in one move
// This is O(W*H) and enables O(W*H) stuck-state checking instead of O(R*W*H)
function buildReverseGraph(
  tiles: TileType[][],
  width: number,
  height: number
): Map<string, Position[]> {
  const reverseGraph = new Map<string, Position[]>();
  
  // For each position, compute where it can go, and add reverse edge
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (tiles[y][x] === TileType.WALL) continue;
      
      for (const dir of getAllDirs()) {
        const result = simulateMove(tiles, { x, y }, dir, width, height);
        if (result.valid && !posEq(result.pos, { x, y })) {
          // Forward edge: (x,y) -> result.pos
          // Reverse edge: result.pos -> (x,y)
          const destKey = posKey(result.pos);
          let sources = reverseGraph.get(destKey);
          if (!sources) {
            sources = [];
            reverseGraph.set(destKey, sources);
          }
          sources.push({ x, y });
        }
      }
    }
  }
  
  return reverseGraph;
}

// Get all positions that can reach the goal using reverse BFS
// O(W*H) instead of running forward BFS from each position
function getCanReachGoal(
  tiles: TileType[][],
  goal: Position,
  width: number,
  height: number
): Set<string> {
  const reverseGraph = buildReverseGraph(tiles, width, height);
  
  const canReachGoal = new Set<string>();
  const queue: Position[] = [goal];
  canReachGoal.add(posKey(goal));
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    const sources = reverseGraph.get(posKey(current));
    
    if (sources) {
      for (const source of sources) {
        const key = posKey(source);
        if (!canReachGoal.has(key)) {
          canReachGoal.add(key);
          queue.push(source);
        }
      }
    }
  }

  return canReachGoal;
}

// Verify no stuck states - all reachable positions can reach the goal
// OPTIMIZED: O(W*H) instead of O(R*W*H) by using reverse BFS
function hasNoStuckStates(tiles: TileType[][], start: Position, goal: Position, w: number, h: number): boolean {
  const reachable = getReachable(tiles, start, w, h);
  const canReachGoal = getCanReachGoal(tiles, goal, w, h);
  
  // Check if every reachable position can reach the goal
  for (const key of reachable) {
    if (!canReachGoal.has(key)) {
      return false;
    }
  }
  return true;
}

// ============================================================================
// GENIUS-LEVEL DECEPTION ENGINE
// Human-engineered psychological misdirection algorithms
// ============================================================================

// Calculate the "intuitive direction" - where a human would naturally want to go
function getIntuitiveDirection(from: Position, to: Position): Direction[] {
  const dirs: Direction[] = [];
  if (to.x > from.x) dirs.push(Direction.RIGHT);
  if (to.x < from.x) dirs.push(Direction.LEFT);
  if (to.y > from.y) dirs.push(Direction.DOWN);
  if (to.y < from.y) dirs.push(Direction.UP);
  return dirs;
}

// Get opposite direction
function getOppositeDir(dir: Direction): Direction {
  switch (dir) {
    case Direction.UP: return Direction.DOWN;
    case Direction.DOWN: return Direction.UP;
    case Direction.LEFT: return Direction.RIGHT;
    case Direction.RIGHT: return Direction.LEFT;
  }
}

// Calculate Manhattan distance
function manhattanDist(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// Get positions along the direct line from start to goal (the "obvious" path)
function getDirectPathZone(start: Position, goal: Position, width: number, height: number, thickness: number): Set<string> {
  const zone = new Set<string>();
  const dx = goal.x - start.x;
  const dy = goal.y - start.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  
  for (let i = 0; i <= steps; i++) {
    const t = steps > 0 ? i / steps : 0;
    const cx = Math.round(start.x + dx * t);
    const cy = Math.round(start.y + dy * t);
    
    // Add thickness around the line
    for (let ox = -thickness; ox <= thickness; ox++) {
      for (let oy = -thickness; oy <= thickness; oy++) {
        const x = cx + ox;
        const y = cy + oy;
        if (isValid(x, y, width, height)) {
          zone.add(posKey({ x, y }));
        }
      }
    }
  }
  return zone;
}

// Find the actual optimal path using BFS with path reconstruction
// Optimized: index-based queue + parent map instead of copying paths
function findOptimalPath(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
): Position[] | null {
  const queue: Position[] = [start];
  const visited = new Set<string>();
  const parent = new Map<string, Position | null>();
  const startKey = posKey(start);
  visited.add(startKey);
  parent.set(startKey, null);
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];

    if (posEq(current, goal)) {
      // Reconstruct path from goal to start using parent map
      const path: Position[] = [];
      let pos: Position | null = current;
      while (pos !== null) {
        path.push(pos);
        pos = parent.get(posKey(pos)) ?? null;
      }
      return path.reverse();
    }

    for (const dir of getAllDirs()) {
      const result = simulateMove(tiles, current, dir, width, height);
      if (result.valid) {
        const key = posKey(result.pos);
        if (!visited.has(key)) {
          visited.add(key);
          parent.set(key, current);
          queue.push(result.pos);
        }
      }
    }
  }

  return null;
}

// GENIUS ALGORITHM 1: Reverse Path Engineering
// Build the optimal path to be counter-intuitive - force backtracking
function engineerCounterIntuitivePath(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom
): void {
  const intuitiveZone = getDirectPathZone(start, goal, width, height, 4);
  const intuitiveDirs = getIntuitiveDirection(start, goal);
  
  // Block the "obvious" approaches near the goal to force roundabout paths
  const goalApproaches: Position[] = [];
  for (let r = 2; r <= 6; r++) {
    for (const dir of intuitiveDirs) {
      const delta = getDelta(dir);
      // Positions approaching goal from the intuitive direction
      const x = goal.x - delta.x * r;
      const y = goal.y - delta.y * r;
      if (isInner(x, y, width, height)) {
        goalApproaches.push({ x, y });
      }
    }
  }
  
  // Place walls to block intuitive approaches
  for (const pos of goalApproaches) {
    if (tiles[pos.y][pos.x] === TileType.ICE && 
        !posEq(pos, start) && !posEq(pos, goal)) {
      tiles[pos.y][pos.x] = TileType.WALL;
      if (!isSolvable(tiles, start, goal, width, height)) {
        tiles[pos.y][pos.x] = TileType.ICE;
      }
    }
  }
}

// GENIUS ALGORITHM 2: The "Almost There" Trap
// Create positions very close to goal that slide past it
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
    // Pick a direction to approach the goal
    const approachDir = rng.randomChoice(getAllDirs());
    const delta = getDelta(approachDir);
    const oppositeDelta = getDelta(getOppositeDir(approachDir));
    
    // Create an ice runway that PASSES the goal
    const runwayStart = {
      x: goal.x + oppositeDelta.x * rng.randomInt(4, 8),
      y: goal.y + oppositeDelta.y * rng.randomInt(4, 8)
    };
    const runwayEnd = {
      x: goal.x + delta.x * rng.randomInt(3, 6),
      y: goal.y + delta.y * rng.randomInt(3, 6)
    };
    
    // Ensure runway is all ice (player will slide past goal)
    const backup: { pos: Position; tile: TileType }[] = [];
    let valid = true;
    
    // Clear the runway
    let rx = runwayStart.x;
    let ry = runwayStart.y;
    while ((delta.x !== 0 && rx !== runwayEnd.x) || (delta.y !== 0 && ry !== runwayEnd.y)) {
      if (!isInner(rx, ry, width, height)) {
        valid = false;
        break;
      }
      
      if (!posEq({ x: rx, y: ry }, goal) && 
          !posEq({ x: rx, y: ry }, start) &&
          tiles[ry][rx] === TileType.WALL) {
        backup.push({ pos: { x: rx, y: ry }, tile: tiles[ry][rx] });
        tiles[ry][rx] = TileType.ICE;
      }
      
      rx += delta.x;
      ry += delta.y;
    }
    
    // Remove any walls adjacent to goal that would stop the slide
    const perpDirs = approachDir === Direction.UP || approachDir === Direction.DOWN 
      ? [Direction.LEFT, Direction.RIGHT]
      : [Direction.UP, Direction.DOWN];
    
    for (const perpDir of perpDirs) {
      const pd = getDelta(perpDir);
      const adjX = goal.x + pd.x;
      const adjY = goal.y + pd.y;
      if (isInner(adjX, adjY, width, height) && 
          tiles[adjY][adjX] === TileType.WALL &&
          !posEq({ x: adjX, y: adjY }, start)) {
        // Keep walls on sides - this makes them slide past!
      }
    }
    
    if (!valid || !isSolvable(tiles, start, goal, width, height)) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
  }
}

// GENIUS ALGORITHM 3: Decoy Open Areas
// Create large, inviting open areas that lead nowhere useful
function createDecoyOpenAreas(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  const intuitiveDirs = getIntuitiveDirection(start, goal);
  
  for (let d = 0; d < count; d++) {
    // Place decoy in the intuitive direction from start (looks like progress)
    const primaryDir = rng.randomChoice(intuitiveDirs);
    const delta = getDelta(primaryDir);
    
    // Calculate decoy center - in the "feels right" direction
    const distFromStart = rng.randomInt(6, 12);
    const cx = start.x + delta.x * distFromStart + rng.randomInt(-3, 4);
    const cy = start.y + delta.y * distFromStart + rng.randomInt(-3, 4);
    
    if (!isInner(cx, cy, width, height)) continue;
    
    // Create a large open ice area (looks inviting!)
    const areaSize = rng.randomInt(4, 7);
    const backup: { pos: Position; tile: TileType }[] = [];
    
    for (let dy = -areaSize; dy <= areaSize; dy++) {
      for (let dx = -areaSize; dx <= areaSize; dx++) {
        // Circular-ish area
        if (Math.abs(dx) + Math.abs(dy) > areaSize + 2) continue;
        
        const x = cx + dx;
        const y = cy + dy;
        
        if (!isInner(x, y, width, height)) continue;
        if (posEq({ x, y }, start) || posEq({ x, y }, goal)) continue;
        
        if (tiles[y][x] === TileType.WALL) {
          backup.push({ pos: { x, y }, tile: tiles[y][x] });
          tiles[y][x] = TileType.ICE;
        }
      }
    }
    
    // Now BLOCK the far side of the decoy area (make it a dead end)
    const blockDist = areaSize + 2;
    for (let i = -areaSize; i <= areaSize; i++) {
      const bx = cx + delta.x * blockDist + (delta.x === 0 ? i : 0);
      const by = cy + delta.y * blockDist + (delta.y === 0 ? i : 0);
      
      if (isInner(bx, by, width, height) && 
          tiles[by][bx] === TileType.ICE &&
          !posEq({ x: bx, y: by }, start) && 
          !posEq({ x: bx, y: by }, goal)) {
        backup.push({ pos: { x: bx, y: by }, tile: tiles[by][bx] });
        tiles[by][bx] = TileType.WALL;
      }
    }
    
    if (!isSolvable(tiles, start, goal, width, height)) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
  }
}

// GENIUS ALGORITHM 4: Hidden Choke Point
// Create a critical narrow passage that's easy to miss
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
    // Find a position NOT on the intuitive path
    const directZone = getDirectPathZone(start, goal, width, height, 5);
    
    let cx: number, cy: number;
    let attempts = 0;
    do {
      cx = rng.randomInt(4, width - 4);
      cy = rng.randomInt(4, height - 4);
      attempts++;
    } while (directZone.has(posKey({ x: cx, y: cy })) && attempts < 50);
    
    if (attempts >= 50) continue;
    
    // Create a wall barrier with a single-tile gap (the hidden choke)
    const isHorizontal = rng.random() < 0.5;
    const barrierLength = rng.randomInt(8, 14);
    const gapPos = rng.randomInt(2, barrierLength - 2);
    
    const backup: { pos: Position; tile: TileType }[] = [];
    
    for (let i = 0; i < barrierLength; i++) {
      const x = isHorizontal ? cx + i - Math.floor(barrierLength / 2) : cx;
      const y = isHorizontal ? cy : cy + i - Math.floor(barrierLength / 2);
      
      if (i === gapPos) continue; // The hidden gap
      if (!isInner(x, y, width, height)) continue;
      if (posEq({ x, y }, start) || posEq({ x, y }, goal)) continue;
      
      if (tiles[y][x] === TileType.ICE) {
        backup.push({ pos: { x, y }, tile: tiles[y][x] });
        tiles[y][x] = TileType.WALL;
      }
    }
    
    // Verify solvability - if this barrier makes it unsolvable, the gap IS critical
    const stillSolvable = isSolvable(tiles, start, goal, width, height);
    
    if (!stillSolvable) {
      // Revert - this barrier blocks all paths
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    } else if (!hasNoStuckStates(tiles, start, goal, width, height)) {
      // Creates stuck states - revert
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
    // If still solvable, the choke point is working as a misdirection
  }
}

// GENIUS ALGORITHM 5: Momentum Traps
// Create ice slides that feel natural but overshoot important positions
function createMomentumTraps(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  // Find current optimal path
  const optimalPath = findOptimalPath(tiles, start, goal, width, height);
  if (!optimalPath || optimalPath.length < 5) return;
  
  // For each key position on the optimal path, try to create momentum traps nearby
  for (let t = 0; t < count; t++) {
    // Pick a point on the optimal path (not start/end)
    const pathIdx = rng.randomInt(1, Math.min(optimalPath.length - 1, 10));
    const keyPos = optimalPath[pathIdx];
    
    // Create an ice runway that crosses near this position but overshoots
    const runwayDir = rng.randomChoice(getAllDirs());
    const delta = getDelta(runwayDir);
    
    // Build a long ice runway perpendicular or parallel
    const runwayLength = rng.randomInt(8, 15);
    const backup: { pos: Position; tile: TileType }[] = [];
    
    // Offset the runway so it goes PAST the key position
    const offsetDist = rng.randomInt(2, 5);
    const runwayStartX = keyPos.x - delta.x * offsetDist;
    const runwayStartY = keyPos.y - delta.y * offsetDist;
    
    for (let i = 0; i < runwayLength; i++) {
      const x = runwayStartX + delta.x * i;
      const y = runwayStartY + delta.y * i;
      
      if (!isInner(x, y, width, height)) continue;
      if (posEq({ x, y }, start) || posEq({ x, y }, goal)) continue;
      
      // Remove walls to create ice runway
      if (tiles[y][x] === TileType.WALL) {
        backup.push({ pos: { x, y }, tile: tiles[y][x] });
        tiles[y][x] = TileType.ICE;
      }
      // Convert floors to ice (remove stopping points)
      if (tiles[y][x] === TileType.GROUND) {
        backup.push({ pos: { x, y }, tile: tiles[y][x] });
        tiles[y][x] = TileType.ICE;
      }
    }
    
    if (!isSolvable(tiles, start, goal, width, height)) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
  }
}

// GENIUS ALGORITHM 6: Anti-Gradient Zones  
// Create areas where moving toward goal actually increases path length
function createAntiGradientZones(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  const intuitiveDirs = getIntuitiveDirection(start, goal);
  
  for (let z = 0; z < count; z++) {
    // Pick a zone between start and goal
    const t = rng.random() * 0.6 + 0.2; // 20-80% along the path
    const zoneX = Math.round(start.x + (goal.x - start.x) * t);
    const zoneY = Math.round(start.y + (goal.y - start.y) * t);
    
    if (!isInner(zoneX, zoneY, width, height)) continue;
    
    // In this zone, block the intuitive directions and open counter-intuitive ones
    const backup: { pos: Position; tile: TileType }[] = [];
    const zoneRadius = rng.randomInt(3, 6);
    
    for (let dy = -zoneRadius; dy <= zoneRadius; dy++) {
      for (let dx = -zoneRadius; dx <= zoneRadius; dx++) {
        const x = zoneX + dx;
        const y = zoneY + dy;
        
        if (!isInner(x, y, width, height)) continue;
        if (posEq({ x, y }, start) || posEq({ x, y }, goal)) continue;
        
        // Determine if this position is in an "intuitive" direction from zone center
        const isIntuitive = intuitiveDirs.some(dir => {
          const d = getDelta(dir);
          return (d.x > 0 && dx > 0) || (d.x < 0 && dx < 0) || 
                 (d.y > 0 && dy > 0) || (d.y < 0 && dy < 0);
        });
        
        if (isIntuitive && tiles[y][x] === TileType.ICE && rng.random() < 0.4) {
          // Block intuitive directions
          backup.push({ pos: { x, y }, tile: tiles[y][x] });
          tiles[y][x] = TileType.WALL;
        } else if (!isIntuitive && tiles[y][x] === TileType.WALL && rng.random() < 0.3) {
          // Open counter-intuitive directions
          backup.push({ pos: { x, y }, tile: tiles[y][x] });
          tiles[y][x] = TileType.ICE;
        }
      }
    }
    
    if (!isSolvable(tiles, start, goal, width, height)) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
  }
}

// GENIUS ALGORITHM 7: Parallel Path Illusion
// Create two similar-looking paths - one efficient, one wasteful
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
    const originalMoves = findPath(tiles, start, goal, width, height);
    if (originalMoves === null) continue;
    
    // Find a wall that, if removed, creates a "shortcut looking" path
    const candidates: Position[] = [];
    
    for (let y = 4; y < height - 4; y++) {
      for (let x = 4; x < width - 4; x++) {
        if (tiles[y][x] !== TileType.WALL) continue;
        
        // Check if wall is between two ice areas
        let iceNeighbors = 0;
        for (const dir of getAllDirs()) {
          const d = getDelta(dir);
          if (isValid(x + d.x, y + d.y, width, height) && 
              tiles[y + d.y][x + d.x] === TileType.ICE) {
            iceNeighbors++;
          }
        }
        
        if (iceNeighbors >= 2) {
          candidates.push({ x, y });
        }
      }
    }
    
    if (candidates.length === 0) continue;
    
    // Try each candidate to find one that creates a longer path (the illusion)
    const shuffled = rng.shuffle(candidates);
    
    for (const pos of shuffled.slice(0, 20)) {
      tiles[pos.y][pos.x] = TileType.ICE;
      
      const newMoves = findPath(tiles, start, goal, width, height);
      
      // We WANT the new path to be longer or same - creates illusion of shortcut
      if (newMoves !== null && newMoves >= originalMoves) {
        // Success - this "shortcut" is actually not shorter
        break;
      } else {
        // Revert - this actually was a shortcut
        tiles[pos.y][pos.x] = TileType.WALL;
      }
    }
  }
}

// GENIUS ALGORITHM 8: Ledge Misdirection
// Place ledges that look like shortcuts but commit you to longer routes
function createLedgeMisdirection(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  const intuitiveDirs = getIntuitiveDirection(start, goal);
  
  for (let l = 0; l < count; l++) {
    // Find a position in the intuitive direction from start
    const dir = rng.randomChoice(intuitiveDirs);
    const delta = getDelta(dir);
    
    // Ledge should be on the "shortcut" path
    const dist = rng.randomInt(5, 12);
    const lx = start.x + delta.x * dist + rng.randomInt(-2, 3);
    const ly = start.y + delta.y * dist + rng.randomInt(-2, 3);
    
    if (!isInner(lx, ly, width, height)) continue;
    if (tiles[ly][lx] !== TileType.ICE) continue;
    if (posEq({ x: lx, y: ly }, start) || posEq({ x: lx, y: ly }, goal)) continue;
    
    const beforeMoves = findPath(tiles, start, goal, width, height);
    if (beforeMoves === null) continue;
    
    // Place a ledge pointing in the intuitive direction (looks like progress!)
    // LEDGE_UP = can only enter from above (moving down)
    // LEDGE_DOWN = can only enter from below (moving up)
    // etc.
    let ledgeType: TileType;
    switch (dir) {
      case Direction.RIGHT: ledgeType = TileType.LEDGE_RIGHT; break;
      case Direction.LEFT: ledgeType = TileType.LEDGE_LEFT; break;
      case Direction.DOWN: ledgeType = TileType.LEDGE_DOWN; break;
      case Direction.UP: ledgeType = TileType.LEDGE_UP; break;
    }
    
    const oldTile = tiles[ly][lx];
    tiles[ly][lx] = ledgeType;
    
    const afterMoves = findPath(tiles, start, goal, width, height);
    
    // Keep ledge if it increases path length (creates a trap) or maintains solvability
    if (afterMoves === null || !hasNoStuckStates(tiles, start, goal, width, height)) {
      tiles[ly][lx] = oldTile;
    } else if (afterMoves < beforeMoves) {
      // This ledge actually helps - we don't want that
      tiles[ly][lx] = oldTile;
    }
    // If afterMoves >= beforeMoves, the ledge is a misdirection - keep it!
  }
}

// GENIUS ALGORITHM 9: Goal Proximity Dead Ends
// Create tantalizing dead ends very close to the goal
function createGoalProximityDeadEnds(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  for (let d = 0; d < count; d++) {
    // Create a pocket 2-4 tiles from the goal
    const dist = rng.randomInt(2, 5);
    const angle = rng.random() * Math.PI * 2;
    
    const pocketX = Math.round(goal.x + Math.cos(angle) * dist);
    const pocketY = Math.round(goal.y + Math.sin(angle) * dist);
    
    if (!isInner(pocketX, pocketY, width, height)) continue;
    
    // Create a small open area (the pocket)
    const backup: { pos: Position; tile: TileType }[] = [];
    const pocketSize = 2;
    
    for (let dy = -pocketSize; dy <= pocketSize; dy++) {
      for (let dx = -pocketSize; dx <= pocketSize; dx++) {
        const x = pocketX + dx;
        const y = pocketY + dy;
        
        if (!isInner(x, y, width, height)) continue;
        if (posEq({ x, y }, start) || posEq({ x, y }, goal)) continue;
        
        if (tiles[y][x] === TileType.WALL) {
          backup.push({ pos: { x, y }, tile: tiles[y][x] });
          tiles[y][x] = TileType.ICE;
        }
      }
    }
    
    // Now block the connection TO the goal from this pocket
    // This makes it a dead end despite being so close
    const dirToGoal = {
      x: Math.sign(goal.x - pocketX),
      y: Math.sign(goal.y - pocketY)
    };
    
    // Place walls between pocket and goal
    for (let i = 1; i < dist; i++) {
      const blockX = pocketX + dirToGoal.x * i;
      const blockY = pocketY + dirToGoal.y * i;
      
      if (isInner(blockX, blockY, width, height) &&
          tiles[blockY][blockX] === TileType.ICE &&
          !posEq({ x: blockX, y: blockY }, goal)) {
        backup.push({ pos: { x: blockX, y: blockY }, tile: tiles[blockY][blockX] });
        tiles[blockY][blockX] = TileType.WALL;
      }
    }
    
    if (!isSolvable(tiles, start, goal, width, height) ||
        !hasNoStuckStates(tiles, start, goal, width, height)) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
  }
}

// GENIUS ALGORITHM 10: Commitment Traps
// Create decision points where wrong choice commits you to long detours
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
    // Find a floor tile or stopping point (decision point)
    const decisionPoints: Position[] = [];
    
    for (let y = 3; y < height - 3; y++) {
      for (let x = 3; x < width - 3; x++) {
        if ((tiles[y][x] === TileType.GROUND || tiles[y][x] === TileType.ICE) &&
            !posEq({ x, y }, start) && !posEq({ x, y }, goal)) {
          // Check if this position has multiple valid moves
          let validMoves = 0;
          for (const dir of getAllDirs()) {
            const result = simulateMove(tiles, { x, y }, dir, width, height);
            if (result.valid && !posEq(result.pos, { x, y })) {
              validMoves++;
            }
          }
          if (validMoves >= 3) {
            decisionPoints.push({ x, y });
          }
        }
      }
    }
    
    if (decisionPoints.length === 0) continue;
    
    const dp = rng.randomChoice(decisionPoints);
    
    // For each direction from this decision point, calculate path cost to goal
    const pathCosts: { dir: Direction; cost: number }[] = [];
    
    for (const dir of getAllDirs()) {
      const result = simulateMove(tiles, dp, dir, width, height);
      if (result.valid && !posEq(result.pos, dp)) {
        const costFromThere = findPath(tiles, result.pos, goal, width, height);
        if (costFromThere !== null) {
          pathCosts.push({ dir, cost: costFromThere });
        }
      }
    }
    
    if (pathCosts.length < 2) continue;
    
    // Sort by cost
    pathCosts.sort((a, b) => a.cost - b.cost);
    
    // Try to block the optimal direction with a ledge (one-way)
    // This forces commitment if player takes the wrong direction
    const optimalDir = pathCosts[0].dir;
    const delta = getDelta(optimalDir);
    
    // Find a tile in the optimal direction and place a ledge facing away
    const ledgeX = dp.x + delta.x * 2;
    const ledgeY = dp.y + delta.y * 2;
    
    if (isInner(ledgeX, ledgeY, width, height) && 
        tiles[ledgeY][ledgeX] === TileType.ICE) {
      // Place ledge that blocks return
      const oppDir = getOppositeDir(optimalDir);
      let ledgeType: TileType;
      switch (oppDir) {
        case Direction.DOWN: ledgeType = TileType.LEDGE_UP; break;
        case Direction.UP: ledgeType = TileType.LEDGE_DOWN; break;
        case Direction.RIGHT: ledgeType = TileType.LEDGE_LEFT; break;
        case Direction.LEFT: ledgeType = TileType.LEDGE_RIGHT; break;
      }
      
      const oldTile = tiles[ledgeY][ledgeX];
      tiles[ledgeY][ledgeX] = ledgeType;
      
      if (!isSolvable(tiles, start, goal, width, height) ||
          !hasNoStuckStates(tiles, start, goal, width, height)) {
        tiles[ledgeY][ledgeX] = oldTile;
      }
    }
  }
}

// ============================================================================
// PSYCHOLOGY-BASED DIFFICULTY SCORING SYSTEM
// Measures what actually makes puzzles hard for HUMANS, not algorithms
// ============================================================================

export interface PsychologyMetrics {
  // Core metrics (these determine actual human difficulty)
  counterIntuitiveMoves: number;      // Moves that go away from goal
  attractiveDecoys: number;           // Wrong moves that look better than optimal
  commitmentGates: number;            // Points where wrong choice is very costly
  falseProgressPaths: number;         // Paths that look good but dead-end or add moves
  
  // Secondary metrics
  optimalMoves: number;
  
  // Computed final score
  psychologyScore: number;
}

// Weighting knobs for psychology scoring (emphasize traps over length)
const PSYCH_WEIGHTS = {
  counterIntuitive: 70,
  attractiveDecoys: 80,
  commitmentGates: 70,
  falseProgress: 100,
  moveBonus: 0.5, // Move count is a tiny bonus, not a driver
};

// Nonlinear bonuses to reward truly trap-heavy layouts
function trapBonus(falseProgressPaths: number, attractiveDecoys: number): number {
  const fpBonus = falseProgressPaths > 8 ? (falseProgressPaths - 8) * 40 : 0;
  const decoyBonus = attractiveDecoys > 12 ? (attractiveDecoys - 12) * 25 : 0;
  return fpBonus + decoyBonus;
}

// Calculate how many moves on the optimal path require going AWAY from the goal
// This is the core of what makes puzzles feel "tricky"
// Optimized version that accepts precomputed optimal path
function countCounterIntuitiveMovesOptimized(
  goal: Position,
  optimalPath: Position[]
): number {
  if (optimalPath.length < 2) return 0;
  
  let counterIntuitiveCount = 0;
  
  for (let i = 0; i < optimalPath.length - 1; i++) {
    const current = optimalPath[i];
    const next = optimalPath[i + 1];
    
    // What direction did we move?
    const moveDir = getDirectionBetween(current, next);
    if (!moveDir) continue;
    
    // What directions would bring us closer to the goal?
    const intuitiveDirs = getIntuitiveDirection(current, goal);
    
    // If our move is NOT in the intuitive directions, it's counter-intuitive
    if (!intuitiveDirs.includes(moveDir)) {
      counterIntuitiveCount++;
    }
  }
  
  return counterIntuitiveCount;
}

// Legacy wrapper for backward compatibility
function countCounterIntuitiveMoves(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
): number {
  const optimalPath = findOptimalPath(tiles, start, goal, width, height);
  if (!optimalPath) return 0;
  return countCounterIntuitiveMovesOptimized(goal, optimalPath);
}

// Count "attractive decoys" - positions where a wrong move LOOKS better than the optimal move
// This is the key insight: difficulty isn't about having choices, it's about WRONG choices looking RIGHT
// Optimized version that accepts precomputed optimal path
function countAttractiveDecoysOptimized(
  tiles: TileType[][],
  goal: Position,
  width: number,
  height: number,
  optimalPath: Position[]
): number {
  if (optimalPath.length < 2) return 0;
  
  let decoyCount = 0;
  
  // For each position on the optimal path
  for (let i = 0; i < optimalPath.length - 1; i++) {
    const current = optimalPath[i];
    const optimalNext = optimalPath[i + 1];
    
    // Get the optimal direction
    const optimalDir = getDirectionBetween(current, optimalNext);
    if (!optimalDir) continue;
    
    // Check all other valid moves from this position
    for (const dir of getAllDirs()) {
      if (dir === optimalDir) continue;
      
      const result = simulateMove(tiles, current, dir, width, height);
      if (!result.valid || posEq(result.pos, current)) continue;
      
      // This is a valid alternative move - is it "attractive"?
      const isAttractive = isMoveAttractive(current, result.pos, optimalNext, goal, tiles, width, height);
      
      if (isAttractive) {
        decoyCount++;
      }
    }
  }
  
  return decoyCount;
}

// Legacy wrapper for backward compatibility
function countAttractiveDecoys(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
): number {
  const optimalPath = findOptimalPath(tiles, start, goal, width, height);
  if (!optimalPath) return 0;
  return countAttractiveDecoysOptimized(tiles, goal, width, height, optimalPath);
}

// Determine if a move looks "attractive" compared to the optimal move
function isMoveAttractive(
  from: Position,
  alternativePos: Position,
  optimalPos: Position,
  goal: Position,
  tiles: TileType[][],
  width: number,
  height: number
): boolean {
  // Calculate distances to goal
  const altDistToGoal = manhattanDist(alternativePos, goal);
  const optDistToGoal = manhattanDist(optimalPos, goal);
  
  // If alternative gets us closer to goal than optimal, it's VERY attractive (a decoy)
  if (altDistToGoal < optDistToGoal) {
    return true;
  }
  
  // If alternative is same distance but moves toward goal direction, it's attractive
  if (altDistToGoal === optDistToGoal) {
    const intuitiveDirs = getIntuitiveDirection(from, goal);
    const altDir = getDirectionBetween(from, alternativePos);
    if (altDir && intuitiveDirs.includes(altDir)) {
      return true;
    }
  }
  
  // Check if alternative looks like "progress" (more open space, toward center, etc.)
  // A move that leads to more options often feels safer/better to humans
  let altOptions = 0;
  let optOptions = 0;
  
  for (const dir of getAllDirs()) {
    const altResult = simulateMove(tiles, alternativePos, dir, width, height);
    if (altResult.valid && !posEq(altResult.pos, alternativePos)) altOptions++;
    
    const optResult = simulateMove(tiles, optimalPos, dir, width, height);
    if (optResult.valid && !posEq(optResult.pos, optimalPos)) optOptions++;
  }
  
  // If alternative has MORE options than optimal, humans may prefer it
  if (altOptions > optOptions + 1) {
    return true;
  }
  
  return false;
}

// Count "commitment gates" - positions where making the wrong choice is VERY costly
// These are high-stakes decision points that create real difficulty
// Optimized version that accepts precomputed path and distance map
function countCommitmentGatesOptimized(
  tiles: TileType[][],
  goal: Position,
  width: number,
  height: number,
  optimalPath: Position[],
  distanceToGoal: Map<string, number>
): number {
  if (optimalPath.length < 2) return 0;
  
  const optimalMoves = optimalPath.length - 1;
  let gateCount = 0;
  
  // For each position on the optimal path
  for (let i = 0; i < optimalPath.length - 1; i++) {
    const current = optimalPath[i];
    const optimalNext = optimalPath[i + 1];
    const optimalDir = getDirectionBetween(current, optimalNext);
    if (!optimalDir) continue;
    
    // Check the cost of each wrong move from this position
    let maxWrongMoveCost = 0;
    
    for (const dir of getAllDirs()) {
      if (dir === optimalDir) continue;
      
      const result = simulateMove(tiles, current, dir, width, height);
      if (!result.valid || posEq(result.pos, current)) continue;
      
      // How many moves to reach goal from this wrong position?
      // Use precomputed distance instead of calling findPath
      const wrongPathLength = distanceToGoal.get(posKey(result.pos));
      if (wrongPathLength === undefined) continue; // Dead end - not a commitment gate, just blocked
      
      // How many moves SHOULD it take from current to goal on optimal path?
      const remainingOptimal = optimalMoves - i;
      
      // The "cost" of this wrong move
      const wrongMoveCost = (wrongPathLength + 1) - remainingOptimal;
      maxWrongMoveCost = Math.max(maxWrongMoveCost, wrongMoveCost);
    }
    
    // If taking the wrong move costs 5+ extra moves, this is a commitment gate
    if (maxWrongMoveCost >= 5) {
      gateCount++;
    }
  }
  
  return gateCount;
}

// Legacy wrapper for backward compatibility
function countCommitmentGates(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
): number {
  const optimalPath = findOptimalPath(tiles, start, goal, width, height);
  if (!optimalPath || optimalPath.length < 2) return 0;
  const distanceToGoal = computeDistanceToGoal(tiles, goal, width, height);
  return countCommitmentGatesOptimized(tiles, goal, width, height, optimalPath, distanceToGoal);
}

// Precompute distance from every position to goal using BFS from goal
// Returns a Map from position key to number of moves to reach goal
// O(W*H) - much faster than calling findPath repeatedly
function computeDistanceToGoal(
  tiles: TileType[][],
  goal: Position,
  width: number,
  height: number
): Map<string, number> {
  const distances = new Map<string, number>();
  const reverseGraph = buildReverseGraph(tiles, width, height);
  
  // BFS from goal using reverse edges
  const queue: { pos: Position; dist: number }[] = [{ pos: goal, dist: 0 }];
  distances.set(posKey(goal), 0);
  let head = 0;
  
  while (head < queue.length) {
    const current = queue[head++];
    const sources = reverseGraph.get(posKey(current.pos));
    
    if (sources) {
      for (const source of sources) {
        const key = posKey(source);
        if (!distances.has(key)) {
          distances.set(key, current.dist + 1);
          queue.push({ pos: source, dist: current.dist + 1 });
        }
      }
    }
  }
  
  return distances;
}

// Count "false progress paths" - paths that FEEL like progress but waste moves
// These are psychologically frustrating because you feel like you're doing well
// Optimized version that accepts precomputed distance map
function countFalseProgressPathsOptimized(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  optimalMoves: number,
  distanceToGoal: Map<string, number>
): number {
  let falsePathCount = 0;
  const checked = new Set<string>();
  
  // BFS from start to find paths that look promising
  const queue: { pos: Position; distFromStart: number; minDistToGoalSeen: number }[] = [
    { pos: start, distFromStart: 0, minDistToGoalSeen: manhattanDist(start, goal) }
  ];
  checked.add(posKey(start));
  let head = 0;
  
  while (head < queue.length) {
    const current = queue[head++];
    if (current.distFromStart > optimalMoves + 10) continue; // Don't explore too far
    
    for (const dir of getAllDirs()) {
      const result = simulateMove(tiles, current.pos, dir, width, height);
      if (!result.valid || posEq(result.pos, current.pos)) continue;
      
      const key = posKey(result.pos);
      if (checked.has(key)) continue;
      checked.add(key);
      
      const newDistToGoal = manhattanDist(result.pos, goal);
      const newDistFromStart = current.distFromStart + 1;
      
      // Is this move "progress"? (getting closer to goal)
      const isProgress = newDistToGoal < current.minDistToGoalSeen;
      
      if (isProgress) {
        // This feels like progress - but is it actually on an optimal path?
        // Use precomputed distance instead of calling findPath
        const pathFromHere = distanceToGoal.get(key);
        if (pathFromHere !== undefined) {
          const totalPath = newDistFromStart + pathFromHere;
          
          // If this "progress" path is actually suboptimal by 3+ moves, it's a false progress path
          if (totalPath > optimalMoves + 3) {
            falsePathCount++;
          }
        }
      }
      
      queue.push({
        pos: result.pos,
        distFromStart: newDistFromStart,
        minDistToGoalSeen: Math.min(current.minDistToGoalSeen, newDistToGoal)
      });
    }
  }
  
  return falsePathCount;
}

// Legacy wrapper for backward compatibility
function countFalseProgressPaths(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
): number {
  const optimalMoves = findPath(tiles, start, goal, width, height);
  if (optimalMoves === null) return 0;
  const distanceToGoal = computeDistanceToGoal(tiles, goal, width, height);
  return countFalseProgressPathsOptimized(tiles, start, goal, width, height, optimalMoves, distanceToGoal);
}

// THE NEW SCORING FORMULA: Simple, additive, psychology-based
// OPTIMIZED: Computes optimal path and distance map ONCE, passes to all metric functions
export function calculatePsychologyScore(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
): PsychologyMetrics {
  // Compute these ONCE and reuse across all metrics
  const optimalPath = findOptimalPath(tiles, start, goal, width, height);
  const optimalMoves = optimalPath ? optimalPath.length - 1 : 0;
  
  if (!optimalPath || optimalPath.length < 2) {
    return {
      counterIntuitiveMoves: 0,
      attractiveDecoys: 0,
      commitmentGates: 0,
      falseProgressPaths: 0,
      optimalMoves: 0,
      psychologyScore: 0
    };
  }
  
  // Compute distance map ONCE for commitment gates and false progress
  const distanceToGoal = computeDistanceToGoal(tiles, goal, width, height);
  
  // Calculate the four core psychological difficulty metrics using optimized functions
  const counterIntuitiveMoves = countCounterIntuitiveMovesOptimized(goal, optimalPath);
  const attractiveDecoys = countAttractiveDecoysOptimized(tiles, goal, width, height, optimalPath);
  const commitmentGates = countCommitmentGatesOptimized(tiles, goal, width, height, optimalPath, distanceToGoal);
  const falseProgressPaths = countFalseProgressPathsOptimized(tiles, start, goal, width, height, optimalMoves, distanceToGoal);
  
  // SIMPLE ADDITIVE SCORING
  // Each metric contributes directly - no multiplicative explosion
  const psychologyScore = 
    (counterIntuitiveMoves * PSYCH_WEIGHTS.counterIntuitive) +
    (attractiveDecoys * PSYCH_WEIGHTS.attractiveDecoys) +
    (commitmentGates * PSYCH_WEIGHTS.commitmentGates) +
    (falseProgressPaths * PSYCH_WEIGHTS.falseProgress) +
    (optimalMoves * PSYCH_WEIGHTS.moveBonus) +
    trapBonus(falseProgressPaths, attractiveDecoys);
  
  return {
    counterIntuitiveMoves,
    attractiveDecoys,
    commitmentGates,
    falseProgressPaths,
    optimalMoves,
    psychologyScore
  };
}

// Prefilter thresholds to avoid wasting attempts on obviously easy maps
const PREFILTER_MIN = {
  counterIntuitive: 6,
  attractiveDecoys: 8,
  commitmentGates: 3,
  falseProgress: 8,
};

function passesPsychologyPrefilters(metrics: PsychologyMetrics): boolean {
  return metrics.counterIntuitiveMoves >= PREFILTER_MIN.counterIntuitive &&
    metrics.attractiveDecoys >= PREFILTER_MIN.attractiveDecoys &&
    metrics.commitmentGates >= PREFILTER_MIN.commitmentGates &&
    metrics.falseProgressPaths >= PREFILTER_MIN.falseProgress;
}

// ============================================================================
// ADVANCED INTELLIGENCE SYSTEMS
// Heat Map Analysis, Critical Path Obfuscation, Cognitive Load
// ============================================================================

// ----------------------------------------------------------------------------
// SYSTEM 1: HEAT MAP / ATTRACTION FIELD ANALYSIS
// Models where humans naturally WANT to go, then ensures optimal path avoids it
// ----------------------------------------------------------------------------

// Calculate "attraction score" for a tile - higher = more appealing to humans
function calculateTileAttraction(
  x: number, 
  y: number, 
  goal: Position, 
  tiles: TileType[][], 
  width: number, 
  height: number
): number {
  // Base attraction: inverse distance to goal (closer = more attractive)
  const distToGoal = manhattanDist({ x, y }, goal);
  const maxDist = width + height;
  const distanceAttraction = (maxDist - distToGoal) / maxDist; // 0-1, higher when closer
  
  // Openness attraction: open areas look more inviting
  let openNeighbors = 0;
  for (const dir of getAllDirs()) {
    const delta = getDelta(dir);
    const nx = x + delta.x;
    const ny = y + delta.y;
    if (isValid(nx, ny, width, height) && tiles[ny][nx] !== TileType.WALL) {
      openNeighbors++;
    }
  }
  const opennessAttraction = openNeighbors / 4; // 0-1
  
  // Line-of-sight to goal (can you "see" toward goal direction?)
  const goalDir = { 
    x: Math.sign(goal.x - x), 
    y: Math.sign(goal.y - y) 
  };
  let lineOfSight = 0;
  let checkX = x + goalDir.x;
  let checkY = y + goalDir.y;
  let losSteps = 0;
  while (isValid(checkX, checkY, width, height) && 
         tiles[checkY][checkX] !== TileType.WALL && 
         losSteps < 10) {
    losSteps++;
    checkX += goalDir.x;
    checkY += goalDir.y;
  }
  lineOfSight = Math.min(losSteps / 5, 1); // 0-1
  
  // Combine factors (weighted)
  return distanceAttraction * 0.5 + opennessAttraction * 0.25 + lineOfSight * 0.25;
}

// Generate full heat map for the puzzle
function generateHeatMap(
  tiles: TileType[][],
  goal: Position,
  width: number,
  height: number
): number[][] {
  const heatMap: number[][] = Array(height).fill(null).map(() => Array(width).fill(0));
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (tiles[y][x] !== TileType.WALL) {
        heatMap[y][x] = calculateTileAttraction(x, y, goal, tiles, width, height);
      }
    }
  }
  
  return heatMap;
}

// Calculate how "cold" the optimal path is (lower = better puzzle)
// Returns average attraction of tiles on optimal path
function calculatePathTemperature(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
): number {
  const optimalPath = findOptimalPath(tiles, start, goal, width, height);
  if (!optimalPath || optimalPath.length < 2) return 1; // Hot = bad
  
  const heatMap = generateHeatMap(tiles, goal, width, height);
  
  let totalHeat = 0;
  for (const pos of optimalPath) {
    totalHeat += heatMap[pos.y][pos.x];
  }
  
  return totalHeat / optimalPath.length;
}

// Modification pass: Block hot paths to force cold routing
function coolDownHotPaths(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  iterations: number
): void {
  const heatMap = generateHeatMap(tiles, goal, width, height);
  
  for (let i = 0; i < iterations; i++) {
    // Find hottest non-path ice tile
    let hottestPos: Position | null = null;
    let hottestTemp = 0;
    
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        if (tiles[y][x] === TileType.ICE && 
            heatMap[y][x] > hottestTemp &&
            !posEq({ x, y }, start) && 
            !posEq({ x, y }, goal)) {
          hottestTemp = heatMap[y][x];
          hottestPos = { x, y };
        }
      }
    }
    
    if (!hottestPos || hottestTemp < 0.6) break; // No hot tiles left
    
    // Try to place a wall on this hot tile
    tiles[hottestPos.y][hottestPos.x] = TileType.WALL;
    
    if (!isSolvable(tiles, start, goal, width, height)) {
      tiles[hottestPos.y][hottestPos.x] = TileType.ICE;
    } else {
      // Update heat map for changed tile
      heatMap[hottestPos.y][hottestPos.x] = 0;
    }
  }
}

// ----------------------------------------------------------------------------
// SYSTEM 2: CRITICAL PATH OBFUSCATION
// Find the optimal path and systematically camouflage each key move
// ----------------------------------------------------------------------------

// Identify "key moves" on the optimal path - moves that aren't obvious
function identifyKeyMoves(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
): Position[] {
  const optimalPath = findOptimalPath(tiles, start, goal, width, height);
  if (!optimalPath || optimalPath.length < 3) return [];
  
  const keyMoves: Position[] = [];
  
  for (let i = 0; i < optimalPath.length - 1; i++) {
    const current = optimalPath[i];
    const next = optimalPath[i + 1];
    
    // Determine direction of this move
    const moveDir = getDirectionBetween(current, next);
    if (!moveDir) continue;
    
    // Check if this move goes AWAY from goal (counter-intuitive)
    const intuitiveDirs = getIntuitiveDirection(current, goal);
    const isCounterIntuitive = !intuitiveDirs.includes(moveDir);
    
    // Check if there are multiple valid moves from this position
    let validMoveCount = 0;
    for (const dir of getAllDirs()) {
      const result = simulateMove(tiles, current, dir, width, height);
      if (result.valid && !posEq(result.pos, current)) {
        validMoveCount++;
      }
    }
    
    // Key move if: counter-intuitive OR at a decision point with 3+ options
    if (isCounterIntuitive || validMoveCount >= 3) {
      keyMoves.push(current);
    }
  }
  
  return keyMoves;
}

// Add decoy paths near key moves to camouflage them
function obfuscateCriticalPath(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom
): void {
  const keyMoves = identifyKeyMoves(tiles, start, goal, width, height);
  
  for (const keyPos of keyMoves) {
    // For each key position, try to open up decoy paths
    const decoyDirs = getAllDirs().filter(dir => {
      const intuitiveDirs = getIntuitiveDirection(keyPos, goal);
      return intuitiveDirs.includes(dir); // Decoys go toward goal (look good)
    });
    
    for (const dir of decoyDirs) {
      const delta = getDelta(dir);
      
      // Try to create a short decoy path in this direction
      for (let dist = 1; dist <= 3; dist++) {
        const decoyX = keyPos.x + delta.x * dist;
        const decoyY = keyPos.y + delta.y * dist;
        
        if (!isInner(decoyX, decoyY, width, height)) break;
        if (posEq({ x: decoyX, y: decoyY }, start) || 
            posEq({ x: decoyX, y: decoyY }, goal)) break;
        
        if (tiles[decoyY][decoyX] === TileType.WALL) {
          // Open this wall to create decoy path
          tiles[decoyY][decoyX] = TileType.ICE;
          
          // Verify still solvable and optimal path unchanged
          const newOptimal = findPath(tiles, start, goal, width, height);
          const oldOptimal = findPath(tiles, start, goal, width, height);
          
          if (newOptimal === null || (oldOptimal !== null && newOptimal < oldOptimal)) {
            // This actually created a shortcut - revert!
            tiles[decoyY][decoyX] = TileType.WALL;
            break;
          }
        }
      }
    }
  }
  
  // Also add walls near key moves to make them look like dead ends
  for (const keyPos of keyMoves) {
    // Find the optimal direction from this key move
    const optPath = findOptimalPath(tiles, start, goal, width, height);
    if (!optPath) continue;
    
    const keyIdx = optPath.findIndex(p => posEq(p, keyPos));
    if (keyIdx < 0 || keyIdx >= optPath.length - 1) continue;
    
    const nextPos = optPath[keyIdx + 1];
    const optimalDir = getDirectionBetween(keyPos, nextPos);
    if (!optimalDir) continue;
    
    // Add "warning" walls near the optimal direction to make it look bad
    const perpDirs = optimalDir === Direction.UP || optimalDir === Direction.DOWN
      ? [Direction.LEFT, Direction.RIGHT]
      : [Direction.UP, Direction.DOWN];
    
    for (const perpDir of perpDirs) {
      const pd = getDelta(perpDir);
      const od = getDelta(optimalDir);
      
      // Place wall diagonally ahead in optimal direction (makes it look blocked)
      const wallX = keyPos.x + od.x * 2 + pd.x;
      const wallY = keyPos.y + od.y * 2 + pd.y;
      
      if (isInner(wallX, wallY, width, height) && 
          tiles[wallY][wallX] === TileType.ICE &&
          !posEq({ x: wallX, y: wallY }, start) &&
          !posEq({ x: wallX, y: wallY }, goal)) {
        tiles[wallY][wallX] = TileType.WALL;
        
        if (!isSolvable(tiles, start, goal, width, height)) {
          tiles[wallY][wallX] = TileType.ICE;
        }
      }
    }
  }
}

// ----------------------------------------------------------------------------
// SYSTEM 3: COGNITIVE LOAD ANALYSIS
// Measure and maximize required lookahead depth
// ----------------------------------------------------------------------------

// Calculate the longest sequence of moves without a "safe" decision point
// Higher = requires more working memory = harder
function calculateLookaheadDepth(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
): number {
  const optimalPath = findOptimalPath(tiles, start, goal, width, height);
  if (!optimalPath || optimalPath.length < 2) return 0;
  
  let maxSequence = 0;
  let currentSequence = 0;
  
  for (let i = 0; i < optimalPath.length; i++) {
    const pos = optimalPath[i];
    const tile = tiles[pos.y][pos.x];
    
    // Count valid moves from this position
    let validMoves = 0;
    for (const dir of getAllDirs()) {
      const result = simulateMove(tiles, pos, dir, width, height);
      if (result.valid && !posEq(result.pos, pos)) {
        validMoves++;
      }
    }
    
    // "Safe" points are floor tiles or positions with only 1-2 valid moves
    // (easy to reason about)
    const isSafePoint = tile === TileType.GROUND || 
                        tile === TileType.START || 
                        validMoves <= 2;
    
    if (isSafePoint) {
      maxSequence = Math.max(maxSequence, currentSequence);
      currentSequence = 0;
    } else {
      currentSequence++;
    }
  }
  
  maxSequence = Math.max(maxSequence, currentSequence);
  return maxSequence;
}

// Count total "high-stakes" decision points (3+ valid moves, on ice)
function countHighStakesDecisions(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
): number {
  const reachable = getReachable(tiles, start, width, height);
  let highStakes = 0;
  
  for (const key of reachable) {
    const [x, y] = key.split(',').map(Number);
    const tile = tiles[y][x];
    
    // Only count ice tiles (where you can't easily correct mistakes)
    if (tile !== TileType.ICE) continue;
    
    let validMoves = 0;
    for (const dir of getAllDirs()) {
      const result = simulateMove(tiles, { x, y }, dir, width, height);
      if (result.valid && !posEq(result.pos, { x, y })) {
        validMoves++;
      }
    }
    
    if (validMoves >= 3) {
      highStakes++;
    }
  }
  
  return highStakes;
}

// Extend cognitive load by converting floor tiles to ice in key locations
function extendCognitiveChains(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  targetDepth: number
): void {
  const optimalPath = findOptimalPath(tiles, start, goal, width, height);
  if (!optimalPath) return;
  
  // Find floor tiles on the optimal path that could be converted to ice
  for (const pos of optimalPath) {
    if (tiles[pos.y][pos.x] !== TileType.GROUND) continue;
    if (posEq(pos, start) || posEq(pos, goal)) continue;
    
    // Check current lookahead depth
    const currentDepth = calculateLookaheadDepth(tiles, start, goal, width, height);
    if (currentDepth >= targetDepth) break;
    
    // Convert to ice
    tiles[pos.y][pos.x] = TileType.ICE;
    
    // Verify still solvable
    if (!isSolvable(tiles, start, goal, width, height) ||
        !hasNoStuckStates(tiles, start, goal, width, height)) {
      tiles[pos.y][pos.x] = TileType.GROUND;
    }
  }
}

// ============================================================================
// DIFFICULTY VALIDATION - Ensure no easy puzzles
// ============================================================================

// Simulate a "greedy" player who always tries to move toward the goal
// Returns the "penalty" - how many extra moves greedy takes vs optimal
// Higher penalty = more deceptive puzzle (greedy approach fails)
function evaluateGreedyPath(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
): number {
  const optimalMoves = findPath(tiles, start, goal, width, height);
  if (optimalMoves === null) return 0;
  
  let pos = { ...start };
  let moves = 0;
  const maxMoves = optimalMoves * 5; // Prevent infinite loops
  const visited = new Map<string, number>(); // Track visit counts
  
  while (!posEq(pos, goal) && moves < maxMoves) {
    const key = posKey(pos);
    visited.set(key, (visited.get(key) || 0) + 1);
    
    // If we've visited this position 3+ times, we're stuck in a loop
    if ((visited.get(key) || 0) >= 3) {
      // Greedy got stuck - this is good! Return high penalty
      return maxMoves - optimalMoves;
    }
    
    // Greedy strategy: prefer moves that decrease distance to goal
    const intuitiveDirs = getIntuitiveDirection(pos, goal);
    let moved = false;
    
    // First try intuitive directions (toward goal)
    for (const dir of intuitiveDirs) {
      const result = simulateMove(tiles, pos, dir, width, height);
      if (result.valid && !posEq(result.pos, pos)) {
        // Check if this move actually gets us closer
        const oldDist = manhattanDist(pos, goal);
        const newDist = manhattanDist(result.pos, goal);
        if (newDist < oldDist) {
          pos = result.pos;
          moves++;
          moved = true;
          break;
        }
      }
    }
    
    // If intuitive didn't work, try any valid move
    if (!moved) {
      for (const dir of getAllDirs()) {
        const result = simulateMove(tiles, pos, dir, width, height);
        if (result.valid && !posEq(result.pos, pos)) {
          pos = result.pos;
          moves++;
          moved = true;
          break;
        }
      }
    }
    
    // If no move possible, stuck
    if (!moved) {
      return maxMoves - optimalMoves;
    }
  }
  
  // If reached goal, penalty is extra moves taken
  if (posEq(pos, goal)) {
    return moves - optimalMoves;
  }
  
  // Didn't reach goal in time - greedy failed badly
  return maxMoves - optimalMoves;
}

// Check if the first few moves from start have an "obvious" path
// Returns true if the puzzle feels too straightforward at the beginning
function hasObviousStart(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
): boolean {
  const optimalPath = findOptimalPath(tiles, start, goal, width, height);
  if (!optimalPath || optimalPath.length < 5) return true;
  
  // Check first 3 moves of optimal path
  // If they're all in intuitive directions, puzzle starts too obviously
  let intuitiveCount = 0;
  
  for (let i = 0; i < Math.min(3, optimalPath.length - 1); i++) {
    const from = optimalPath[i];
    const to = optimalPath[i + 1];
    
    const intuitiveDirs = getIntuitiveDirection(from, goal);
    const actualDir = getDirectionBetween(from, to);
    
    if (actualDir && intuitiveDirs.includes(actualDir)) {
      intuitiveCount++;
    }
  }
  
  // If 3+ of first moves are intuitive, start is too obvious
  return intuitiveCount >= 3;
}

// Helper: get direction from one position to adjacent position
function getDirectionBetween(from: Position, to: Position): Direction | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  
  // Only works for cardinal directions
  if (dx > 0 && dy === 0) return Direction.RIGHT;
  if (dx < 0 && dy === 0) return Direction.LEFT;
  if (dy > 0 && dx === 0) return Direction.DOWN;
  if (dy < 0 && dx === 0) return Direction.UP;
  
  // For ice slides, check dominant direction
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? Direction.RIGHT : Direction.LEFT;
  } else if (Math.abs(dy) > Math.abs(dx)) {
    return dy > 0 ? Direction.DOWN : Direction.UP;
  }
  
  return null;
}

// ============================================================================
// PUZZLE GENERATION - Large, challenging mazes
// ============================================================================

function createBaseMaze(width: number, height: number, rng: SeededRandom): TileType[][] {
  // Start with all walls
  const tiles: TileType[][] = Array(height).fill(null).map(() => Array(width).fill(TileType.WALL));

  // Carve out the playable area using recursive backtracking maze generation
  const visited = new Set<string>();

  function carve(x: number, y: number) {
    visited.add(posKey({ x, y }));
    tiles[y][x] = TileType.ICE;

    // Get shuffled directions - use step of 2 to create maze walls
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
        // Carve the wall between current and next
        tiles[y + dy / 2][x + dx / 2] = TileType.ICE;
        carve(nx, ny);
      }
    }
  }

  // Start carving from a position
  const startX = 2 + (rng.randomInt(0, Math.floor((width - 4) / 2))) * 2;
  const startY = 2 + (rng.randomInt(0, Math.floor((height - 4) / 2))) * 2;
  carve(startX, startY);

  return tiles;
}

function widenPassages(tiles: TileType[][], width: number, height: number, rng: SeededRandom, intensity: number): void {
  // Widen passages to create larger ice areas for sliding
  const widenCount = Math.floor(width * height * intensity);

  for (let i = 0; i < widenCount; i++) {
    const x = rng.randomInt(2, width - 2);
    const y = rng.randomInt(2, height - 2);

    if (tiles[y][x] === TileType.WALL) {
      // Check if adjacent to ice
      let iceCount = 0;
      if (tiles[y - 1]?.[x] === TileType.ICE) iceCount++;
      if (tiles[y + 1]?.[x] === TileType.ICE) iceCount++;
      if (tiles[y]?.[x - 1] === TileType.ICE) iceCount++;
      if (tiles[y]?.[x + 1] === TileType.ICE) iceCount++;

      if (iceCount >= 2) {
        tiles[y][x] = TileType.ICE;
      }
    }
  }
}

function addStopBlocks(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  // Add walls inside ice areas to create stopping points and redirect slides
  let placed = 0;
  let attempts = 0;
  const maxAttempts = count * 8;

  while (placed < count && attempts < maxAttempts) {
    attempts++;
    const x = rng.randomInt(2, width - 2);
    const y = rng.randomInt(2, height - 2);

    if (tiles[y][x] !== TileType.ICE) continue;
    if (posEq({ x, y }, start) || posEq({ x, y }, goal)) continue;

    // Temporarily place wall
    tiles[y][x] = TileType.WALL;

    // Check if still solvable
    if (isSolvable(tiles, start, goal, width, height)) {
      placed++;
    } else {
      tiles[y][x] = TileType.ICE; // Revert
    }
  }
}

function addFloorStops(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  // Add floor tiles as natural stopping points (decision points)
  let placed = 0;
  let attempts = 0;

  while (placed < count && attempts < count * 3) {
    attempts++;
    const x = rng.randomInt(2, width - 2);
    const y = rng.randomInt(2, height - 2);

    if (tiles[y][x] !== TileType.ICE) continue;
    if (posEq({ x, y }, start) || posEq({ x, y }, goal)) continue;

    tiles[y][x] = TileType.GROUND;
    placed++;
  }
}

function addLedges(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  // Add one-way ledges for directional challenge
  const ledgeOptions: { dir: Direction; type: TileType }[] = [
    { dir: Direction.DOWN, type: TileType.LEDGE_UP },
    { dir: Direction.UP, type: TileType.LEDGE_DOWN },
    { dir: Direction.RIGHT, type: TileType.LEDGE_LEFT },
    { dir: Direction.LEFT, type: TileType.LEDGE_RIGHT },
  ];

  let placed = 0;
  let attempts = 0;
  const maxAttempts = count * 15;

  while (placed < count && attempts < maxAttempts) {
    attempts++;
    const x = rng.randomInt(3, width - 3);
    const y = rng.randomInt(3, height - 3);

    if (tiles[y][x] !== TileType.ICE && tiles[y][x] !== TileType.GROUND) continue;
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

    if (entryTile === TileType.WALL || exitTile === TileType.WALL) continue;

    const oldTile = tiles[y][x];
    tiles[y][x] = option.type;

    // Check if still solvable AND no stuck states
    if (isSolvable(tiles, start, goal, width, height) &&
        hasNoStuckStates(tiles, start, goal, width, height)) {
      placed++;
    } else {
      tiles[y][x] = oldTile;
    }
  }
}

function addExtraConnections(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  // Add extra paths by removing walls - creates alternative (suboptimal) routes
  let added = 0;
  let attempts = 0;

  while (added < count && attempts < count * 5) {
    attempts++;
    const x = rng.randomInt(2, width - 2);
    const y = rng.randomInt(2, height - 2);

    if (tiles[y][x] !== TileType.WALL) continue;

    // Check if this wall separates two ice areas
    let iceCount = 0;
    if (isValid(x, y - 1, width, height) && tiles[y - 1][x] === TileType.ICE) iceCount++;
    if (isValid(x, y + 1, width, height) && tiles[y + 1][x] === TileType.ICE) iceCount++;
    if (isValid(x - 1, y, width, height) && tiles[y][x - 1] === TileType.ICE) iceCount++;
    if (isValid(x + 1, y, width, height) && tiles[y][x + 1] === TileType.ICE) iceCount++;

    if (iceCount >= 2) {
      tiles[y][x] = TileType.ICE;
      added++;
    }
  }
}

// Create island obstacles - clusters of walls that redirect slides
function addIslandObstacles(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  for (let island = 0; island < count; island++) {
    const cx = rng.randomInt(5, width - 5);
    const cy = rng.randomInt(5, height - 5);
    const size = rng.randomInt(2, 4);

    const toPlace: Position[] = [];

    // Create a small cluster
    for (let dy = -size; dy <= size; dy++) {
      for (let dx = -size; dx <= size; dx++) {
        if (Math.abs(dx) + Math.abs(dy) <= size) {
          const x = cx + dx;
          const y = cy + dy;
          if (isInner(x, y, width, height) &&
              tiles[y][x] === TileType.ICE &&
              !posEq({ x, y }, start) &&
              !posEq({ x, y }, goal)) {
            toPlace.push({ x, y });
          }
        }
      }
    }

    // Place the island
    const backup: { pos: Position; tile: TileType }[] = [];
    for (const pos of toPlace) {
      backup.push({ pos, tile: tiles[pos.y][pos.x] });
      tiles[pos.y][pos.x] = TileType.WALL;
    }

    // Verify solvability
    if (!isSolvable(tiles, start, goal, width, height)) {
      // Revert
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
  }
}

// ============================================================================
// ADVANCED DIFFICULTY MECHANICS - High IQ skill curve
// ============================================================================

// Calculate path complexity: how many decision points have multiple viable options
function calculateBranchingFactor(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
): number {
  const visited = new Set<string>();
  const queue: { pos: Position; depth: number }[] = [{ pos: start, depth: 0 }];
  visited.add(posKey(start));
  let head = 0;
  
  let totalBranches = 0;
  let decisionPoints = 0;
  
  while (head < queue.length) {
    const current = queue[head++];
    
    let validMoves = 0;
    const validDirs: Direction[] = [];
    
    for (const dir of getAllDirs()) {
      const result = simulateMove(tiles, current.pos, dir, width, height);
      if (result.valid && !posEq(result.pos, current.pos)) {
        validMoves++;
        validDirs.push(dir);
        
        const key = posKey(result.pos);
        if (!visited.has(key)) {
          visited.add(key);
          queue.push({ pos: result.pos, depth: current.depth + 1 });
        }
      }
    }
    
    if (validMoves >= 2) {
      decisionPoints++;
      totalBranches += validMoves;
    }
  }
  
  return decisionPoints > 0 ? totalBranches / decisionPoints : 1;
}

// Count positions that require backtracking or non-obvious moves to escape
function countTrapPotential(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
): number {
  const reachable = getReachable(tiles, start, width, height);
  let trapScore = 0;
  
  for (const key of reachable) {
    const [x, y] = key.split(',').map(Number);
    const pos = { x, y };
    if (posEq(pos, goal)) continue;
    
    const pathFromPos = findPath(tiles, pos, goal, width, height);
    const directPath = findPath(tiles, start, goal, width, height);
    
    if (pathFromPos !== null && directPath !== null) {
      // How many extra moves does getting here cost vs direct?
      const pathToPos = findPath(tiles, start, pos, width, height);
      if (pathToPos !== null) {
        const inefficiency = (pathToPos + pathFromPos) - directPath;
        if (inefficiency > 5) {
          trapScore += Math.min(inefficiency, 15); // Cap contribution
        }
      }
    }
  }
  
  return trapScore;
}

// Create "funnel" patterns that force specific entry angles
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
    // Pick a funnel center
    const cx = rng.randomInt(6, width - 6);
    const cy = rng.randomInt(6, height - 6);
    
    if (tiles[cy][cx] !== TileType.ICE) continue;
    if (posEq({ x: cx, y: cy }, start) || posEq({ x: cx, y: cy }, goal)) continue;
    
    // Create a funnel shape - walls that guide into a narrow point
    const funnelDir = rng.randomChoice(['horizontal', 'vertical']);
    const backup: { pos: Position; tile: TileType }[] = [];
    
    if (funnelDir === 'horizontal') {
      // Create V-shaped horizontal funnel
      for (let i = 1; i <= 3; i++) {
        const positions = [
          { x: cx - i, y: cy - i },
          { x: cx - i, y: cy + i },
          { x: cx + i, y: cy - i },
          { x: cx + i, y: cy + i },
        ];
        
        for (const pos of positions) {
          if (isInner(pos.x, pos.y, width, height) &&
              tiles[pos.y][pos.x] === TileType.ICE &&
              !posEq(pos, start) && !posEq(pos, goal)) {
            backup.push({ pos, tile: tiles[pos.y][pos.x] });
            tiles[pos.y][pos.x] = TileType.WALL;
          }
        }
      }
    } else {
      // Create V-shaped vertical funnel
      for (let i = 1; i <= 3; i++) {
        const positions = [
          { x: cx - i, y: cy - i },
          { x: cx + i, y: cy - i },
          { x: cx - i, y: cy + i },
          { x: cx + i, y: cy + i },
        ];
        
        for (const pos of positions) {
          if (isInner(pos.x, pos.y, width, height) &&
              tiles[pos.y][pos.x] === TileType.ICE &&
              !posEq(pos, start) && !posEq(pos, goal)) {
            backup.push({ pos, tile: tiles[pos.y][pos.x] });
            tiles[pos.y][pos.x] = TileType.WALL;
          }
        }
      }
    }
    
    // Verify still solvable
    if (!isSolvable(tiles, start, goal, width, height)) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
  }
}

// Add "deceptive shortcuts" - paths that look good but are suboptimal
function addDeceptivePaths(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  count: number
): void {
  const initialPath = findPath(tiles, start, goal, width, height);
  if (initialPath === null) return;
  
  let added = 0;
  let attempts = 0;
  
  while (added < count && attempts < count * 10) {
    attempts++;
    
    // Find a wall that's between two ice areas
    const x = rng.randomInt(4, width - 4);
    const y = rng.randomInt(4, height - 4);
    
    if (tiles[y][x] !== TileType.WALL) continue;
    
    // Count adjacent ice
    let iceNeighbors = 0;
    for (const d of getAllDirs()) {
      const delta = getDelta(d);
      const nx = x + delta.x;
      const ny = y + delta.y;
      if (isValid(nx, ny, width, height) && 
          (tiles[ny][nx] === TileType.ICE || tiles[ny][nx] === TileType.GROUND)) {
        iceNeighbors++;
      }
    }
    
    if (iceNeighbors < 2) continue;
    
    // Open the wall
    tiles[y][x] = TileType.ICE;
    
    const newPath = findPath(tiles, start, goal, width, height);
    
    // Only keep if it doesn't shorten the optimal path (or shortens minimally)
    // This creates "deceptive" routes that seem like shortcuts but aren't
    if (newPath !== null && newPath >= initialPath - 2) {
      added++;
    } else {
      tiles[y][x] = TileType.WALL;
    }
  }
}

// Create "trap alcoves" - areas easy to slide into but requiring multiple moves to escape
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
    
    // Pick alcove direction (which way it opens)
    const openDir = rng.randomChoice(getAllDirs());
    const delta = getDelta(openDir);
    
    // Create a U-shaped alcove
    const backup: { pos: Position; tile: TileType }[] = [];
    const alcovePositions: Position[] = [];
    
    // The "back" of the alcove
    const backX = cx - delta.x * 2;
    const backY = cy - delta.y * 2;
    
    // Walls on sides perpendicular to opening
    if (openDir === Direction.UP || openDir === Direction.DOWN) {
      // Vertical alcove - walls on left and right
      for (let d = -2; d <= 0; d++) {
        const dy = delta.y * d;
        const leftPos = { x: cx - 1, y: cy + dy };
        const rightPos = { x: cx + 1, y: cy + dy };
        
        if (isInner(leftPos.x, leftPos.y, width, height) &&
            tiles[leftPos.y][leftPos.x] === TileType.ICE &&
            !posEq(leftPos, start) && !posEq(leftPos, goal)) {
          alcovePositions.push(leftPos);
        }
        if (isInner(rightPos.x, rightPos.y, width, height) &&
            tiles[rightPos.y][rightPos.x] === TileType.ICE &&
            !posEq(rightPos, start) && !posEq(rightPos, goal)) {
          alcovePositions.push(rightPos);
        }
      }
      // Back wall
      for (let dx = -1; dx <= 1; dx++) {
        const pos = { x: cx + dx, y: backY };
        if (isInner(pos.x, pos.y, width, height) &&
            tiles[pos.y][pos.x] === TileType.ICE &&
            !posEq(pos, start) && !posEq(pos, goal)) {
          alcovePositions.push(pos);
        }
      }
    } else {
      // Horizontal alcove - walls on top and bottom
      for (let d = -2; d <= 0; d++) {
        const dx = delta.x * d;
        const topPos = { x: cx + dx, y: cy - 1 };
        const bottomPos = { x: cx + dx, y: cy + 1 };
        
        if (isInner(topPos.x, topPos.y, width, height) &&
            tiles[topPos.y][topPos.x] === TileType.ICE &&
            !posEq(topPos, start) && !posEq(topPos, goal)) {
          alcovePositions.push(topPos);
        }
        if (isInner(bottomPos.x, bottomPos.y, width, height) &&
            tiles[bottomPos.y][bottomPos.x] === TileType.ICE &&
            !posEq(bottomPos, start) && !posEq(bottomPos, goal)) {
          alcovePositions.push(bottomPos);
        }
      }
      // Back wall
      for (let dy = -1; dy <= 1; dy++) {
        const pos = { x: backX, y: cy + dy };
        if (isInner(pos.x, pos.y, width, height) &&
            tiles[pos.y][pos.x] === TileType.ICE &&
            !posEq(pos, start) && !posEq(pos, goal)) {
          alcovePositions.push(pos);
        }
      }
    }
    
    // Place walls
    for (const pos of alcovePositions) {
      backup.push({ pos, tile: tiles[pos.y][pos.x] });
      tiles[pos.y][pos.x] = TileType.WALL;
    }
    
    // Verify solvability and no permanent traps
    if (!isSolvable(tiles, start, goal, width, height) ||
        !hasNoStuckStates(tiles, start, goal, width, height)) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
  }
}

// Add precision gates - narrow passages requiring exact positioning to navigate
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
      // Horizontal gate (narrow vertical passage)
      const gateY = rng.randomInt(4, height - 4);
      const gateX = rng.randomInt(6, width - 6);
      const gateWidth = rng.randomInt(4, 8);
      const gapPos = rng.randomInt(1, gateWidth - 1);
      
      for (let i = 0; i < gateWidth; i++) {
        const x = gateX + i;
        if (i === gapPos || i === gapPos + 1) continue; // 2-wide gap
        if (!isInner(x, gateY, width, height)) continue;
        if (tiles[gateY][x] !== TileType.ICE) continue;
        if (posEq({ x, y: gateY }, start) || posEq({ x, y: gateY }, goal)) continue;
        
        backup.push({ pos: { x, y: gateY }, tile: tiles[gateY][x] });
        tiles[gateY][x] = TileType.WALL;
      }
    } else {
      // Vertical gate (narrow horizontal passage)
      const gateX = rng.randomInt(4, width - 4);
      const gateY = rng.randomInt(6, height - 6);
      const gateHeight = rng.randomInt(4, 8);
      const gapPos = rng.randomInt(1, gateHeight - 1);
      
      for (let i = 0; i < gateHeight; i++) {
        const y = gateY + i;
        if (i === gapPos || i === gapPos + 1) continue; // 2-wide gap
        if (!isInner(gateX, y, width, height)) continue;
        if (tiles[y][gateX] !== TileType.ICE) continue;
        if (posEq({ x: gateX, y }, start) || posEq({ x: gateX, y }, goal)) continue;
        
        backup.push({ pos: { x: gateX, y }, tile: tiles[y][gateX] });
        tiles[y][gateX] = TileType.WALL;
      }
    }
    
    // Verify solvability
    if (!isSolvable(tiles, start, goal, width, height)) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
  }
}

// Remove floor tiles to force longer planning chains
function convertFloorsToIce(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom,
  percentage: number
): void {
  const floorTiles: Position[] = [];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (tiles[y][x] === TileType.GROUND && 
          !posEq({ x, y }, start) && !posEq({ x, y }, goal)) {
        floorTiles.push({ x, y });
      }
    }
  }
  
  const toConvert = rng.shuffle(floorTiles).slice(0, Math.floor(floorTiles.length * percentage));
  
  for (const pos of toConvert) {
    tiles[pos.y][pos.x] = TileType.ICE;
  }
}

// Add "dead-end magnets" - attractive looking areas that are actually dead ends
// These look like shortcuts toward the goal but lead nowhere useful
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
    // Find a position that's roughly between start and goal
    const midX = Math.floor((start.x + goal.x) / 2);
    const midY = Math.floor((start.y + goal.y) / 2);
    
    const cx = rng.randomInt(
      Math.min(midX - 8, width - 10),
      Math.min(midX + 8, width - 6)
    );
    const cy = rng.randomInt(
      Math.min(midY - 6, height - 8),
      Math.min(midY + 6, height - 6)
    );
    
    if (!isInner(cx, cy, width, height)) continue;
    if (tiles[cy][cx] !== TileType.ICE) continue;
    
    // Create a small open area that looks inviting (toward goal direction)
    const backup: { pos: Position; tile: TileType }[] = [];
    const magnetPositions: Position[] = [];
    
    // Open space toward goal
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
    
    // Open up the magnet area
    for (const pos of magnetPositions) {
      backup.push({ pos, tile: tiles[pos.y][pos.x] });
      tiles[pos.y][pos.x] = TileType.ICE;
    }
    
    // Now block the far end to make it a dead end
    const deadEndWalls: Position[] = [];
    const farX = cx + 4 * goalDir.x;
    const farY = cy + 4 * goalDir.y;
    
    for (let i = -2; i <= 2; i++) {
      const blockX = farX;
      const blockY = farY + i;
      if (isInner(blockX, blockY, width, height) && 
          tiles[blockY][blockX] === TileType.ICE &&
          !posEq({ x: blockX, y: blockY }, start) && 
          !posEq({ x: blockX, y: blockY }, goal)) {
        deadEndWalls.push({ x: blockX, y: blockY });
      }
      
      const blockX2 = farX + i;
      const blockY2 = farY;
      if (isInner(blockX2, blockY2, width, height) && 
          tiles[blockY2][blockX2] === TileType.ICE &&
          !posEq({ x: blockX2, y: blockY2 }, start) && 
          !posEq({ x: blockX2, y: blockY2 }, goal)) {
        deadEndWalls.push({ x: blockX2, y: blockY2 });
      }
    }
    
    // Place dead-end walls
    for (const pos of deadEndWalls) {
      backup.push({ pos, tile: tiles[pos.y][pos.x] });
      tiles[pos.y][pos.x] = TileType.WALL;
    }
    
    // Verify still solvable
    if (!isSolvable(tiles, start, goal, width, height)) {
      // Revert all changes
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
  }
}

// Add winding corridors that force longer paths - EXTREME VERSION
function addWindingCorridors(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom
): void {
  // Add MANY horizontal and vertical wall segments that force detours
  const numSegments = rng.randomInt(8, 15);

  for (let seg = 0; seg < numSegments; seg++) {
    const isHorizontal = rng.random() < 0.5;
    const backup: { pos: Position; tile: TileType }[] = [];

    if (isHorizontal) {
      const y = rng.randomInt(4, height - 4);
      const startX = rng.randomInt(3, Math.floor(width * 0.6));
      const length = rng.randomInt(8, 18); // Longer segments
      const gapPos = rng.randomInt(1, length - 1);
      const gapSize = rng.randomInt(1, 3); // Variable gap sizes

      for (let i = 0; i < length; i++) {
        const x = startX + i;
        if (i >= gapPos && i < gapPos + gapSize) continue; // Leave a gap
        if (!isInner(x, y, width, height)) continue;
        if (tiles[y][x] !== TileType.ICE) continue;
        if (posEq({ x, y }, start) || posEq({ x, y }, goal)) continue;

        backup.push({ pos: { x, y }, tile: tiles[y][x] });
        tiles[y][x] = TileType.WALL;
      }
    } else {
      const x = rng.randomInt(4, width - 4);
      const startY = rng.randomInt(3, Math.floor(height * 0.6));
      const length = rng.randomInt(8, 16); // Longer segments
      const gapPos = rng.randomInt(1, length - 1);
      const gapSize = rng.randomInt(1, 3);

      for (let i = 0; i < length; i++) {
        const y = startY + i;
        if (i >= gapPos && i < gapPos + gapSize) continue;
        if (!isInner(x, y, width, height)) continue;
        if (tiles[y][x] !== TileType.ICE) continue;
        if (posEq({ x, y }, start) || posEq({ x, y }, goal)) continue;

        backup.push({ pos: { x, y }, tile: tiles[y][x] });
        tiles[y][x] = TileType.WALL;
      }
    }

    // Verify solvability
    if (!isSolvable(tiles, start, goal, width, height)) {
      for (const { pos, tile } of backup) {
        tiles[pos.y][pos.x] = tile;
      }
    }
  }
}

// ============================================================================
// CONSTRAINT-BASED PUZZLE GENERATION (Backwards Design)
// Designs puzzles from the goal backwards, ensuring every step is counter-intuitive
// ============================================================================

interface WaypointConstraint {
  pos: Position;
  requiredApproachDir: Direction; // Must approach from this direction to reach
  slideDistance: number; // How far you slide to reach this point
}

// Generate a puzzle by designing the solution path backwards from goal
function generateConstraintBasedPuzzle(
  width: number,
  height: number,
  rng: SeededRandom,
  chainLength: number = 15 // Number of required waypoints
): { tiles: TileType[][], start: Position, goal: Position } | null {
  
  // Initialize with all walls
  const tiles: TileType[][] = Array(height).fill(null).map(() => 
    Array(width).fill(TileType.WALL)
  );
  
  // Place goal near a corner (but not on edge)
  const corners = [
    { x: width - 4, y: height - 4 }, // bottom-right
    { x: 4, y: height - 4 },          // bottom-left
    { x: width - 4, y: 4 },           // top-right
    { x: 4, y: 4 },                    // top-left
  ];
  const goal = rng.randomChoice(corners);
  
  // Create the solution chain working backwards from goal
  const waypoints: WaypointConstraint[] = [];
  let currentPos = { ...goal };
  
  // Track which cells are part of the solution path
  const solutionPath = new Set<string>();
  solutionPath.add(posKey(goal));
  
  for (let i = 0; i < chainLength; i++) {
    // Determine the "intuitive" direction (toward where start likely is - opposite corner)
    const intuitiveDir = getOppositeCornerDirection(currentPos, goal, width, height);
    
    // Choose approach direction - AVOID the intuitive direction
    const possibleApproachDirs = getAllDirs().filter(d => {
      // Don't use the intuitive direction
      if (d === intuitiveDir) return false;
      // Don't use the opposite of intuitive (too predictable)
      if (d === getOppositeDir(intuitiveDir) && rng.random() < 0.7) return false;
      return true;
    });
    
    if (possibleApproachDirs.length === 0) break;
    
    const approachDir = rng.randomChoice(possibleApproachDirs);
    const oppDir = getOppositeDir(approachDir);
    const delta = getDelta(oppDir); // Direction to look for source position
    
    // Determine slide distance (longer slides = harder to plan)
    const slideDistance = rng.randomInt(3, 8);
    
    // Find source position (where player starts the slide FROM)
    const sourcePos = {
      x: currentPos.x + delta.x * slideDistance,
      y: currentPos.y + delta.y * slideDistance
    };
    
    // Check if source is valid
    if (!isInner(sourcePos.x, sourcePos.y, width, height)) {
      // Try shorter distance
      let found = false;
      for (let dist = slideDistance - 1; dist >= 2; dist--) {
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
    
    // Carve the ice path from source to current (player slides this path)
    const pathDelta = getDelta(approachDir);
    let carveX = sourcePos.x;
    let carveY = sourcePos.y;
    
    while (!posEq({ x: carveX, y: carveY }, currentPos)) {
      if (!isInner(carveX, carveY, width, height)) break;
      tiles[carveY][carveX] = TileType.ICE;
      solutionPath.add(posKey({ x: carveX, y: carveY }));
      carveX += pathDelta.x;
      carveY += pathDelta.y;
    }
    tiles[currentPos.y][currentPos.x] = TileType.ICE;
    
    // Place WALL as stopper (why player stops at currentPos)
    const stopperX = currentPos.x + pathDelta.x;
    const stopperY = currentPos.y + pathDelta.y;
    if (isValid(stopperX, stopperY, width, height)) {
      tiles[stopperY][stopperX] = TileType.WALL;
    }
    
    // Record this waypoint
    waypoints.push({
      pos: { ...currentPos },
      requiredApproachDir: approachDir,
      slideDistance: Math.abs(sourcePos.x - currentPos.x) + Math.abs(sourcePos.y - currentPos.y)
    });
    
    // Move to source for next iteration
    currentPos = sourcePos;
  }
  
  if (waypoints.length < 5) {
    return null; // Failed to create enough complexity
  }
  
  // Start position is the last source we reached
  const start = { ...currentPos };
  tiles[start.y][start.x] = TileType.ICE;
  
  // Now add DECOY paths - paths that look good but lead nowhere
  addDecoyBranches(tiles, waypoints, goal, width, height, rng);
  
  // Add some additional ice to make the map less obviously linear
  fillWithDecoyIce(tiles, solutionPath, start, goal, width, height, rng);
  
  // Add strategic walls to block "shortcut" attempts
  addShortcutBlockers(tiles, waypoints, start, goal, width, height, rng);
  
  // Set start and goal tiles
  tiles[start.y][start.x] = TileType.START;
  tiles[goal.y][goal.x] = TileType.GOAL;
  
  // Verify solvability
  if (!isSolvable(tiles, start, goal, width, height)) {
    return null;
  }
  
  // Verify no stuck states
  if (!hasNoStuckStates(tiles, start, goal, width, height)) {
    return null;
  }
  
  return { tiles, start, goal };
}

// Get the direction toward the opposite corner from goal
function getOppositeCornerDirection(pos: Position, goal: Position, width: number, height: number): Direction {
  // If goal is in bottom-right, intuitive is toward top-left, etc.
  const centerX = width / 2;
  const centerY = height / 2;
  
  // Primary direction away from goal's corner
  if (goal.x > centerX && goal.y > centerY) {
    // Goal bottom-right, intuitive toward top-left
    return pos.y > centerY ? Direction.UP : Direction.LEFT;
  } else if (goal.x < centerX && goal.y > centerY) {
    // Goal bottom-left, intuitive toward top-right
    return pos.y > centerY ? Direction.UP : Direction.RIGHT;
  } else if (goal.x > centerX && goal.y < centerY) {
    // Goal top-right, intuitive toward bottom-left
    return pos.y < centerY ? Direction.DOWN : Direction.LEFT;
  } else {
    // Goal top-left, intuitive toward bottom-right
    return pos.y < centerY ? Direction.DOWN : Direction.RIGHT;
  }
}

// Add decoy branches at waypoints - paths that look promising but dead-end
function addDecoyBranches(
  tiles: TileType[][],
  waypoints: WaypointConstraint[],
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom
): void {
  for (const wp of waypoints) {
    // At each waypoint, create decoy paths in the "intuitive" directions
    const intuitiveDirs = getIntuitiveDirection(wp.pos, goal);
    
    for (const decoyDir of intuitiveDirs) {
      // Don't create decoy in the correct approach direction
      if (decoyDir === wp.requiredApproachDir) continue;
      
      // Create a decoy path that looks like progress but dead-ends
      const decoyLength = rng.randomInt(4, 10);
      const delta = getDelta(decoyDir);
      
      let x = wp.pos.x + delta.x;
      let y = wp.pos.y + delta.y;
      
      // Carve decoy path
      for (let i = 0; i < decoyLength; i++) {
        if (!isInner(x, y, width, height)) break;
        if (tiles[y][x] === TileType.WALL) {
          tiles[y][x] = TileType.ICE;
        }
        x += delta.x;
        y += delta.y;
      }
      
      // Make sure it dead-ends (wall at the end)
      if (isValid(x, y, width, height)) {
        tiles[y][x] = TileType.WALL;
      }
      
      // Add a perpendicular dead-end for extra misdirection
      if (rng.random() < 0.6 && decoyLength > 3) {
        const perpDir = rng.randomChoice(
          decoyDir === Direction.UP || decoyDir === Direction.DOWN
            ? [Direction.LEFT, Direction.RIGHT]
            : [Direction.UP, Direction.DOWN]
        );
        const perpDelta = getDelta(perpDir);
        const branchX = wp.pos.x + delta.x * Math.floor(decoyLength / 2);
        const branchY = wp.pos.y + delta.y * Math.floor(decoyLength / 2);
        
        for (let i = 1; i <= rng.randomInt(3, 6); i++) {
          const bx = branchX + perpDelta.x * i;
          const by = branchY + perpDelta.y * i;
          if (!isInner(bx, by, width, height)) break;
          if (tiles[by][bx] === TileType.WALL) {
            tiles[by][bx] = TileType.ICE;
          }
        }
      }
    }
  }
}

// Fill some areas with ice to make map less obviously a single path
function fillWithDecoyIce(
  tiles: TileType[][],
  solutionPath: Set<string>,
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom
): void {
  const fillAttempts = Math.floor(width * height * 0.15);
  
  for (let i = 0; i < fillAttempts; i++) {
    const x = rng.randomInt(2, width - 2);
    const y = rng.randomInt(2, height - 2);
    
    if (tiles[y][x] !== TileType.WALL) continue;
    if (posEq({ x, y }, start) || posEq({ x, y }, goal)) continue;
    
    // Only fill if adjacent to existing ice (creates connected areas)
    let hasAdjacentIce = false;
    for (const dir of getAllDirs()) {
      const d = getDelta(dir);
      const nx = x + d.x;
      const ny = y + d.y;
      if (isValid(nx, ny, width, height) && 
          (tiles[ny][nx] === TileType.ICE || tiles[ny][nx] === TileType.GROUND)) {
        hasAdjacentIce = true;
        break;
      }
    }
    
    if (hasAdjacentIce && rng.random() < 0.4) {
      tiles[y][x] = TileType.ICE;
    }
  }
}

// Add walls that block intuitive "shortcuts"
function addShortcutBlockers(
  tiles: TileType[][],
  waypoints: WaypointConstraint[],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom
): void {
  // For each pair of non-adjacent waypoints, try to block direct paths
  for (let i = 0; i < waypoints.length - 2; i++) {
    const wp1 = waypoints[i];
    const wp2 = waypoints[i + 2]; // Skip one waypoint
    
    // Find midpoint
    const midX = Math.floor((wp1.pos.x + wp2.pos.x) / 2);
    const midY = Math.floor((wp1.pos.y + wp2.pos.y) / 2);
    
    // Try to place a wall near the midpoint
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const wx = midX + dx;
        const wy = midY + dy;
        
        if (!isInner(wx, wy, width, height)) continue;
        if (tiles[wy][wx] !== TileType.ICE) continue;
        if (posEq({ x: wx, y: wy }, start) || posEq({ x: wx, y: wy }, goal)) continue;
        
        // Temporarily place wall
        tiles[wy][wx] = TileType.WALL;
        
        // Check if still solvable
        if (!isSolvable(tiles, start, goal, width, height)) {
          tiles[wy][wx] = TileType.ICE; // Revert
        } else if (rng.random() < 0.5) {
          break; // Keep this blocker
        } else {
          tiles[wy][wx] = TileType.ICE; // Revert, try another spot
        }
      }
    }
  }
  
  // Add some random blockers in areas that look like shortcuts to goal
  const goalApproachDirs = getIntuitiveDirection(start, goal);
  for (const dir of goalApproachDirs) {
    const delta = getDelta(dir);
    
    // Walk from start toward goal, adding occasional blockers
    let x = start.x + delta.x * 3;
    let y = start.y + delta.y * 3;
    
    for (let step = 0; step < 15; step++) {
      if (!isInner(x, y, width, height)) break;
      
      if (tiles[y][x] === TileType.ICE && rng.random() < 0.25) {
        tiles[y][x] = TileType.WALL;
        
        if (!isSolvable(tiles, start, goal, width, height)) {
          tiles[y][x] = TileType.ICE;
        }
      }
      
      x += delta.x;
      y += delta.y;
    }
  }
}

// Main puzzle generation - EXTREME DIFFICULTY (targeting 2+ minute solves)
export function generatePuzzle(seed: string): PuzzleData {
  const rng = new SeededRandom(seed);

  // LARGER puzzle sizes - more ground to cover, more complexity
  const sizeOptions = [
    { width: 35, height: 27 },
    { width: 37, height: 27 },
    { width: 35, height: 29 },
    { width: 37, height: 29 },
    { width: 39, height: 29 },
    { width: 37, height: 31 },
    { width: 39, height: 31 },
    { width: 41, height: 31 },
    { width: 41, height: 33 },
    { width: 43, height: 33 },
  ];

  const { width, height } = rng.randomChoice(sizeOptions);
  let batch = 0;

  while (true) {
    let bestPuzzle: PuzzleData | null = null;
    let bestScore = 0;
    const cbStart = batch * CONSTRAINT_ATTEMPTS;
    const cbEnd = cbStart + CONSTRAINT_ATTEMPTS;
    const tradStart = batch * TRADITIONAL_ATTEMPTS;
    const tradEnd = tradStart + TRADITIONAL_ATTEMPTS;

    // ============================================
    // PHASE 1: Constraint-Based Generation
    // ============================================
    
    for (let cbAttempt = cbStart; cbAttempt < cbEnd; cbAttempt++) {
      const cbRng = new SeededRandom(seed + '-cb-' + cbAttempt);
      const chainLength = cbRng.randomInt(16, 26); // Longer chains = harder
      
      const result = generateConstraintBasedPuzzle(width, height, cbRng, chainLength);
      if (!result) continue;
      
      const { tiles, start, goal } = result;
      
      // Calculate metrics using psychology-based scoring
      const optimalMoves = findPath(tiles, start, goal, width, height);
      if (optimalMoves === null || optimalMoves < 20) continue;
      
      // Use psychology-based difficulty metrics
      const psychMetrics = calculatePsychologyScore(tiles, start, goal, width, height);
      if (!passesPsychologyPrefilters(psychMetrics)) continue;
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
          mapType: MapType.ICE,
          difficultyScore: Math.round(score),
          counterIntuitiveMoves: psychMetrics.counterIntuitiveMoves,
          attractiveDecoys: psychMetrics.attractiveDecoys,
          commitmentGates: psychMetrics.commitmentGates,
          falseProgressPaths: psychMetrics.falseProgressPaths,
        };
      }
      
      // Found excellent psychology-based puzzle
      if (score >= TARGET_PSYCHOLOGY_SCORE &&
          psychMetrics.counterIntuitiveMoves >= 8 && 
          psychMetrics.attractiveDecoys >= 10 &&
          psychMetrics.commitmentGates >= 3) {
        return bestPuzzle!;
      }
    }
    
    // ============================================
    // PHASE 2: Traditional Generation
    // ============================================
    
    for (let attempt = tradStart; attempt < tradEnd; attempt++) {
      // Create base maze with guaranteed connectivity
      const tiles = createBaseMaze(width, height, rng);

      // Find start and goal positions
      const iceTiles: Position[] = [];
      for (let y = 2; y < height - 2; y++) {
        for (let x = 2; x < width - 2; x++) {
          if (tiles[y][x] === TileType.ICE) {
            iceTiles.push({ x, y });
          }
        }
      }

      // Require more ice tiles for larger mazes
      if (iceTiles.length < 90) continue;

      // Pick start on left side, goal on right side (maximize distance)
      const leftTiles = iceTiles.filter(p => p.x < width / 5);
      const rightTiles = iceTiles.filter(p => p.x > (4 * width) / 5);
      
      // Also consider corner positions for extra path length
      const topLeftTiles = iceTiles.filter(p => p.x < width / 4 && p.y < height / 3);
      const bottomRightTiles = iceTiles.filter(p => p.x > (3 * width) / 4 && p.y > (2 * height) / 3);

      // Prefer diagonal placements when possible
      let start: Position, goal: Position;
      if (topLeftTiles.length > 0 && bottomRightTiles.length > 0 && rng.random() < 0.6) {
        start = rng.randomChoice(topLeftTiles);
        goal = rng.randomChoice(bottomRightTiles);
      } else if (leftTiles.length > 0 && rightTiles.length > 0) {
        start = rng.randomChoice(leftTiles);
        goal = rng.randomChoice(rightTiles);
      } else {
        continue;
      }

      // Widen passages for larger sliding areas - INCREASED
      widenPassages(tiles, width, height, rng, 0.20);

      // MANY alternative routes (creates decision paralysis)
      addExtraConnections(tiles, start, goal, width, height, rng, rng.randomInt(35, 60));

      // MORE winding corridors - call multiple times for layered complexity
      addWindingCorridors(tiles, start, goal, width, height, rng);
      addWindingCorridors(tiles, start, goal, width, height, rng);
      addWindingCorridors(tiles, start, goal, width, height, rng);

      // MORE island obstacles for redirection
      addIslandObstacles(tiles, start, goal, width, height, rng, rng.randomInt(10, 18));

      // ============================================
      // GENIUS-LEVEL DECEPTION ENGINE
      // All 10 psychological misdirection algorithms
      // ============================================
      
      // ALGORITHM 1: Force counter-intuitive paths (block obvious approaches)
      engineerCounterIntuitivePath(tiles, start, goal, width, height, rng);
      
      // ALGORITHM 2: "Almost there" traps - slide past the goal
      createAlmostThereTraps(tiles, start, goal, width, height, rng, rng.randomInt(5, 10));
      
      // ALGORITHM 3: Decoy open areas - inviting areas that waste moves
      createDecoyOpenAreas(tiles, start, goal, width, height, rng, rng.randomInt(6, 12));
      
      // ALGORITHM 4: Hidden choke points - critical passages easy to miss
      createHiddenChokePoints(tiles, start, goal, width, height, rng, rng.randomInt(5, 10));
      
      // ALGORITHM 5: Momentum traps - ice slides that overshoot
      createMomentumTraps(tiles, start, goal, width, height, rng, rng.randomInt(8, 16));
      
      // ALGORITHM 6: Anti-gradient zones - moving toward goal increases cost
      createAntiGradientZones(tiles, start, goal, width, height, rng, rng.randomInt(5, 10));
      
      // ALGORITHM 7: Parallel path illusion - similar paths, different costs
      createParallelPathIllusion(tiles, start, goal, width, height, rng, rng.randomInt(6, 12));
      
      // ALGORITHM 8: Ledge misdirection - one-way tiles that look helpful
      createLedgeMisdirection(tiles, start, goal, width, height, rng, rng.randomInt(10, 18));
      
      // ALGORITHM 9: Goal proximity dead ends - tantalizingly close but blocked
      createGoalProximityDeadEnds(tiles, start, goal, width, height, rng, rng.randomInt(6, 12));
      
      // ALGORITHM 10: Commitment traps - wrong choices lock you in
      createCommitmentTraps(tiles, start, goal, width, height, rng, rng.randomInt(6, 12));

      // ============================================
      // ADDITIONAL COMPLEXITY LAYERS
      // ============================================
      
      // Precision gates - narrow passages requiring exact positioning
      addPrecisionGates(tiles, start, goal, width, height, rng, rng.randomInt(8, 16));
      
      // Funnel patterns that force specific approaches
      addFunnelPatterns(tiles, start, goal, width, height, rng, rng.randomInt(6, 12));
      
      // Trap alcoves - easy to enter, costly to escape
      addTrapAlcoves(tiles, start, goal, width, height, rng, rng.randomInt(10, 18));
      
      // Deceptive paths - routes that look good but waste moves
      addDeceptivePaths(tiles, start, goal, width, height, rng, rng.randomInt(25, 45));
      
      // Dead-end magnets - attractive looking dead ends
      addDeadEndMagnets(tiles, start, goal, width, height, rng, rng.randomInt(6, 12));

      // Stop blocks for redirect complexity
      addStopBlocks(tiles, start, goal, width, height, rng, rng.randomInt(35, 60));

      // MINIMAL floor stopping points (force long ice planning chains)
      addFloorStops(tiles, start, goal, width, height, rng, rng.randomInt(2, 4));
      
      // Convert MOST floor tiles back to ice (maximize planning difficulty)
      convertFloorsToIce(tiles, start, goal, width, height, rng, 0.82);

      // Ledges for complex directional puzzles
      addLedges(tiles, start, goal, width, height, rng, rng.randomInt(20, 35));

      // Set start and goal
      tiles[start.y][start.x] = TileType.START;
      tiles[goal.y][goal.x] = TileType.GOAL;

      // Verify solvability after all modifications
      const optimalMoves = findPath(tiles, start, goal, width, height);
      if (optimalMoves === null) continue;

      // Verify no stuck states
      if (!hasNoStuckStates(tiles, start, goal, width, height)) continue;

      // ============================================
      // PSYCHOLOGY-BASED DIFFICULTY SCORING
      // Measures what actually makes puzzles hard for HUMANS
      // ============================================
      
      // Only hard reject trivially short puzzles
      if (optimalMoves < 20) continue;
      
      // Calculate psychology-based difficulty metrics
      const psychMetrics = calculatePsychologyScore(tiles, start, goal, width, height);
      if (!passesPsychologyPrefilters(psychMetrics)) continue;
      
      // Use the new psychology score directly
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
          mapType: MapType.ICE,
          // Psychology-based difficulty metrics for dev display
          difficultyScore: Math.round(score),
          counterIntuitiveMoves: psychMetrics.counterIntuitiveMoves,
          attractiveDecoys: psychMetrics.attractiveDecoys,
          commitmentGates: psychMetrics.commitmentGates,
          falseProgressPaths: psychMetrics.falseProgressPaths,
        };
      }

      // Break early if we find an excellent psychology-based puzzle
      // A good puzzle has multiple counter-intuitive moves AND attractive decoys
      if (score >= TARGET_PSYCHOLOGY_SCORE &&
          psychMetrics.counterIntuitiveMoves >= 8 && 
          psychMetrics.attractiveDecoys >= 10 &&
          psychMetrics.commitmentGates >= 3) {
        return bestPuzzle!;
      }
    }

    if (bestPuzzle) {
      return bestPuzzle;
    }

    // Nothing accepted in this batch; keep generating with new attempt ranges
    batch++;
  }
}

// Partial puzzle generation for parallel workers
// Each worker processes a subset of attempts and returns the best found
export function generatePuzzlePartial(
  seed: string,
  constraintStart: number,
  constraintEnd: number,
  traditionalStart: number,
  traditionalEnd: number
): { puzzle: PuzzleData | null; score: number } {
  const rng = new SeededRandom(seed);

  const sizeOptions = [
    { width: 35, height: 27 },
    { width: 37, height: 27 },
    { width: 35, height: 29 },
    { width: 37, height: 29 },
    { width: 39, height: 29 },
    { width: 37, height: 31 },
    { width: 39, height: 31 },
    { width: 41, height: 31 },
    { width: 41, height: 33 },
    { width: 43, height: 33 },
  ];

  const { width, height } = rng.randomChoice(sizeOptions);
  const constraintRange = constraintEnd - constraintStart;
  const traditionalRange = traditionalEnd - traditionalStart;
  let batch = 0;

  while (true) {
    let bestPuzzle: PuzzleData | null = null;
    let bestScore = 0;
    const cbBase = constraintStart + batch * constraintRange;
    const cbLimit = cbBase + constraintRange;
    const tradBase = traditionalStart + batch * traditionalRange;
    const tradLimit = tradBase + traditionalRange;

    // PHASE 1: Constraint-Based Generation (partial range, repeated per batch)
    for (let cbAttempt = cbBase; cbAttempt < cbLimit; cbAttempt++) {
      const cbRng = new SeededRandom(seed + '-cb-' + cbAttempt);
      const chainLength = cbRng.randomInt(16, 26);
      
      const result = generateConstraintBasedPuzzle(width, height, cbRng, chainLength);
      if (!result) continue;
      
      const { tiles, start, goal } = result;
      
      const optimalMoves = findPath(tiles, start, goal, width, height);
      if (optimalMoves === null || optimalMoves < 20) continue;
      
      const psychMetrics = calculatePsychologyScore(tiles, start, goal, width, height);
      if (!passesPsychologyPrefilters(psychMetrics)) continue;
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
          mapType: MapType.ICE,
          difficultyScore: Math.round(score),
          counterIntuitiveMoves: psychMetrics.counterIntuitiveMoves,
          attractiveDecoys: psychMetrics.attractiveDecoys,
          commitmentGates: psychMetrics.commitmentGates,
          falseProgressPaths: psychMetrics.falseProgressPaths,
        };
      }
      
      // Found excellent puzzle - return early when score target is hit
      if (score >= TARGET_PSYCHOLOGY_SCORE &&
          psychMetrics.counterIntuitiveMoves >= 8 && 
          psychMetrics.attractiveDecoys >= 10 &&
          psychMetrics.commitmentGates >= 3) {
        return { puzzle: bestPuzzle, score: bestScore };
      }
    }
    
    // PHASE 2: Traditional Generation (partial range, repeated per batch)
    for (let attempt = tradBase; attempt < tradLimit; attempt++) {
      const attemptRng = new SeededRandom(seed + '-trad-' + attempt);
      
      const tiles = createBaseMaze(width, height, attemptRng);

      const iceTiles: Position[] = [];
      for (let y = 2; y < height - 2; y++) {
        for (let x = 2; x < width - 2; x++) {
          if (tiles[y][x] === TileType.ICE) {
            iceTiles.push({ x, y });
          }
        }
      }

      if (iceTiles.length < 90) continue;

      const leftTiles = iceTiles.filter(p => p.x < width / 5);
      const rightTiles = iceTiles.filter(p => p.x > (4 * width) / 5);
      const topLeftTiles = iceTiles.filter(p => p.x < width / 4 && p.y < height / 3);
      const bottomRightTiles = iceTiles.filter(p => p.x > (3 * width) / 4 && p.y > (2 * height) / 3);

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

      widenPassages(tiles, width, height, attemptRng, 0.20);
      addExtraConnections(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(35, 60));
      addWindingCorridors(tiles, start, goal, width, height, attemptRng);
      addWindingCorridors(tiles, start, goal, width, height, attemptRng);
      addWindingCorridors(tiles, start, goal, width, height, attemptRng);
      addIslandObstacles(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(10, 18));
      
      engineerCounterIntuitivePath(tiles, start, goal, width, height, attemptRng);
      createAlmostThereTraps(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(5, 10));
      createDecoyOpenAreas(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(6, 12));
      createHiddenChokePoints(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(5, 10));
      createMomentumTraps(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(8, 16));
      createAntiGradientZones(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(5, 10));
      createParallelPathIllusion(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(6, 12));
      createLedgeMisdirection(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(10, 18));
      createGoalProximityDeadEnds(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(6, 12));
      createCommitmentTraps(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(6, 12));
      
      addPrecisionGates(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(8, 16));
      addFunnelPatterns(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(6, 12));
      addTrapAlcoves(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(10, 18));
      addDeceptivePaths(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(25, 45));
      addDeadEndMagnets(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(6, 12));
      addStopBlocks(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(35, 60));
      addFloorStops(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(2, 4));
      convertFloorsToIce(tiles, start, goal, width, height, attemptRng, 0.82);
      addLedges(tiles, start, goal, width, height, attemptRng, attemptRng.randomInt(20, 35));

      tiles[start.y][start.x] = TileType.START;
      tiles[goal.y][goal.x] = TileType.GOAL;

      const optimalMoves = findPath(tiles, start, goal, width, height);
      if (optimalMoves === null) continue;

      if (!hasNoStuckStates(tiles, start, goal, width, height)) continue;

      if (optimalMoves < 20) continue;
      
      const psychMetrics = calculatePsychologyScore(tiles, start, goal, width, height);
      if (!passesPsychologyPrefilters(psychMetrics)) continue;
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
          mapType: MapType.ICE,
          difficultyScore: Math.round(score),
          counterIntuitiveMoves: psychMetrics.counterIntuitiveMoves,
          attractiveDecoys: psychMetrics.attractiveDecoys,
          commitmentGates: psychMetrics.commitmentGates,
          falseProgressPaths: psychMetrics.falseProgressPaths,
        };
      }

      // Found excellent puzzle - return early
      if (score >= TARGET_PSYCHOLOGY_SCORE &&
          psychMetrics.counterIntuitiveMoves >= 8 && 
          psychMetrics.attractiveDecoys >= 10 &&
          psychMetrics.commitmentGates >= 3) {
        return { puzzle: bestPuzzle, score: bestScore };
      }
    }

    if (bestPuzzle) {
      return { puzzle: bestPuzzle, score: bestScore };
    }

    // Nothing accepted in this batch; move to next batch of attempts
    batch++;
  }
}

// GUARANTEED HARD PUZZLE - Uses deliberate counter-intuitive design
// This is the fallback when random generation fails to produce a hard enough puzzle
function createGuaranteedHardPuzzle(width: number, height: number, rng: SeededRandom): PuzzleData {
  const tiles: TileType[][] = Array(height).fill(null).map(() => Array(width).fill(TileType.WALL));

  // Create a deliberately serpentine path structure
  // The key: goal is opposite corner, but direct path is blocked
  // Player must navigate a winding route
  
  // Create main corridors that DON'T go directly to goal
  // Horizontal corridors at different heights
  const corridorY1 = Math.floor(height * 0.2);
  const corridorY2 = Math.floor(height * 0.5);
  const corridorY3 = Math.floor(height * 0.8);
  
  // Vertical corridors at different positions
  const corridorX1 = Math.floor(width * 0.15);
  const corridorX2 = Math.floor(width * 0.4);
  const corridorX3 = Math.floor(width * 0.6);
  const corridorX4 = Math.floor(width * 0.85);
  
  // Create horizontal corridors (2 tiles wide for ice sliding)
  for (const cy of [corridorY1, corridorY2, corridorY3]) {
    for (let x = 2; x < width - 2; x++) {
      for (let dy = -1; dy <= 1; dy++) {
        const y = cy + dy;
        if (isInner(x, y, width, height)) {
          tiles[y][x] = TileType.ICE;
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
          tiles[y][x] = TileType.ICE;
        }
      }
    }
  }
  
  // Start in top-left area, goal in bottom-right
  // But block the direct diagonal!
  const start = { x: corridorX1, y: corridorY1 };
  const goal = { x: corridorX4, y: corridorY3 };
  
  // Block direct approaches to goal from intuitive directions
  // Create walls that force counter-intuitive routing
  
  // Block the straightforward right-then-down path
  for (let x = corridorX3 + 3; x < corridorX4 - 2; x++) {
    for (let y = corridorY2 - 2; y <= corridorY2 + 2; y++) {
      if (isInner(x, y, width, height) && 
          !posEq({ x, y }, start) && !posEq({ x, y }, goal)) {
        tiles[y][x] = TileType.WALL;
      }
    }
  }
  
  // Block approach to goal from above
  for (let y = corridorY2 + 3; y < corridorY3 - 2; y++) {
    const x = corridorX4;
    if (isInner(x, y, width, height)) {
      tiles[y][x] = TileType.WALL;
      tiles[y][x - 1] = TileType.WALL;
    }
  }
  
  // Add many walls to create maze-like complexity
  for (let i = 0; i < 100; i++) {
    const x = rng.randomInt(3, width - 3);
    const y = rng.randomInt(3, height - 3);
    if (!posEq({ x, y }, start) && !posEq({ x, y }, goal) && tiles[y][x] === TileType.ICE) {
      tiles[y][x] = TileType.WALL;
      if (!isSolvable(tiles, start, goal, width, height)) {
        tiles[y][x] = TileType.ICE;
      }
    }
  }
  
  // Add ledges to create commitment points
  const ledgePositions = [
    { x: corridorX2, y: corridorY1 + 2, type: TileType.LEDGE_DOWN },
    { x: corridorX3, y: corridorY2 - 2, type: TileType.LEDGE_UP },
    { x: corridorX2 + 2, y: corridorY2, type: TileType.LEDGE_RIGHT },
    { x: corridorX3 - 2, y: corridorY3, type: TileType.LEDGE_LEFT },
  ];
  
  for (const lp of ledgePositions) {
    if (isInner(lp.x, lp.y, width, height) && 
        tiles[lp.y][lp.x] === TileType.ICE &&
        !posEq({ x: lp.x, y: lp.y }, start) && 
        !posEq({ x: lp.x, y: lp.y }, goal)) {
      tiles[lp.y][lp.x] = lp.type;
      if (!isSolvable(tiles, start, goal, width, height) ||
          !hasNoStuckStates(tiles, start, goal, width, height)) {
        tiles[lp.y][lp.x] = TileType.ICE;
      }
    }
  }
  
  // Ensure solvability by opening a guaranteed (but non-obvious) path
  // Open a path that requires going LEFT first (counter-intuitive)
  const escapeX = corridorX1 - 2;
  for (let y = corridorY1; y <= corridorY3; y++) {
    if (isInner(escapeX, y, width, height)) {
      tiles[y][escapeX] = TileType.ICE;
    }
  }
  
  tiles[start.y][start.x] = TileType.START;
  tiles[goal.y][goal.x] = TileType.GOAL;
  
  // Final solvability check
  if (!isSolvable(tiles, start, goal, width, height)) {
    // Emergency: open more paths
    for (let y = corridorY2 - 1; y <= corridorY2 + 1; y++) {
      for (let x = corridorX1; x <= corridorX4; x++) {
        if (isInner(x, y, width, height)) {
          tiles[y][x] = TileType.ICE;
        }
      }
    }
  }

  const optimalMoves = findPath(tiles, start, goal, width, height) || 60;

  return { width, height, tiles, start, goal, optimalMoves, mapType: MapType.ICE };
}
