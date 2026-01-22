export type ApiError = {
  errorCode: string;
  message: string;
};

export type ThemePreference = 'system' | 'light' | 'dark';

export type UserProfile = {
  characterId: string;
  skinId: string;
};

export type UserSettings = {
  theme: ThemePreference;
  leaderboardAutoSubmit: boolean;
};

export type UserStats = {
  playedStreak: number;
  winStreak: number;
  maxPlayedStreak: number;
  totalPlayed: number;
  totalWins: number;
  avgSolveTimeMs: number | null;
  goldCount: number;
  silverCount: number;
  bronzeCount: number;
};

export type MeResponse = {
  mode: 'guest' | 'user';
  userId?: string | null;
  displayName: string;
  entitlements: {
    archiveAccess: boolean;
    adsRemoved: boolean;
    unlockedSkins: string[];
  };
  profile?: UserProfile;
  settings?: UserSettings;
  stats?: UserStats;
};

export type GuestResponse = {
  displayName: string;
};

export type ClaimRequest = {
  displayName?: string;
};

export type ClaimResponse = {
  displayName: string;
};

export type ArchiveOfferResponse = {
  plans: Array<{
    id: 'monthly' | 'lifetime';
    priceId: string;
    formattedPrice: string;
    currency: string;
    purchaseType: 'subscription' | 'one_time';
    interval?: 'month';
  }>;
  defaultPlanId: 'monthly' | 'lifetime';
  grants: Array<'archive_access' | 'ads_removed'>;
};

export type CheckoutRequest = {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutResponse = {
  url?: string;
  alreadyOwned?: boolean;
};

export type LeaderboardEntry = {
  rank: number;
  displayName: string;
  timeMs: number;
  attemptsUsed: number;
  isMe?: boolean;
};

export type LeaderboardPodiumEntry = {
  rank: 1 | 2 | 3;
  displayName: string;
  timeMs: number;
  attemptsUsed: number;
  characterId: string;
  skinId: string;
  isMe?: boolean;
};

export type LeaderboardTopResponse = {
  date: string;
  entries: LeaderboardEntry[];
  podium?: LeaderboardPodiumEntry[];
  total?: number;
  nextOffset?: number | null;
};

export type LeaderboardMeResponse =
  | {
    date: string;
    rank: number;
    displayName: string;
    timeMs: number;
    attemptsUsed: number;
  }
  | null;

export type LeaderboardAroundResponse = {
  date: string;
  entries: LeaderboardEntry[];
};

export type LeaderboardSubmitRequest = {
  date: string;
};

export type LeaderboardSubmitResponse = {
  ok: true;
  rank?: number;
  updated: boolean;
};

export type ResultsRecordRequest = {
  date: string;
  completed: boolean;
  timeMs?: number;
  attemptsUsed?: number;
};

export type ResultsRecordResponse = {
  ok: true;
  created: boolean;
  result: {
    date: string;
    completed: boolean;
    timeMs: number | null;
    attemptsUsed: number | null;
  };
};

export type ResultsDayResponse = {
  ok: true;
  result: {
    date: string;
    completed: boolean;
    timeMs: number | null;
    attemptsUsed: number | null;
  } | null;
};

export type ResultsHistoryRow = {
  date: string;
  completed: boolean;
  timeMs: number | null;
  attemptsUsed: number | null;
};

export type ResultsHistoryResponse = {
  ok: true;
  history: ResultsHistoryRow[];
};

export type ResultsImportRow = {
  date: string;
  completed: boolean;
  timeMs?: number | null;
  attemptsUsed?: number | null;
};

export type ResultsImportRequest = {
  history: ResultsImportRow[];
};

export type ResultsImportResponse = {
  ok: true;
  imported: number;
  skipped: number;
};

export type HallOfFamePodiumResponse = {
  date: string;
  podium: LeaderboardPodiumEntry[];
};

export type SettingsUpdateRequest = Partial<{
  theme: ThemePreference;
  leaderboardAutoSubmit: boolean;
}>;

export type SettingsUpdateResponse = {
  ok: true;
  settings: UserSettings;
};

export type ProfileUpdateRequest = Partial<{
  characterId: string;
  skinId: string;
}>;

export type ProfileUpdateResponse = {
  ok: true;
  profile: UserProfile;
};

export type ArchiveDay = {
  date: string;
  locked: boolean;
};

export type ArchiveDaysResponse = {
  entitled: boolean;
  days: ArchiveDay[];
};

export type ArchivePuzzleResponse = {
  date: string;
  puzzleNumber: number;
  seed: string;
  puzzle: import('@/game/types').PuzzleData;
};
