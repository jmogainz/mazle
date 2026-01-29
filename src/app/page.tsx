'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter } from 'next/navigation';
import { Header, GameUI, ShareCard, StatsModal, HelpModal, ErrorBoundary, Loader, DevTools, AdSlot, RecentPuzzlesModal } from '@/components';
import type { StatsModalMeData, StatsHistoryEntry } from '@/components/StatsModal';
import LeaderboardFallback from '@/components/LeaderboardFallback';
import UiDevModal from '@/components/UiDevModal';
import { HELP_MENU_HASH } from '@/components/helpMenuHash';
import MoreMenuModal from '@/components/MoreMenuModal';
import OverlayShell from '@/components/OverlayShell';
import AccountView from '@/components/AccountView';
import HallOfFameView from '@/components/HallOfFameView';

// Lazy load LeaderboardView for faster modal open
const LeaderboardView = dynamic(() => import('@/components/LeaderboardView'), {
  ssr: false,
  loading: () => <LeaderboardFallback />,
});
import { api } from '@/lib/api';
import type { ResultsAttempt } from '@/lib/api/types';
import { cachedApi, fetchMeFresh, invalidateMeCache, prefetchAccount, prefetchArchiveDays, prefetchHallOfFame, prefetchLeaderboard, readCachedMe } from '@/lib/api/cached';
import { addDays } from '@/lib/date';
import { getPrefs } from '@/lib/prefs';
import {
  CHEAT_TIMEOUT_MS,
  CHEAT_CODE_LENGTH,
  TAP_COUNT_THRESHOLD,
  TAP_WINDOW_MS,
  GAME_BUFFER_PX,
  STORAGE_KEYS,
  isCheatCode,
  CLOSENESS_THRESHOLD_DEV,
  CLOSENESS_THRESHOLD_PROD,
  RECENT_PUZZLE_DAYS,
  DEFAULT_LIVES,
} from '@/constants';
import {
  getPuzzleNumber,
  getPuzzleNumberFromNyDateString,
  getNewYorkDateString,
  onGameEvent,
  emitGameEvent,
  PuzzleData,
  generatePuzzleParallel,
  cancelRustRequest,
  cancelWasmRequest,
  fetchDailyPuzzle,
  getDailySeed,
  GenerationProgress,
  GeneratorBackend,
  preloadWasm,
  TILE_SIZE,
} from '@/game';
import {
  getPlayerStats,
  mergePlayerStats,
  savePlayerStats,
  saveTodaysResult,
  saveHistoricalResult,
  upsertTodaysResult,
  getTodaysResult,
  getStorageScope,
  getCachedPuzzle,
  cachePuzzle,
  saveInProgressState,
  getInProgressState,
  getAnyInProgressState,
  clearInProgressState,
  markRecentPuzzlePlayed,
  recordLeaderboardRank,
  setTodaysResultForDev,
  setStorageScope,
} from '@/utils/storage';
import { useAdConsent } from '@/utils/consent';
import type { PlayerStats, DailyStats, GameState, Direction, Position } from '@/game/types';
import type { GameControls } from '@/game/PhaserGame';
import { useGlobalSwipeMoves } from '@/game/useGlobalSwipeMoves';
import { formatTime } from '@/utils/storage';
import styles from './page.module.css';

// Calculate time until next puzzle (midnight ET)
function getTimeUntilMidnightET(): { hours: number; minutes: number; seconds: number; totalMs: number } {
  const now = new Date();
  // Get current time in ET
  const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const etNow = new Date(etString);

  // Calculate midnight ET
  const midnightET = new Date(etNow);
  midnightET.setHours(24, 0, 0, 0);

  const totalMs = midnightET.getTime() - etNow.getTime();
  const totalSeconds = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return { hours, minutes, seconds, totalMs };
}

function formatCountdown(time: { hours: number; minutes: number; seconds: number }): string {
  const h = time.hours;
  const m = time.minutes.toString().padStart(2, '0');
  const s = time.seconds.toString().padStart(2, '0');
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

const GUEST_IMPORT_OWNER_KEY = 'mazle_guest_history_owner_user_v1';

type ServerDailyResult = {
  date: string;
  completed: boolean;
  timeMs: number | null;
  attemptsUsed: number | null;
  attemptScores?: number[] | null;
  attempts?: ResultsAttempt[] | null;
};

function readGuestOwner(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(GUEST_IMPORT_OWNER_KEY);
  } catch {
    return null;
  }
}

function canAdoptGuestHistory(userId: string): boolean {
  const owner = readGuestOwner();
  return !owner || owner === userId;
}

function ensureGuestOwner(userId: string): void {
  if (typeof window === 'undefined') return;
  const owner = readGuestOwner();
  if (owner && owner !== userId) return;
  try {
    localStorage.setItem(GUEST_IMPORT_OWNER_KEY, userId);
  } catch {
    // ignore
  }
}

function resolveAttemptsUsed(result: DailyStats): number | null {
  if (!result) return null;
  if (typeof result.attemptsUsed === 'number' && Number.isFinite(result.attemptsUsed)) {
    return Math.min(DEFAULT_LIVES, Math.max(1, Math.floor(result.attemptsUsed)));
  }
  const failedAttempts = result.attempts?.length ?? 0;
  return Math.min(DEFAULT_LIVES, Math.max(1, failedAttempts + 1));
}

function buildPlaceholderAttempts(attemptsUsed: number | null | undefined): Array<{ moveCount: number; path: Position[] }> {
  if (!attemptsUsed || attemptsUsed <= 1) return [];
  return Array.from({ length: Math.max(0, attemptsUsed - 1) }, () => ({ moveCount: 0, path: [] }));
}

function resolveAttemptScore(attempt: any): number {
  if (typeof attempt?.correctMoves === 'number' && Number.isFinite(attempt.correctMoves)) {
    return Math.max(0, Math.round(attempt.correctMoves));
  }
  if (typeof attempt?.deviationIndex === 'number' && attempt.deviationIndex >= 0) {
    return Math.max(0, Math.round(attempt.deviationIndex - 1));
  }
  if (typeof attempt?.moveCount === 'number' && Number.isFinite(attempt.moveCount)) {
    return Math.max(0, Math.round(attempt.moveCount));
  }
  return 0;
}

function getAttemptScores(attempts: any[] | undefined): number[] | null {
  if (!Array.isArray(attempts) || attempts.length === 0) return null;
  return attempts.map(resolveAttemptScore);
}

function buildDailyStatsFromServer(result: ServerDailyResult): DailyStats {
  const completed = !!result.completed;
  const attemptsUsed = typeof result.attemptsUsed === 'number' ? result.attemptsUsed : undefined;
  const timeMs = typeof result.timeMs === 'number' && Number.isFinite(result.timeMs) ? result.timeMs : 0;
  const serverAttempts =
    Array.isArray(result.attempts) && result.attempts.length > 0
      ? result.attempts.map((attempt) => ({
          moveCount: typeof attempt.moveCount === 'number' && Number.isFinite(attempt.moveCount) ? Math.round(attempt.moveCount) : 0,
          correctMoves:
            typeof attempt.correctMoves === 'number' && Number.isFinite(attempt.correctMoves)
              ? Math.round(attempt.correctMoves)
              : undefined,
          deviationIndex:
            typeof attempt.deviationIndex === 'number' && Number.isFinite(attempt.deviationIndex)
              ? Math.round(attempt.deviationIndex)
              : undefined,
          failedAt: attempt.failedAt ?? undefined,
          path: Array.isArray(attempt.path) ? attempt.path : [],
        }))
      : null;
  const attemptsFromScores =
    Array.isArray(result.attemptScores) && result.attemptScores.length > 0
      ? result.attemptScores.map((score) => ({ moveCount: score, path: [] as Position[] }))
      : null;
  return {
    date: result.date,
    completed,
    failed: !completed,
    timeMs,
    moveCount: 0,
    puzzleNumber: getPuzzleNumberFromNyDateString(result.date),
    attemptsUsed,
    attempts: serverAttempts ?? attemptsFromScores ?? buildPlaceholderAttempts(attemptsUsed),
  };
}

function mergeServerResultIntoLocal(server: ServerDailyResult, local: DailyStats | null): DailyStats {
  const base = buildDailyStatsFromServer(server);
  if (!local || local.date !== server.date) return base;

  const next: DailyStats = { ...base };
  if (typeof local.puzzleNumber === 'number' && Number.isFinite(local.puzzleNumber)) {
    next.puzzleNumber = local.puzzleNumber;
  }
  if (typeof local.moveCount === 'number' && Number.isFinite(local.moveCount) && local.moveCount > 0) {
    next.moveCount = local.moveCount;
  }
  if (typeof local.optimalMoves === 'number' && Number.isFinite(local.optimalMoves) && local.optimalMoves > 0) {
    next.optimalMoves = local.optimalMoves;
  }

  const serverHasAttempts = Array.isArray(base.attempts) && base.attempts.length > 0;
  const localHasAttempts = Array.isArray(local.attempts) && local.attempts.length > 0;

  if (!serverHasAttempts && localHasAttempts) {
    next.attempts = local.attempts;
  }
  if ((next.timeMs ?? 0) <= 0 && typeof local.timeMs === 'number' && Number.isFinite(local.timeMs) && local.timeMs > 0) {
    next.timeMs = local.timeMs;
  }
  if (next.attemptsUsed == null && typeof local.attemptsUsed === 'number') {
    next.attemptsUsed = local.attemptsUsed;
  }

  return next;
}

// Dynamic import for Phaser (client-side only)
const PhaserGame = dynamic(() => import('@/game/PhaserGame'), {
  ssr: false,
  loading: () => null,
});

// Keep for potential future use (e.g., auto-enable in dev builds)
const _DEVTOOLS_BUILD_FLAG =
  process.env.NEXT_PUBLIC_DEVTOOLS_ENABLED === 'true';

const LEADERBOARD_LIMIT = 200;
const UI_DEV_CODE = 'uiuiuiui';
const IS_UI_DEV_ENV = process.env.NEXT_PUBLIC_ENV === 'dev' || process.env.NEXT_PUBLIC_ENV === 'dev-test';

const IS_PROD = process.env.NEXT_PUBLIC_ENV === 'prod';
const HELP_SEEN_KEY = `mazle_seen_help_${HELP_MENU_HASH}`;
// Ads disabled temporarily - flip to true and restore env var logic to re-enable
const ADS_ENABLED = false;
const ADSENSE_TOP_SLOT = ADS_ENABLED ? (process.env.NEXT_PUBLIC_ADSENSE_SLOT_MOBILE_TOP ?? '') : '';
const ADSENSE_BOTTOM_SLOT = ADS_ENABLED ? (process.env.NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM ?? '') : '';
const AD_BANNER_HEIGHT = 50;

