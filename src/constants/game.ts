/** Configuration constants for the game */

// Cheat code validation
export const CHEAT_TIMEOUT_MS = 2000;
export const CHEAT_CODE_LENGTH = 5;
export const CHEAT_HASH = 0x5f69e7c;

// Mobile tap-to-open dev tools
export const TAP_COUNT_THRESHOLD = 10;
export const TAP_WINDOW_MS = 3000;

// Game frame buffer
export const GAME_BUFFER_PX = 0;

// Penalty for losing a life
export const PENALTY_MS = 30000;

// Closeness threshold configuration
export const CLOSENESS_THRESHOLD_DEV = 0.97;
export const CLOSENESS_THRESHOLD_PROD = 1.0;

// Local storage keys
export const STORAGE_KEYS = {
  HINTS_ENABLED: 'mazle_hints_enabled',
} as const;

/**
 * Simple hash function for string comparison
 * Used for cheat code validation without exposing the actual code
 */
export function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash >>> 0; // Convert to unsigned
}

/**
 * Check if buffer ends with the cheat code
 */
export function isCheatCode(buffer: string): boolean {
  if (buffer.length < CHEAT_CODE_LENGTH) return false;
  const suffix = buffer.slice(-CHEAT_CODE_LENGTH);
  return hashCode(suffix) === CHEAT_HASH;
}
