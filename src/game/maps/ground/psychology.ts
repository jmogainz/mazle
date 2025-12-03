/**
 * Ground map psychology metrics and scoring.
 * 
 * Ground maps measure difficulty through:
 * - Counter-intuitive moves (moves away from goal)
 * - Ice patch count (sliding zones that add complexity)
 * - Ledge count (one-way passages creating commitment)
 * - Boulder count (Sokoban-style pushable obstacles)
 * - Attractive decoys (wrong moves that look good)
 * - False progress paths (paths that waste moves)
 */

import { PuzzleData } from '../../types';
import { PsychologyMetrics } from '../registry';
import {
  calculateGroundPsychologyScore,
  GroundPsychologyMetrics,
} from './generator';

// Re-export types for external use
export type { GroundPsychologyMetrics };

/**
 * Calculate psychology-based difficulty metrics for a ground puzzle.
 * This is the scorer function used by the map registry.
 * 
 * @param puzzle - The puzzle to score
 * @returns Psychology metrics compatible with the registry interface
 */
export function scoreGroundPuzzle(puzzle: PuzzleData): PsychologyMetrics {
  const groundMetrics = calculateGroundPsychologyScore(
    puzzle.tiles,
    puzzle.start,
    puzzle.goal,
    puzzle.width,
    puzzle.height
  );
  
  return {
    counterIntuitiveMoves: groundMetrics.counterIntuitiveMoves,
    attractiveDecoys: groundMetrics.attractiveDecoys,
    // Combine ledges and boulders as commitment gates (both create irreversible decisions)
    commitmentGates: groundMetrics.ledgeCount + groundMetrics.boulderCount,
    falseProgressPaths: groundMetrics.falseProgressPaths,
    optimalMoves: groundMetrics.optimalMoves,
    psychologyScore: groundMetrics.psychologyScore,
  };
}

// Re-export the raw calculator for advanced use cases
export { calculateGroundPsychologyScore } from './generator';

