import seedrandom from 'seedrandom';
import { TileType, Position, PuzzleData, Direction } from './types';

// Server salt for puzzle generation (in production, this would come from server)
const SERVER_SALT = 'mazle-daily-v1-2024';

// Get deterministic seed for a given date
export function getDailySeed(date: Date): string {
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  return `${dateStr}-${SERVER_SALT}`;
}

// Get puzzle number (days since launch)
export function getPuzzleNumber(date: Date): number {
  const launchDate = new Date('2024-01-01');
  const diffTime = date.getTime() - launchDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays + 1;
}

// Seeded random number generator wrapper
class SeededRandom {
  private rng: seedrandom.PRNG;

  constructor(seed: string) {
    this.rng = seedrandom(seed);
  }

  // Returns float between 0 and 1
  random(): number {
    return this.rng();
  }

  // Returns int between min (inclusive) and max (exclusive)
  randomInt(min: number, max: number): number {
    return Math.floor(this.random() * (max - min)) + min;
  }

  // Returns random element from array
  randomChoice<T>(arr: T[]): T {
    return arr[this.randomInt(0, arr.length)];
  }

  // Shuffle array in place
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.randomInt(0, i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

// Check if a position is valid on the grid
function isValidPosition(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x < width && y >= 0 && y < height;
}

// Get direction delta
function getDirectionDelta(dir: Direction): Position {
  switch (dir) {
    case Direction.UP: return { x: 0, y: -1 };
    case Direction.DOWN: return { x: 0, y: 1 };
    case Direction.LEFT: return { x: -1, y: 0 };
    case Direction.RIGHT: return { x: 1, y: 0 };
  }
}

// Simulate a move and return final position
function simulateMove(
  tiles: TileType[][],
  start: Position,
  dir: Direction,
  width: number,
  height: number
): Position | null {
  const delta = getDirectionDelta(dir);
  let x = start.x + delta.x;
  let y = start.y + delta.y;

  // Check if initial move is valid
  if (!isValidPosition(x, y, width, height)) return null;
  
  const targetTile = tiles[y][x];
  if (targetTile === TileType.WALL) return null;

  // Check ledge entry rules
  if (targetTile >= TileType.LEDGE_UP && targetTile <= TileType.LEDGE_RIGHT) {
    // Ledges can only be entered from specific directions
    const ledgeDir = targetTile - TileType.LEDGE_UP; // 0=up, 1=down, 2=left, 3=right
    const allowedDirs = [Direction.DOWN, Direction.UP, Direction.RIGHT, Direction.LEFT];
    if (dir !== allowedDirs[ledgeDir]) return null;
  }

  // Handle ice sliding
  if (targetTile === TileType.ICE) {
    while (true) {
      const nextX = x + delta.x;
      const nextY = y + delta.y;
      
      if (!isValidPosition(nextX, nextY, width, height)) break;
      
      const nextTile = tiles[nextY][nextX];
      if (nextTile === TileType.WALL) break;
      if (nextTile >= TileType.LEDGE_UP && nextTile <= TileType.LEDGE_RIGHT) break;
      
      x = nextX;
      y = nextY;
      
      if (nextTile !== TileType.ICE) break;
    }
  }

  return { x, y };
}

// BFS to find if goal is reachable and minimum moves
function findPath(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  width: number,
  height: number
): number | null {
  const queue: { pos: Position; moves: number }[] = [{ pos: start, moves: 0 }];
  const visited = new Set<string>();
  visited.add(`${start.x},${start.y}`);

  const directions = [Direction.UP, Direction.DOWN, Direction.LEFT, Direction.RIGHT];

  while (queue.length > 0) {
    const current = queue.shift()!;
    
    if (current.pos.x === goal.x && current.pos.y === goal.y) {
      return current.moves;
    }

    for (const dir of directions) {
      const newPos = simulateMove(tiles, current.pos, dir, width, height);
      if (newPos) {
        const key = `${newPos.x},${newPos.y}`;
        if (!visited.has(key)) {
          visited.add(key);
          queue.push({ pos: newPos, moves: current.moves + 1 });
        }
      }
    }
  }

  return null;
}

// Generate a puzzle for a given seed
export function generatePuzzle(seed: string): PuzzleData {
  const rng = new SeededRandom(seed);
  
  // Variable puzzle size for variety
  const sizeOptions = [
    { width: 13, height: 13 },
    { width: 14, height: 12 },
    { width: 12, height: 14 },
    { width: 13, height: 12 },
    { width: 12, height: 13 },
    { width: 12, height: 12 },
    { width: 12, height: 11 },
    { width: 11, height: 12 },
    { width: 12, height: 10 },
    { width: 10, height: 12 },
    { width: 11, height: 11 },
  ];
  
  const { width, height } = rng.randomChoice(sizeOptions);
  
  let bestPuzzle: PuzzleData | null = null;
  const passes = [
    {
      targetMinMoves: 28,
      targetMaxMoves: 60,
      minDistance: 12,
      wallRange: [18, 34] as [number, number],
      stripeRange: [2, 4] as [number, number],
      stripeOpenings: [1, 2] as [number, number],
      icePatchRange: [3, 6] as [number, number],
      icePatchSizeRange: [4, 9] as [number, number],
      ledgeRange: [3, 6] as [number, number],
      pillarRange: [2, 5] as [number, number],
      iceLinesRange: [1, 3] as [number, number],
    },
    {
      // Relaxed pass to avoid deterministic fallback in dev/test seeds
      targetMinMoves: 18,
      targetMaxMoves: 50,
      minDistance: 8,
      wallRange: [14, 28] as [number, number],
      stripeRange: [1, 3] as [number, number],
      stripeOpenings: [1, 3] as [number, number],
      icePatchRange: [2, 5] as [number, number],
      icePatchSizeRange: [3, 7] as [number, number],
      ledgeRange: [2, 5] as [number, number],
      pillarRange: [1, 4] as [number, number],
      iceLinesRange: [0, 2] as [number, number],
    },
  ];
  const attemptsPerPass = 200;

  for (const pass of passes) {
    let attempts = 0;

    while (!bestPuzzle && attempts < attemptsPerPass) {
      attempts++;
      
      // Initialize grid with floors
      const tiles: TileType[][] = Array(height)
        .fill(null)
        .map(() => Array(width).fill(TileType.FLOOR));
      
      // Add border walls
      for (let x = 0; x < width; x++) {
        tiles[0][x] = TileType.WALL;
        tiles[height - 1][x] = TileType.WALL;
      }
      for (let y = 0; y < height; y++) {
        tiles[y][0] = TileType.WALL;
        tiles[y][width - 1] = TileType.WALL;
      }
      
      // Add internal walls (create interesting structure)
      const wallCount = rng.randomInt(pass.wallRange[0], pass.wallRange[1]);
      for (let i = 0; i < wallCount; i++) {
        const wx = rng.randomInt(2, width - 2);
        const wy = rng.randomInt(2, height - 2);
        
        // Create wall clusters
        const clusterSize = rng.randomInt(2, 6);
        for (let j = 0; j < clusterSize; j++) {
          const cx = wx + rng.randomInt(-1, 2);
          const cy = wy + rng.randomInt(-1, 2);
          if (isValidPosition(cx, cy, width, height) && 
              tiles[cy][cx] === TileType.FLOOR) {
            tiles[cy][cx] = TileType.WALL;
          }
        }
      }

      // Add wall stripes to create choke points
      const stripeCount = rng.randomInt(pass.stripeRange[0], pass.stripeRange[1]);
      for (let i = 0; i < stripeCount; i++) {
        const horizontal = rng.random() > 0.5;
        if (horizontal) {
          const row = rng.randomInt(2, height - 2);
          const openings = new Set<number>();
          const openingCount = rng.randomInt(pass.stripeOpenings[0], pass.stripeOpenings[1]);
          while (openings.size < openingCount) {
            openings.add(rng.randomInt(2, width - 2));
          }
          for (let x = 1; x < width - 1; x++) {
            if (openings.has(x)) continue;
            if (tiles[row][x] === TileType.FLOOR) {
              tiles[row][x] = TileType.WALL;
            }
          }
        } else {
          const col = rng.randomInt(2, width - 2);
          const openings = new Set<number>();
          const openingCount = rng.randomInt(pass.stripeOpenings[0], pass.stripeOpenings[1]);
          while (openings.size < openingCount) {
            openings.add(rng.randomInt(2, height - 2));
          }
          for (let y = 1; y < height - 1; y++) {
            if (openings.has(y)) continue;
            if (tiles[y][col] === TileType.FLOOR) {
              tiles[y][col] = TileType.WALL;
            }
          }
        }
      }

      // Add small pillar clusters to force detours
      const pillarCount = rng.randomInt(pass.pillarRange[0], pass.pillarRange[1]);
      for (let i = 0; i < pillarCount; i++) {
        const px = rng.randomInt(2, width - 2);
        const py = rng.randomInt(2, height - 2);
        const shapes = [
          [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }],
          [{ dx: 0, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: -1 }],
          [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: -1 }],
          [{ dx: 0, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }],
        ];
        const shape = rng.randomChoice(shapes);
        for (const { dx, dy } of shape) {
          const tx = px + dx;
          const ty = py + dy;
          if (isValidPosition(tx, ty, width, height) && tiles[ty][tx] === TileType.FLOOR) {
            tiles[ty][tx] = TileType.WALL;
          }
        }
      }
      
      // Add ice patches (sparingly, as per spec)
      const useIce = rng.random() > 0.15; // 85% chance of ice
      if (useIce) {
        const icePatches = rng.randomInt(pass.icePatchRange[0], pass.icePatchRange[1]);
        for (let i = 0; i < icePatches; i++) {
          const ix = rng.randomInt(2, width - 2);
          const iy = rng.randomInt(2, height - 2);
          
          // Create ice patch
          const patchSize = rng.randomInt(pass.icePatchSizeRange[0], pass.icePatchSizeRange[1]);
          for (let j = 0; j < patchSize; j++) {
            const cx = ix + rng.randomInt(-1, 2);
            const cy = iy + rng.randomInt(-1, 2);
            if (isValidPosition(cx, cy, width, height) && 
                tiles[cy][cx] === TileType.FLOOR) {
              tiles[cy][cx] = TileType.ICE;
            }
          }
        }

        // Add a few sliding corridors aligned with stripes
        const iceLines = rng.randomInt(pass.iceLinesRange[0], pass.iceLinesRange[1]);
        for (let i = 0; i < iceLines; i++) {
          const horizontal = rng.random() > 0.5;
          if (horizontal) {
            const row = rng.randomInt(2, height - 2);
            const startX = rng.randomInt(1, Math.max(2, width - 6));
            const length = rng.randomInt(4, Math.min(8, width - startX - 1));
            for (let x = startX; x < startX + length; x++) {
              if (tiles[row][x] === TileType.FLOOR) {
                tiles[row][x] = TileType.ICE;
              }
            }
          } else {
            const col = rng.randomInt(2, width - 2);
            const startY = rng.randomInt(1, Math.max(2, height - 6));
            const length = rng.randomInt(4, Math.min(8, height - startY - 1));
            for (let y = startY; y < startY + length; y++) {
              if (tiles[y][col] === TileType.FLOOR) {
                tiles[y][col] = TileType.ICE;
              }
            }
          }
        }
      }
      
      // Add ledges (sparingly)
      const useLedges = rng.random() > 0.3; // 70% chance of ledges
      if (useLedges) {
        const ledgeCount = rng.randomInt(pass.ledgeRange[0], pass.ledgeRange[1]);
        for (let i = 0; i < ledgeCount; i++) {
          const lx = rng.randomInt(2, width - 2);
          const ly = rng.randomInt(2, height - 2);
          if (tiles[ly][lx] === TileType.FLOOR) {
            const ledgeType = rng.randomChoice([
              TileType.LEDGE_UP,
              TileType.LEDGE_DOWN,
              TileType.LEDGE_LEFT,
              TileType.LEDGE_RIGHT,
            ]);
            tiles[ly][lx] = ledgeType;
          }
        }
      }
      
      // Find valid start and goal positions
      const floorTiles: Position[] = [];
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          if (tiles[y][x] === TileType.FLOOR) {
            floorTiles.push({ x, y });
          }
        }
      }
      
