/**
 * Ice map psychology metrics and scoring.
 * 
 * These metrics measure what actually makes puzzles hard for HUMANS, not algorithms.
 * 
 * Note: Psychology scores are now calculated by the WASM/Rust generator and embedded
 * in the puzzle data. This module provides a scorer function that extracts these
 * pre-computed metrics.
 */

import { PuzzleData } from '../../types';
import { PsychologyMetrics } from '../registry';

export type { PsychologyMetrics };

/**
 * Extract psychology-based difficulty metrics from an ice puzzle.
 * The metrics are pre-computed by the WASM/Rust generator.
 * 
 * @param puzzle - The puzzle with embedded metrics
 * @returns Psychology metrics from the puzzle data
 */
export function scoreIcePuzzle(puzzle: PuzzleData): PsychologyMetrics {
  return {
    counterIntuitiveMoves: puzzle.counterIntuitiveMoves ?? 0,
    attractiveDecoys: puzzle.attractiveDecoys ?? 0,
    commitmentGates: puzzle.commitmentGates ?? 0,
    falseProgressPaths: puzzle.falseProgressPaths ?? 0,
    optimalMoves: puzzle.optimalMoves,
    psychologyScore: puzzle.difficultyScore,
    difficultyScore: puzzle.difficultyScore,
  };
}
