/**
 * Puzzle Generator Dispatcher
 * 
 * This module serves as the entry point for puzzle generation.
 * It delegates to the appropriate map type generator based on the registry.
 */

import seedrandom from 'seedrandom';
import { PuzzleData, MapType } from './types';
import { MAP_REGISTRY } from './maps/registry';
// Import maps to trigger registration
import './maps/ice';
import './maps/ground';

// Server salt for puzzle generation
const SERVER_SALT = 'mazle-daily-v8-2024-genius';

/**
 * Get deterministic seed for a given date
 */
export function getDailySeed(date: Date): string {
  const dateStr = date.toISOString().split('T')[0];
  return `${dateStr}-${SERVER_SALT}`;
}

/**
 * Get puzzle number (days since launch)
 */
export function getPuzzleNumber(date: Date): number {
  const launchDate = new Date('2024-01-01');
  const diffTime = date.getTime() - launchDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays + 1;
}

/**
 * Seeded random number generator for map type selection.
 * Uses a separate seed stream to avoid perturbing puzzle generation.
 */
class MapTypeRng {
  private rng: seedrandom.PRNG;

  constructor(seed: string) {
    // Use a separate seed stream for map type selection
    this.rng = seedrandom(seed + ':maptype');
  }

  random(): number {
    return this.rng();
  }
}

/**
 * Select a map type for the given seed.
 * Currently returns ice directly; weighted selection will be enabled
 * when other map types are ready.
 */
function selectMapType(seed: string): MapType {
  // For now, always return ice to ensure backward compatibility
  // When other map types are enabled with weight > 0, this will use weighted selection
  const rng = new MapTypeRng(seed);
  const selected = MAP_REGISTRY.selectWeighted(rng);
  
  // Fallback to ice if no map types are enabled (shouldn't happen)
  return selected?.type ?? MapType.ICE;
}

/**
 * Generate a puzzle for the given seed.
 * Delegates to the appropriate map type generator.
 * 
 * @param seed - The seed for puzzle generation
 * @param forceMapType - Optional: force a specific map type (for dev tools)
 */
export function generatePuzzle(seed: string, forceMapType?: MapType): PuzzleData {
  const mapType = forceMapType ?? selectMapType(seed);
  const mapDef = MAP_REGISTRY.get(mapType);
  
  if (!mapDef) {
    throw new Error(`Unknown map type: ${mapType}`);
  }
  
  return mapDef.generate(seed);
}

/**
 * Partial puzzle generation for parallel workers.
 * Each worker processes a subset of attempts and returns the best found.
 * 
 * @param forceMapType - Optional: force a specific map type (for dev tools)
 */
export function generatePuzzlePartial(
  seed: string,
  constraintStart: number,
  constraintEnd: number,
  traditionalStart: number,
  traditionalEnd: number,
  forceMapType?: MapType
): { puzzle: PuzzleData | null; score: number } {
  const mapType = forceMapType ?? selectMapType(seed);
  const mapDef = MAP_REGISTRY.get(mapType);
  
  if (!mapDef) {
    throw new Error(`Unknown map type: ${mapType}`);
  }
  
  if (!mapDef.generatePartial) {
    // Fallback: use full generation (less efficient but works)
    const puzzle = mapDef.generate(seed);
    return { puzzle, score: puzzle.difficultyScore ?? 0 };
  }
  
  return mapDef.generatePartial(seed, constraintStart, constraintEnd, traditionalStart, traditionalEnd);
}

/**
 * Get today's puzzle
 */
export function getTodaysPuzzle(): PuzzleData {
  const today = new Date();
  const seed = getDailySeed(today);
  return generatePuzzle(seed);
}

/**
 * Get puzzle for a specific date
 */
export function getPuzzleForDate(date: Date): PuzzleData {
  const seed = getDailySeed(date);
  return generatePuzzle(seed);
}

// Re-export map registry utilities for advanced use
export { MAP_REGISTRY } from './maps/registry';
export type { MapTypeDefinition, PsychologyMetrics, PartialGenerationResult } from './maps/registry';
