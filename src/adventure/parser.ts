import { Direction, TileType, type Position } from '../game/types';

const TILE_BY_TOKEN: Readonly<Record<string, TileType>> = Object.freeze({
  '.': TileType.GROUND,
  '#': TileType.WALL,
  S: TileType.START,
  G: TileType.GOAL,
  '~': TileType.ICE,
  '^': TileType.LEDGE_UP,
  v: TileType.LEDGE_DOWN,
  '<': TileType.LEDGE_LEFT,
  '>': TileType.LEDGE_RIGHT,
});

const DIRECTION_BY_TOKEN: Readonly<Record<string, Direction>> = Object.freeze({
  U: Direction.UP,
  R: Direction.RIGHT,
  D: Direction.DOWN,
  L: Direction.LEFT,
});

export interface ParsedAdventureBoard {
  width: number;
  height: number;
  tiles: TileType[][];
  start: Position;
  goal: Position;
}

export function parseAdventureRows(rows: readonly string[]): ParsedAdventureBoard {
  if (rows.length < 3) {
    throw new Error('Adventure board must contain at least three rows.');
  }
  const width = rows[0]?.length ?? 0;
  if (width < 3 || rows.some((row) => row.length !== width)) {
    throw new Error('Adventure board rows must be rectangular and at least three tiles wide.');
  }

  let start: Position | null = null;
  let goal: Position | null = null;
  const tiles = rows.map((row, y) => Array.from(row, (token, x) => {
    const tile = TILE_BY_TOKEN[token];
    if (tile === undefined) {
      throw new Error(`Unknown Adventure tile token "${token}" at (${x}, ${y}).`);
    }
    if (tile === TileType.START) {
      if (start) throw new Error('Adventure board must contain exactly one start tile.');
      start = { x, y };
    }
    if (tile === TileType.GOAL) {
      if (goal) throw new Error('Adventure board must contain exactly one goal tile.');
      goal = { x, y };
    }
    return tile;
  }));

  if (!start || !goal) {
    throw new Error('Adventure board must contain exactly one start and one goal tile.');
  }
  return { width, height: rows.length, tiles, start, goal };
}

export function parseAdventureSolution(encoded: string): Direction[] {
  return Array.from(encoded, (token, index) => {
    const direction = DIRECTION_BY_TOKEN[token];
    if (direction === undefined) {
      throw new Error(`Unknown Adventure solution token "${token}" at index ${index}.`);
    }
    return direction;
  });
}

export function encodeAdventureSolution(directions: readonly Direction[]): string {
  return directions.map((direction) => {
    switch (direction) {
      case Direction.UP: return 'U';
      case Direction.RIGHT: return 'R';
      case Direction.DOWN: return 'D';
      case Direction.LEFT: return 'L';
    }
  }).join('');
}

export function adventureRowsFromTiles(tiles: readonly (readonly TileType[])[]): string[] {
  const tokenByTile = new Map<TileType, string>([
    [TileType.GROUND, '.'],
    [TileType.WALL, '#'],
    [TileType.START, 'S'],
    [TileType.GOAL, 'G'],
    [TileType.ICE, '~'],
    [TileType.LEDGE_UP, '^'],
    [TileType.LEDGE_DOWN, 'v'],
    [TileType.LEDGE_LEFT, '<'],
    [TileType.LEDGE_RIGHT, '>'],
  ]);
  return tiles.map((row, y) => row.map((tile, x) => {
    const token = tokenByTile.get(tile);
    if (!token) throw new Error(`Unsupported Adventure tile ${tile} at (${x}, ${y}).`);
    return token;
  }).join(''));
}
