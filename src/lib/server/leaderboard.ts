export const LB_NAMES_KEY = 'lb:names:v1';

export function leaderboardZsetKey(date: string): string {
  return `lb:${date}`;
}

export function leaderboardMemberIndexKey(date: string): string {
  return `lb:member:${date}`;
}

export function encodeLeaderboardScore(timeMs: number, attemptsUsed: number): number {
  return timeMs * 10 + attemptsUsed;
}

export function decodeLeaderboardScore(score: number): { timeMs: number; attemptsUsed: number } {
  const timeMs = Math.floor(score / 10);
  const attemptsUsed = score % 10;
  return { timeMs, attemptsUsed };
}

export function makeLeaderboardMember(_submittedAtMs: number, subjectKey: string): string {
  // Use just subjectKey as member - prevents race condition duplicates
  // (timestamp was causing duplicate entries when concurrent requests
  // created different member strings for the same user)
  return subjectKey;
}

export function parseLeaderboardMember(member: string): { submittedAtMs: number | null; subjectKey: string | null } {
  const parts = member.split(':');

  // New format: "type:id" (e.g., "user:abc123" or "guest:xyz789")
  if (parts.length === 2) {
    const [subjectType, subjectId] = parts;
    if (subjectType === 'user' || subjectType === 'guest') {
      return { submittedAtMs: null, subjectKey: member };
    }
  }

  // Old format: "timestamp:type:id" (e.g., "1706290000000:user:abc123")
  if (parts.length >= 3) {
    const submittedAtMs = Number(parts[0]);
    const subjectType = parts[1];
    const subjectId = parts[2];
    if (Number.isFinite(submittedAtMs) && (subjectType === 'user' || subjectType === 'guest')) {
      return { submittedAtMs, subjectKey: `${subjectType}:${subjectId}` };
    }
  }

  return { submittedAtMs: null, subjectKey: null };
}

