import { Filter } from 'glin-profanity';
import { DISPLAY_NAME_MAX_LEN, DISPLAY_NAME_MIN_LEN, DISPLAY_NAME_REGEX } from './displayNameRules';

const profanityFilter = new Filter({
  allLanguages: true,
  wordBoundaries: false,
  allowObfuscatedMatch: true,
  // >1 disables fuzzy subsequence matching (score max is 1.0)
  fuzzyToleranceLevel: 1.01,
  detectLeetspeak: true,
  leetspeakLevel: 'aggressive',
  normalizeUnicode: true,
  caseSensitive: false,
  cacheResults: true,
});

export function normalizeDisplayName(raw: string): string {
  return raw.trim().slice(0, DISPLAY_NAME_MAX_LEN);
}

export function isValidDisplayName(name: string): boolean {
  return (
    name.length >= DISPLAY_NAME_MIN_LEN
    && name.length <= DISPLAY_NAME_MAX_LEN
    && DISPLAY_NAME_REGEX.test(name)
  );
}

export function isInappropriateDisplayName(name: string): boolean {
  if (!name) return false;
  return profanityFilter.isProfane(name);
}
