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

export function makeLeaderboardMember(submittedAtMs: number, subjectKey: string): string {
  const ts = submittedAtMs.toString().padStart(13, '0');
  return `${ts}:${subjectKey}`;
}

export function parseLeaderboardMember(member: string): { submittedAtMs: number | null; subjectKey: string | null } {
  const parts = member.split(':');
  if (parts.length < 3) return { submittedAtMs: null, subjectKey: null };
  const submittedAtMs = Number(parts[0]);
  const subjectType = parts[1];
  const subjectId = parts[2];
  if (!Number.isFinite(submittedAtMs)) return { submittedAtMs: null, subjectKey: null };
  return { submittedAtMs, subjectKey: `${subjectType}:${subjectId}` };
}

