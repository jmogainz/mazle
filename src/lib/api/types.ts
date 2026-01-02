export type ApiError = {
  errorCode: string;
  message: string;
};

export type MeResponse = {
  mode: 'guest' | 'user';
  displayName: string;
  entitlements: {
    archiveAccess: boolean;
    adsRemoved: boolean;
  };
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

export type LeaderboardTopResponse = {
  date: string;
  entries: LeaderboardEntry[];
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
  timeMs: number;
  attemptsUsed: number;
};

export type LeaderboardSubmitResponse = {
  ok: true;
  rank?: number;
  updated: boolean;
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
