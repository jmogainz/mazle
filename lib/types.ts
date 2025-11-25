export type Point = {
  x: number;
  y: number;
};

export type Direction = 'up' | 'down' | 'left' | 'right';

export enum TileType {
  Floor = 'floor',
  Wall = 'wall',
  Start = 'start',
  Goal = 'goal',
  Ice = 'ice',
  Ledge = 'ledge',
}

export type Puzzle = {
  width: number;
  height: number;
  tiles: TileType[][]; // tiles[y][x]
  start: Point;
  goal: Point;
  seed: string;
  number: number;
  iceCount: number;
  ledgeCount: number;
  parMoves: number;
};

export type MovePath = {
  path: Point[]; // includes origin and final positions
  bumped: boolean;
  reachedGoal: boolean;
};

export type GameState = {
  position: Point;
  moves: number;
  status: 'playing' | 'won';
  startedAt: number;
  completedAt?: number;
};
