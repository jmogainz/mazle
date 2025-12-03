/**
 * Ground map psychology metrics and scoring.
 * 
 * Ground maps have different difficulty characteristics than ice maps
 * since there's no sliding momentum to consider.
 * 
 * TODO: Implement ground-specific psychology metrics
 */

import { PuzzleData } from '../../types';
import { PsychologyMetrics } from '../registry';

/**
 * Calculate psychology-based difficulty metrics for a ground puzzle.
 * Stub implementation - returns placeholder values.
 * 
 * @param puzzle - The puzzle to score
 * @returns Psychology metrics
 */
export function scoreGroundPuzzle(puzzle: PuzzleData): PsychologyMetrics {
  // Stub: Return placeholder metrics
  // Ground puzzles need different difficulty metrics than ice puzzles
  return {
    counterIntuitiveMoves: 0,
    attractiveDecoys: 0,
    commitmentGates: 0,
    falseProgressPaths: 0,
    optimalMoves: puzzle.optimalMoves,
    psychologyScore: 0,
  };
}

