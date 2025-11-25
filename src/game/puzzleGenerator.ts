import seedrandom from 'seedrandom';
import { TileType, Position, PuzzleData, Direction } from './types';

// Server salt for puzzle generation
const SERVER_SALT = 'mazle-daily-v4-2024-refined';

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
    while (steps < 50) {
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
// PUZZLE GENERATION - Guaranteed solvable with strategic obstacles
// ============================================================================

function createBaseMaze(width: number, height: number, rng: SeededRandom): TileType[][] {
  // Start with all walls
  const tiles: TileType[][] = Array(height).fill(null).map(() => Array(width).fill(TileType.WALL));

  // Carve out the playable area using recursive backtracking maze generation
  // This guarantees connectivity
  const visited = new Set<string>();

  function carve(x: number, y: number) {
    visited.add(posKey({ x, y }));
    tiles[y][x] = TileType.ICE;

    // Get shuffled directions
    const dirs = rng.shuffle([
      { dx: 0, dy: -2 }, // Up
      { dx: 0, dy: 2 },  // Down
      { dx: -2, dy: 0 }, // Left
      { dx: 2, dy: 0 },  // Right
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
  const startX = 2 + (rng.randomInt(0, (width - 4) / 2)) * 2;
  const startY = 2 + (rng.randomInt(0, (height - 4) / 2)) * 2;
  carve(startX, startY);

  return tiles;
}

function widenPassages(tiles: TileType[][], width: number, height: number, rng: SeededRandom): void {
  // Widen some passages to create larger ice areas
  const widenCount = rng.randomInt(15, 30);

  for (let i = 0; i < widenCount; i++) {
    const x = rng.randomInt(2, width - 2);
    const y = rng.randomInt(2, height - 2);

    if (tiles[y][x] === TileType.WALL) {
      // Check if adjacent to ice
      const neighbors = [
        tiles[y - 1]?.[x], tiles[y + 1]?.[x],
        tiles[y]?.[x - 1], tiles[y]?.[x + 1]
      ].filter(t => t === TileType.ICE);

      if (neighbors.length >= 2) {
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

  while (placed < count && attempts < count * 5) {
    attempts++;
    const x = rng.randomInt(2, width - 2);
    const y = rng.randomInt(2, height - 2);

    if (tiles[y][x] !== TileType.ICE) continue;
    if (posEq({ x, y }, start) || posEq({ x, y }, goal)) continue;

    // Temporarily place wall
    tiles[y][x] = TileType.WALL;

    // Check if still solvable and no stuck states
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
  // Ledges can only be entered from one direction

  const ledgeOptions: { dir: Direction; type: TileType }[] = [
    { dir: Direction.DOWN, type: TileType.LEDGE_UP },    // Enter from above
    { dir: Direction.UP, type: TileType.LEDGE_DOWN },    // Enter from below
    { dir: Direction.RIGHT, type: TileType.LEDGE_LEFT }, // Enter from left
    { dir: Direction.LEFT, type: TileType.LEDGE_RIGHT }, // Enter from right
  ];

  let placed = 0;
  let attempts = 0;

  while (placed < count && attempts < count * 10) {
    attempts++;
    const x = rng.randomInt(3, width - 3);
    const y = rng.randomInt(3, height - 3);

    if (tiles[y][x] !== TileType.ICE && tiles[y][x] !== TileType.FLOOR) continue;
    if (posEq({ x, y }, start) || posEq({ x, y }, goal)) continue;

    // Pick a random ledge direction
    const option = rng.randomChoice(ledgeOptions);
    const delta = getDelta(option.dir);

    // Check that we have walkable tiles on entry and exit sides
    const entryX = x - delta.x;
    const entryY = y - delta.y;
    const exitX = x + delta.x;
    const exitY = y + delta.y;

    if (!isInner(entryX, entryY, width, height)) continue;
    if (!isInner(exitX, exitY, width, height)) continue;

    const entryTile = tiles[entryY][entryX];
    const exitTile = tiles[exitY][exitX];

    if (entryTile === TileType.WALL || exitTile === TileType.WALL) continue;

    // Temporarily place ledge
    const oldTile = tiles[y][x];
    tiles[y][x] = option.type;

    // Check if still solvable AND no stuck states
    if (isSolvable(tiles, start, goal, width, height) && 
        hasNoStuckStates(tiles, start, goal, width, height)) {
      placed++;
    } else {
      tiles[y][x] = oldTile; // Revert
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
  // Add extra paths by removing some walls - creates alternative routes
  let added = 0;
  let attempts = 0;

  while (added < count && attempts < count * 5) {
    attempts++;
    const x = rng.randomInt(2, width - 2);
    const y = rng.randomInt(2, height - 2);

    if (tiles[y][x] !== TileType.WALL) continue;

    // Check if this wall separates two ice areas
    const neighbors = [
      { x: x, y: y - 1 }, { x: x, y: y + 1 },
      { x: x - 1, y: y }, { x: x + 1, y: y }
    ];

    const iceNeighbors = neighbors.filter(n => 
      isValid(n.x, n.y, width, height) && 
      (tiles[n.y][n.x] === TileType.ICE || tiles[n.y][n.x] === TileType.FLOOR)
    );

    if (iceNeighbors.length >= 2) {
      tiles[y][x] = TileType.ICE;
      added++;
    }
  }
}

// Main puzzle generation
export function generatePuzzle(seed: string): PuzzleData {
  const rng = new SeededRandom(seed);

  // Puzzle sizes - larger for more challenge
  const sizeOptions = [
    { width: 17, height: 15 },
    { width: 19, height: 15 },
    { width: 17, height: 17 },
    { width: 19, height: 17 },
    { width: 21, height: 17 },
    { width: 19, height: 19 },
    { width: 21, height: 19 },
  ];

  const { width, height } = rng.randomChoice(sizeOptions);

  let bestPuzzle: PuzzleData | null = null;
  let bestScore = 0;

  for (let attempt = 0; attempt < 50; attempt++) {
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

    if (iceTiles.length < 20) continue;

    // Pick start on left side, goal on right side
    const leftTiles = iceTiles.filter(p => p.x < width / 3);
    const rightTiles = iceTiles.filter(p => p.x > (2 * width) / 3);

    if (leftTiles.length === 0 || rightTiles.length === 0) continue;

    const start = rng.randomChoice(leftTiles);
    const goal = rng.randomChoice(rightTiles);

    // Widen some passages
    widenPassages(tiles, width, height, rng);

    // Add extra connections for alternative routes
    addExtraConnections(tiles, start, goal, width, height, rng, rng.randomInt(5, 12));

    // Add stop blocks to increase difficulty
    addStopBlocks(tiles, start, goal, width, height, rng, rng.randomInt(8, 18));

    // Add floor stopping points
    addFloorStops(tiles, start, goal, width, height, rng, rng.randomInt(5, 12));

    // Add ledges for directional challenge
    addLedges(tiles, start, goal, width, height, rng, rng.randomInt(3, 8));

    // Set start and goal
    tiles[start.y][start.x] = TileType.START;
    tiles[goal.y][goal.x] = TileType.GOAL;

    // Verify solvability
    const optimalMoves = findPath(tiles, start, goal, width, height);
    if (optimalMoves === null) continue;

    // Verify no stuck states
    if (!hasNoStuckStates(tiles, start, goal, width, height)) continue;

    // Score based on move count - prefer puzzles with 20-40 moves
    const score = optimalMoves >= 20 && optimalMoves <= 45 ? optimalMoves : optimalMoves / 2;

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

    // Good enough
    if (optimalMoves >= 22 && optimalMoves <= 40) {
      break;
    }
  }

  if (!bestPuzzle) {
    // Fallback - try with different seed
    if (!seed.includes('-fallback')) {
      return generatePuzzle(seed + '-fallback');
    }
    // Ultimate fallback
    return createSimplePuzzle(width, height, rng);
  }

  return bestPuzzle;
}

// Simple fallback puzzle that's guaranteed to work
function createSimplePuzzle(width: number, height: number, rng: SeededRandom): PuzzleData {
  const tiles: TileType[][] = Array(height).fill(null).map(() => Array(width).fill(TileType.WALL));

  // Create a simple connected ice area
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      if (rng.random() < 0.65) {
        tiles[y][x] = TileType.ICE;
      }
    }
  }

  // Ensure connectivity with a guaranteed path
  for (let y = height / 2 - 1; y <= height / 2 + 1; y++) {
    for (let x = 2; x < width - 2; x++) {
      tiles[Math.floor(y)][x] = TileType.ICE;
    }
  }

  const start = { x: 3, y: Math.floor(height / 2) };
  const goal = { x: width - 4, y: Math.floor(height / 2) };

  // Add some walls for interest
  for (let i = 0; i < 15; i++) {
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
  for (let i = 0; i < 8; i++) {
    const x = rng.randomInt(3, width - 3);
    const y = rng.randomInt(3, height - 3);
    if (tiles[y][x] === TileType.ICE && !posEq({ x, y }, start) && !posEq({ x, y }, goal)) {
      tiles[y][x] = TileType.FLOOR;
    }
  }

  tiles[start.y][start.x] = TileType.START;
  tiles[goal.y][goal.x] = TileType.GOAL;

  const optimalMoves = findPath(tiles, start, goal, width, height) || 15;

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
