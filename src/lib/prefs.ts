export type MazlePrefsV1 = {
  leaderboardAutoSubmitWins: boolean;
};

const STORAGE_KEY = 'mazle_prefs_v1';

const DEFAULT_PREFS: MazlePrefsV1 = {
  leaderboardAutoSubmitWins: false,
};

export function getPrefs(): MazlePrefsV1 {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<MazlePrefsV1>;
    return {
      leaderboardAutoSubmitWins: parsed.leaderboardAutoSubmitWins ?? DEFAULT_PREFS.leaderboardAutoSubmitWins,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setPrefs(next: Partial<MazlePrefsV1>): MazlePrefsV1 {
  const current = getPrefs();
  const merged: MazlePrefsV1 = { ...current, ...next };
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // ignore
    }
  }
  return merged;
}

