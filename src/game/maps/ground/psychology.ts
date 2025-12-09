/**
 * Ground map psychology metrics and scoring.
 * 
 * Ground maps measure difficulty through:
 * - Counter-intuitive moves (moves away from goal)
 * - Attractive decoys (wrong moves that look good)
 * - Commitment gates (ledges and boulders that create irreversible decisions)
 * - False progress paths (paths that waste moves)
 * 
 * Note: Psychology scores are now calculated by the WASM/Rust generator and embedded
 * in the puzzle data. This module provides a scorer function that extracts these
 * pre-computed metrics.
 */

import { PuzzleData } from '../../types';
import { PsychologyMetrics } from '../registry';

/**
 * Ground-specific psychology metrics (extended from base metrics)
 */
export interface GroundPsychologyMetrics extends PsychologyMetrics {
  icePatchCount?: number;
  ledgeCount?: number;
  boulderCount?: number;
}

/**
 * Extract psychology-based difficulty metrics from a ground puzzle.
 * The metrics are pre-computed by the WASM/Rust generator.
 * 
 * @param puzzle - The puzzle with embedded metrics
 * @returns Psychology metrics compatible with the registry interface
 */
export function scoreGroundPuzzle(puzzle: PuzzleData): PsychologyMetrics {
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