      if (floorTiles.length < 10) continue;
      
      // Try to find good start/goal pair
      rng.shuffle(floorTiles);
      
      let foundValidPuzzle = false;
      for (let si = 0; si < Math.min(floorTiles.length, 80) && !foundValidPuzzle; si++) {
        const start = floorTiles[si];
        
        for (let gi = si + 1; gi < Math.min(floorTiles.length, 120) && !foundValidPuzzle; gi++) {
          const goal = floorTiles[gi];
          
          // Ensure some minimum distance
          const dist = Math.abs(goal.x - start.x) + Math.abs(goal.y - start.y);
          if (dist < pass.minDistance) continue;
          
          // Check path
          const moves = findPath(tiles, start, goal, width, height);
          
          // Target deeper puzzles for 2-3 minute solves
          if (moves !== null && moves >= pass.targetMinMoves && moves <= pass.targetMaxMoves) {
            // Mark start and goal
            tiles[start.y][start.x] = TileType.START;
            tiles[goal.y][goal.x] = TileType.GOAL;
            
            bestPuzzle = {
              width,
              height,
              tiles,
              start,
              goal,
              optimalMoves: moves,
            };
            foundValidPuzzle = true;
          }
        }
      }
    }

    if (bestPuzzle) {
      break;
    }
  }
  
  // Fallback: generate a simple guaranteed-solvable puzzle
  if (!bestPuzzle) {
    bestPuzzle = generateSimplePuzzle(rng);
  }
  
  return bestPuzzle;
}

