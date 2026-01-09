'use client';

import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Header, GameUI, ShareCard, StatsModal, HelpModal, ErrorBoundary, Loader, DevTools, AdSlot } from '@/components';
import { HELP_MENU_HASH } from '@/components/helpMenuHash';
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
} from '@/constants';
import {
  getPuzzleNumber,
  getPuzzleNumberFromNyDateString,
  getNewYorkDateString,
  onGameEvent,
  PuzzleData,
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
import { useAdConsent } from '@/utils/consent';
import type { PlayerStats, DailyStats, GameState, Direction } from '@/game/types';
import type { GameControls } from '@/game/PhaserGame';
import { useGlobalSwipeMoves } from '@/game/useGlobalSwipeMoves';
import styles from './page.module.css';

// Dynamic import for Phaser (client-side only)
const PhaserGame = dynamic(() => import('@/game/PhaserGame'), {
  ssr: false,
  loading: () => null,
});

// Keep for potential future use (e.g., auto-enable in dev builds)
const _DEVTOOLS_BUILD_FLAG =
  process.env.NEXT_PUBLIC_DEVTOOLS_ENABLED === 'true';

const IS_PROD = process.env.NEXT_PUBLIC_ENV === 'prod';
const HELP_SEEN_KEY = `mazle_seen_help_${HELP_MENU_HASH}`;
const ADSENSE_TOP_SLOT = process.env.NEXT_PUBLIC_ADSENSE_SLOT_MOBILE_TOP ?? (!IS_PROD ? 'DEV_TOP' : '');
const ADSENSE_BOTTOM_SLOT = process.env.NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM ?? (!IS_PROD ? 'DEV_BOTTOM' : '');
const AD_BANNER_HEIGHT = 50;

export default function Home() {
  const [puzzle, setPuzzle] = useState<PuzzleData | null>(null);
  const [puzzleNumber, setPuzzleNumber] = useState(0);
  const [puzzleLabel, setPuzzleLabel] = useState<string | null>(null);
  const [activeSeed, setActiveSeed] = useState('');
  const [seedInput, setSeedInput] = useState('');
  const [renderKey, setRenderKey] = useState(0);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [showShareCard, setShowShareCard] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showDevTools, setShowDevTools] = useState(false);
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
  const [devMaxLives, setDevMaxLives] = useState(3);
  const [lifeFlash, setLifeFlash] = useState(false);
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
  const cheatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const gameFrameRef = useRef<HTMLDivElement | null>(null);
  const gameStageRef = useRef<HTMLDivElement | null>(null);
  const adTopRef = useRef<HTMLDivElement | null>(null);
  const adBottomRef = useRef<HTMLDivElement | null>(null);
  const adsReadyTimeoutRef = useRef<number | null>(null);
  const adTimeoutsRef = useRef<{ top?: number; bottom?: number }>({});
  const hintsPrefLoadedRef = useRef(false);
  // Initialize with max maze size to prevent layout shift before useEffect calculates actual size
  const [gameFrameSizePx, setGameFrameSizePx] = useState<{ width: number; height: number }>({ width: 520, height: 520 });
  const tapTimestampsRef = useRef<number[]>([]);
  const lastDevToolsTouchTsRef = useRef<number>(0);
  const devToolsTapTargetRef = useRef<HTMLDivElement | null>(null);
  const pendingRestoreRef = useRef<Parameters<GameControls['restoreState']>[0] | null>(null);
  const hintsEnabledRef = useRef(hintsEnabled);
  const devMaxLivesRef = useRef(devMaxLives);
  const uiScaleRef = useRef<number | null>(null);
  const [liveAttempts, setLiveAttempts] = useState<GameState['attempts']>([]);
  const [reviewAttemptIndex, setReviewAttemptIndex] = useState<number | null>(null);

  // Keep devMaxLivesRef in sync
  useEffect(() => {
    devMaxLivesRef.current = devMaxLives;
  }, [devMaxLives]);

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

  const isModalOpen =
    showHelp || showStats || showShareCard || showDevTools;
  const shouldPause = isModalOpen;

  useEffect(() => {
    gameControlsRef.current?.setPaused?.(shouldPause);
  }, [shouldPause]);

  // Dynamic UI scaling system - maximizes maze size while keeping UI readable
  // The --ui-scale CSS variable controls all UI element sizes
  // useLayoutEffect ensures scale is calculated before paint to prevent layout shift
  useLayoutEffect(() => {
    const getGameAreaSize = () => {
      const node = gameStageRef.current;
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      const styles = window.getComputedStyle(node);
      const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(styles.paddingRight) || 0;
      const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
      const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
      const paddingX = paddingLeft + paddingRight;
      const paddingY = paddingTop + paddingBottom;
      const width = Math.max(0, rect.width - paddingX);
      const height = Math.max(0, rect.height - paddingY);
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    };

    const updateScale = () => {
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const viewportWidth = window.innerWidth;

      // Fixed UI heights at scale=1 (approximate values)
      const HEADER_HEIGHT = 56;      // MAZLE logo + icons
      const PUZZLE_NUM_HEIGHT = 32;  // Puzzle number banner
      const SCOREBOARD_HEIGHT = 70;  // Lives, moves, time row
      const CONTROLS_HEIGHT = 56;    // Share button area
      const FOOTER_HEIGHT = viewportWidth > 768 ? 32 : 0; // Desktop footer
      const AD_HEIGHT = (showTopAd ? AD_BANNER_HEIGHT + 8 : 0) + (showBottomAd ? AD_BANNER_HEIGHT + 8 : 0);
      const PADDING = 24;            // Various padding/gaps

      const totalUIHeight = HEADER_HEIGHT + PUZZLE_NUM_HEIGHT + SCOREBOARD_HEIGHT +
        CONTROLS_HEIGHT + FOOTER_HEIGHT + AD_HEIGHT + PADDING;

      // Available height for the maze
      const availableForMaze = viewportHeight - totalUIHeight;

      // Maximum maze size (don't let it grow infinitely on large screens)
      const MAX_MAZE_SIZE = 520;
      // Scale limits for UI
      const UI_SCALE_MIN = 0.55;
      const UI_SCALE_MAX = 1.0;

      // Calculate ideal maze size (constrained by width too)
      const maxMazeByWidth = Math.max(1, Math.min(viewportWidth - 4, MAX_MAZE_SIZE)); // 2px padding each side
      const idealMazeSize = Math.min(maxMazeByWidth, MAX_MAZE_SIZE);

      // How much height do we need for the ideal maze?
      const neededForIdealMaze = idealMazeSize;

      let uiScale = UI_SCALE_MAX;

      if (availableForMaze < neededForIdealMaze) {
        // Not enough space - try scaling down UI first
        // Calculate how much UI space we can save by scaling
        const uiScalableHeight = HEADER_HEIGHT + PUZZLE_NUM_HEIGHT + SCOREBOARD_HEIGHT + CONTROLS_HEIGHT;

        // How much extra space do we need?
        const deficit = neededForIdealMaze - availableForMaze;

        // How much can we save by scaling UI to minimum?
        const maxUISavings = uiScalableHeight * (1 - UI_SCALE_MIN);

        if (deficit <= maxUISavings) {
          // We can fit the ideal maze by just scaling down UI
          // Calculate the exact scale needed
          uiScale = 1 - (deficit / uiScalableHeight);
          uiScale = Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, uiScale));
        } else {
          // Even at minimum UI scale, we can't fit ideal maze
          // Scale UI to minimum and shrink maze
          uiScale = UI_SCALE_MIN;
        }
      }

      const uiScaleValue = Math.round(uiScale * 1000) / 1000;
      if (uiScaleRef.current !== uiScaleValue) {
        document.documentElement.style.setProperty('--ui-scale', uiScaleValue.toFixed(3));
        uiScaleRef.current = uiScaleValue;
      }

      // Also update maze frame size
      const area = getGameAreaSize();
      const areaScale = area
        ? Math.min(area.width / baseWidth, area.height / baseHeight)
        : 1;
      const maxScale = maxMazeByWidth / baseWidth;
      const finalScale = Math.min(maxScale, areaScale);
      const width = Math.max(1, Math.floor(baseWidth * finalScale));
      const height = Math.max(1, Math.floor(baseHeight * finalScale));

      setGameFrameSizePx((prev) => {
        if (prev.width === width && prev.height === height) return prev;
        return { width, height };
      });
    };

    // Immediate call on mount to set scale before first paint
    updateScale();
    window.visualViewport?.addEventListener('resize', updateScale);
    window.addEventListener('resize', updateScale);
    const gameArea = gameStageRef.current;
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && gameArea
        ? new ResizeObserver(updateScale)
        : null;
    resizeObserver?.observe(gameArea);

    return () => {
      window.visualViewport?.removeEventListener('resize', updateScale);
      window.removeEventListener('resize', updateScale);
      resizeObserver?.disconnect();
    };
  }, [baseWidth, baseHeight, showTopAd, showBottomAd]);

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
    setIsFreshCompletion(false); // Reset - will be set true only by gameComplete event

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
      setIsFreshCompletion(true); // Mark as fresh completion (not loaded from storage)

      // Set initialStats so scoreboard stays frozen at completion state
      const failedAttempts = result.attempts?.length ?? 0;
      const livesRemaining = result.failed ? 0 : 3 - failedAttempts;
      setInitialStats({
        lives: livesRemaining,
        currentAttemptMoves: result.optimalMoves, // 0 moves remaining
        elapsedTimeMs: result.timeMs,
        penaltyTimeMs: 0, // Already included in timeMs
      });

      // Result is already saved in stateUpdate handler when isComplete becomes true
      // This handler now only triggers UI updates after animation completes
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

      // Only save if we're in the daily puzzle (not debug mode) and game hasn't completed
      if (debugModeRef.current || previousResult) return;

      const serializableState = gameControlsRef.current?.getSerializableState();
      if (serializableState && activeSeed) {
        if (serializableState.isComplete) {
          // Game just completed - save result immediately (before animation)
          clearInProgressState();

          const failed = serializableState.lives === 0;
          const timeMs = serializableState.elapsedTimeMs + serializableState.penaltyTimeMs;
          const todayDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

          const dailyResult: DailyStats = {
            date: todayDateStr,
            completed: !failed,
            moveCount: serializableState.moveCount,
            timeMs,
            puzzleNumber,
            attempts: serializableState.attempts,
            failed,
          };

          saveTodaysResult(dailyResult);
          setStats(getPlayerStats());
          setPreviousResult(dailyResult);
          console.log('[SAVE] Result saved immediately on completion');
        } else if (serializableState.isPlaying) {
          saveInProgressState(activeSeed, serializableState);
        }
      }
    };
    const unsubscribeStateUpdate = onGameEvent('stateUpdate', persistInProgressState);

    // Also persist while idle and when backgrounding/unloading so elapsed time doesn't jump backwards.
    const intervalId = window.setInterval(() => {
        // We can't access state directly here easily without ref, but getSerializableState works
        const state = gameControlsRef.current?.getSerializableState();
        if (state && state.isPlaying && activeSeed && !debugModeRef.current && !previousResult) {
            saveInProgressState(activeSeed, state);
        }
    }, 5000);
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
         const state = gameControlsRef.current?.getSerializableState();
         if (state && state.isPlaying && activeSeed && !debugModeRef.current && !previousResult) {
             saveInProgressState(activeSeed, state);
         }
      }
    };
    const handlePageHide = () => {
       const state = gameControlsRef.current?.getSerializableState();
       if (state && state.isPlaying && activeSeed && !debugModeRef.current && !previousResult) {
           saveInProgressState(activeSeed, state);
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
  }, [puzzleNumber, previousResult, activeSeed]);

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
    setIsPlaying(true);
    gameControlsRef.current?.start();
    setLiveAttempts([]);
    setReviewAttemptIndex(null);
    // Mount hint after 500ms delay - animation handles full lifecycle
    setShowSwipeHint(false);
    setTimeout(() => {
      setShowSwipeHint(true);
    }, 500);
  }, []);

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

    // Sync dev tools maxLives setting if not default
    if (devMaxLivesRef.current !== 3) {
      controls.setMaxLives(devMaxLivesRef.current);
    }

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
  const hasPuzzle = Boolean(puzzle);
  const loadingText = isGenerating
    ? 'Generating daily puzzle...'
    : hasPuzzle && !isGameReady
      ? 'Loading puzzle...'
      : 'Loading Mazle...';
  const displayOptimalMoves = puzzle?.optimalMoves ?? 10;
  const isPostGame = hasPuzzle && !isPlaying && (!!gameResult || !!previousResult);
  const shouldBlur = showShareCard || (hasPuzzle && !isPlaying && isGameReady && !showInlineResult);
  const showLoader = !hasPuzzle || !isGameReady;
  const showResultsButton = showInlineResult;

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
          streak={stats?.currentStreak ?? 0}
          puzzleInfo={puzzleLabel ?? (puzzleNumber > 0 ? `#${puzzleNumber}` : undefined)}
          puzzleInfoLoading={isGenerating || (!puzzle && !gameResult)}
          onHelpClick={() => setShowHelp(true)}
          onStatsClick={() => setShowStats(true)}
          logoRef={devToolsTapTargetRef}
          logoClassName={styles.devToolsTapTarget}
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
              isProd={IS_PROD}
            />
          )}

          {/* Always render GameUI - shows skeleton shimmer while loading */}
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
            loading={!hasPuzzle}
          />

          <div ref={gameStageRef} className={styles.gameArea}>
            <div className={styles.gameFrame} style={{ width: gameFrameSizePx.width, height: gameFrameSizePx.height }} ref={gameFrameRef}>
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
                <div className={styles.frameLoader}>
                  <Loader
                    text={loadingText}
                    progress={isGenerating ? progressPercent : undefined}
                  />
                </div>
              )}

              {/* Game overlays - only shown when game is ready */}
              {puzzle && isGameReady && (
                <>
                  <div className={`${styles.blurOverlay} ${!shouldBlur ? styles.blurOverlayHidden : ''}`} />
                  {lifeFlash && <div className={styles.lifeFlash} />}
                  {!isPlaying && !showInlineResult && !showShareCard && (
                    <div className={styles.startOverlay}>
                      {previousResult ? (
                        <div className={styles.previousResult}>
                          <p>
                            {previousResult.completed
                              ? 'You already completed today\u2019s puzzle!'
                              : 'You already played today\u2019s puzzle!'}
                          </p>
                          <div className={styles.previousResultActions}>
                            <button onClick={handleViewResult} className={styles.viewResultButton}>
                              View Result
                            </button>
                            <button onClick={handleShowShareCard} className={styles.shareButton}>
                              Share Score
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button className={styles.startButton} onClick={handleBegin}>
                          Begin
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className={styles.controlsArea}>
            <button
              className={styles.shareButton}
              onClick={handleShowShareCard}
              style={{
                visibility: showResultsButton && !showSwipeHint ? 'visible' : 'hidden',
                opacity: showResultsButton && !showSwipeHint ? 1 : 0,
                transform: showResultsButton && !showSwipeHint ? 'scale(1)' : 'scale(0.9)',
                pointerEvents: showResultsButton && !showSwipeHint ? 'auto' : 'none',
              }}
            >
              Share Score
            </button>
            {showSwipeHint && (
              <div
                className={styles.swipeHint}
                onAnimationEnd={() => setShowSwipeHint(false)}
              >
                Swipe anywhere to move
              </div>
            )}
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
        {showShareCard && gameResult && puzzle && (
          <ShareCard
            puzzleNumber={puzzleNumber}
            puzzleLabel={puzzleLabel ?? undefined}
            timeMs={gameResult.timeMs}
            optimalMoves={puzzle.optimalMoves}
            failed={gameResult.failed}
            attempts={gameResult.attempts}
            maxLives={devMaxLives}
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