export default function Home() {
  const router = useRouter();
  const pathname = usePathname();
  const todayNy = useMemo(() => getNewYorkDateString(), []);
  const [puzzle, setPuzzle] = useState<PuzzleData | null>(null);
  const [puzzleNumber, setPuzzleNumber] = useState(0);
  const [puzzleLabel, setPuzzleLabel] = useState<string | null>(null);
  const [puzzleMode, setPuzzleMode] = useState<'daily' | 'recent'>('daily');
  const [recentDate, setRecentDate] = useState<string | null>(null);
  const [activeSeed, setActiveSeed] = useState('');
  const [seedInput, setSeedInput] = useState('');
  const [renderKey, setRenderKey] = useState(0);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [statsMe, setStatsMe] = useState<StatsModalMeData | null>(() => readCachedMe() as StatsModalMeData | null);
  const [statsAccountHistory, setStatsAccountHistory] = useState<StatsHistoryEntry[] | null>(null);
  const [accountMe, setAccountMe] = useState<Awaited<ReturnType<typeof cachedApi.me>> | null>(() => readCachedMe());
  const [showShareCard, setShowShareCard] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showDevTools, setShowDevTools] = useState(false);
  const [showUiDevModal, setShowUiDevModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showHallOfFame, setShowHallOfFame] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showRecentPuzzles, setShowRecentPuzzles] = useState(false);
  const [recentShareResult, setRecentShareResult] = useState<DailyStats | null>(null);
  const [selectedBackend, setSelectedBackend] = useState<GeneratorBackend>('auto');
  const [lastUsedBackend, setLastUsedBackend] = useState<'rust-backend' | 'wasm' | null>(null);
  const [gameResult, setGameResult] = useState<{ moveCount: number; timeMs: number; failed?: boolean; attempts?: any[] } | null>(null);
  const [previousResult, setPreviousResult] = useState<DailyStats | null>(null);
  const [isGameReady, setIsGameReady] = useState(false);
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const [adsReady, setAdsReady] = useState(false);
  const { consentReady } = useAdConsent();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [showInlineResult, setShowInlineResult] = useState(false);
  const [isFreshCompletion, setIsFreshCompletion] = useState(false); // True when game completed this session (not loaded from storage)
  const [hintsEnabled, setHintsEnabled] = useState(true);
  const [devMaxLives, setDevMaxLives] = useState(DEFAULT_LIVES);
  const [lifeFlash, setLifeFlash] = useState(false);
  const [nextPuzzleCountdown, setNextPuzzleCountdown] = useState(() => getTimeUntilMidnightET());
  const [hasPendingRestore, setHasPendingRestore] = useState(false);
  const [initialStats, setInitialStats] = useState<{
    lives?: number;
    currentAttemptMoves?: number;
    elapsedTimeMs?: number;
    penaltyTimeMs?: number;
    maxLives?: number;
  } | null>(null);
  const [startBatchInput, setStartBatchInput] = useState('');
  const [closenessThreshold, setClosenessThreshold] = useState<number>(
    IS_PROD ? CLOSENESS_THRESHOLD_PROD : CLOSENESS_THRESHOLD_DEV
  );
  const [adStatus, setAdStatus] = useState<{ top: 'filled' | 'unfilled' | null; bottom: 'filled' | 'unfilled' | null }>({
    top: null,
    bottom: null,
  });
  const gameControlsRef = useRef<GameControls | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const inFlightSeedRef = useRef<string | null>(null);
  const debugModeRef = useRef(false);
  const cheatBufferRef = useRef('');
  const wakeLockRef = useRef<any>(null);
  const cheatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const gameFrameRef = useRef<HTMLDivElement | null>(null);
  const gameStageRef = useRef<HTMLDivElement | null>(null);
  const adTopRef = useRef<HTMLDivElement | null>(null);
  const adBottomRef = useRef<HTMLDivElement | null>(null);
  const adsReadyTimeoutRef = useRef<number | null>(null);
  const adTimeoutsRef = useRef<{ top?: number; bottom?: number }>({});
  const hintsPrefLoadedRef = useRef(false);
  const tapTimestampsRef = useRef<number[]>([]);
  const lastDevToolsTouchTsRef = useRef<number>(0);
  const devToolsTapTargetRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingRestoreRef = useRef<Parameters<GameControls['restoreState']>[0] | null>(null);
  const pendingRecentLoadRef = useRef<string | null>(null);
  const puzzleModeRef = useRef<'daily' | 'recent'>('daily');
  const recentDateRef = useRef<string | null>(null);
  const hintsEnabledRef = useRef(hintsEnabled);
  const devMaxLivesRef = useRef(devMaxLives);
  const isPlayingRef = useRef(isPlaying);
  const wakeLockRequestInFlightRef = useRef(false);
  const wakeLockReleaseHandlerRef = useRef<((ev: Event) => void) | null>(null);
  const analyticsStartSentRef = useRef(false);
  const analyticsViewSentRef = useRef<string | null>(null);
  const [liveAttempts, setLiveAttempts] = useState<GameState['attempts']>([]);
  const [reviewAttemptIndex, setReviewAttemptIndex] = useState<number | null>(null);
  const [showReplayButton, setShowReplayButton] = useState(false);
  const [analysisAnimationComplete, setAnalysisAnimationComplete] = useState(false);
  const [replayHeld, setReplayHeld] = useState(false);
  const replayHeldTimer = useRef<number>(0);
  const [tapToPlayHeld, setTapToPlayHeld] = useState(false);
  const tapToPlayHeldTimer = useRef<number>(0);
  const [isIdentityChecked, setIsIdentityChecked] = useState(false);
  const identitySyncEpochRef = useRef(0);

  // Keep devMaxLivesRef in sync
  useEffect(() => {
    devMaxLivesRef.current = devMaxLives;
  }, [devMaxLives]);

  useEffect(() => {
    puzzleModeRef.current = puzzleMode;
  }, [puzzleMode]);

  useEffect(() => {
    recentDateRef.current = recentDate;
  }, [recentDate]);

  // Prefetch stats modal data (me + history) so modal opens instantly
  const refreshStatsData = useCallback(() => {
    setStats(getPlayerStats());
    fetchMeFresh()
      .then((me) => {
        setStatsMe(me as StatsModalMeData | null);
        if (me?.mode === 'user' && me?.userId) {
          api.resultsHistory()
            .then((res) => {
              const mapped = res.history
                .map((row) => ({
                  date: row.date,
                  completed: row.completed,
                  timeMs: row.timeMs ?? null,
                  attemptsUsed: row.attemptsUsed ?? null,
                  attemptScores: row.attemptScores ?? null,
                  isRecent: row.isRecent,
                  puzzleNumber: getPuzzleNumberFromNyDateString(row.date),
                }))
                .sort((a: StatsHistoryEntry, b: StatsHistoryEntry) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
              setStatsAccountHistory(mapped);
            })
            .catch(() => setStatsAccountHistory([]));
        } else {
          setStatsAccountHistory(null);
        }
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    const runPrefetch = () => {
      prefetchAccount();
      prefetchLeaderboard(todayNy, LEADERBOARD_LIMIT);
      // Prefetch hall of fame for yesterday (default view) ± 2 days
      const yesterday = addDays(todayNy, -1);
      const hofDates: string[] = [];
      for (let i = -2; i <= 2; i++) {
        hofDates.push(addDays(yesterday, i));
      }
      prefetchHallOfFame(hofDates);
      // Prefetch stats modal data
      refreshStatsData();
    };

    const ric = (window as any).requestIdleCallback as ((cb: IdleRequestCallback, opts?: { timeout: number }) => number) | undefined;
    const cic = (window as any).cancelIdleCallback as ((id: number) => void) | undefined;
    if (typeof ric === 'function') {
      const id = ric(runPrefetch, { timeout: 1500 });
      return () => cic?.(id);
    }

    const id = window.setTimeout(runPrefetch, 800);
    return () => window.clearTimeout(id);
  }, [todayNy]);

  // Refresh stats data when modal opens (catches results saved after gameComplete prefetch)
  useEffect(() => {
    if (showStats) {
      refreshStatsData();
    }
  }, [showStats, refreshStatsData]);

  // Reset first-move analytics when the active puzzle changes.
  useEffect(() => {
    analyticsStartSentRef.current = false;
  }, [activeSeed]);

  useEffect(() => {
    if (analyticsViewSentRef.current === todayNy) return;
    analyticsViewSentRef.current = todayNy;
    api.analyticsView({ date: todayNy }).catch(() => null);
  }, [todayNy]);

  const applyStoredResult = useCallback((result: DailyStats | null) => {
    if (isPlayingRef.current) return;
    if (result && result.date !== todayNy) return;

    if (debugModeRef.current) return;

    if (!result) {
      setPreviousResult(null);
      setGameResult(null);
      setInitialStats(null);
      return;
    }

    setPreviousResult(result);
    setGameResult({
      moveCount: result.moveCount,
      timeMs: result.timeMs,
      attempts: result.attempts,
      failed: result.failed ?? !result.completed,
    });
    setShowShareCard(false);
    setShowInlineResult(false);
    setIsPlaying(false);
    setIsFreshCompletion(false);
    pendingRestoreRef.current = null;
    setHasPendingRestore(false);
    clearInProgressState();

    // initialStats will be set by the effect below when puzzle becomes available
  }, [todayNy, clearInProgressState]);

  useEffect(() => {
    if (!previousResult || !puzzle) return;
    const failed = previousResult.failed ?? !previousResult.completed;
    const failedAttempts = previousResult.attempts?.length ?? 0;
    const livesRemaining = failed ? 0 : DEFAULT_LIVES - failedAttempts;
    setInitialStats({
      lives: livesRemaining,
      currentAttemptMoves: puzzle.optimalMoves,
      elapsedTimeMs: previousResult.timeMs,
      penaltyTimeMs: 0,
    });
  }, [previousResult, puzzle]);

  useEffect(() => {
    let cancelled = false;
    setIsIdentityChecked(false);
    const epoch = identitySyncEpochRef.current + 1;
    identitySyncEpochRef.current = epoch;

    const run = async () => {
      let meError = false;
      let me = null as Awaited<ReturnType<typeof cachedApi.me>> | null;
      try {
        me = await cachedApi.me();
        setAccountMe(me);
        setStatsMe(me as StatsModalMeData | null);
      } catch {
        meError = true;
        me = null;
        setAccountMe(null);
        setStatsMe(null);
      }
      if (cancelled || identitySyncEpochRef.current !== epoch) return;

      const userId = me?.mode === 'user' ? me.userId : null;
      const fallbackScope = meError ? getStorageScope() : 'guest';
      const scope = userId ? `user:${userId}` : fallbackScope;
      setStorageScope(scope);

      if (!userId) {
        setStats(getPlayerStats(scope, me?.provider));
        const localResult = getTodaysResult(scope);

        // Check if we have a pending recent puzzle (already set by mount effect)
        if (pendingRecentLoadRef.current) {
          setIsIdentityChecked(true);
          return;
        }

        applyStoredResult(localResult);

        // If no completed result, check for in-progress state to restore
        if (!localResult && !debugModeRef.current) {
          const todaySeed = getDailySeed(new Date());
          const inProgressState = getInProgressState(todaySeed);
          if (inProgressState) {
            console.log('[RESUME] Found in-progress state (guest), will restore after game ready');
            pendingRestoreRef.current = inProgressState;
            setHasPendingRestore(true);
            setInitialStats({
              lives: inProgressState.lives,
              currentAttemptMoves: inProgressState.currentAttemptMoves,
              elapsedTimeMs: inProgressState.elapsedTimeMs,
              penaltyTimeMs: inProgressState.penaltyTimeMs,
            });
          }
        }
        setIsIdentityChecked(true);
        return;
      }

      const userScope = `user:${userId}`;
      const guestScope = 'guest';
      const canAdopt = canAdoptGuestHistory(userId);

      // Check if we have a pending recent puzzle (already set by mount effect)
      if (pendingRecentLoadRef.current) {
        setIsIdentityChecked(true);
        return;
      }

      if (canAdopt) {
        const userStats = getPlayerStats(userScope, me?.provider);
        const guestStats = getPlayerStats(guestScope, me?.provider);
        if (guestStats.history.length > 0) {
          const merged = mergePlayerStats(userStats, guestStats);
          if (
            merged.history.length !== userStats.history.length ||
            merged.totalGamesPlayed !== userStats.totalGamesPlayed ||
            merged.totalGamesWon !== userStats.totalGamesWon
          ) {
            ensureGuestOwner(userId);
            savePlayerStats(merged, userScope);
          }
        }
      }

      let serverResult: ServerDailyResult | null = null;
      try {
        const res = await api.resultsDay(todayNy);
        serverResult = res.result ?? null;
      } catch {
        serverResult = null;
      }

      if (cancelled || identitySyncEpochRef.current !== epoch) return;

      const localUserResult = getTodaysResult(userScope);
      const localGuestResult = canAdopt ? getTodaysResult(guestScope) : null;

      if (serverResult) {
        const merged = mergeServerResultIntoLocal(serverResult, localUserResult ?? localGuestResult);
        upsertTodaysResult(merged, userScope);
        setStats(getPlayerStats(userScope, me?.provider));
        applyStoredResult(merged);
        setIsIdentityChecked(true);
        return;
      }

      let candidate = localUserResult ?? localGuestResult;
      if (candidate && candidate.date === todayNy) {
        if (!localUserResult && localGuestResult && canAdopt) {
          ensureGuestOwner(userId);
        }

        if (!localUserResult) {
          saveTodaysResult(candidate, userScope);
        }

        const attemptsUsed = resolveAttemptsUsed(candidate);
        const attemptScores = getAttemptScores(candidate.attempts);
        const attemptsPayload = candidate.attempts;
        try {
          const recordRes = await api.resultsRecord(
            candidate.completed
              ? {
                date: todayNy,
                completed: true,
                timeMs: candidate.timeMs,
                attemptsUsed: attemptsUsed ?? undefined,
                attemptScores: attemptScores ?? undefined,
                attempts: attemptsPayload ?? undefined,
              }
              : {
                date: todayNy,
                completed: false,
                timeMs: candidate.timeMs,
                attemptsUsed: attemptsUsed ?? undefined,
                attemptScores: attemptScores ?? undefined,
                attempts: attemptsPayload ?? undefined,
              }
          );
          if (recordRes?.result) {
            const merged = mergeServerResultIntoLocal(recordRes.result, candidate);
            upsertTodaysResult(merged, userScope);
            candidate = merged;
          }
          invalidateMeCache();
          fetchMeFresh().then(setAccountMe).catch(() => null);
        } catch {
          // ignore record failures; local state is still valid
        }

        setStats(getPlayerStats(userScope, me?.provider));
        applyStoredResult(candidate);
        setIsIdentityChecked(true);
        return;
      }

      setStats(getPlayerStats(userScope, me?.provider));
      applyStoredResult(null);

      // No completed result - check for in-progress state to restore
      if (!debugModeRef.current) {
        const todaySeed = getDailySeed(new Date());
        let inProgressState = getInProgressState(todaySeed, userScope);
        if (!inProgressState && canAdopt) {
          inProgressState = getInProgressState(todaySeed, guestScope);
        }
        if (inProgressState) {
          console.log('[RESUME] Found in-progress state, will restore after game ready');
          pendingRestoreRef.current = inProgressState;
          setHasPendingRestore(true);
          setInitialStats({
            lives: inProgressState.lives,
            currentAttemptMoves: inProgressState.currentAttemptMoves,
            elapsedTimeMs: inProgressState.elapsedTimeMs,
            penaltyTimeMs: inProgressState.penaltyTimeMs,
          });
        }
      }
      setIsIdentityChecked(true);
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [todayNy, applyStoredResult]);

  useEffect(() => {
    if (!showShareCard && !showLeaderboard) return;
    prefetchLeaderboard(todayNy, 20);
    prefetchLeaderboard(todayNy, LEADERBOARD_LIMIT);
  }, [showShareCard, showLeaderboard, todayNy]);

  // Prefetch hall of fame when share card or hall of fame modal is shown
  useEffect(() => {
    if (!showShareCard && !showHallOfFame) return;
    const yesterday = addDays(todayNy, -1);
    const hofDates: string[] = [];
    for (let i = -2; i <= 2; i++) {
      hofDates.push(addDays(yesterday, i));
    }
    prefetchHallOfFame(hofDates);
  }, [showShareCard, showHallOfFame, todayNy]);

  // Update countdown timer every second when showing results
  useEffect(() => {
    if (!previousResult && !showShareCard) return;

    const interval = setInterval(() => {
      setNextPuzzleCountdown(getTimeUntilMidnightET());
    }, 1000);

    return () => clearInterval(interval);
  }, [previousResult, showShareCard]);

  // Sync CSS custom property to the real visual viewport height (iOS-safe)
  useEffect(() => {
    function setVH() {
      const vh = window.visualViewport?.height || window.innerHeight;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    }

    window.visualViewport?.addEventListener('resize', setVH);
    window.visualViewport?.addEventListener('scroll', setVH);
    window.addEventListener('resize', setVH);
    setVH();

    return () => {
      window.visualViewport?.removeEventListener('resize', setVH);
      window.visualViewport?.removeEventListener('scroll', setVH);
      window.removeEventListener('resize', setVH);
    };
  }, []);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
    const ua = navigator.userAgent || '';
    const uaMobile = /Android|iPhone|iPad|iPod|IEMobile|BlackBerry|Opera Mini|Mobi/i.test(ua);
    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;

    setIsMobileDevice(Boolean(uaData?.mobile) || uaMobile || coarsePointer);
  }, []);

  useEffect(() => {
    if (!isGameReady) {
      setAdsReady(false);
      if (adsReadyTimeoutRef.current !== null) {
        window.clearTimeout(adsReadyTimeoutRef.current);
        adsReadyTimeoutRef.current = null;
      }
      return;
    }

    if (adsReady) return;
    adsReadyTimeoutRef.current = window.setTimeout(() => {
      setAdsReady(true);
      adsReadyTimeoutRef.current = null;
    }, 1000);

    return () => {
      if (adsReadyTimeoutRef.current !== null) {
        window.clearTimeout(adsReadyTimeoutRef.current);
        adsReadyTimeoutRef.current = null;
      }
    };
  }, [isGameReady, adsReady]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.HINTS_ENABLED);
    if (stored !== null) {
      const enabled = stored === '1';
      hintsEnabledRef.current = enabled;
      setHintsEnabled(enabled);
    }
    hintsPrefLoadedRef.current = true;
  }, []);

  useEffect(() => {
    if (!hintsPrefLoadedRef.current) return;
    hintsEnabledRef.current = hintsEnabled;
    localStorage.setItem(STORAGE_KEYS.HINTS_ENABLED, hintsEnabled ? '1' : '0');
    gameControlsRef.current?.setHintsEnabled?.(hintsEnabled);
  }, [hintsEnabled]);

  const puzzleWidth = puzzle?.width ?? 15;
  const puzzleHeight = puzzle?.height ?? 15;
  const baseWidth = puzzleWidth * TILE_SIZE; // No buffer
  const baseHeight = puzzleHeight * TILE_SIZE; // No buffer
  const showTopAd = !!ADSENSE_TOP_SLOT;
  const showBottomAd = !!ADSENSE_BOTTOM_SLOT;
  const canRequestAds = adsReady && consentReady;

  const isRouteOverlayOpen = pathname !== '/';
  const isModalOpen =
    showHelp ||
    showStats ||
    showShareCard ||
    showDevTools ||
    showUiDevModal ||
    showMenu ||
    showLeaderboard ||
    showHallOfFame ||
    showAccount ||
    showRecentPuzzles;
  const shouldPause = isRouteOverlayOpen || isModalOpen;

  useEffect(() => {
    gameControlsRef.current?.setPaused?.(shouldPause);
  }, [shouldPause]);

  useEffect(() => {
    const targets: Record<'top' | 'bottom', boolean> = {
      top: adsReady && showTopAd,
      bottom: adsReady && showBottomAd,
    };

    const clearTimeoutFor = (key: keyof typeof targets) => {
      const timeoutId = adTimeoutsRef.current[key];
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
        adTimeoutsRef.current[key] = undefined;
      }
    };

    const ensureTimeout = (key: keyof typeof targets) => {
      if (adTimeoutsRef.current[key] !== undefined) return;
      adTimeoutsRef.current[key] = window.setTimeout(() => {
        setAdStatus((prev) => {
          if (prev[key] !== null) return prev;
          return { ...prev, [key]: 'unfilled' };
        });
        adTimeoutsRef.current[key] = undefined;
      }, 2000);
    };

    (Object.keys(targets) as Array<keyof typeof targets>).forEach((key) => {
      const shouldTrack = targets[key];
      if (!shouldTrack || adStatus[key] !== null) {
        clearTimeoutFor(key);
        return;
      }
      ensureTimeout(key);
    });
  }, [
    adsReady,
    showTopAd,
    showBottomAd,
    adStatus,
  ]);

  // Secret cheat code listener (hash-based, code not in plain text)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Only track single character keys
      if (e.key.length !== 1) return;

      // Clear timeout and reset buffer after delay
      if (cheatTimeoutRef.current) {
        clearTimeout(cheatTimeoutRef.current);
      }
      cheatTimeoutRef.current = setTimeout(() => {
        cheatBufferRef.current = '';
      }, CHEAT_TIMEOUT_MS);

      // Add key to buffer
      cheatBufferRef.current += e.key.toLowerCase();

      // Keep buffer at reasonable length
      if (cheatBufferRef.current.length > 20) {
        cheatBufferRef.current = cheatBufferRef.current.slice(-20);
      }

      // Check if cheat code was entered (hash comparison)
      if (isCheatCode(cheatBufferRef.current)) {
        cheatBufferRef.current = '';
        setShowDevTools(prev => !prev);
      }

      // UI Dev modal cheat (plain text)
      if (IS_UI_DEV_ENV && cheatBufferRef.current.endsWith(UI_DEV_CODE)) {
        cheatBufferRef.current = '';
        setShowUiDevModal((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (cheatTimeoutRef.current) {
        clearTimeout(cheatTimeoutRef.current);
      }
    };
  }, []);

  const applyTodayResultForUiDev = useCallback((kind: 'clear' | 'win' | 'loss') => {
    if (!IS_UI_DEV_ENV) return;
    const todayDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    if (kind === 'clear') {
      setTodaysResultForDev(null);
      setStats(getPlayerStats());
      setPreviousResult(null);
      setGameResult(null);
      setShowShareCard(false);
      setShowInlineResult(false);
      setReviewAttemptIndex(null);
      setIsFreshCompletion(false);
      setIsPlaying(false);
      setInitialStats(null);
      clearInProgressState();
      return;
    }

    const failed = kind === 'loss';
    const optimalMoves = puzzle?.optimalMoves ?? 10;
    const baseTimeMs = 55_000 + Math.floor(Math.random() * 65_000);
    const timeMs = failed ? baseTimeMs + 30_000 : baseTimeMs;

    const nextResult: DailyStats = {
      date: todayDateStr,
      completed: !failed,
      failed,
      moveCount: failed ? Math.max(optimalMoves, optimalMoves + 4) : optimalMoves,
      timeMs,
      puzzleNumber: puzzleNumber || getPuzzleNumberFromNyDateString(todayDateStr),
      optimalMoves,
      attemptsUsed: failed ? undefined : 1,
      attempts: [],
    };

    setTodaysResultForDev(nextResult);
    setStats(getPlayerStats());
    setPreviousResult(nextResult);
    setGameResult({
      moveCount: nextResult.moveCount,
      timeMs: nextResult.timeMs,
      attempts: nextResult.attempts,
      failed,
    });

    setInitialStats({
      lives: failed ? 0 : DEFAULT_LIVES,
      currentAttemptMoves: optimalMoves,
      elapsedTimeMs: timeMs,
      penaltyTimeMs: 0,
      maxLives: devMaxLivesRef.current,
    });

    setIsPlaying(false);
    setIsFreshCompletion(true);
    setShowInlineResult(true);
    setShowShareCard(true);
  }, [puzzle?.optimalMoves, puzzleNumber]);

  // Mobile tap-to-open dev tools (10 taps in 2 seconds on the scoreboard)
  const handleDevToolsTap = useCallback(() => {
    const now = Date.now();

    // Filter out taps older than the window
    tapTimestampsRef.current = tapTimestampsRef.current.filter(
      (ts) => now - ts < TAP_WINDOW_MS
    );

    // Add current tap
    tapTimestampsRef.current.push(now);

    // Check if threshold reached
    if (tapTimestampsRef.current.length >= TAP_COUNT_THRESHOLD) {
      tapTimestampsRef.current = []; // Reset
      setShowDevTools((prev) => !prev);
    }
  }, []);

  // Robust mobile activation: use native event listeners in capture phase.
  // This avoids React/pointer-event edge cases with global `touch-action: none`.
  useEffect(() => {
    const isInsideTapTarget = (eventTarget: EventTarget | null) => {
      const node = eventTarget as Node | null;
      return !!node && !!devToolsTapTargetRef.current && devToolsTapTargetRef.current.contains(node);
    };

    const onTouchEndCapture = (e: TouchEvent) => {
      if (!isInsideTapTarget(e.target)) return;
      lastDevToolsTouchTsRef.current = Date.now();
      handleDevToolsTap();
    };

    // Some browsers may still deliver pointer events; keep as a non-invasive fallback.
    const onPointerUpCapture = (e: PointerEvent) => {
      if (!isInsideTapTarget(e.target)) return;
      // If we've just processed a touch, ignore the follow-up pointer event.
      if (Date.now() - lastDevToolsTouchTsRef.current < 700) return;
      handleDevToolsTap();
    };

    const onClickCapture = (e: MouseEvent) => {
      if (!isInsideTapTarget(e.target)) return;
      if (Date.now() - lastDevToolsTouchTsRef.current < 700) return;
      handleDevToolsTap();
    };

    document.addEventListener('touchend', onTouchEndCapture, { capture: true });
    document.addEventListener('pointerup', onPointerUpCapture, { capture: true });
    document.addEventListener('click', onClickCapture, { capture: true });
    return () => {
      document.removeEventListener('touchend', onTouchEndCapture, { capture: true } as any);
      document.removeEventListener('pointerup', onPointerUpCapture, { capture: true } as any);
      document.removeEventListener('click', onClickCapture, { capture: true } as any);
    };
  }, [handleDevToolsTap]);

  const canAcceptMove = useCallback(() => gameControlsRef.current?.canAcceptMoveInput?.() ?? false, []);
  const onMove = useCallback((dir: Direction) => gameControlsRef.current?.movePlayer(dir), []);

  useGlobalSwipeMoves({
    enabled: isGameReady && isPlaying,
    blocked: shouldPause,
    baseWidth,
    baseHeight,
    gameFrameRef,
    canAcceptMove,
    onMove,
  });

  const loadDailyPuzzle = useCallback(async () => {
    const today = new Date();
    const todayNumber = getPuzzleNumber(today);
    const todaySeed = getDailySeed(today);

    // Set puzzle-specific state immediately so UI renders
    // NOTE: We do NOT set previousResult, stats, gameResult, or initialStats here.
    // These depend on user identity (storage scope) which may not be resolved yet.
    // The identity sync effect handles loading these with the correct scope.
    debugModeRef.current = false;
    setPuzzleNumber(todayNumber);
    setPuzzleLabel(null);
    setActiveSeed(todaySeed);
    setSeedInput('');
    setShowShareCard(false);
    setShowInlineResult(false);
    setIsFreshCompletion(false); // Reset - will be set true only by gameComplete event

    // Check localStorage cache first for instant loading (same-day revisit)
    const cachedPuzzle = getCachedPuzzle(todaySeed);
    if (cachedPuzzle) {
      setPuzzle(cachedPuzzle);
      setRenderKey((prev) => prev + 1);
      return;
    }

    // Fetch daily puzzle: KV (pre-generated) → Rust → WASM fallback
    // setIsGenerating(true); // Don't show progress bar for initial KV check
    setGenerationProgress(null);

    try {
      const { puzzle: todayPuzzle, source } = await fetchDailyPuzzle(todaySeed, (progress) => {
        // Only show generating state if we are actually generating (not checking cache)
        if (progress.phase !== 'kv') {
          setIsGenerating(true);
        }
        setGenerationProgress(progress);
        setLastUsedBackend(progress.phase === 'kv' ? null : progress.phase);
      });

      console.log(`[Daily] Loaded puzzle from ${source}`);
      setPuzzle(todayPuzzle);
      // Note: initialStats is set by the effect watching previousResult + puzzle
      setRenderKey((prev) => prev + 1);

      // Cache in localStorage for same-day revisits
      cachePuzzle(todaySeed, todayPuzzle);
    } finally {
      setIsGenerating(false);
      setGenerationProgress(null);
    }
  }, []);

  // Track if we've already initiated loading (prevent React Strict Mode double-call)
  const loadInitiatedRef = useRef(false);

  // Initialize puzzle on mount without waiting for identity check (which involves API calls)
  useEffect(() => {
    // Prevent duplicate calls from React Strict Mode
    if (loadInitiatedRef.current) return;
    loadInitiatedRef.current = true;

    // Quick localStorage check for in-progress recent puzzle (no async)
    // Check both possible scopes since we don't know the user yet
    const guestInProgress = getAnyInProgressState('guest');
    const userScope = getStorageScope();
    const userInProgress = userScope !== 'guest' ? getAnyInProgressState(userScope) : null;
    const anyInProgress = guestInProgress ?? userInProgress;

    if (anyInProgress?.isRecent && anyInProgress.seed) {
      // Found in-progress recent puzzle - wait for identity check to load it
      pendingRecentLoadRef.current = anyInProgress.seed;
      // Don't load daily - the identity check effect will trigger recent puzzle load
      return;
    }

    // No recent puzzle to restore - load daily puzzle immediately
    // Preload WASM early for faster fallback if needed
    preloadWasm();

    // Ensure the loading UI renders before starting heavy computation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        loadDailyPuzzle();
      });
    });
  }, [loadDailyPuzzle]);


  // Listen for game completion
  useEffect(() => {
    const unsubscribeComplete = onGameEvent('gameComplete', (data) => {
      const result = data as { moveCount: number; timeMs: number; optimalMoves: number; failed?: boolean; attempts?: any[] };
      setGameResult(result);
      const isRecent = puzzleModeRef.current === 'recent';
      if (isRecent) {
        const playedDate = recentDateRef.current;
        if (playedDate) {
          if (accountMe?.mode !== 'user') {
            markRecentPuzzlePlayed(playedDate, getStorageScope());
          }
        }
      } else {
        prefetchLeaderboard(todayNy, 20);
        prefetchLeaderboard(todayNy, LEADERBOARD_LIMIT);
        // Notify LeaderboardView to refresh with latest data
        emitGameEvent('leaderboardRefresh', {});
      }
      setShowShareCard(true);
      setIsPlaying(false); // Ensure game is marked as not playing to show blocked state
      setIsFreshCompletion(true); // Mark as fresh completion (not loaded from storage)

      // Set initialStats so scoreboard stays frozen at completion state
      const failedAttempts = result.attempts?.length ?? 0;
      const livesRemaining = result.failed ? 0 : DEFAULT_LIVES - failedAttempts;
      setInitialStats({
        lives: livesRemaining,
        currentAttemptMoves: result.optimalMoves, // 0 moves remaining
        elapsedTimeMs: result.timeMs,
        penaltyTimeMs: 0, // Already included in timeMs
      });

      // Result is already saved in stateUpdate handler when isComplete becomes true
      // This handler now only triggers UI updates after animation completes

      // Refresh stats data so modal opens instantly with updated data
      refreshStatsData();
    });

    const unsubscribeLifeLost = onGameEvent('lifeLost', (data) => {
      const { lives } = data as { lives: number; penaltyMs: number };
      // Let GameScene handle the final life flash to avoid double-flashing.
      if (lives > 0) {
        setLifeFlash(true);
        setTimeout(() => setLifeFlash(false), 500);
      }
    });

    // Save in-progress state on each state update (for resume after refresh)
    const persistInProgressState = (data: any) => {
      const state = data as GameState;
      setLiveAttempts(state.attempts);

      const isRecent = puzzleModeRef.current === 'recent';
      const isDaily = puzzleModeRef.current === 'daily';
      
      // Skip for dev seeds (not daily or recent)
      if (!isDaily && !isRecent) return;
      // Skip if daily already completed
      if (isDaily && previousResult) return;

      const serializableState = gameControlsRef.current?.getSerializableState();
      if (serializableState && activeSeed) {
        setIsPlaying(serializableState.isPlaying);

        if (serializableState.isComplete) {
          // Game just completed - save result immediately (before animation)
          clearInProgressState();

          const failed = serializableState.lives === 0;
          const timeMs = serializableState.elapsedTimeMs + serializableState.penaltyTimeMs;
          const failedAttempts = serializableState.attempts?.length ?? 0;
          const attemptsUsed = Math.min(DEFAULT_LIVES, Math.max(1, failedAttempts + 1));
          const attemptScores = getAttemptScores(serializableState.attempts);
          const attemptsPayload = serializableState.attempts;

          if (isRecent) {
            // Recent puzzle - record for signed-in users (no leaderboard)
            const recentDate = recentDateRef.current;
            if (recentDate) {
              const recentResult: DailyStats = {
                date: recentDate,
                completed: !failed,
                isRecent: true,
                moveCount: serializableState.moveCount,
                timeMs,
                puzzleNumber,
                optimalMoves: puzzle?.optimalMoves,
                attempts: serializableState.attempts,
                attemptsUsed,
                failed,
              };
              if (accountMe?.mode !== 'user') {
                saveHistoricalResult(recentResult);
                setStats(getPlayerStats());
              }
              setPreviousResult(recentResult);
              console.log('[SAVE] Recent puzzle result saved to history');

              if (accountMe?.mode === 'user') {
                api
                  .resultsRecord({
                    date: recentDate,
                    completed: !failed,
                    timeMs,
                    attemptsUsed,
                    attemptScores: attemptScores ?? undefined,
                    attempts: attemptsPayload ?? undefined,
                    isRecent: true,
                  })
                  .then(() => {
                    refreshStatsData();
                    invalidateMeCache();
                    fetchMeFresh().then(setAccountMe).catch(() => null);
                  })
                  .catch(() => null);
              }
            }
          } else {
            // Daily puzzle - full save with server record
            const todayDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

            const dailyResult: DailyStats = {
              date: todayDateStr,
              completed: !failed,
              moveCount: serializableState.moveCount,
              timeMs,
              puzzleNumber,
              optimalMoves: puzzle?.optimalMoves,
              attempts: serializableState.attempts,
              attemptsUsed,
              failed,
            };

            saveTodaysResult(dailyResult);
            setStats(getPlayerStats());
            setPreviousResult(dailyResult);
            console.log('[SAVE] Result saved immediately on completion');

            const recordPromise = api
              .resultsRecord(
                failed
                  ? {
                    date: todayDateStr,
                    completed: false,
                    timeMs,
                    attemptsUsed,
                    attemptScores: attemptScores ?? undefined,
                    attempts: attemptsPayload ?? undefined,
                  }
                  : {
                    date: todayDateStr,
                    completed: true,
                    timeMs,
                    attemptsUsed,
                    attemptScores: attemptScores ?? undefined,
                    attempts: attemptsPayload ?? undefined,
                  }
              )
              .then((res) => {
                invalidateMeCache();
                fetchMeFresh().then(setAccountMe).catch(() => null);
                return res;
              })
              .catch(() => null);

            if (!failed && getPrefs().leaderboardAutoSubmitWins) {
              recordPromise
                .then(() => api.leaderboardSubmit({ date: todayDateStr }))
                .then((res) => {
                  if (res.rank != null) {
                    recordLeaderboardRank(todayDateStr, res.rank);
                    setStats(getPlayerStats());
                  }
                })
                .catch(() => {
                  // Ignore: manual submit remains available via the leaderboard overlay.
                });
            }
          }
        } else if (serializableState.isPlaying) {
          // Save for daily or recent puzzles (not dev seeds)
          const isRecent = puzzleModeRef.current === 'recent';
          const recentDate = isRecent ? recentDateRef.current : undefined;
          saveInProgressState(activeSeed, serializableState, undefined, recentDate ?? undefined);
        }
      }
    };
    const unsubscribeStateUpdate = onGameEvent('stateUpdate', persistInProgressState);

    // Also persist while idle and when backgrounding/unloading so elapsed time doesn't jump backwards.
    const intervalId = window.setInterval(() => {
      // We can't access state directly here easily without ref, but getSerializableState works
      const state = gameControlsRef.current?.getSerializableState();
      const isRecent = puzzleModeRef.current === 'recent';
      const canSave = puzzleModeRef.current === 'daily' || isRecent;
      if (state && state.isPlaying && activeSeed && canSave && !previousResult) {
        const recentDate = isRecent ? recentDateRef.current : undefined;
        saveInProgressState(activeSeed, state, undefined, recentDate ?? undefined);
      }
    }, 5000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        const state = gameControlsRef.current?.getSerializableState();
        const isRecent = puzzleModeRef.current === 'recent';
        const canSave = puzzleModeRef.current === 'daily' || isRecent;
        if (state && state.isPlaying && activeSeed && canSave && !previousResult) {
          const recentDate = isRecent ? recentDateRef.current : undefined;
          saveInProgressState(activeSeed, state, undefined, recentDate ?? undefined);
        }
      }
    };
    const handlePageHide = () => {
      const state = gameControlsRef.current?.getSerializableState();
      const isRecent = puzzleModeRef.current === 'recent';
      const canSave = puzzleModeRef.current === 'daily' || isRecent;
      if (state && state.isPlaying && activeSeed && canSave && !previousResult) {
        const recentDate = isRecent ? recentDateRef.current : undefined;
        saveInProgressState(activeSeed, state, undefined, recentDate ?? undefined);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      unsubscribeComplete();
      unsubscribeLifeLost();
      unsubscribeStateUpdate();
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [puzzleNumber, previousResult, activeSeed, todayNy, accountMe]);

  // Listen for analysis completion to show replay button
  useEffect(() => {
    const unsubscribe = onGameEvent('analysisComplete', () => {
      setShowReplayButton(true);
      setAnalysisAnimationComplete(true);
    });
    return unsubscribe;
  }, []);

  // Listen for openAccount event (from LeaderboardView "Sign in to submit" button)
  useEffect(() => {
    const unsubscribe = onGameEvent('openAccount', () => {
      setShowAccount(true);
    });
    return unsubscribe;
  }, []);

  const requestWakeLock = useCallback(async () => {
    try {
      const wakeLock = (navigator as any)?.wakeLock;
      if (!wakeLock?.request) return;
      const existing = wakeLockRef.current;
      if (existing && existing.released === false) return;
      if (wakeLockRequestInFlightRef.current) return;
      wakeLockRequestInFlightRef.current = true;

      if (existing && wakeLockReleaseHandlerRef.current) {
        try {
          existing.removeEventListener?.('release', wakeLockReleaseHandlerRef.current);
        } catch {
          // Ignore
        }
      }
      wakeLockReleaseHandlerRef.current = null;
      wakeLockRef.current = null;
      await existing?.release?.();

      const sentinel = await wakeLock.request('screen');
      if (!isPlayingRef.current || document.visibilityState !== 'visible') {
        try {
          await sentinel.release?.();
        } catch {
          // Ignore
        }
        return;
      }

      wakeLockRef.current = sentinel;
      const handleRelease = () => {
        if (wakeLockRef.current === sentinel) {
          wakeLockRef.current = null;
          wakeLockReleaseHandlerRef.current = null;
        }
        if (isPlayingRef.current && document.visibilityState === 'visible') {
          requestWakeLock();
        }
      };
      wakeLockReleaseHandlerRef.current = handleRelease;
      sentinel.addEventListener?.('release', handleRelease);
    } catch {
      // Ignore - wake lock is best-effort and not supported on all browsers.
    } finally {
      wakeLockRequestInFlightRef.current = false;
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    try {
      const sentinel = wakeLockRef.current;
      if (sentinel && wakeLockReleaseHandlerRef.current) {
        try {
          sentinel.removeEventListener?.('release', wakeLockReleaseHandlerRef.current);
        } catch {
          // Ignore
        }
      }
      wakeLockReleaseHandlerRef.current = null;
      await sentinel?.release?.();
    } catch {
      // Ignore
    } finally {
      wakeLockRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      releaseWakeLock();
    }
  }, [isPlaying, releaseWakeLock]);

  useEffect(() => {
    if (isPlaying && document.visibilityState === 'visible') {
      requestWakeLock();
    }
  }, [isPlaying, requestWakeLock]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isPlaying) {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isPlaying, requestWakeLock]);

  // Reset review mode when hints are enabled
  useEffect(() => {
    if (hintsEnabled) {
      setReviewAttemptIndex(null);
    }
  }, [hintsEnabled]);

  // Apply review path when index changes
  useEffect(() => {
    gameControlsRef.current?.showSingleAttemptPath(reviewAttemptIndex);
  }, [reviewAttemptIndex]);

  const handleRestart = useCallback(() => {
    setIsPlaying(false);
    gameControlsRef.current?.restart();
    setShowShareCard(false);
    setLiveAttempts([]);
    setReviewAttemptIndex(null);
  }, []);

  const [showSwipeHint, setShowSwipeHint] = useState(false);

  const handleBegin = useCallback(() => {
    if (puzzleMode === 'daily' && !analyticsStartSentRef.current) {
      analyticsStartSentRef.current = true;
      api.analyticsStart({ date: todayNy }).catch(() => null);
    }
    setIsPlaying(true);
    requestWakeLock();
    gameControlsRef.current?.start();
    setLiveAttempts([]);
    setReviewAttemptIndex(null);
    // Mount hint after 500ms delay - animation handles full lifecycle
    // Only show on mobile (desktop has display:none which prevents onAnimationEnd)
    setShowSwipeHint(false);
    setTimeout(() => {
      const isMobile = window.innerWidth < 769;
      if (isMobile) {
        setShowSwipeHint(true);
      }
    }, 500);
  }, [puzzleMode, requestWakeLock, todayNy]);

  const handleDevSeedGenerate = useCallback(
    async (rawSeed?: string) => {
      const trimmed = rawSeed?.trim() ?? '';
      const isDateSeed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
      const startBatch = startBatchInput ? parseInt(startBatchInput, 10) : undefined;
      const abortController = new AbortController();

      // Abort any previous in-flight generation to avoid duplicate work
      if (generationAbortRef.current && !generationAbortRef.current.signal.aborted) {
        generationAbortRef.current.abort();
      }
      generationAbortRef.current = abortController;

      // Track which seed this request is for (used by Stop button)
      const requestSeed = isDateSeed
        ? trimmed
        : (trimmed ||
          `dev-${Date.now()}-${Math.floor(Math.random() * 10000)
            .toString()
            .padStart(4, '0')}`);
      inFlightSeedRef.current = requestSeed;

      const progressHandler = (progress: GenerationProgress) => {
        setGenerationProgress(progress);
        setLastUsedBackend(progress.phase === 'kv' ? null : progress.phase);
      };

      if (isDateSeed) {
        setIsGenerating(true);
        setGenerationProgress(null);

        const dailySeed = requestSeed;
        const puzzleNumberForDate = getPuzzleNumberFromNyDateString(dailySeed);

        try {
          const datedPuzzle = await generatePuzzleParallel(
            dailySeed,
            progressHandler,
            selectedBackend,
            startBatch,
            abortController,
            closenessThreshold
          );
          debugModeRef.current = true;
          setPuzzle(datedPuzzle);
          setPuzzleNumber(puzzleNumberForDate);
          setPuzzleLabel(`DATE ${trimmed}`);
          setActiveSeed(dailySeed);
          setSeedInput(trimmed);
          setGameResult(null);
          setShowShareCard(false);
          setShowInlineResult(false);
          setPreviousResult(null);
          setInitialStats(null);
          setIsPlaying(false);
          setReviewAttemptIndex(null);
        } catch (error) {
          if (abortController.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
            console.log('[Dev] Generation cancelled by user');
            return;
          }
          throw error;
        } finally {
          setIsGenerating(false);
          setGenerationProgress(null);
          generationAbortRef.current = null;
          inFlightSeedRef.current = null;
        }
        return;
      }

      const newSeed =
        trimmed ||
        `dev-${Date.now()}-${Math.floor(Math.random() * 10000)
          .toString()
          .padStart(4, '0')}`;

      setIsGenerating(true);
      setGenerationProgress(null);

      try {
        const newPuzzle = await generatePuzzleParallel(
          requestSeed,
          progressHandler,
          selectedBackend,
          startBatch,
          abortController,
          closenessThreshold
        );
        debugModeRef.current = true;
        setPuzzle(newPuzzle);
        setPuzzleLabel(`DEV ${requestSeed}`);
        setActiveSeed(requestSeed);
        setSeedInput(requestSeed);
        setRenderKey((prev) => prev + 1);
        setGameResult(null);
        setShowShareCard(false);
        setShowInlineResult(false);
        setPreviousResult(null);
        setInitialStats(null);
        setIsPlaying(false);
        setReviewAttemptIndex(null);
      } catch (error) {
        if (abortController.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          console.log('[Dev] Generation cancelled by user');
          return;
        }
        throw error;
      } finally {
        setIsGenerating(false);
        setGenerationProgress(null);
        generationAbortRef.current = null;
        inFlightSeedRef.current = null;
      }
    },
    [selectedBackend, startBatchInput, closenessThreshold],
  );

  const handleLoadDaily = useCallback(() => {
    loadDailyPuzzle();
    applyStoredResult(getTodaysResult());
  }, [loadDailyPuzzle, applyStoredResult]);

  const loadRecentPuzzle = useCallback(
    async (date: string) => {
      const trimmed = date.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return;

      // Abort any previous in-flight generation to avoid duplicate work
      if (generationAbortRef.current && !generationAbortRef.current.signal.aborted) {
        generationAbortRef.current.abort();
      }
      const abortController = new AbortController();
      generationAbortRef.current = abortController;
      inFlightSeedRef.current = trimmed;

      debugModeRef.current = true;
      setPuzzleMode('recent');
      setRecentDate(trimmed);

      const puzzleNumberForDate = getPuzzleNumberFromNyDateString(trimmed);
      setPuzzleNumber(puzzleNumberForDate);
      setPuzzleLabel(null); // Use default puzzle number display
      setActiveSeed(trimmed);
      setSeedInput('');
      setShowShareCard(false);
      setShowInlineResult(false);
      setIsFreshCompletion(false);
      setGameResult(null);
      setPreviousResult(null);
      setIsPlaying(false);
      setReviewAttemptIndex(null);
      setShowReplayButton(false);
      setAnalysisAnimationComplete(false);
      setPuzzle(null);
      setIsGameReady(false);
      setIsGenerating(true);
      setGenerationProgress(null);

      // Check for in-progress state for this recent puzzle
      const scope = getStorageScope();
      const inProgressState = getInProgressState(trimmed, scope);
      if (inProgressState) {
        console.log('[RESUME] Found in-progress recent puzzle state, will restore after game ready');
        pendingRestoreRef.current = inProgressState;
        setHasPendingRestore(true);
        setInitialStats({
          lives: inProgressState.lives,
          currentAttemptMoves: inProgressState.currentAttemptMoves,
          elapsedTimeMs: inProgressState.elapsedTimeMs,
          penaltyTimeMs: inProgressState.penaltyTimeMs,
        });
      } else {
        pendingRestoreRef.current = null;
        setHasPendingRestore(false);
        setInitialStats(null);
      }

      const cachedPuzzle = getCachedPuzzle(trimmed);
      if (cachedPuzzle) {
        setPuzzle(cachedPuzzle);
        setRenderKey((prev) => prev + 1);
        setIsGenerating(false);
        setGenerationProgress(null);
        generationAbortRef.current = null;
        inFlightSeedRef.current = null;
        return;
      }

      const progressHandler = (progress: GenerationProgress) => {
        setGenerationProgress(progress);
        setLastUsedBackend(progress.phase === 'kv' ? null : progress.phase);
      };

      try {
        let recentPuzzle: PuzzleData | null = null;

        try {
          const response = await fetch(`/api/recent/${encodeURIComponent(trimmed)}`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(10000),
          });

          if (response.ok) {
            const data = await response.json();
            if (data?.puzzle && data.seed === trimmed) {
              recentPuzzle = data.puzzle as PuzzleData;
              setLastUsedBackend(null);
            }
          }
        } catch {
          // Cache check failed; fall back to generation
        }

        if (!recentPuzzle) {
          recentPuzzle = await generatePuzzleParallel(
            trimmed,
            progressHandler,
            selectedBackend,
            undefined,
            abortController,
            closenessThreshold
          );

          // Backfill KV cache with client-generated puzzle (fire and forget)
          if (recentPuzzle && !abortController.signal.aborted) {
            fetch('/api/daily/cache', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ seed: trimmed, puzzle: recentPuzzle, date: trimmed }),
            }).catch(() => {
              // Ignore backfill failures - puzzle is already usable
            });
          }
        }

        if (abortController.signal.aborted) return;
        setPuzzle(recentPuzzle);
        setRenderKey((prev) => prev + 1);
        cachePuzzle(trimmed, recentPuzzle);
      } catch (error) {
        if (abortController.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          return;
        }
        throw error;
      } finally {
        if (generationAbortRef.current === abortController) {
          generationAbortRef.current = null;
          inFlightSeedRef.current = null;
        }
        setIsGenerating(false);
        setGenerationProgress(null);
      }
    },
    [selectedBackend, closenessThreshold],
  );

  // Load pending recent puzzle after identity check completes
  useEffect(() => {
    if (!isIdentityChecked) return;
    const pendingSeed = pendingRecentLoadRef.current;
    if (pendingSeed) {
      pendingRecentLoadRef.current = null;
      loadRecentPuzzle(pendingSeed);
    }
  }, [isIdentityChecked, loadRecentPuzzle]);

  const returnToDaily = useCallback(() => {
    debugModeRef.current = false;
    setPuzzleMode('daily');
    setRecentDate(null);
    setPuzzleLabel(null);
    setShowShareCard(false);
    setShowInlineResult(false);
    setIsFreshCompletion(false);
    setGameResult(null);
    setPreviousResult(null);
    setInitialStats(null);
    setIsPlaying(false);
    setReviewAttemptIndex(null);
    setShowReplayButton(false);
    setAnalysisAnimationComplete(false);
    setShowSwipeHint(false);
    pendingRestoreRef.current = null;
    setHasPendingRestore(false);
    setPuzzle(null);
    setIsGameReady(false);

    loadDailyPuzzle();
    const scope = getStorageScope();
    const stored = getTodaysResult(scope);
    applyStoredResult(stored);

    if (!stored) {
      const todaySeed = getDailySeed(new Date());
      const inProgressState = getInProgressState(todaySeed, scope);
      if (inProgressState) {
        pendingRestoreRef.current = inProgressState;
        setHasPendingRestore(true);
        setInitialStats({
          lives: inProgressState.lives,
          currentAttemptMoves: inProgressState.currentAttemptMoves,
          elapsedTimeMs: inProgressState.elapsedTimeMs,
          penaltyTimeMs: inProgressState.penaltyTimeMs,
        });
      }
    }
  }, [loadDailyPuzzle, applyStoredResult]);

  const showAnalysis = useCallback(() => {
    const attempts = gameResult?.attempts ?? previousResult?.attempts;
    if (attempts && gameControlsRef.current) {
      gameControlsRef.current.showAnalysis(attempts);
    }
  }, [gameResult?.attempts, previousResult?.attempts]);

  const handleReplayAnalysis = useCallback(() => {
    setShowReplayButton(false); // Hide button while replaying
    setAnalysisAnimationComplete(false); // Reset animation state
    gameControlsRef.current?.replayAnalysis();
    // Blur active element to clear any stuck hover/focus state on mobile
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, []);

  const handleGameReady = useCallback((controls: GameControls) => {
    gameControlsRef.current = controls;
    setIsGameReady(true);
    controls.setHintsEnabled(hintsEnabledRef.current);

    const me = readCachedMe();
    emitGameEvent('cosmeticsUpdate', me?.mode === 'user' && me.profile ? me.profile : { characterId: 'default', skinId: 'default' });

    // Sync dev tools maxLives setting if not default
    if (devMaxLivesRef.current !== DEFAULT_LIVES) {
      controls.setMaxLives(devMaxLivesRef.current);
    }

    controls.setPaused(shouldPause);

    // Restore in-progress state if we have one (mid-game refresh resume)
    if (pendingRestoreRef.current) {
      console.log('[RESUME] Restoring in-progress state');
      try {
        controls.restoreState(pendingRestoreRef.current);
        setIsPlaying(pendingRestoreRef.current.isPlaying);
        pendingRestoreRef.current = null;
        setHasPendingRestore(false);
        return;
      } catch (error) {
        console.warn('[RESUME] Failed to restore in-progress state, clearing it', error);
        clearInProgressState();
        pendingRestoreRef.current = null;
        setHasPendingRestore(false);
        setInitialStats(null);
      }
    }

    // If inline results are already visible (e.g., post-game), re-sync analysis
    if (showInlineResult) {
      showAnalysis();
      setIsPlaying(false);
    }
  }, [showAnalysis, showInlineResult, shouldPause]);

  // If in-progress state is discovered after the game is ready, restore it here.
  useEffect(() => {
    if (!isGameReady || !hasPendingRestore) return;
    const pending = pendingRestoreRef.current;
    const controls = gameControlsRef.current;
    if (!pending || !controls) return;

    console.log('[RESUME] Restoring late in-progress state');
    try {
      controls.restoreState(pending);
      setIsPlaying(pending.isPlaying);
      pendingRestoreRef.current = null;
      setHasPendingRestore(false);
      return;
    } catch (error) {
      console.warn('[RESUME] Failed to restore late in-progress state, clearing it', error);
      clearInProgressState();
      pendingRestoreRef.current = null;
      setHasPendingRestore(false);
      setInitialStats(null);
    }
  }, [isGameReady, hasPendingRestore, clearInProgressState]);

  // Show help on first visit - wait for full loading to complete
  const hasShownFirstVisitHelpRef = useRef(false);
  useEffect(() => {
    if (!isGameReady || !isIdentityChecked || hasShownFirstVisitHelpRef.current) return;
    hasShownFirstVisitHelpRef.current = true;

    try {
      // Clean up old help keys
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith('mazle_seen_help') && key !== HELP_SEEN_KEY) {
          localStorage.removeItem(key);
        }
      }
    } catch {
      // Ignore storage access errors (e.g., private mode)
    }

    const hasSeenHelp = localStorage.getItem(HELP_SEEN_KEY);
    if (!hasSeenHelp) {
      setShowHelp(true);
      localStorage.setItem(HELP_SEEN_KEY, 'true');
    }
  }, [isGameReady, isIdentityChecked]);

  const handleViewResult = useCallback(() => {
    // Show analysis on the map; share card can be opened from the bottom button
    showAnalysis();
    setShowInlineResult(true);
    setIsPlaying(false);
    setShowShareCard(false);
    setAnalysisAnimationComplete(false); // Reset so animation plays fresh
  }, [showAnalysis]);

  const handleShowShareCard = useCallback(() => {
    // Only show analysis if already in inline result view
    // (Don't transition if user is on "View Result" overlay - they can view analysis separately)
    if (showInlineResult) {
      showAnalysis();
    }
    setIsPlaying(false);
    setShowShareCard(true);
  }, [showAnalysis, showInlineResult]);

  const handleStopGeneration = useCallback(() => {
    const controller = generationAbortRef.current;
    const seedToCancel = inFlightSeedRef.current || activeSeed;
    if (!controller || !seedToCancel) {
      return;
    }

    // Only cancel if no other same-seed requests are in-flight (handled in wasmGenerator)
    const didCancelWasm = cancelWasmRequest(seedToCancel);
    const didCancelRust = cancelRustRequest(seedToCancel);
    const didCancel = didCancelWasm || didCancelRust;

    if (didCancel) {
      console.log('[Dev] Stopping generation request (client abort)');
      controller.abort();

      if (didCancelRust) {
        // Ask backend to cancel compute if we're the only waiter
        fetch(`/api/generate/${encodeURIComponent(seedToCancel)}/cancel`, {
          method: 'POST',
        }).catch((err) => console.warn('[Dev] Backend cancel request failed', err));
      }

      setIsGenerating(false);
      setGenerationProgress(null);
      generationAbortRef.current = null;
    } else {
      console.log('[Dev] Cancel skipped; another request for this seed is in-flight');
    }
  }, [activeSeed]);

  const handleMaxLivesChange = useCallback((count: number) => {
    setDevMaxLives(count);
    gameControlsRef.current?.setMaxLives(count);
  }, []);

  const handleCloseShareCard = useCallback(() => {
    setShowShareCard(false);
    setReviewAttemptIndex(null);

    // Only transition to inline result view if:
    // 1. Already in inline result view, OR
    // 2. This is a fresh game completion (not just returning to a previous result)
    if (showInlineResult || isFreshCompletion) {
      setShowInlineResult(true);
      showAnalysis();
    }
    // Otherwise, return to "View Result" overlay state
  }, [showAnalysis, showInlineResult, isFreshCompletion]);

  // Calculate progress percentage (works for both loading screen and dev tools)
  const progressPercent = generationProgress
    ? Math.round((generationProgress.workersComplete / generationProgress.totalWorkers) * 100)
    : 0;

  // Helper for ad visibility
  const isAdVisible = (status: 'filled' | 'unfilled' | null) => canRequestAds && status === 'filled';

  // Derived state
  const isRecentMode = puzzleMode === 'recent' && !!recentDate;
  const hasPuzzle = Boolean(puzzle);
  // Loading text priority: generating > no puzzle > puzzle loading/waiting
  const loadingText = isGenerating
    ? (isRecentMode ? 'Loading recent puzzle...' : 'Generating daily puzzle...')
    : !hasPuzzle
      ? 'Loading Mazle...'
      : 'Loading puzzle...';
  const displayOptimalMoves = puzzle?.optimalMoves ?? 10;
  const isPostGame = hasPuzzle && !isPlaying && (!!gameResult || !!previousResult);
  const shouldBlur =
    showShareCard ||
    showHelp ||
    showStats ||
    showUiDevModal ||
    showMenu ||
    showLeaderboard ||
    showAccount ||
    showDevTools ||
    (hasPuzzle && !isPlaying && isGameReady && !showInlineResult);
  const showLoader = !hasPuzzle || !isGameReady || !isIdentityChecked;
  const showControlsRow = showInlineResult && !showSwipeHint && !showShareCard;

  // Clear preload hint once puzzle loading completes (React now controls visibility)
  useEffect(() => {
    if (hasPuzzle && isIdentityChecked) {
      delete document.documentElement.dataset.puzzlePlayed;
    }
  }, [hasPuzzle, isIdentityChecked]);

  return (
    <ErrorBoundary>
      <main className={`${styles.main} bg-pattern`}>
        {showTopAd && (
          <div
            ref={adTopRef}
            className={`${styles.adBanner} ${styles.adBannerTop} ${adStatus.top === 'unfilled' ? styles.adCollapsed : (!isAdVisible(adStatus.top) ? styles.adHidden : '')}`}
            role="complementary"
            aria-label="Advertisement"
          >
            <AdSlot
              slot={ADSENSE_TOP_SLOT}
              className={styles.adBannerSlot}
              format="horizontal"
              responsive={true}
              enabled={canRequestAds}
              onSlotStatus={(status) =>
                setAdStatus((prev) => (prev.top === status ? prev : { ...prev, top: status }))
              }
            />
          </div>
        )}

        <Header
          streak={accountMe?.mode === 'user' && accountMe.stats ? accountMe.stats.playedStreak : (stats?.currentStreak ?? 0)}
          puzzleInfo={puzzleLabel ?? (puzzleNumber > 0 ? `#${puzzleNumber}` : undefined)}
          puzzleInfoLoading={isGenerating || (!puzzle && !gameResult)}
          onHelpClick={() => setShowHelp(true)}
          onMenuClick={() => setShowMenu(!showMenu)}
          logoRef={devToolsTapTargetRef}
          logoClassName={styles.devToolsTapTarget}
          isMenuOpen={showMenu}
          menuButtonRef={menuButtonRef}
          showThemeToggle={false}
        />

        <div className={styles.gameWrapper}>
          {showDevTools && puzzle && (
            <DevTools
              puzzle={puzzle}
              puzzleNumber={puzzleNumber}
              puzzleLabel={puzzleLabel}
              activeSeed={activeSeed}
              seedInput={seedInput}
              onSeedInputChange={setSeedInput}
              startBatchInput={startBatchInput}
              onStartBatchInputChange={setStartBatchInput}
              selectedBackend={selectedBackend}
              onBackendChange={setSelectedBackend}
              lastUsedBackend={lastUsedBackend}
              hintsEnabled={hintsEnabled}
              onHintsToggle={setHintsEnabled}
              maxLives={devMaxLives}
              onMaxLivesChange={handleMaxLivesChange}
              isGenerating={isGenerating}
              generationProgress={generationProgress}
              onGenerate={handleDevSeedGenerate}
              onLoadDaily={handleLoadDaily}
              onStopGeneration={handleStopGeneration}
              onClose={() => setShowDevTools(false)}
              canStopGeneration={!!generationAbortRef.current}
              closenessThreshold={closenessThreshold}
              onClosenessThresholdChange={setClosenessThreshold}
            />
          )}

          <div className={styles.gameCluster}>
            {/* GameUI - invisible when View Result modal is showing, fades in after */}
            <div className={`${styles.gameUiWrapper} ${(previousResult && !isPlaying && !showInlineResult && !showShareCard) ? styles.gameUiHidden : ''} ${showMenu ? styles.blurred : ''}`}>
              <GameUI
                puzzleNumber={puzzleNumber}
                puzzleLabel={puzzleLabel ?? undefined}
                optimalMoves={displayOptimalMoves}
                variant="header"
                hidePuzzleNumber={true}
                initialState={initialStats ?? undefined}
                frozen={isPostGame || !hasPuzzle}
                maxLives={devMaxLives}
                hintsEnabled={hintsEnabled}
                onReviewAttempt={setReviewAttemptIndex}
                reviewAttemptIndex={reviewAttemptIndex}
                loading={(!hasPuzzle && !initialStats) || !isIdentityChecked || (!!previousResult && !initialStats)}
                analysisAnimationComplete={analysisAnimationComplete}
                isResultModalActive={showShareCard}
              />
            </div>

            <div ref={gameStageRef} className={styles.gameArea}>
              <div
                ref={gameFrameRef}
                className={`${styles.gameFrame} ${shouldBlur ? styles.gameFrameBlurred : ''} ${showLoader ? styles.gameFrameLoading : ''}`}
              >
                {puzzle && (
                  <PhaserGame
                    key={renderKey}
                    puzzle={puzzle}
                    viewportWidth={baseWidth}
                    viewportHeight={baseHeight}
                    onReady={handleGameReady}
                  />
                )}

                {/* Loading Overlay */}
                {showLoader && (
                  <div className={`${styles.frameLoader} ${showMenu ? styles.blurred : ''}`}>
                    <Loader
                      text={loadingText}
                      progress={isGenerating ? progressPercent : undefined}
                    />
                  </div>
                )}

                {/* Game overlays - only shown when game is ready and loader is hidden */}
                {puzzle && isGameReady && isIdentityChecked && (
                  <>
                    <div className={`${styles.darkOverlay} ${shouldBlur ? styles.darkOverlayVisible : ''}`} />
                    {lifeFlash && <div className={styles.lifeFlash} />}
                    {!isPlaying && !showInlineResult && !showShareCard && (
                      <div
                        className={`${styles.startOverlay} ${showMenu ? styles.blurred : ''}`}
                        onClick={previousResult ? handleViewResult : undefined}
                      >
                        {previousResult ? (
                          <div className={styles.previousResult} onClick={(e) => e.stopPropagation()}>
                            <p className={styles.previousResultTitle}>
                              {previousResult.completed
                                ? 'You completed today\u2019s puzzle!'
                                : 'You already played today\u2019s puzzle!'}
                            </p>
                            <div className={styles.previousResultStats}>
                              <div className={styles.previousResultAttempts}>
                                <span className={styles.previousResultAttemptsValue}>
                                  {previousResult.failed
                                    ? 'DNF'
                                    : `${previousResult.attemptsUsed ?? (previousResult.attempts?.length ?? 0) + 1}/${devMaxLives}`}
                                </span>
                                <span className={styles.previousResultAttemptsLabel}>tries</span>
                              </div>
                              <div className={styles.previousResultCharacter}>
                                {previousResult.completed ? (
                                  <svg viewBox="0 -16 64 80" className={styles.previousResultCharacterSvg}>
                                    {/* Shadow */}
                                    <ellipse cx="32" cy="48" rx="32" ry="12" fill="black" fillOpacity="0.25" />
                                    {/* Body */}
                                    <rect x="16" y="12" width="32" height="36" rx="6" fill="#FF4D4D" stroke="#CC0000" strokeWidth="2.5" />
                                    {/* Eyes */}
                                    <circle cx="26" cy="24" r="6" fill="white" />
                                    <circle cx="38" cy="24" r="6" fill="white" />
                                    {/* Pupils */}
                                    <circle cx="28" cy="24" r="3" fill="black" />
                                    <circle cx="40" cy="24" r="3" fill="black" />
                                    {/* Crown */}
                                    <g className={styles.crownGroup}>
                                      <path
                                        d="M16 12 L16 0 L24 8 L32 0 L40 8 L48 0 L48 12 Z"
                                        fill="#FFE082"
                                        stroke="#FFE082"
                                        strokeWidth="8"
                                        strokeLinejoin="round"
                                        transform="translate(0, -6)"
                                        className={styles.crownGlow}
                                        filter="url(#softGlowOverlay)"
                                      />
                                      <path
                                        d="M16 12 L16 0 L24 8 L32 0 L40 8 L48 0 L48 12 Z"
                                        fill="#FFD700"
                                        stroke="#DAA520"
                                        strokeWidth="1.5"
                                        strokeLinejoin="round"
                                        transform="translate(0, -6)"
                                      />
                                    </g>
                                    <defs>
                                      <filter id="softGlowOverlay" x="-100%" y="-100%" width="300%" height="300%">
                                        <feGaussianBlur stdDeviation="6" result="coloredBlur" />
                                      </filter>
                                    </defs>
                                  </svg>
                                ) : (
                                  <svg viewBox="0 0 64 64" className={styles.previousResultCharacterSvg}>
                                    {/* Shadow */}
                                    <ellipse cx="32" cy="48" rx="32" ry="12" fill="black" fillOpacity="0.25" />
                                    {/* Body */}
                                    <rect x="16" y="12" width="32" height="36" rx="6" fill="#FF4D4D" stroke="#CC0000" strokeWidth="2.5" />
                                    {/* Dead Eyes (X shapes) */}
                                    <path d="M22 20 L30 28 M30 20 L22 28" stroke="white" strokeWidth="3" strokeLinecap="round" />
                                    <path d="M34 20 L42 28 M42 20 L34 28" stroke="white" strokeWidth="3" strokeLinecap="round" />
                                  </svg>
                                )}
                              </div>
                              <div className={styles.previousResultTimeBlock}>
                                <span className={styles.previousResultTimeValue}>
                                  {formatTime(previousResult.timeMs ?? 0)}
                                </span>
                                <span className={styles.previousResultTimeLabel}>time</span>
                              </div>
                            </div>
                            <div className={styles.previousResultActions}>
                              <button onClick={handleViewResult} className={styles.viewResultButtonFull}>
                                View Result
                              </button>
                              <button
                                onClick={handleShowShareCard}
                                className={styles.shareButton}
                              >
                                Share
                              </button>
                            </div>
                            <p className={styles.previousResultCountdown}>
                              Next puzzle in {formatCountdown(nextPuzzleCountdown)}
                            </p>
                          </div>
                        ) : (
                          <button
                            className={`${styles.tapToPlayOverlay} ${tapToPlayHeld ? styles.tapToPlayHeld : ''}`}
                            onClick={handleBegin}
                            onPointerDown={() => {
                              tapToPlayHeldTimer.current = window.setTimeout(() => setTapToPlayHeld(true), 120);
                            }}
                            onPointerUp={() => {
                              clearTimeout(tapToPlayHeldTimer.current);
                              setTapToPlayHeld(false);
                            }}
                            onPointerCancel={() => {
                              clearTimeout(tapToPlayHeldTimer.current);
                              setTapToPlayHeld(false);
                            }}
                          >
                            Tap to Play
                          </button>
                        )}
                      </div>
                    )}
                    {/* Replay Solution overlay button - fades in after analysis completes */}
                    {showInlineResult && showReplayButton && !showShareCard && !showMenu && reviewAttemptIndex === null && (
                      <button
                        className={`${styles.replaySolutionOverlay} ${replayHeld ? styles.replaySolutionHeld : ''}`}
                        onClick={handleReplayAnalysis}
                        onPointerDown={() => {
                          replayHeldTimer.current = window.setTimeout(() => setReplayHeld(true), 120);
                        }}
                        onPointerUp={() => {
                          clearTimeout(replayHeldTimer.current);
                          setReplayHeld(false);
                        }}
                        onPointerCancel={() => {
                          clearTimeout(replayHeldTimer.current);
                          setReplayHeld(false);
                        }}
                      >
                        Replay Solution
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className={`${styles.controlsArea} ${showMenu ? styles.blurred : ''}`}>
              {/* Controls row - for daily (post-game) or recent mode (always) */}
              {(showControlsRow || isRecentMode) && !showShareCard && (
                <div
                  className={`${styles.controlsRow} ${styles.controlsRowVisible}`}
                >
                  {isRecentMode ? (
                    <>
                      {!isPlaying && !hasPendingRestore && (
                        <button
                          className={styles.backToDailyButton}
                          onClick={returnToDaily}
                        >
                          ← Today
                        </button>
                      )}
                      {showControlsRow && (
                        <button
                          className={styles.shareButton}
                          onClick={handleShowShareCard}
                        >
                          Share
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <button
                        className={styles.iconButton}
                        onClick={() => setShowLeaderboard(true)}
                        aria-label="Leaderboard"
                        title="Leaderboard"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 21V10h6V3h6v4h6v14H3zM9 10v11M15 7v14" />
                        </svg>
                      </button>
                      <button
                        className={styles.shareButton}
                        onClick={handleShowShareCard}
                      >
                        Share
                      </button>
                      <button
                        className={styles.iconButton}
                        onClick={() => {
                          setStats(getPlayerStats());
                          setShowStats(true);
                        }}
                        aria-label="Statistics"
                        title="Statistics"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 3v18h18" />
                          <path d="M18 17V9" />
                          <path d="M13 17V5" />
                          <path d="M8 17v-3" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              )}
              {showSwipeHint && (
                <div className={styles.swipeHint} onAnimationEnd={() => setShowSwipeHint(false)}>
                  Swipe anywhere to move
                </div>
              )}
            </div>
          </div>

          {isPostGame && <AdSlot placement="postGame" />}
        </div>

        {showBottomAd && (
          <div
            ref={adBottomRef}
            className={`${styles.adBanner} ${styles.adBannerBottom} ${adStatus.bottom === 'unfilled' ? styles.adCollapsed : (!isAdVisible(adStatus.bottom) ? styles.adHidden : '')}`}
            role="complementary"
            aria-label="Advertisement"
          >
            <AdSlot
              slot={ADSENSE_BOTTOM_SLOT}
              className={styles.adBannerSlot}
              format="horizontal"
              responsive={true}
              enabled={canRequestAds}
              onSlotStatus={(status) =>
                setAdStatus((prev) => (prev.bottom === status ? prev : { ...prev, bottom: status }))
              }
            />
          </div>
        )}

        <footer className={styles.footer}>
          <p>
            <span className={styles.footerTextDesktop}>Use arrow keys or swipe to move</span>
          </p>
          <p className={styles.footerLinks}>
            <a href="/about">About</a>
            <span>·</span>
            <a href="/privacy">Privacy</a>
          </p>
        </footer>

        {/* Modals */}
        <MoreMenuModal
          open={showMenu}
          onClose={() => setShowMenu(false)}
          onOpenStats={() => {
            setStats(getPlayerStats());
            setShowStats(true);
          }}
          onOpenLeaderboard={() => setShowLeaderboard(true)}
          onOpenHallOfFame={() => setShowHallOfFame(true)}
          onOpenAccount={() => setShowAccount(true)}
          onOpenRecentPuzzles={() => {
            setStats(getPlayerStats());
            setShowRecentPuzzles(true);
          }}
          triggerButtonRef={menuButtonRef}
        />

        <OverlayShell
          title="Leaderboard"
          variant="overlay"
          onClose={() => setShowLeaderboard(false)}
          open={showLeaderboard}
        >
          <LeaderboardView />
          <AdSlot placement="leaderboard" />
        </OverlayShell>

        {showHallOfFame && (
          <OverlayShell
            title="Hall of Fame"
            subtitle="Podium history"
            variant="overlay"
            onClose={() => setShowHallOfFame(false)}
          >
            <HallOfFameView />
            <AdSlot placement="leaderboard" />
          </OverlayShell>
        )}

        {showAccount && (
          <OverlayShell
            title="Account"
            // subtitle="Name, sign-in, settings"
            variant="overlay"
            onClose={() => setShowAccount(false)}
          >
            <AccountView />
            <AdSlot placement="account" />
          </OverlayShell>
        )}

        {showShareCard && gameResult && puzzle && (
          <ShareCard
            puzzleNumber={puzzleNumber}
            puzzleLabel={puzzleLabel ?? undefined}
            analyticsDate={isRecentMode ? undefined : todayNy}
            timeMs={gameResult.timeMs}
            optimalMoves={puzzle.optimalMoves}
            failed={gameResult.failed}
            attempts={gameResult.attempts}
            maxLives={devMaxLives}
            onClose={handleCloseShareCard}
            countdownText={isRecentMode ? undefined : `Next puzzle in ${formatCountdown(nextPuzzleCountdown)}`}
            secondaryActionLabel={isRecentMode ? 'Back to Today' : 'Recent Puzzles'}
            onSecondaryAction={
              isRecentMode
                ? returnToDaily
                : () => {
                  setStats(getPlayerStats());
                  setShowRecentPuzzles(true);
                }
            }
            footerText={
              isRecentMode
                ? 'Today’s puzzle is waiting.'
                : `Play the last ${RECENT_PUZZLE_DAYS} days of puzzles`
            }
          />
        )}

        {showRecentPuzzles && stats && (
          <RecentPuzzlesModal
            stats={stats}
            accountHistory={accountMe?.mode === 'user' ? (statsAccountHistory ?? []) : null}
            onClose={() => setShowRecentPuzzles(false)}
            onPlay={loadRecentPuzzle}
            onShare={(result) => {
              setRecentShareResult(result);
              // Don't close modal - ShareCard will appear on top
            }}
            dailyInProgress={!previousResult && (hasPendingRestore || isPlaying)}
          />
        )}

        {recentShareResult && (
          <div style={{ position: 'relative', zIndex: 1001 }}>
            <ShareCard
              puzzleNumber={recentShareResult.puzzleNumber}
              timeMs={recentShareResult.timeMs}
              optimalMoves={recentShareResult.optimalMoves ?? 10}
              failed={recentShareResult.failed}
              attempts={recentShareResult.attempts}
              maxLives={recentShareResult.attemptsUsed ? Math.max(DEFAULT_LIVES, recentShareResult.attemptsUsed) : DEFAULT_LIVES}
              onClose={() => setRecentShareResult(null)}
            />
          </div>
        )}

        {IS_UI_DEV_ENV && (
          <UiDevModal
            open={showUiDevModal}
            onClose={() => setShowUiDevModal(false)}
            onOpenStats={() => {
              setStats(getPlayerStats());
              setShowStats(true);
              setShowUiDevModal(false);
            }}
            onOpenAccount={() => {
              setShowAccount(true);
              setShowUiDevModal(false);
            }}
            onOpenLeaderboard={() => {
              setShowLeaderboard(true);
              setShowUiDevModal(false);
            }}
            onOpenHallOfFame={() => {
              setShowHallOfFame(true);
              setShowUiDevModal(false);
            }}
            onApplyTodayResult={(kind) => applyTodayResultForUiDev(kind)}
          />
        )}

        {showStats && stats && (
          <StatsModal stats={stats} me={statsMe} accountHistory={statsAccountHistory} onClose={() => setShowStats(false)} />
        )}

        {showHelp && <HelpModal onClose={() => setShowHelp(false)} hintsEnabled={hintsEnabled} />}
      </main>
    </ErrorBoundary>
  );
}
