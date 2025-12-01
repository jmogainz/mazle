import seedrandom from 'seedrandom';
import { TileType, Position, PuzzleData, Direction } from './types';

// Server salt for puzzle generation
const SERVER_SALT = 'mazle-daily-v8-2024-genius';

// Get deterministic seed for a given date
export function getDailySeed(date: Date): string {
  const dateStr = date.toISOString().split('T')[0];
  return `${dateStr}-${SERVER_SALT}`;
}

// Get puzzle number (days since launch)
export function getPuzzleNumber(date: Date): number {
  const launchDate = new Date('2024-01-01');
  const diffTime = date.getTime() - launchDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays + 1;
}

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
  if (targetTile >= TileType.LEDGE_UP && targetTile <= TileType.LEDGE_RIGHT) {
    const ledgeDir = targetTile - TileType.LEDGE_UP;
    const allowedDirs = [Direction.DOWN, Direction.UP, Direction.RIGHT, Direction.LEFT];
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
        const allowedDirs = [Direction.DOWN, Direction.UP, Direction.RIGHT, Direction.LEFT];
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

// BFS pathfinding
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

  while (queue.length > 0) {
    const current = queue.shift()!;

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

// Get all reachable positions
function getReachable(
  tiles: TileType[][],
  start: Position,
  width: number,
  height: number
): Set<string> {
  const reachable = new Set<string>();
  const queue: Position[] = [start];
  reachable.add(posKey(start));

  while (queue.length > 0) {
    const current = queue.shift()!;

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

// Verify no stuck states - all reachable positions can reach the goal
function hasNoStuckStates(tiles: TileType[][], start: Position, goal: Position, w: number, h: number): boolean {
  const reachable = getReachable(tiles, start, w, h);
  for (const key of reachable) {
    const [x, y] = key.split(',').map(Number);
    if (!isSolvable(tiles, { x, y }, goal, w, h)) {
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
function findOptimalPath(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
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
      const result = simulateMove(tiles, current.pos, dir, width, height);
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
      if (tiles[y][x] === TileType.FLOOR) {
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
        if ((tiles[y][x] === TileType.FLOOR || tiles[y][x] === TileType.ICE) &&
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

    tiles[y][x] = TileType.FLOOR;
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

    if (tiles[y][x] !== TileType.ICE && tiles[y][x] !== TileType.FLOOR) continue;
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
  
  let totalBranches = 0;
  let decisionPoints = 0;
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    
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
          (tiles[ny][nx] === TileType.ICE || tiles[ny][nx] === TileType.FLOOR)) {
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
      if (tiles[y][x] === TileType.FLOOR && 
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

// Main puzzle generation - EXTREME DIFFICULTY (targeting 2+ minute solves)
export function generatePuzzle(seed: string): PuzzleData {
  const rng = new SeededRandom(seed);

  // LARGER puzzle sizes - more ground to cover, more complexity
  const sizeOptions = [
    { width: 29, height: 23 },
    { width: 31, height: 23 },
    { width: 29, height: 25 },
    { width: 31, height: 25 },
    { width: 33, height: 25 },
    { width: 31, height: 27 },
    { width: 33, height: 27 },
    { width: 35, height: 27 },
    { width: 35, height: 29 },
    { width: 37, height: 29 },
  ];

  const { width, height } = rng.randomChoice(sizeOptions);

  let bestPuzzle: PuzzleData | null = null;
  let bestScore = 0;

  // More attempts to find truly challenging layouts
  for (let attempt = 0; attempt < 120; attempt++) {
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
    if (iceTiles.length < 60) continue;

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
    addExtraConnections(tiles, start, goal, width, height, rng, rng.randomInt(25, 45));

    // MORE winding corridors - call multiple times for layered complexity
    addWindingCorridors(tiles, start, goal, width, height, rng);
    addWindingCorridors(tiles, start, goal, width, height, rng);

    // MORE island obstacles for redirection
    addIslandObstacles(tiles, start, goal, width, height, rng, rng.randomInt(6, 12));

    // ============================================
    // GENIUS-LEVEL DECEPTION ENGINE
    // Psychological misdirection + counter-intuitive design
    // ============================================
    
    // ALGORITHM 1: Force counter-intuitive paths (block obvious approaches)
    engineerCounterIntuitivePath(tiles, start, goal, width, height, rng);
    
    // ALGORITHM 2: "Almost there" traps - slide past the goal
    createAlmostThereTraps(tiles, start, goal, width, height, rng, rng.randomInt(3, 6));
    
    // ALGORITHM 3: Decoy open areas - inviting areas that waste moves
    createDecoyOpenAreas(tiles, start, goal, width, height, rng, rng.randomInt(4, 8));
    
    // ALGORITHM 4: Hidden choke points - critical passages easy to miss
    createHiddenChokePoints(tiles, start, goal, width, height, rng, rng.randomInt(3, 6));
    
    // ALGORITHM 5: Momentum traps - ice slides that overshoot
    createMomentumTraps(tiles, start, goal, width, height, rng, rng.randomInt(5, 10));
    
    // ALGORITHM 6: Anti-gradient zones - moving toward goal increases cost
    createAntiGradientZones(tiles, start, goal, width, height, rng, rng.randomInt(3, 6));
    
    // ALGORITHM 7: Parallel path illusion - similar paths, different costs
    createParallelPathIllusion(tiles, start, goal, width, height, rng, rng.randomInt(4, 8));
    
    // ALGORITHM 8: Ledge misdirection - one-way tiles that look helpful
    createLedgeMisdirection(tiles, start, goal, width, height, rng, rng.randomInt(6, 12));
    
    // ALGORITHM 9: Goal proximity dead ends - tantalizingly close but blocked
    createGoalProximityDeadEnds(tiles, start, goal, width, height, rng, rng.randomInt(4, 8));
    
    // ALGORITHM 10: Commitment traps - wrong choices lock you in
    createCommitmentTraps(tiles, start, goal, width, height, rng, rng.randomInt(4, 8));

    // ============================================
    // ADDITIONAL COMPLEXITY LAYERS
    // ============================================
    
    // Precision gates - narrow passages requiring exact positioning
    addPrecisionGates(tiles, start, goal, width, height, rng, rng.randomInt(5, 10));
    
    // Funnel patterns that force specific approaches
    addFunnelPatterns(tiles, start, goal, width, height, rng, rng.randomInt(4, 8));
    
    // Trap alcoves - easy to enter, costly to escape
    addTrapAlcoves(tiles, start, goal, width, height, rng, rng.randomInt(6, 12));
    
    // Deceptive paths - routes that look good but waste moves
    addDeceptivePaths(tiles, start, goal, width, height, rng, rng.randomInt(15, 30));
    
    // Dead-end magnets - attractive looking dead ends
    addDeadEndMagnets(tiles, start, goal, width, height, rng, rng.randomInt(4, 8));

    // Stop blocks for redirect complexity
    addStopBlocks(tiles, start, goal, width, height, rng, rng.randomInt(25, 45));

    // MINIMAL floor stopping points (force long ice planning chains)
    addFloorStops(tiles, start, goal, width, height, rng, rng.randomInt(1, 3));
    
    // Convert MOST floor tiles back to ice (maximize planning difficulty)
    convertFloorsToIce(tiles, start, goal, width, height, rng, 0.75);

    // Ledges for complex directional puzzles
    addLedges(tiles, start, goal, width, height, rng, rng.randomInt(15, 25));

    // Set start and goal
    tiles[start.y][start.x] = TileType.START;
    tiles[goal.y][goal.x] = TileType.GOAL;

    // Verify solvability
    const optimalMoves = findPath(tiles, start, goal, width, height);
    if (optimalMoves === null) continue;

    // Verify no stuck states
    if (!hasNoStuckStates(tiles, start, goal, width, height)) continue;

    // Calculate complexity metrics for scoring
    const branchingFactor = calculateBranchingFactor(tiles, start, goal, width, height);
    const trapPotential = countTrapPotential(tiles, start, goal, width, height);
    
    // Count reachable positions for exploration complexity
    const reachableCount = getReachable(tiles, start, width, height).size;
    const explorationDensity = reachableCount / (width * height);
    
    // NEW: Calculate "deceptiveness" - how counter-intuitive is the optimal path?
    // Compare Manhattan distance (intuitive) vs actual optimal moves
    const intuitiveDist = manhattanDist(start, goal);
    const deceptivenessRatio = optimalMoves / Math.max(intuitiveDist, 1);
    
    // GENIUS scoring: prioritize puzzles that ACTIVELY DECEIVE
    // - HIGH optimal moves (100-200 range for truly challenging puzzles)
    // - High branching factor (decision paralysis)
    // - High trap potential (mistakes are punishing)
    // - High deceptiveness ratio (optimal path is NOT the intuitive one)
    // - High exploration density (lots of places to get lost)
    let score = optimalMoves;
    
    // Strong bonus for being in the extreme target range (100-200 moves)
    if (optimalMoves >= 100 && optimalMoves <= 200) {
      score *= 2.5;
    } else if (optimalMoves >= 80 && optimalMoves <= 100) {
      score *= 1.8;
    } else if (optimalMoves >= 60 && optimalMoves <= 80) {
      score *= 1.3;
    }
    
    // Bonus for high branching (many wrong choices possible)
    if (branchingFactor >= 3.5) {
      score *= 1.6;
    } else if (branchingFactor >= 3.0) {
      score *= 1.4;
    } else if (branchingFactor >= 2.5) {
      score *= 1.2;
    }
    
    // Significant bonus for trap potential (mistakes are punishing)
    score += Math.min(trapPotential / 4, 50);
    
    // NEW: Big bonus for deceptive puzzles (optimal != intuitive)
    if (deceptivenessRatio >= 3.0) {
      score *= 1.5; // Optimal path is 3x+ longer than intuitive
    } else if (deceptivenessRatio >= 2.5) {
      score *= 1.3;
    } else if (deceptivenessRatio >= 2.0) {
      score *= 1.2;
    }
    
    // Bonus for high exploration density (lots of reachable positions)
    if (explorationDensity >= 0.45) {
      score *= 1.3;
    } else if (explorationDensity >= 0.35) {
      score *= 1.15;
    }

    if (score > bestScore) {
      bestScore = score;
      bestPuzzle = {
        width,
        height,
        tiles,
        start,
        goal,
        optimalMoves
      };
    }

    // Target 100+ optimal moves with excellent complexity for 2+ min solves
    // Also require good deceptiveness ratio
    if (optimalMoves >= 100 && optimalMoves <= 180 && 
        branchingFactor >= 3.0 && deceptivenessRatio >= 2.5) {
      break;
    }
  }

  if (!bestPuzzle) {
    if (!seed.includes('-fallback')) {
      return generatePuzzle(seed + '-fallback');
    }
    return createSimplePuzzle(width, height, rng);
  }

  return bestPuzzle;
}

// Simple fallback puzzle - still challenging but guaranteed to work
function createSimplePuzzle(width: number, height: number, rng: SeededRandom): PuzzleData {
  const tiles: TileType[][] = Array(height).fill(null).map(() => Array(width).fill(TileType.WALL));

  // Create connected ice area with higher density
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      if (rng.random() < 0.7) {
        tiles[y][x] = TileType.ICE;
      }
    }
  }

  // Ensure connectivity with guaranteed paths (multiple corridors)
  for (let y = Math.floor(height / 2) - 1; y <= Math.floor(height / 2) + 1; y++) {
    for (let x = 2; x < width - 2; x++) {
      tiles[y][x] = TileType.ICE;
    }
  }
  // Additional horizontal corridors
  for (let y = Math.floor(height / 4) - 1; y <= Math.floor(height / 4) + 1; y++) {
    for (let x = 2; x < width - 2; x++) {
      tiles[y][x] = TileType.ICE;
    }
  }
  for (let y = Math.floor(3 * height / 4) - 1; y <= Math.floor(3 * height / 4) + 1; y++) {
    for (let x = 2; x < width - 2; x++) {
      tiles[y][x] = TileType.ICE;
    }
  }
  // Vertical corridors
  for (let x = Math.floor(width / 4); x <= Math.floor(width / 4) + 1; x++) {
    for (let y = 2; y < height - 2; y++) {
      tiles[y][x] = TileType.ICE;
    }
  }
  for (let x = Math.floor(width / 2); x <= Math.floor(width / 2) + 1; x++) {
    for (let y = 2; y < height - 2; y++) {
      tiles[y][x] = TileType.ICE;
    }
  }
  for (let x = Math.floor(3 * width / 4); x <= Math.floor(3 * width / 4) + 1; x++) {
    for (let y = 2; y < height - 2; y++) {
      tiles[y][x] = TileType.ICE;
    }
  }

  const start = { x: 3, y: Math.floor(height / 4) };
  const goal = { x: width - 4, y: Math.floor(3 * height / 4) };

  // Add MANY walls for complexity
  for (let i = 0; i < 60; i++) {
    const x = rng.randomInt(4, width - 4);
    const y = rng.randomInt(3, height - 3);
    if (!posEq({ x, y }, start) && !posEq({ x, y }, goal) && tiles[y][x] === TileType.ICE) {
      tiles[y][x] = TileType.WALL;
      if (!isSolvable(tiles, start, goal, width, height)) {
        tiles[y][x] = TileType.ICE;
      }
    }
  }

  // Add MINIMAL floor stops (force planning)
  for (let i = 0; i < 4; i++) {
    const x = rng.randomInt(3, width - 3);
    const y = rng.randomInt(3, height - 3);
    if (tiles[y][x] === TileType.ICE && !posEq({ x, y }, start) && !posEq({ x, y }, goal)) {
      tiles[y][x] = TileType.FLOOR;
    }
  }

  tiles[start.y][start.x] = TileType.START;
  tiles[goal.y][goal.x] = TileType.GOAL;

  const optimalMoves = findPath(tiles, start, goal, width, height) || 50;

  return { width, height, tiles, start, goal, optimalMoves };
}

// Get today's puzzle
export function getTodaysPuzzle(): PuzzleData {
  const today = new Date();
  const seed = getDailySeed(today);
  return generatePuzzle(seed);
}

// Get puzzle for a specific date
export function getPuzzleForDate(date: Date): PuzzleData {
  const seed = getDailySeed(date);
  return generatePuzzle(seed);
}
