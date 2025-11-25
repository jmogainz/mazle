import seedrandom from 'seedrandom';
import { TileType, Position, PuzzleData, Direction } from './types';

// Server salt for puzzle generation
const SERVER_SALT = 'mazle-daily-v6-2024-elite';

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

// Add winding corridors that force longer paths
function addWindingCorridors(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number,
  rng: SeededRandom
): void {
  // Add horizontal and vertical wall segments that force detours
  const numSegments = rng.randomInt(4, 8);

  for (let seg = 0; seg < numSegments; seg++) {
    const isHorizontal = rng.random() < 0.5;
    const backup: { pos: Position; tile: TileType }[] = [];

    if (isHorizontal) {
      const y = rng.randomInt(4, height - 4);
      const startX = rng.randomInt(3, width / 2);
      const length = rng.randomInt(4, 12);
      const gapPos = rng.randomInt(0, length);

      for (let i = 0; i < length; i++) {
        const x = startX + i;
        if (i === gapPos) continue; // Leave a gap
        if (!isInner(x, y, width, height)) continue;
        if (tiles[y][x] !== TileType.ICE) continue;
        if (posEq({ x, y }, start) || posEq({ x, y }, goal)) continue;

        backup.push({ pos: { x, y }, tile: tiles[y][x] });
        tiles[y][x] = TileType.WALL;
      }
    } else {
      const x = rng.randomInt(4, width - 4);
      const startY = rng.randomInt(3, height / 2);
      const length = rng.randomInt(4, 12);
      const gapPos = rng.randomInt(0, length);

      for (let i = 0; i < length; i++) {
        const y = startY + i;
        if (i === gapPos) continue;
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

// Main puzzle generation - ELITE DIFFICULTY
export function generatePuzzle(seed: string): PuzzleData {
  const rng = new SeededRandom(seed);

  // Keep puzzle sizes moderate - difficulty comes from complexity, not size
  const sizeOptions = [
    { width: 23, height: 19 },
    { width: 25, height: 19 },
    { width: 23, height: 21 },
    { width: 25, height: 21 },
    { width: 27, height: 21 },
    { width: 25, height: 23 },
    { width: 27, height: 23 },
  ];

  const { width, height } = rng.randomChoice(sizeOptions);

  let bestPuzzle: PuzzleData | null = null;
  let bestScore = 0;

  for (let attempt = 0; attempt < 80; attempt++) {
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

    if (iceTiles.length < 40) continue;

    // Pick start on left side, goal on right side (far apart)
    const leftTiles = iceTiles.filter(p => p.x < width / 4);
    const rightTiles = iceTiles.filter(p => p.x > (3 * width) / 4);

    if (leftTiles.length === 0 || rightTiles.length === 0) continue;

    const start = rng.randomChoice(leftTiles);
    const goal = rng.randomChoice(rightTiles);

    // Widen passages for larger sliding areas (more ice = more planning needed)
    widenPassages(tiles, width, height, rng, 0.15);

    // Add extra connections for MANY alternative routes (most are suboptimal)
    addExtraConnections(tiles, start, goal, width, height, rng, rng.randomInt(15, 30));

    // Add winding corridors to force longer paths
    addWindingCorridors(tiles, start, goal, width, height, rng);

    // Add island obstacles
    addIslandObstacles(tiles, start, goal, width, height, rng, rng.randomInt(4, 8));

    // ============================================
    // HIGH IQ DIFFICULTY MECHANICS
    // ============================================
    
    // Add precision gates - narrow passages requiring exact positioning
    addPrecisionGates(tiles, start, goal, width, height, rng, rng.randomInt(3, 6));
    
    // Add funnel patterns that force specific approaches
    addFunnelPatterns(tiles, start, goal, width, height, rng, rng.randomInt(2, 5));
    
    // Add trap alcoves - easy to enter, costly to escape
    addTrapAlcoves(tiles, start, goal, width, height, rng, rng.randomInt(3, 7));
    
    // Add deceptive paths - routes that look good but waste moves
    addDeceptivePaths(tiles, start, goal, width, height, rng, rng.randomInt(8, 15));

    // Add stop blocks strategically (fewer = more planning required)
    addStopBlocks(tiles, start, goal, width, height, rng, rng.randomInt(15, 30));

    // Add MINIMAL floor stopping points (force long ice slide chains)
    addFloorStops(tiles, start, goal, width, height, rng, rng.randomInt(3, 7));
    
    // Convert some floor tiles back to ice (reduce safe stopping points)
    convertFloorsToIce(tiles, start, goal, width, height, rng, 0.4);

    // Add MORE ledges for complex directional puzzles
    addLedges(tiles, start, goal, width, height, rng, rng.randomInt(8, 16));

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
    
    // Elite scoring: prioritize puzzles with:
    // - High optimal moves (50-80 range ideal)
    // - High branching factor (more decision points)
    // - High trap potential (wrong moves are costly)
    let score = optimalMoves;
    
    // Bonus for being in the sweet spot
    if (optimalMoves >= 45 && optimalMoves <= 80) {
      score *= 1.5;
    }
    
    // Bonus for high branching (many wrong choices possible)
    if (branchingFactor >= 2.5) {
      score *= 1.3;
    }
    
    // Bonus for trap potential (mistakes are punishing)
    score += Math.min(trapPotential / 10, 20);

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

    // Target 50+ optimal moves with good complexity
    if (optimalMoves >= 50 && optimalMoves <= 75 && branchingFactor >= 2.3) {
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

// Simple fallback puzzle
function createSimplePuzzle(width: number, height: number, rng: SeededRandom): PuzzleData {
  const tiles: TileType[][] = Array(height).fill(null).map(() => Array(width).fill(TileType.WALL));

  // Create connected ice area
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      if (rng.random() < 0.6) {
        tiles[y][x] = TileType.ICE;
      }
    }
  }

  // Ensure connectivity with guaranteed paths
  for (let y = Math.floor(height / 2) - 1; y <= Math.floor(height / 2) + 1; y++) {
    for (let x = 2; x < width - 2; x++) {
      tiles[y][x] = TileType.ICE;
    }
  }
  for (let x = Math.floor(width / 3); x <= Math.floor(width / 3) + 1; x++) {
    for (let y = 2; y < height - 2; y++) {
      tiles[y][x] = TileType.ICE;
    }
  }
  for (let x = Math.floor(2 * width / 3); x <= Math.floor(2 * width / 3) + 1; x++) {
    for (let y = 2; y < height - 2; y++) {
      tiles[y][x] = TileType.ICE;
    }
  }

  const start = { x: 3, y: Math.floor(height / 2) };
  const goal = { x: width - 4, y: Math.floor(height / 2) };

  // Add walls
  for (let i = 0; i < 30; i++) {
    const x = rng.randomInt(4, width - 4);
    const y = rng.randomInt(3, height - 3);
    if (!posEq({ x, y }, start) && !posEq({ x, y }, goal) && tiles[y][x] === TileType.ICE) {
      tiles[y][x] = TileType.WALL;
      if (!isSolvable(tiles, start, goal, width, height)) {
        tiles[y][x] = TileType.ICE;
      }
    }
  }

  // Add floor stops
  for (let i = 0; i < 12; i++) {
    const x = rng.randomInt(3, width - 3);
    const y = rng.randomInt(3, height - 3);
    if (tiles[y][x] === TileType.ICE && !posEq({ x, y }, start) && !posEq({ x, y }, goal)) {
      tiles[y][x] = TileType.FLOOR;
    }
  }

  tiles[start.y][start.x] = TileType.START;
  tiles[goal.y][goal.x] = TileType.GOAL;

  const optimalMoves = findPath(tiles, start, goal, width, height) || 25;

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
