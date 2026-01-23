import { fetchJson } from './http';
import { getGuestDisplayName } from '@/utils/storage';
import type {
  ArchiveDaysResponse,
  ArchiveOfferResponse,
  ArchivePuzzleResponse,
  CheckoutRequest,
  CheckoutResponse,
  ClaimRequest,
  ClaimResponse,
  GuestResponse,
  HallOfFamePodiumResponse,
  LeaderboardAroundResponse,
  LeaderboardMeResponse,
  LeaderboardSubmitRequest,
  LeaderboardSubmitResponse,
  LeaderboardTopResponse,
  MeResponse,
  ProfileUpdateRequest,
  ProfileUpdateResponse,
  ResultsDayResponse,
  ResultsHistoryResponse,
  ResultsImportRequest,
  ResultsImportResponse,
  ResultsRecordRequest,
  ResultsRecordResponse,
  SettingsUpdateRequest,
  SettingsUpdateResponse,
} from './types';

export const api = {
  me: async (): Promise<MeResponse> => {
    const guestName = getGuestDisplayName();
    return fetchJson('/api/me', {
      method: 'GET',
      headers: guestName ? { 'x-guest-name': guestName } : undefined,
    });
  },

  guest: async (): Promise<GuestResponse> => {
    const guestName = getGuestDisplayName();
    return fetchJson('/api/guest', {
      method: 'POST',
      headers: guestName ? { 'x-guest-name': guestName } : undefined,
    });
  },

  claim: async (body: ClaimRequest): Promise<ClaimResponse> =>
    fetchJson('/api/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  leaderboardTop: async (date: string, limit = 50, offset = 0): Promise<LeaderboardTopResponse> => {
    const params = new URLSearchParams({
      date,
      limit: String(limit),
      offset: String(offset),
    });
    return fetchJson(`/api/leaderboard/top?${params.toString()}`, { method: 'GET' });
  },

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

  resultsRecord: async (body: ResultsRecordRequest): Promise<ResultsRecordResponse> =>
    fetchJson('/api/results/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  resultsDay: async (date?: string): Promise<ResultsDayResponse> =>
    fetchJson(`/api/results/day${date ? `?date=${encodeURIComponent(date)}` : ''}`, { method: 'GET' }),

  resultsHistory: async (): Promise<ResultsHistoryResponse> =>
    fetchJson('/api/results/history', { method: 'GET' }),

  resultsImport: async (body: ResultsImportRequest): Promise<ResultsImportResponse> =>
    fetchJson('/api/results/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  hallOfFamePodium: async (date: string): Promise<HallOfFamePodiumResponse> =>
    fetchJson(`/api/hall-of-fame/podium?date=${encodeURIComponent(date)}`, { method: 'GET' }),

  settingsUpdate: async (body: SettingsUpdateRequest): Promise<SettingsUpdateResponse> =>
    fetchJson('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  profileUpdate: async (body: ProfileUpdateRequest): Promise<ProfileUpdateResponse> =>
    fetchJson('/api/profile', {
      method: 'PATCH',
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
