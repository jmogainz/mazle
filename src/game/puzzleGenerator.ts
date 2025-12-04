/**
 * Puzzle Seed Utilities
 * 
 * Provides deterministic seed generation for daily puzzles.
 * Actual puzzle generation is handled by WASM/Rust backend.
 */

// Import maps to trigger registration of movement configs and tilesets
import './maps/ice';
import './maps/ground';

// Server salt for puzzle generation (must match Rust backend)
const SERVER_SALT = 'mazle-daily-v8-2024-genius';

/**
 * Get deterministic seed for a given date.
 * This seed is passed to the WASM/Rust generator.
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

// Re-export map registry utilities
export { MAP_REGISTRY } from './maps/registry';
export type { MapTypeDefinition, PsychologyMetrics } from './maps/registry';
