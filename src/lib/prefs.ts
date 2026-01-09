export type MazlePrefsV1 = {
  leaderboardAutoSubmitWins: boolean;
  themePreference: 'system' | 'light' | 'dark';
};

const STORAGE_KEY = 'mazle_prefs_v1';
const PREFS_CHANGED_EVENT = 'mazle_prefs_changed_v1';

const DEFAULT_PREFS: MazlePrefsV1 = {
  leaderboardAutoSubmitWins: true,
  themePreference: 'system',
};

export function getPrefs(): MazlePrefsV1 {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<MazlePrefsV1>;
    return {
      leaderboardAutoSubmitWins: parsed.leaderboardAutoSubmitWins ?? DEFAULT_PREFS.leaderboardAutoSubmitWins,
      themePreference: parsed.themePreference ?? DEFAULT_PREFS.themePreference,
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
      window.dispatchEvent(new Event(PREFS_CHANGED_EVENT));
    } catch {
      // ignore
    }
  }
  return merged;
}

export function onPrefsChanged(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(PREFS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(PREFS_CHANGED_EVENT, handler);
}
