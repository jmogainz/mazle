import { DISPLAY_NAME_MAX_LEN } from './displayNameRules';

export { DISPLAY_NAME_MAX_LEN };

export const DISPLAY_NAME_ADJECTIVES = [
  'Frosty',
  'Swift',
  'Misty',
  'Brave',
  'Calm',
  'Clever',
  'Bold',
  'Chill',
  'Sunny',
  'Glowy',
  'Sly',
  'Nimble',
];

export const DISPLAY_NAME_NOUNS = [
  'Zubat',
  'Pikachu',
  'Eevee',
  'Snorlax',
  'Psyduck',
  'Cubone',
  'Lapras',
  'Abra',
  'Onix',
  'Jigglypuff',
  'Vulpix',
  'Magikarp',
];

export function formatDisplayName(adjective: string, noun: string, num: number): string {
  return `${adjective}${noun}${num}`.slice(0, DISPLAY_NAME_MAX_LEN);
}

export function randomDisplayNameCandidate(randInt: (min: number, max: number) => number): string {
  const adjective = DISPLAY_NAME_ADJECTIVES[randInt(0, DISPLAY_NAME_ADJECTIVES.length - 1)] ?? 'Frosty';
  const noun = DISPLAY_NAME_NOUNS[randInt(0, DISPLAY_NAME_NOUNS.length - 1)] ?? 'Lapras';
  const num = randInt(10, 99);
  return formatDisplayName(adjective, noun, num);
}
