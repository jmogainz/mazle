import { fetchJson } from './http';
import type {
  ArchiveDaysResponse,
  ArchiveOfferResponse,
  ArchivePuzzleResponse,
  CheckoutRequest,
  CheckoutResponse,
  ClaimRequest,
  ClaimResponse,
  GuestResponse,
  LeaderboardAroundResponse,
  LeaderboardMeResponse,
  LeaderboardSubmitRequest,
  LeaderboardSubmitResponse,
  LeaderboardTopResponse,
  MeResponse,
} from './types';

export const realApi = {
  me: async (): Promise<MeResponse> => fetchJson('/api/me', { method: 'GET' }),

  guest: async (): Promise<GuestResponse> => fetchJson('/api/guest', { method: 'POST' }),

  claim: async (body: ClaimRequest): Promise<ClaimResponse> =>
    fetchJson('/api/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  leaderboardTop: async (date: string, limit = 50): Promise<LeaderboardTopResponse> =>
    fetchJson(`/api/leaderboard/top?date=${encodeURIComponent(date)}&limit=${limit}`, { method: 'GET' }),

  leaderboardMe: async (date: string): Promise<LeaderboardMeResponse> =>
    fetchJson(`/api/leaderboard/me?date=${encodeURIComponent(date)}`, { method: 'GET' }),

  leaderboardAround: async (date: string, rank: number, window = 5): Promise<LeaderboardAroundResponse> =>
    fetchJson(
      `/api/leaderboard/around?date=${encodeURIComponent(date)}&rank=${rank}&window=${window}`,
      { method: 'GET' }
    ),

  leaderboardSubmit: async (body: LeaderboardSubmitRequest): Promise<LeaderboardSubmitResponse> =>
    fetchJson('/api/leaderboard/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  archiveOffer: async (): Promise<ArchiveOfferResponse> =>
    fetchJson('/api/stripe/archive-offer', { method: 'GET' }),

  createCheckout: async (body: CheckoutRequest): Promise<CheckoutResponse> =>
    fetchJson('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  archiveDays: async (from: string, to: string): Promise<ArchiveDaysResponse> =>
    fetchJson(`/api/archive/days?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { method: 'GET' }),

  archivePuzzle: async (date: string): Promise<ArchivePuzzleResponse> =>
    fetchJson(`/api/archive/${encodeURIComponent(date)}`, { method: 'GET' }),
};

