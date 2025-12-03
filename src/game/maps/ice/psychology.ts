/**
 * Ice map psychology metrics and scoring.
 * 
 * These metrics measure what actually makes puzzles hard for HUMANS, not algorithms.
 * The ice generator uses these to score puzzle quality based on psychological difficulty.
 */

import { PuzzleData } from '../../types';
import { PsychologyMetrics as GeneratorPsychologyMetrics, calculatePsychologyScore } from './generator';

// Re-export types for external use
export type PsychologyMetrics = GeneratorPsychologyMetrics;

/**
 * Calculate psychology-based difficulty metrics for an ice puzzle.
 * This is the scorer function used by the map registry.
 * 
 * @param puzzle - The puzzle to score
 * @returns Psychology metrics including counter-intuitive moves, decoys, gates, and paths
 */
export function scoreIcePuzzle(puzzle: PuzzleData): PsychologyMetrics {
  return calculatePsychologyScore(
    puzzle.tiles,
    puzzle.start,
    puzzle.goal,
    puzzle.width,
    puzzle.height
  );
}

// Re-export the raw calculator for advanced use cases
export { calculatePsychologyScore } from './generator';


