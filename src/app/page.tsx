'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { Header, GameUI, ShareCard, StatsModal, HelpModal, ErrorBoundary, Loader, DevTools } from '@/components';
import { HELP_MENU_HASH } from '@/components/helpMenuHash';
import MoreMenuModal from '@/components/MoreMenuModal';
import AdSlot from '@/components/AdSlot';
import { api } from '@/lib/api';
import { getPrefs } from '@/lib/prefs';
import {
  CHEAT_TIMEOUT_MS,
  CHEAT_CODE_LENGTH,
  TAP_COUNT_THRESHOLD,
  TAP_WINDOW_MS,
  GAME_BUFFER_PX,
  STORAGE_KEYS,
  isCheatCode,
} from '@/constants';
import {
  getPuzzleNumber,
  getNewYorkDateString,
  onGameEvent,
  PuzzleData,
  MapType,
  generatePuzzleParallel,
  cancelRustRequest,
  fetchDailyPuzzle,
  getDailySeed,
  GenerationProgress,
  GeneratorBackend,
  preloadWasm,
  TILE_SIZE,
} from '@/game';
import { getPlayerStats, saveTodaysResult, getTodaysResult, getCachedPuzzle, cachePuzzle, saveInProgressState, getInProgressState, clearInProgressState } from '@/utils/storage';
import { PlayerStats, DailyStats } from '@/game/types';
import type { Direction } from '@/game/types';
import type { GameControls } from '@/game/PhaserGame';
import { useGlobalSwipeMoves } from '@/game/useGlobalSwipeMoves';
import styles from './page.module.css';

// Dynamic import for Phaser (client-side only)
const PhaserGame = dynamic(() => import('@/game/PhaserGame'), {
  ssr: false,
  loading: () => (
    <div className={styles.loading}>
      <Loader text="Loading puzzle..." />
    </div>
  ),
});

// Keep for potential future use (e.g., auto-enable in dev builds)
const _DEVTOOLS_BUILD_FLAG =
  process.env.NEXT_PUBLIC_DEVTOOLS_ENABLED === '1' ||
  process.env.NEXT_PUBLIC_DEVTOOLS_ENABLED === 'true';

const HELP_SEEN_KEY = `mazle_seen_help_${HELP_MENU_HASH}`;

