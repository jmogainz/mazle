import { Direction, MovePath, Point, Puzzle, TileType } from './types';

const deltas: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function keyFor(point: Point) {
  return `${point.x},${point.y}`;
}

function inBounds(puzzle: Puzzle, point: Point) {
  return point.x >= 0 && point.x < puzzle.width && point.y >= 0 && point.y < puzzle.height;
}

function tileAt(puzzle: Puzzle, point: Point) {
  return puzzle.tiles[point.y][point.x];
}

function isWall(tile: TileType) {
  return tile === TileType.Wall;
}

function canLeave(tile: TileType, direction: Direction) {
  if (tile === TileType.Ledge && direction === 'up') return false;
  return true;
}

function canEnter(tile: TileType, direction: Direction) {
  if (tile === TileType.Wall) return false;
  if (tile === TileType.Ledge) return direction === 'down';
  return true;
}

function normalizeTile(tile: TileType) {
  if (tile === TileType.Start) return TileType.Floor;
  if (tile === TileType.Goal) return TileType.Floor;
  return tile;
}

export function simulateMove(puzzle: Puzzle, origin: Point, direction: Direction): MovePath {
  const delta = deltas[direction];
  const path: Point[] = [origin];
  const startTile = normalizeTile(tileAt(puzzle, origin));

  if (!canLeave(startTile, direction)) {
    return { path, bumped: true, reachedGoal: false };
  }

  const firstStep = { x: origin.x + delta.x, y: origin.y + delta.y };
  if (!inBounds(puzzle, firstStep)) {
    return { path, bumped: true, reachedGoal: false };
  }

  const nextTileRaw = tileAt(puzzle, firstStep);
  const nextTile = normalizeTile(nextTileRaw);
  if (!canEnter(nextTile, direction)) {
    return { path, bumped: true, reachedGoal: false };
  }

  path.push(firstStep);
  let current = firstStep;

  if (nextTile === TileType.Ice) {
    let sliding = true;
    while (sliding) {
      const candidate = { x: current.x + delta.x, y: current.y + delta.y };
      if (!inBounds(puzzle, candidate)) break;
      const candidateTileRaw = tileAt(puzzle, candidate);
      const candidateTile = normalizeTile(candidateTileRaw);
      if (!canLeave(normalizeTile(tileAt(puzzle, current)), direction)) break;
      if (!canEnter(candidateTile, direction)) break;
      path.push(candidate);
      current = candidate;
      if (candidateTile !== TileType.Ice) {
        sliding = false;
      }
    }
  }

  const final = path[path.length - 1];
  const reachedGoal = final.x === puzzle.goal.x && final.y === puzzle.goal.y;
  return { path, bumped: false, reachedGoal };
}

export function findShortestSolution(puzzle: Puzzle) {
  const startKey = keyFor(puzzle.start);
  const queue: { pos: Point; moves: number }[] = [{ pos: puzzle.start, moves: 0 }];
  const visited = new Set<string>([startKey]);

  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    for (const direction of Object.keys(deltas) as Direction[]) {
      const result = simulateMove(puzzle, current.pos, direction);
      const destination = result.path[result.path.length - 1];
      const destKey = keyFor(destination);
      if (result.bumped) continue;
      if (visited.has(destKey)) continue;
      const nextMoves = current.moves + 1;
      if (result.reachedGoal) {
        return { solved: true, moves: nextMoves } as const;
      }
      visited.add(destKey);
      queue.push({ pos: destination, moves: nextMoves });
    }
  }

  return { solved: false, moves: -1 } as const;
}

export function tileIsWalkable(tile: TileType) {
  return tile !== TileType.Wall;
}

export const directions: Direction[] = ['up', 'down', 'left', 'right'];
