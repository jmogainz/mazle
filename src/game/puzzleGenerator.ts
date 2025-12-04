/**
 * Puzzle Seed Utilities
 * 
 * Provides deterministic seed generation for daily puzzles.
 * Actual puzzle generation is handled by WASM/Rust backend.
 * 
 * IMPORTANT: All daily puzzle logic uses New York timezone (America/New_York).
 * Puzzles roll over at midnight Eastern Time.
 */

// Import maps to trigger registration of movement configs and tilesets
import './maps/ice';
import './maps/ground';

// Server salt for puzzle generation (must match Rust backend)
const SERVER_SALT = 'mazle-daily-v8-2024-genius';

// Launch date for puzzle numbering (in New York timezone)
// Puzzle #1 starts on December 4, 2024
const LAUNCH_DATE = '2024-12-04';

/**
 * Get the current date string in New York timezone (YYYY-MM-DD format).
 * This ensures puzzles roll over at midnight Eastern Time.
 */
export function getNewYorkDateString(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * Get deterministic seed for a given date.
 * This seed is passed to the WASM/Rust generator.
 * Uses New York timezone for consistency.
 */
export function getDailySeed(date: Date = new Date()): string {
  const dateStr = getNewYorkDateString(date);
  return `${dateStr}-${SERVER_SALT}`;
}

/**
 * Get puzzle number (days since launch)
 * Puzzle #1 is December 4, 2024 (New York timezone)
 */
export function getPuzzleNumber(date: Date = new Date()): number {
  const currentDateStr = getNewYorkDateString(date);
  const currentDate = new Date(currentDateStr + 'T00:00:00');
  const launchDate = new Date(LAUNCH_DATE + 'T00:00:00');
  const diffTime = currentDate.getTime() - launchDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays + 1;
}

// Re-export map registry utilities
export { MAP_REGISTRY } from './maps/registry';
export type { MapTypeDefinition, PsychologyMetrics } from './maps/registry';