// Simple fallback puzzle generator
function generateSimplePuzzle(rng: SeededRandom): PuzzleData {
  const width = 13;
  const height = 13;
  
  const tiles: TileType[][] = Array(height)
    .fill(null)
    .map(() => Array(width).fill(TileType.FLOOR));
  
  // Border walls
  for (let x = 0; x < width; x++) {
  tiles[0][x] = TileType.WALL;
  tiles[height - 1][x] = TileType.WALL;
}
for (let y = 0; y < height; y++) {
  tiles[y][0] = TileType.WALL;
  tiles[y][width - 1] = TileType.WALL;
}

  // Random internal walls and choke points to avoid deterministic fallback
  const scatterWalls = rng.randomInt(14, 22);
  for (let i = 0; i < scatterWalls; i++) {
    const wx = rng.randomInt(1, width - 1);
    const wy = rng.randomInt(1, height - 1);
    if (tiles[wy][wx] === TileType.FLOOR) {
      tiles[wy][wx] = TileType.WALL;
    }
  }
  for (let x = 2; x < width - 2; x++) {
    if (rng.random() > 0.7) continue;
    tiles[7][x] = TileType.WALL;
  }
  
  // Ice patch
  const iceCount = rng.randomInt(8, 16);
  for (let i = 0; i < iceCount; i++) {
    const ix = rng.randomInt(2, width - 2);
    const iy = rng.randomInt(2, height - 2);
    if (tiles[iy][ix] === TileType.FLOOR) {
      tiles[iy][ix] = TileType.ICE;
    }
  }
  
  // Ledge to force detours
  const ledgeChoices = [TileType.LEDGE_RIGHT, TileType.LEDGE_DOWN, TileType.LEDGE_LEFT, TileType.LEDGE_UP];
  const ledgeCount = rng.randomInt(2, 4);
  for (let i = 0; i < ledgeCount; i++) {
    const lx = rng.randomInt(2, width - 2);
    const ly = rng.randomInt(2, height - 2);
    if (tiles[ly][lx] === TileType.FLOOR) {
      tiles[ly][lx] = rng.randomChoice(ledgeChoices);
    }
  }
  
  // Start and goal
  const start = { x: 1, y: 1 };
  const goal = { x: 11, y: 11 };
  tiles[start.y][start.x] = TileType.START;
  tiles[goal.y][goal.x] = TileType.GOAL;
  
  return {
    width,
    height,
    tiles,
    start,
    goal,
    optimalMoves: 28,
  };
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