export default function Home() {
  const pathname = usePathname();
  const [puzzle, setPuzzle] = useState<PuzzleData | null>(null);
  const [puzzleNumber, setPuzzleNumber] = useState(0);
  const [puzzleLabel, setPuzzleLabel] = useState<string | null>(null);
  const [activeSeed, setActiveSeed] = useState('');
  const [seedInput, setSeedInput] = useState('');
  const [selectedMapType, setSelectedMapType] = useState<MapType | 'random'>('random');
  const [renderKey, setRenderKey] = useState(0);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [showShareCard, setShowShareCard] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showDevTools, setShowDevTools] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [selectedBackend, setSelectedBackend] = useState<GeneratorBackend>('auto');
  const [lastUsedBackend, setLastUsedBackend] = useState<'rust-backend' | 'wasm' | null>(null);
  const [gameResult, setGameResult] = useState<{ moveCount: number; timeMs: number; failed?: boolean; attempts?: any[] } | null>(null);
  const [previousResult, setPreviousResult] = useState<DailyStats | null>(null);
  const [isGameReady, setIsGameReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [showInlineResult, setShowInlineResult] = useState(false);
  const [hintsEnabled, setHintsEnabled] = useState(true);
  const [lifeFlash, setLifeFlash] = useState(false);
  const [hasPendingRestore, setHasPendingRestore] = useState(false);
  const [initialStats, setInitialStats] = useState<{
    lives?: number;
    currentAttemptMoves?: number;
    elapsedTimeMs?: number;
    penaltyTimeMs?: number;
  } | null>(null);
  const [startBatchInput, setStartBatchInput] = useState('');
  const gameControlsRef = useRef<GameControls | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const inFlightSeedRef = useRef<string | null>(null);
  const debugModeRef = useRef(false);
  const cheatBufferRef = useRef('');
  const cheatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const gameFrameRef = useRef<HTMLDivElement | null>(null);
  const gameStageRef = useRef<HTMLDivElement | null>(null);
  const hintsPrefLoadedRef = useRef(false);
  const [gameFrameSizePx, setGameFrameSizePx] = useState<{ width: number; height: number } | null>(null);
  const tapTimestampsRef = useRef<number[]>([]);
  const lastDevToolsTouchTsRef = useRef<number>(0);
  const devToolsTapTargetRef = useRef<HTMLDivElement | null>(null);
  const pendingRestoreRef = useRef<Parameters<GameControls['restoreState']>[0] | null>(null);
  const hintsEnabledRef = useRef(hintsEnabled);

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

  const puzzleWidth = puzzle?.width ?? 10;
  const puzzleHeight = puzzle?.height ?? 10;
  const baseWidth = puzzleWidth * TILE_SIZE + GAME_BUFFER_PX * 2;
  const baseHeight = puzzleHeight * TILE_SIZE + GAME_BUFFER_PX * 2;

  const isRouteOverlayOpen = pathname !== '/';
  const isModalOpen = showHelp || showStats || showShareCard || showDevTools || showMenu;
  const shouldPause = isRouteOverlayOpen || isModalOpen;

  useEffect(() => {
    gameControlsRef.current?.setPaused?.(shouldPause);
  }, [shouldPause]);

  // Size the maze frame to the *actual available* game area so it can't expand underneath
  // the header/footer when the viewport is short or zoomed.
  useEffect(() => {
    const stage = gameStageRef.current;
    if (!stage) return;

    let rafId: number | null = null;
    const update = () => {
      const computedStyle = window.getComputedStyle(stage);
      const paddingX =
        parseFloat(computedStyle.paddingLeft || '0') + parseFloat(computedStyle.paddingRight || '0');
      const paddingY =
        parseFloat(computedStyle.paddingTop || '0') + parseFloat(computedStyle.paddingBottom || '0');

      const availableWidth = stage.clientWidth - paddingX;
      const availableHeight = stage.clientHeight - paddingY;
      if (availableWidth <= 0 || availableHeight <= 0) return;

      const scale = Math.min(1, availableWidth / baseWidth, availableHeight / baseHeight);
      const width = Math.max(1, Math.floor(baseWidth * scale));
      const height = Math.max(1, Math.floor(baseHeight * scale));

      setGameFrameSizePx((prev) => {
        if (prev && prev.width === width && prev.height === height) return prev;
        return { width, height };
      });
    };

    const scheduleUpdate = () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        update();
      });
    };

    scheduleUpdate();
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(stage);
    window.visualViewport?.addEventListener('resize', scheduleUpdate);
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.visualViewport?.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [baseWidth, baseHeight]);

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
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (cheatTimeoutRef.current) {
        clearTimeout(cheatTimeoutRef.current);
      }
    };
  }, []);

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
    const playerStats = getPlayerStats();
    const existingResult = getTodaysResult();

    // Set initial state immediately so UI renders
    debugModeRef.current = false;
    setPuzzleNumber(todayNumber);
    setPuzzleLabel(null);
    setActiveSeed(todaySeed);
    setSeedInput('');
    setStats(playerStats);
    setPreviousResult(existingResult);
    console.log('[LOAD] Loaded previousResult:', existingResult);
    setShowShareCard(false);
    setShowInlineResult(false);
    setIsPlaying(false);

    // Helper to set scoreboard stats for a finished game once we have the puzzle.
    const setResultStats = (optimalMoves: number) => {
      if (!existingResult) return;
      const failed = existingResult.failed ?? !existingResult.completed;
      const failedAttempts = existingResult.attempts?.length ?? 0;
      const livesRemaining = failed ? 0 : 3 - failedAttempts;
      setInitialStats({
        lives: livesRemaining,
        currentAttemptMoves: optimalMoves, // Shows 0 moves remaining
        elapsedTimeMs: existingResult.timeMs,
        penaltyTimeMs: 0, // Already included in timeMs
      });
    };

    if (existingResult) {
      setGameResult({
        moveCount: existingResult.moveCount,
        timeMs: existingResult.timeMs,
        attempts: existingResult.attempts,
        failed: existingResult.failed ?? !existingResult.completed,
      });
      // initialStats will be set after puzzle loads (need optimalMoves)
      // Keep overlay prompt; let user choose to view results
      setShowShareCard(false);
      setShowInlineResult(false);
      setIsPlaying(false);
    } else {
      setGameResult(null);

      // Check for in-progress state (mid-game refresh resume)
      const inProgressState = getInProgressState(todaySeed);
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
      } else {
        pendingRestoreRef.current = null;
        setHasPendingRestore(false);
        setInitialStats(null);
      }
    }

    // Check localStorage cache first for instant loading (same-day revisit)
    const cachedPuzzle = getCachedPuzzle(todaySeed);
    if (cachedPuzzle) {
      setPuzzle(cachedPuzzle);
      setResultStats(cachedPuzzle.optimalMoves);
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
      setResultStats(todayPuzzle.optimalMoves);
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

  // Initialize puzzle and stats - use requestAnimationFrame to ensure first paint
  useEffect(() => {
    // Prevent duplicate calls from React Strict Mode
    if (loadInitiatedRef.current) return;
    loadInitiatedRef.current = true;

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
      setShowShareCard(true);
      setIsPlaying(false); // Ensure game is marked as not playing to show blocked state

      // Set initialStats so scoreboard stays frozen at completion state
      const failedAttempts = result.attempts?.length ?? 0;
      const livesRemaining = result.failed ? 0 : 3 - failedAttempts;
      setInitialStats({
        lives: livesRemaining,
        currentAttemptMoves: result.optimalMoves, // 0 moves remaining
        elapsedTimeMs: result.timeMs,
        penaltyTimeMs: 0, // Already included in timeMs
      });

      // Clear in-progress state since game is complete
      clearInProgressState();

      if (debugModeRef.current) {
        return;
      }

      // Save result if not already saved today
      if (!previousResult) {
        console.log('[SAVE] Saving daily result:', result);
        const todayDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        const dailyResult: DailyStats = {
          date: todayDateStr,
          completed: !result.failed,
          moveCount: result.moveCount,
          timeMs: result.timeMs,
          puzzleNumber,
          attempts: result.attempts,
          failed: result.failed,
        };
        saveTodaysResult(dailyResult);
        setStats(getPlayerStats());
        setPreviousResult(dailyResult);
        console.log('[SAVE] Result saved, previousResult updated');

        if (!result.failed && getPrefs().leaderboardAutoSubmitWins) {
          const failedAttempts = result.attempts?.length ?? 0;
          const attemptsUsed = Math.min(3, Math.max(1, failedAttempts + 1));
          api.leaderboardSubmit({ date: todayDateStr, timeMs: result.timeMs, attemptsUsed }).catch(() => {
            // Ignore: manual submit remains available via the leaderboard overlay.
          });
        }
      } else {
        console.log('[SAVE] Skipped - previousResult already exists:', previousResult);
      }
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
    const persistInProgressState = () => {
      // Only save if we're in the daily puzzle (not debug mode) and game hasn't completed
      if (debugModeRef.current || previousResult) return;

      const state = gameControlsRef.current?.getSerializableState();
      if (state && state.isPlaying && activeSeed) {
        saveInProgressState(activeSeed, state);
      }
    };
    const unsubscribeStateUpdate = onGameEvent('stateUpdate', persistInProgressState);

    // Also persist while idle and when backgrounding/unloading so elapsed time doesn't jump backwards.
    const intervalId = window.setInterval(persistInProgressState, 5000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistInProgressState();
      }
    };
    const handlePageHide = () => {
      persistInProgressState();
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
  }, [puzzleNumber, previousResult, activeSeed]);

  const handleRestart = useCallback(() => {
    setIsPlaying(false);
    gameControlsRef.current?.restart();
    setShowShareCard(false);
  }, []);

  const handleBegin = useCallback(() => {
    setIsPlaying(true);
    gameControlsRef.current?.start();
  }, []);

  const handleDevSeedGenerate = useCallback(
    async (rawSeed?: string) => {
      const trimmed = rawSeed?.trim() ?? '';
      const isDateSeed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
      const forceMapType = selectedMapType === 'random' ? undefined : selectedMapType;
      const startBatch = startBatchInput ? parseInt(startBatchInput, 10) : undefined;
      const abortController = new AbortController();

      // Abort any previous in-flight generation to avoid duplicate work
      if (generationAbortRef.current && !generationAbortRef.current.signal.aborted) {
        generationAbortRef.current.abort();
      }
      generationAbortRef.current = abortController;

      // Track which seed this request is for (used by Stop button)
      const requestSeed = isDateSeed
        ? getDailySeed(new Date(trimmed))
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

        const targetDate = new Date(trimmed);
        const dailySeed = requestSeed;

        try {
          const datedPuzzle = await generatePuzzleParallel(
            dailySeed,
            progressHandler,
            forceMapType,
            selectedBackend,
            startBatch,
            abortController,
          );
          debugModeRef.current = true;
          setPuzzle(datedPuzzle);
          setPuzzleNumber(getPuzzleNumber(targetDate));
          setPuzzleLabel(`DATE ${trimmed}`);
          setActiveSeed(dailySeed);
          setSeedInput(trimmed);
          setGameResult(null);
          setShowShareCard(false);
          setShowInlineResult(false);
          setPreviousResult(null);
          setInitialStats(null);
          setIsPlaying(false);
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
          forceMapType,
          selectedBackend,
          startBatch,
          abortController,
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
    [selectedMapType, selectedBackend, startBatchInput],
  );

  const handleLoadDaily = useCallback(() => {
    loadDailyPuzzle();
  }, [loadDailyPuzzle]);

  const showAnalysis = useCallback(() => {
    const attempts = gameResult?.attempts ?? previousResult?.attempts;
    if (attempts && gameControlsRef.current) {
      gameControlsRef.current.showAnalysis(attempts);
    }
  }, [gameResult?.attempts, previousResult?.attempts]);

  const handleGameReady = useCallback((controls: GameControls) => {
    gameControlsRef.current = controls;
    setIsGameReady(true);
    controls.setHintsEnabled(hintsEnabledRef.current);
    controls.setPaused(shouldPause);

    // Show help on first visit
    try {
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

  const handleViewResult = useCallback(() => {
    // Show analysis on the map; share card can be opened from the bottom button
    showAnalysis();
    setShowInlineResult(true);
    setIsPlaying(false);
    setShowShareCard(false);
  }, [showAnalysis]);

  const handleShowShareCard = useCallback(() => {
    showAnalysis();
    setShowInlineResult(true);
    setIsPlaying(false);
    setShowShareCard(true);
  }, [showAnalysis]);

  const handleStopGeneration = useCallback(() => {
    const controller = generationAbortRef.current;
    const seedToCancel = inFlightSeedRef.current || activeSeed;
    if (!controller || !seedToCancel) {
      return;
    }

    // Only cancel if no other same-seed requests are in-flight (handled in wasmGenerator)
    const didCancel = cancelRustRequest(seedToCancel);
    if (didCancel) {
      console.log('[Dev] Stopping generation request (client abort)');
      controller.abort();
      // Ask backend to cancel compute if we're the only waiter
      fetch(`/api/generate/${encodeURIComponent(seedToCancel)}/cancel`, {
        method: 'POST',
      }).catch((err) => console.warn('[Dev] Backend cancel request failed', err));
      setIsGenerating(false);
      setGenerationProgress(null);
      generationAbortRef.current = null;
    } else {
      console.log('[Dev] Cancel skipped; another request for this seed is in-flight');
    }
  }, [activeSeed]);

  const handleCloseShareCard = useCallback(() => {
    // Hide the share card but keep inline analysis visible
    setShowShareCard(false);
    setShowInlineResult(true);
    showAnalysis();
  }, [showAnalysis]);

  // Calculate progress percentage (works for both loading screen and dev tools)
  const progressPercent = generationProgress
    ? Math.round((generationProgress.workersComplete / generationProgress.totalWorkers) * 100)
    : 0;

  if (!puzzle) {
    return (
      <main className={`${styles.main} bg-pattern`} style={{ justifyContent: 'center' }}>
        <Loader
          text={isGenerating ? 'Generating daily puzzle...' : 'Loading Mazle...'}
          progress={isGenerating ? progressPercent : undefined}
        />
      </main>
    );
  }

  const isPostGame = !isPlaying && (!!gameResult || !!previousResult);
  const shouldBlur = showShareCard || (!isPlaying && isGameReady && !showInlineResult);
  const showResultsButton = showInlineResult;

  return (
    <ErrorBoundary>
      <main className={`${styles.main} bg-pattern`}>
        <Header
          streak={stats?.currentStreak || 0}
          onHelpClick={() => setShowHelp(true)}
          onStatsClick={() => setShowStats(true)}
          onMenuClick={() => setShowMenu(true)}
          logoRef={devToolsTapTargetRef}
          logoClassName={styles.devToolsTapTarget}
        />

        <div className={styles.gameWrapper}>
          {showDevTools && (
            <DevTools
              puzzle={puzzle}
              puzzleNumber={puzzleNumber}
              puzzleLabel={puzzleLabel}
              activeSeed={activeSeed}
              seedInput={seedInput}
              onSeedInputChange={setSeedInput}
              selectedMapType={selectedMapType}
              onMapTypeChange={setSelectedMapType}
              startBatchInput={startBatchInput}
              onStartBatchInputChange={setStartBatchInput}
              selectedBackend={selectedBackend}
              onBackendChange={setSelectedBackend}
              lastUsedBackend={lastUsedBackend}
              hintsEnabled={hintsEnabled}
              onHintsToggle={setHintsEnabled}
              isGenerating={isGenerating}
              generationProgress={generationProgress}
              onGenerate={handleDevSeedGenerate}
              onLoadDaily={handleLoadDaily}
              onStopGeneration={handleStopGeneration}
              onClose={() => setShowDevTools(false)}
              canStopGeneration={!!generationAbortRef.current}
            />
          )}

          {/* Puzzle Number - separate from stats for better spacing */}
          <div className={styles.puzzleNumberBanner}>
            <span className={styles.puzzleNumberText}>
              {puzzleLabel ?? `#${puzzleNumber}`}
            </span>
          </div>


          {/* Only show stats when game is ready (avoids flash of default values during restore) */}
          {(!hasPendingRestore || isGameReady) && (
            <GameUI
              puzzleNumber={puzzleNumber}
              puzzleLabel={puzzleLabel ?? undefined}
              optimalMoves={puzzle.optimalMoves}
              variant="header"
              hidePuzzleNumber={true}
              initialState={initialStats ?? undefined}
              frozen={isPostGame}
            />
          )}

          <div ref={gameStageRef} className={styles.gameArea}>
            <div
              ref={gameFrameRef}
              className={styles.gameFrame}
              style={{
                width: gameFrameSizePx ? `${gameFrameSizePx.width}px` : undefined,
                height: gameFrameSizePx ? `${gameFrameSizePx.height}px` : undefined,
              }}
            >
              <PhaserGame
                key={renderKey}
                puzzle={puzzle}
                viewportWidth={baseWidth}
                viewportHeight={baseHeight}
                onReady={handleGameReady}
              />
              <div className={`${styles.blurOverlay} ${!shouldBlur ? styles.blurOverlayHidden : ''}`} />
              {lifeFlash && <div className={styles.lifeFlash} />}
              {!isPlaying && isGameReady && !showInlineResult && !showShareCard && (
                <div className={styles.startOverlay}>
                  {previousResult ? (
                    <div className={styles.previousResult}>
                      <p>
                        {previousResult.completed
                          ? 'You already completed today\u2019s puzzle!'
                          : 'You already played today\u2019s puzzle!'}
                      </p>
                      <button onClick={handleViewResult} className={styles.viewResultButton}>
                        View Result
                      </button>
                    </div>
                  ) : (
                    <button className={styles.startButton} onClick={handleBegin}>
                      Begin
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className={styles.controlsArea}>
            <button
              className={styles.shareButton}
              onClick={handleShowShareCard}
              style={{
                visibility: showResultsButton ? 'visible' : 'hidden',
                opacity: showResultsButton ? 1 : 0,
                transform: showResultsButton ? 'scale(1)' : 'scale(0.9)',
                pointerEvents: showResultsButton ? 'auto' : 'none',
              }}
            >
              Share Score
            </button>
          </div>

          {isPostGame && <AdSlot placement="postGame" />}
        </div>

        <footer className={styles.footer}>
          <p>Use arrow keys or swipe to move</p>
        </footer>

        {/* Modals */}
        <MoreMenuModal open={showMenu} onClose={() => setShowMenu(false)} />

        {showShareCard && gameResult && (
          <ShareCard
            puzzleNumber={puzzleNumber}
            puzzleLabel={puzzleLabel ?? undefined}
            moveCount={gameResult.moveCount}
            timeMs={gameResult.timeMs}
            optimalMoves={puzzle.optimalMoves}
            failed={gameResult.failed}
            attempts={gameResult.attempts}
            mapType={puzzle.mapType}
            leaderboardDate={!debugModeRef.current ? getNewYorkDateString() : undefined}
            onClose={handleCloseShareCard}
          />
        )}

        {showStats && stats && (
          <StatsModal stats={stats} onClose={() => setShowStats(false)} />
        )}

        {showHelp && <HelpModal onClose={() => setShowHelp(false)} hintsEnabled={hintsEnabled} />}
      </main>
    </ErrorBoundary>
  );
}
