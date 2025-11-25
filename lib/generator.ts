import { BASELINE_DATE, SERVER_SALT, TARGET_IDEAL_MOVES, TARGET_MOVES_MAX, TARGET_MOVES_MIN } from './constants';
import { createRng, randomInt } from './prng';
import { findShortestSolution } from './movement';
import { dateKey, puzzleNumberForDate } from './puzzleNumber';
import { Puzzle, TileType, Point } from './types';

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

function makeEmptyGrid(width: number, height: number): TileType[][] {
  const tiles: TileType[][] = [];
  for (let y = 0; y < height; y += 1) {
    const row: TileType[] = [];
    for (let x = 0; x < width; x += 1) {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        row.push(TileType.Wall);
      } else {
        row.push(TileType.Floor);
      }
    }
    tiles.push(row);
  }
  return tiles;
}

function carvePath(start: Point, steps: number, width: number, height: number, rng: () => number) {
  const path: Point[] = [start];
  let current = { ...start };
  for (let i = 0; i < steps; i += 1) {
    const biasX = rng() < 0.55 ? 1 : -1;
    const biasY = rng() < 0.55 ? 1 : -1;
    const directions: Point[] = [
      { x: biasX, y: 0 },
      { x: 0, y: biasY },
      { x: -biasX, y: 0 },
      { x: 0, y: -biasY },
    ];
    const choice = directions[randomInt(rng, 0, directions.length - 1)];
    const next = {
      x: clamp(current.x + choice.x, 1, width - 2),
      y: clamp(current.y + choice.y, 1, height - 2),
    };
    current = next;
    path.push(current);
  }
  return path;
}

function placeWalls(tiles: TileType[][], rng: () => number, start: Point, goal: Point) {
  const height = tiles.length;
  const width = tiles[0].length;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if ((x === start.x && y === start.y) || (x === goal.x && y === goal.y)) continue;
      if (tiles[y][x] !== TileType.Floor) continue;
      const chance = 0.13;
      if (rng() < chance) {
        tiles[y][x] = TileType.Wall;
      }
    }
  }
  const clusters = randomInt(rng, 1, 3);
  for (let i = 0; i < clusters; i += 1) {
    const cx = randomInt(rng, 2, width - 3);
    const cy = randomInt(rng, 2, height - 3);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if ((x === start.x && y === start.y) || (x === goal.x && y === goal.y)) continue;
        if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) continue;
        if (rng() < 0.6) {
          tiles[y][x] = TileType.Wall;
        }
      }
    }
  }
}

function placeIce(tiles: TileType[][], rng: () => number, start: Point, goal: Point) {
  const height = tiles.length;
  const width = tiles[0].length;
  const runs = randomInt(rng, 1, 3);
  let iceCount = 0;
  for (let i = 0; i < runs; i += 1) {
    const horizontal = rng() > 0.5;
    const length = randomInt(rng, 3, clamp(horizontal ? width - 2 : height - 2, 3, 7));
    const startX = horizontal ? randomInt(rng, 1, width - length - 1) : randomInt(rng, 1, width - 2);
    const startY = horizontal ? randomInt(rng, 1, height - 2) : randomInt(rng, 1, height - length - 1);
    for (let j = 0; j < length; j += 1) {
      const x = horizontal ? startX + j : startX;
      const y = horizontal ? startY : startY + j;
      if ((x === start.x && y === start.y) || (x === goal.x && y === goal.y)) continue;
      if (tiles[y][x] === TileType.Wall) continue;
      tiles[y][x] = TileType.Ice;
      iceCount += 1;
    }
    // add stoppers to improve readability
    const endX = horizontal ? startX + length : startX;
    const endY = horizontal ? startY : startY + length;
    if (horizontal) {
      if (endX < width - 1 && tiles[startY][endX] === TileType.Floor) tiles[startY][endX] = TileType.Wall;
      if (startX - 1 > 0 && tiles[startY][startX - 1] === TileType.Floor) tiles[startY][startX - 1] = TileType.Wall;
    } else {
      if (endY < height - 1 && tiles[endY][startX] === TileType.Floor) tiles[endY][startX] = TileType.Wall;
      if (startY - 1 > 0 && tiles[startY - 1][startX] === TileType.Floor) tiles[startY - 1][startX] = TileType.Wall;
    }
  }
  return iceCount;
}

function placeLedges(tiles: TileType[][], rng: () => number, start: Point, goal: Point) {
  const height = tiles.length;
  const width = tiles[0].length;
  const bands = randomInt(rng, 1, 2);
  let count = 0;
  for (let i = 0; i < bands; i += 1) {
    const row = randomInt(rng, 2, height - 2);
    const length = randomInt(rng, 3, clamp(width - 2, 3, 8));
    const startX = randomInt(rng, 1, Math.max(1, width - length - 1));
    for (let j = 0; j < length; j += 1) {
      const x = startX + j;
      const y = row;
      if ((x === start.x && y === start.y) || (x === goal.x && y === goal.y)) continue;
      if (tiles[y][x] === TileType.Wall) continue;
      if (tiles[y - 1][x] === TileType.Wall) continue; // need an approach tile above
      tiles[y][x] = TileType.Ledge;
      count += 1;
    }
  }
  return count;
}

function buildCandidate(seed: string, number: number) {
  const rng = createRng(seed);
  const width = randomInt(rng, 9, 12);
  const height = randomInt(rng, 9, 12);
  const tiles = makeEmptyGrid(width, height);

  const start: Point = { x: 1, y: randomInt(rng, 1, Math.max(1, Math.floor(height / 3))) };
  const path = carvePath(start, randomInt(rng, 16, 26), width, height, rng);
  const goal = path[path.length - 1];

  placeWalls(tiles, rng, start, goal);
  const iceCount = placeIce(tiles, rng, start, goal);
  const ledgeCount = placeLedges(tiles, rng, start, goal);

  tiles[start.y][start.x] = TileType.Start;
  tiles[goal.y][goal.x] = TileType.Goal;

  const puzzle: Puzzle = {
    width,
    height,
    tiles,
    start,
    goal,
    seed,
    number,
    iceCount,
    ledgeCount,
    parMoves: -1,
  };

  return puzzle;
}

export function generatePuzzle(seed: string, number: number): Puzzle {
  let chosen: Puzzle | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = buildCandidate(`${seed}#${attempt}`, number);
    const solution = findShortestSolution(candidate);
    if (!solution.solved) continue;
    const candidateWithPar: Puzzle = { ...candidate, parMoves: solution.moves };
    const withinRange = solution.moves >= TARGET_MOVES_MIN && solution.moves <= TARGET_MOVES_MAX;
    const score = Math.abs(solution.moves - TARGET_IDEAL_MOVES);
    if (withinRange) {
      return candidateWithPar;
    }
    if (score < bestScore) {
      bestScore = score;
      chosen = candidateWithPar;
    }
  }

  if (!chosen) {
    const fallback = buildCandidate(seed, number);
    return { ...fallback, parMoves: -1 };
  }

  return chosen;
}

export function generateDailyPuzzle(date: Date = new Date(), salt: string = SERVER_SALT) {
  const key = dateKey(date);
  const seed = `${key}:${salt}`;
  const number = puzzleNumberForDate(date);
  return generatePuzzle(seed, number);
}
