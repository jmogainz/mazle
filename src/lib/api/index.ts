import { realApi } from './real';
import { mockApi } from './mock';

type ApiImpl = typeof realApi;

function isUiDevEnv(): boolean {
  return process.env.NEXT_PUBLIC_ENV === 'dev';
}

export function getApiMode(): 'real' | 'mock' {
  if (!isUiDevEnv()) return 'real';
  if (typeof window === 'undefined') return 'real';

  try {
    const stored = localStorage.getItem('mazle_ui_dev_api_mode_v1');
    if (stored === 'real' || stored === 'mock') return stored;
  } catch {
    // ignore
  }

  return 'mock';
}

export function setApiMode(mode: 'real' | 'mock'): void {
  if (!isUiDevEnv()) return;
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('mazle_ui_dev_api_mode_v1', mode);
  } catch {
    // ignore
  }
}

export function getActiveApi(): ApiImpl {
  return getApiMode() === 'mock' ? (mockApi as ApiImpl) : realApi;
}

export const api: ApiImpl = {
  me: () => getActiveApi().me(),
  guest: () => getActiveApi().guest(),
  claim: (body) => getActiveApi().claim(body),
  leaderboardTop: (date, limit) => getActiveApi().leaderboardTop(date, limit),
  leaderboardMe: (date) => getActiveApi().leaderboardMe(date),
  leaderboardAround: (date, rank, window) => getActiveApi().leaderboardAround(date, rank, window),
  leaderboardSubmit: (body) => getActiveApi().leaderboardSubmit(body),
  resultsRecord: (body) => getActiveApi().resultsRecord(body),
  resultsImport: (body) => getActiveApi().resultsImport(body),
  hallOfFamePodium: (date) => getActiveApi().hallOfFamePodium(date),
  settingsUpdate: (body) => getActiveApi().settingsUpdate(body),
  profileUpdate: (body) => getActiveApi().profileUpdate(body),
  archiveOffer: () => getActiveApi().archiveOffer(),
  createCheckout: (body) => getActiveApi().createCheckout(body),
  archiveDays: (from, to) => getActiveApi().archiveDays(from, to),
  archivePuzzle: (date) => getActiveApi().archivePuzzle(date),
};

export * from './types';
