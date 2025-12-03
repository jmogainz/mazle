/**
 * Ground Map Generator - STUB
 * 
 * This is a placeholder generator for ground-type maps.
 * Ground maps feature step-based movement without ice sliding.
 * 
 * TODO: Implement full ground puzzle generation algorithm
 */

import { TileType, Position, PuzzleData, MapType } from '../../types';

/**
 * Generate a ground-type puzzle.
 * Currently returns a simple test puzzle for development.
 * 
 * @param seed - The seed for deterministic generation
 * @returns A ground-type PuzzleData
 */
export function generatePuzzle(seed: string): PuzzleData {
  // Stub: Return a simple test puzzle
  // This will be replaced with a full generator when ground maps are enabled
  
  const width = 15;
  const height = 11;
  
  // Create a simple maze-like layout
  const tiles: TileType[][] = Array(height).fill(null).map(() => 
    Array(width).fill(TileType.WALL)
  );
  
  // Create ground paths
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x++) {
      tiles[y][x] = TileType.GROUND;
    }
  }
  
  // Connect horizontal paths with vertical corridors
  for (let x = 2; x < width - 2; x += 4) {
    for (let y = 1; y < height - 1; y++) {
      tiles[y][x] = TileType.GROUND;
    }
  }
  
  const start: Position = { x: 1, y: 1 };
  const goal: Position = { x: width - 2, y: height - 2 };
  
  tiles[start.y][start.x] = TileType.START;
  tiles[goal.y][goal.x] = TileType.GOAL;
  
  return {
    width,
    height,
    tiles,
    start,
    goal,
    optimalMoves: 20, // Placeholder
    mapType: MapType.GROUND,
  };
}

/**
 * Partial generation for worker parallelization.
 * Stub implementation - just calls full generate.
 */
export function generatePuzzlePartial(
  seed: string,
  _constraintStart: number,
  _constraintEnd: number,
  _traditionalStart: number,
  _traditionalEnd: number
): { puzzle: PuzzleData | null; score: number } {
  const puzzle = generatePuzzle(seed);
  return { puzzle, score: 0 };
}

