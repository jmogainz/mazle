export const ADVENTURE_BASE_MAX_HEARTS = 3;
export const ADVENTURE_PLUS_MAX_HEARTS = 5;
export const ADVENTURE_FREE_LEVEL_MAX = 5;
export const ADVENTURE_HEART_REGEN_MS = 30 * 60 * 1000;
export const ADVENTURE_ATTEMPT_STALE_MS = 4 * 60 * 60 * 1000;

export function regenerateAdventureEnergy(
  heartsInput: number,
  maxHearts: number,
  nextHeartInput: Date | null,
  now: Date
): { hearts: number; nextHeartAt: Date | null } {
  let hearts = Math.max(0, Math.min(maxHearts, Math.trunc(heartsInput)));
  let nextHeartAt = nextHeartInput;

  if (hearts >= maxHearts) return { hearts: maxHearts, nextHeartAt: null };
  if (!nextHeartAt) return { hearts, nextHeartAt: new Date(now.getTime() + ADVENTURE_HEART_REGEN_MS) };
  if (nextHeartAt.getTime() > now.getTime()) return { hearts, nextHeartAt };

  const elapsed = now.getTime() - nextHeartAt.getTime();
  const restored = Math.floor(elapsed / ADVENTURE_HEART_REGEN_MS) + 1;
  hearts = Math.min(maxHearts, hearts + restored);
  if (hearts >= maxHearts) return { hearts, nextHeartAt: null };
  return {
    hearts,
    nextHeartAt: new Date(nextHeartAt.getTime() + restored * ADVENTURE_HEART_REGEN_MS),
  };
}
